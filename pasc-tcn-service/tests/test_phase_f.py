import gzip
import io
import json
import unittest

from pasc_tcn_service.errors import ServiceError
from pasc_tcn_service.job_consumer import (
    ConsumerConfig,
    ConsumerError,
    HttpJobTransport,
    PascJobConsumer,
)


DATES = [f"D2020{(index // 28) + 1:02d}{(index % 28) + 1:02d}" for index in range(40)]


def claim(chunk_size=2):
    return {
        "leaseToken": "lease-token-123456789",
        "attempt": 1,
        "sourcePath": "/v1/internal/jobs/job-1/source",
        "progressPath": "/v1/internal/jobs/job-1/progress",
        "artifactPath": "/v1/internal/jobs/job-1/artifacts",
        "completePath": "/v1/internal/jobs/job-1/complete",
        "failPath": "/v1/internal/jobs/job-1/fail",
        "job": {
            "jobId": "job-1",
            "points": {"total": 0},
            "chunks": {"size": chunk_size, "total": 0},
        },
        "request": {
            "datasetName": "large.csv",
            "mapping": {
                "id": "id",
                "lon": "lon",
                "lat": "lat",
                "velocity": "",
                "coherence": "",
            },
            "settings": {
                "displacementUnit": "mm",
                "velocityUnit": "mm/year",
                "signConvention": "toward_satellite_positive",
                "preprocessingState": "already_smoothed",
            },
            "dateColumns": DATES,
        },
    }


def csv_bytes(include_bad=False, count=5):
    output = io.StringIO()
    writer = __import__("csv").DictWriter(
        output, fieldnames=["id", "lon", "lat", *DATES]
    )
    writer.writeheader()
    for index in range(count):
        point_id = "BAD" if include_bad and index == 1 else f"P-{index}"
        row = {
            "id": point_id,
            "lon": str(110 + index * 0.001),
            "lat": str(20 + index * 0.001),
        }
        row.update({date: str(-index - offset / 10) for offset, date in enumerate(DATES)})
        if not include_bad and index == 4:
            for date_field in DATES[19:]:
                row[date_field] = ""
        writer.writerow(row)
    return output.getvalue().encode("utf-8")


def point_result(point_id):
    probabilities = [0.7, 0.1, 0.05, 0.05, 0.05, 0.05]
    return {
        "pointId": point_id,
        "finalLabel": {
            "classId": 0,
            "className": "Stable",
            "classNameZh": "稳定型",
            "color": "#76D65B",
        },
        "probabilities": probabilities,
        "confidence": 0.7,
        "lowConfidence": False,
        "spatialReliability": 0.8,
        "spatialGateMean": 0.2,
        "applicability": {
            "temporal": "experimental_adapted_to_248",
            "spatial": "full_reference",
        },
        "calibrationChanged": False,
        "sources": {"velocity": "calculated", "coherence": "default"},
        "warnings": [],
        "quality": {
            "effectiveEpochs": 40,
            "missingEpochs": 0,
            "originalStart": "2020-01-01",
            "originalEnd": "2020-02-12",
            "originalSpanDays": 42,
            "missingRate": 0,
            "maximumGapDays": 2,
            "adapterApplied": True,
            "noiseResidualStd": None,
            "seriesMean": -2,
            "seriesStd": 1,
            "zscoreEpsilon": 0.00001,
        },
    }


def fake_preprocess(payload):
    if any(row["id"] == "BAD" for row in payload["records"]):
        raise ServiceError(
            "PASC_PREPROCESS_FAILED",
            "bad row",
        )
    return {
        "contractVersion": "pasc-contract-v1",
        "operation": "preprocess_only",
        "points": [{"pointId": row["id"]} for row in payload["records"]],
        "integrity": {"signature": "test"},
    }


def fake_infer(payload):
    points = [
        point_result(item["pointId"])
        for item in payload["preprocessed"]["points"]
    ]
    return {
        "contractVersion": "pasc-contract-v1",
        "modelVersion": "pasc-tcn-haikou-v1",
        "serviceVersion": "0.4.0",
        "points": points,
        "modelPackage": {
            "buildHash": "build-hash",
            "manifestSha256": "manifest-hash",
            "assetSha256": {"checkpoint": "asset-hash"},
        },
    }


class FakeTransport:
    def __init__(self, source, selected_claim=None, cancel_on_progress=None):
        self.selected_claim = selected_claim or claim()
        self.source = source
        self.cancel_on_progress = cancel_on_progress
        self.progress_calls = []
        self.artifacts = []
        self.completed = None
        self.failed = None
        self.claimed = False

    def claim(self):
        if self.claimed:
            return None
        self.claimed = True
        return self.selected_claim

    def open_source(self, _claim):
        return io.BytesIO(self.source), len(self.source)

    def progress(self, _claim, payload):
        self.progress_calls.append(payload)
        return (
            self.cancel_on_progress is not None
            and len(self.progress_calls) >= self.cancel_on_progress
        )

    def put_artifact(
        self,
        _claim,
        kind,
        chunk_index,
        content_type,
        body,
        record_count,
    ):
        self.artifacts.append(
            {
                "kind": kind,
                "chunk": chunk_index,
                "contentType": content_type,
                "body": body,
                "records": record_count,
            }
        )

    def complete(self, _claim, summary, model):
        self.completed = {"summary": summary, "model": model}

    def fail(self, _claim, code, message, retryable):
        self.failed = {
            "code": code,
            "message": message,
            "retryable": retryable,
        }


class PhaseFConsumerTests(unittest.TestCase):
    def test_config_and_paths_reject_arbitrary_urls(self):
        with self.assertRaises(ConsumerError):
            ConsumerConfig(
                "https://user:pass@example.com", "x" * 32, "worker"
            ).validate()
        with self.assertRaises(ConsumerError):
            ConsumerConfig(
                "https://example.com", "short", "worker"
            ).validate()
        transport = HttpJobTransport(
            ConsumerConfig(
                "https://webgis.example.com",
                "x" * 32,
                "worker",
            )
        )
        self.assertEqual(
            transport._safe_url("/v1/internal/jobs/job-1/source"),
            "https://webgis.example.com/v1/internal/jobs/job-1/source",
        )
        with self.assertRaises(ConsumerError):
            transport._safe_url("https://attacker.invalid/source")

    def test_streaming_job_writes_chunks_summary_audit_errors_and_maps(self):
        transport = FakeTransport(csv_bytes(count=81))
        consumer = PascJobConsumer(
            transport,
            preprocess_fn=fake_preprocess,
            infer_fn=fake_infer,
        )
        self.assertTrue(consumer.run_once())
        self.assertIsNone(transport.failed)
        self.assertEqual(transport.completed["summary"]["points"], 81)
        self.assertEqual(transport.completed["summary"]["predicted"], 80)
        self.assertEqual(transport.completed["summary"]["unsupported"], 1)
        kinds = [item["kind"] for item in transport.artifacts]
        self.assertEqual(kinds.count("preprocessed"), 2)
        self.assertEqual(kinds.count("predictions"), 2)
        self.assertIn("validation", kinds)
        self.assertIn("summary", kinds)
        self.assertIn("audit", kinds)
        self.assertIn("errors", kinds)
        self.assertEqual(kinds.count("map_level_0"), 1)
        self.assertEqual(kinds.count("map_level_1"), 1)
        self.assertEqual(kinds.count("map_level_2"), 1)
        prediction = next(
            item for item in transport.artifacts
            if item["kind"] == "predictions"
        )
        decoded = gzip.decompress(prediction["body"]).decode("utf-8")
        self.assertIn('"pointId":"P-0"', decoded)
        self.assertNotIn("D2020", decoded)
        map_artifact = next(
            item for item in transport.artifacts
            if item["kind"] == "map_level_2"
        )
        map_payload = json.loads(map_artifact["body"])
        self.assertEqual(map_payload["returnedPoints"], 80)
        self.assertEqual(
            map_payload["strategy"],
            "deterministic_multilevel_decimation",
        )

    def test_cancellation_stops_at_progress_boundary(self):
        transport = FakeTransport(
            csv_bytes(), cancel_on_progress=1
        )
        consumer = PascJobConsumer(
            transport,
            preprocess_fn=fake_preprocess,
            infer_fn=fake_infer,
        )
        consumer.run_once()
        self.assertIsNone(transport.completed)
        self.assertEqual(
            transport.failed["code"], "PASC_JOB_CANCELLED"
        )
        self.assertFalse(transport.failed["retryable"])
        self.assertEqual(transport.artifacts, [])

    def test_bad_row_isolated_without_losing_good_chunk_results(self):
        transport = FakeTransport(
            csv_bytes(include_bad=True), claim(chunk_size=5)
        )
        consumer = PascJobConsumer(
            transport,
            preprocess_fn=fake_preprocess,
            infer_fn=fake_infer,
        )
        consumer.run_once()
        self.assertIsNone(transport.failed)
        self.assertEqual(transport.completed["summary"]["predicted"], 4)
        self.assertEqual(transport.completed["summary"]["unsupported"], 1)
        self.assertEqual(
            [
                item["kind"] for item in transport.artifacts
            ].count("predictions"),
            1,
        )
        preprocessed = next(
            item for item in transport.artifacts
            if item["kind"] == "preprocessed"
        )
        wrapper = json.loads(
            gzip.decompress(preprocessed["body"]).decode("utf-8")
        )
        self.assertEqual(
            wrapper["format"], "sealed_preprocessed_fragments_v1"
        )
        self.assertGreaterEqual(len(wrapper["fragments"]), 2)


if __name__ == "__main__":
    unittest.main()

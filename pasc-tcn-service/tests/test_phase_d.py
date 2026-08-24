from __future__ import annotations

import asyncio
import copy
import json
import os
import re
import shutil
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import numpy as np

from pasc_tcn_service.api import application, dispatch
from pasc_tcn_service.errors import ServiceError
from pasc_tcn_service.inference import (
    MAX_SYNC_INFER_POINTS,
    infer_payload,
    get_runtime,
    reset_runtime,
    verify_bundle,
)
from pasc_tcn_service.security import seal_preprocessed, verify_preprocessed

SERVICE_ROOT = Path(__file__).resolve().parents[1]
FIXTURE = json.loads(
    (Path(__file__).parent / "fixtures" / "phase_d_inference_golden.json").read_text(
        encoding="utf-8"
    )
)
ARTIFACT_KEY = "artifact-signing-key-0123456789abcdef"
API_KEY = "service-api-key-0123456789abcdef"


class PhaseDInferenceTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.saved = {
            name: os.environ.get(name)
            for name in (
                "PASC_MODEL_BUNDLE_DIR",
                "PASC_DEVICE",
                "PASC_ARTIFACT_SIGNING_KEY",
                "PASC_SERVICE_API_KEY",
            )
        }
        os.environ.update(
            {
                "PASC_MODEL_BUNDLE_DIR": str(
                    SERVICE_ROOT
                    / ".private-model-bundles"
                    / "pasc-tcn-haikou-v1"
                ),
                "PASC_DEVICE": "cpu",
                "PASC_ARTIFACT_SIGNING_KEY": ARTIFACT_KEY,
                "PASC_SERVICE_API_KEY": API_KEY,
            }
        )
        reset_runtime()

    @classmethod
    def tearDownClass(cls):
        reset_runtime()
        for name, value in cls.saved.items():
            if value is None:
                os.environ.pop(name, None)
            else:
                os.environ[name] = value

    def call(self, method, path, body=None, *, authorized=False):
        raw = (
            json.dumps(body, ensure_ascii=False).encode("utf-8")
            if body is not None
            else b""
        )
        headers = {"authorization": f"Bearer {API_KEY}"} if authorized else None
        return dispatch(method, path, raw, headers)

    def preprocess(self, scenario):
        status, body = self.call(
            "POST", "/v1/preprocess", FIXTURE["scenarioRequests"][scenario]
        )
        self.assertEqual(status, 200, body)
        self.assertTrue(body["integrity"]["signed"])
        return body

    def infer(self, scenario):
        artifact = self.preprocess(scenario)
        status, body = self.call(
            "POST",
            "/v1/infer",
            {"contractVersion": "pasc-contract-v1", "preprocessed": artifact},
            authorized=True,
        )
        self.assertEqual(status, 200, body)
        return body

    def assert_golden(self, scenario, actual):
        expected = FIXTURE["expected"][scenario]
        self.assertEqual(len(actual), len(expected))
        tolerance = FIXTURE["tolerances"]
        for result, golden in zip(actual, expected):
            self.assertEqual(result["pointId"], golden["pointId"])
            self.assertEqual(result["rawResult"]["classId"], golden["rawLabel"])
            self.assertEqual(result["finalLabel"]["classId"], golden["finalLabel"])
            np.testing.assert_allclose(
                result["rawResult"]["probabilities"],
                golden["rawProbabilities"],
                atol=tolerance["absolute"],
                rtol=tolerance["relative"],
            )
            np.testing.assert_allclose(
                result["probabilities"],
                golden["calibratedProbabilities"],
                atol=tolerance["absolute"],
                rtol=tolerance["relative"],
            )
            self.assertAlmostEqual(
                result["confidence"], golden["confidence"], delta=tolerance["absolute"]
            )
            self.assertAlmostEqual(
                result["spatialReliability"],
                golden["spatialReliability"],
                delta=tolerance["absolute"],
            )
            self.assertAlmostEqual(
                result["spatialGateMean"],
                golden["spatialGateMean"],
                delta=tolerance["absolute"],
            )

    def test_native_248_matches_formal_golden(self):
        body = self.infer("native248")
        self.assert_golden("native248", body["points"])
        self.assertTrue(body["audit"]["assetHashesVerified"])
        self.assertFalse(body["audit"]["userDataFit"])
        self.assertFalse(body["audit"]["trainingPathAvailable"])
        self.assertEqual(body["audit"]["referenceRows"], 1036)
        self.assertEqual(len(body["modelPackage"]["assetSha256"]), 8)

    def test_adapted_40_matches_formal_golden(self):
        body = self.infer("adapted40")
        self.assert_golden("adapted40", body["points"])
        result = body["points"][0]
        self.assertEqual(
            result["applicability"]["temporal"],
            "experimental_adapted_to_248",
        )

    def test_concurrency_queue_timeout_is_deterministic(self):
        artifact = self.preprocess("adapted40")
        points = verify_preprocessed(artifact)["points"]
        runtime = get_runtime()
        previous = runtime.queue_timeout_seconds
        self.assertTrue(runtime._inference_slots.acquire(timeout=0))
        try:
            runtime.queue_timeout_seconds = 0
            with self.assertRaises(ServiceError) as captured:
                runtime.infer(points)
        finally:
            runtime.queue_timeout_seconds = previous
            runtime._inference_slots.release()
        self.assertEqual(captured.exception.code, "PASC_INFERENCE_BUSY")
        self.assertEqual(captured.exception.status, 503)


    def test_external_city_is_limited_reference(self):
        body = self.infer("external")
        self.assert_golden("external", body["points"])
        result = body["points"][0]
        self.assertEqual(result["applicability"]["spatial"], "limited_reference")
        self.assertEqual(result["spatialReliability"], 0.0)
        self.assertEqual(result["spatialGateMean"], 0.0)
        self.assertIn(
            "PASC_SPATIAL_REFERENCE_LIMITED",
            [warning["code"] for warning in result["warnings"]],
        )

    def test_infer_requires_service_authorization(self):
        artifact = self.preprocess("adapted40")
        payload = {"preprocessed": artifact}
        status, body = self.call("POST", "/v1/infer", payload)
        self.assertEqual(status, 401)
        self.assertEqual(body["error"]["code"], "PASC_AUTHORIZATION_FAILED")
        status, body = dispatch(
            "POST",
            "/v1/infer",
            json.dumps(payload).encode(),
            {"x-pasc-service-key": "wrong-key"},
        )
        self.assertEqual(status, 401)
        self.assertEqual(body["error"]["code"], "PASC_AUTHORIZATION_FAILED")

    def test_unsigned_or_tampered_preprocessing_is_rejected(self):
        with patch.dict(os.environ, {"PASC_ARTIFACT_SIGNING_KEY": ""}):
            status, unsigned = self.call(
                "POST", "/v1/preprocess", FIXTURE["scenarioRequests"]["adapted40"]
            )
        self.assertEqual(status, 200, unsigned)
        self.assertFalse(unsigned["integrity"]["signed"])
        status, body = self.call(
            "POST", "/v1/infer", {"preprocessed": unsigned}, authorized=True
        )
        self.assertEqual(status, 422)
        self.assertEqual(
            body["error"]["code"], "PASC_PREPROCESSED_ARTIFACT_INVALID"
        )

        artifact = self.preprocess("adapted40")
        artifact["points"][0]["normalizedSeries"][0] += 0.25
        status, body = self.call(
            "POST", "/v1/infer", {"preprocessed": artifact}, authorized=True
        )
        self.assertEqual(status, 422)
        self.assertEqual(
            body["error"]["code"], "PASC_PREPROCESSED_ARTIFACT_INVALID"
        )

    def test_sync_point_limit_fails_before_model_execution(self):
        artifact = self.preprocess("adapted40")
        point = artifact["points"][0]
        artifact["points"] = [copy.deepcopy(point) for _ in range(MAX_SYNC_INFER_POINTS + 1)]
        artifact = seal_preprocessed(artifact)
        with self.assertRaises(ServiceError) as captured:
            infer_payload({"preprocessed": artifact})
        self.assertEqual(captured.exception.code, "PASC_INFERENCE_LIMIT_EXCEEDED")
        self.assertEqual(captured.exception.status, 413)

    def test_bundle_hash_mismatch_fails_closed(self):
        source = Path(os.environ["PASC_MODEL_BUNDLE_DIR"])
        with tempfile.TemporaryDirectory() as temporary:
            target = Path(temporary) / "bundle"
            shutil.copytree(source, target)
            with (target / "classes.json").open("ab") as stream:
                stream.write(b"\n")
            with self.assertRaises(ServiceError) as captured:
                verify_bundle(target)
        self.assertEqual(captured.exception.code, "PASC_MODEL_ASSET_HASH_MISMATCH")
        self.assertEqual(captured.exception.status, 503)

    def test_asgi_lifespan_refuses_required_missing_bundle(self):
        events = [{"type": "lifespan.startup"}]
        sent = []

        async def receive():
            return events.pop(0)

        async def send(event):
            sent.append(event)

        with patch.dict(
            os.environ,
            {
                "PASC_MODEL_BUNDLE_DIR": "",
                "PASC_REQUIRE_INFERENCE": "1",
            },
        ):
            reset_runtime()
            asyncio.run(
                application(
                    {"type": "lifespan"}, receive, send
                )
            )
        reset_runtime()
        self.assertEqual(
            sent,
            [
                {
                    "type": "lifespan.startup.failed",
                    "message": "PASC_MODEL_UNAVAILABLE",
                }
            ],
        )


    def test_runtime_source_has_no_training_entry_point(self):
        forbidden = re.compile(r"\boptimizer\b|\.backward\s*\(|\bdef\s+fit\b|\.fit\s*\(|\btrain\s*\(")
        for name in ("model_architecture.py", "inference.py"):
            text = (
                SERVICE_ROOT / "src" / "pasc_tcn_service" / name
            ).read_text(encoding="utf-8")
            self.assertIsNone(forbidden.search(text), name)


if __name__ == "__main__":
    unittest.main()

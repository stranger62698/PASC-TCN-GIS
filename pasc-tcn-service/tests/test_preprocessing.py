from __future__ import annotations

import json
import unittest
from datetime import date, timedelta
from pathlib import Path

import numpy as np

from pasc_tcn_service.contract import FEATURE_NAMES
from pasc_tcn_service.errors import ServiceError
from pasc_tcn_service.preprocessing import (
    preprocess_payload,
    rowwise_zscore,
    savgol_filter_9_3,
)


def payload_for(count: int, *, state="already_smoothed", with_velocity=False, interval_days=12):
    start = date(2020, 1, 1)
    record = {"fid": "p1", "xpos": 110.3, "ypos": 20.1}
    for index in range(count):
        record["D" + (start + timedelta(days=index * interval_days)).strftime("%Y%m%d")] = -float(index)
    mapping = {"pointId": "fid", "longitude": "xpos", "latitude": "ypos"}
    settings = {
        "displacementUnit": "mm",
        "signConvention": "model_native",
        "preprocessingState": state,
    }
    if with_velocity:
        record["Vel"] = -3.0
        mapping["velocity"] = "Vel"
        settings["velocityUnit"] = "mm/year"
    return {"mapping": mapping, "settings": settings, "records": [record]}


class PreprocessingTests(unittest.TestCase):
    def test_rowwise_zscore_formula_and_metadata(self):
        source = np.asarray([[1.0, 2.0, 3.0]], dtype=np.float32)
        normalized, mean, std = rowwise_zscore(source)
        expected = (source - np.mean(source)) / (np.std(source) + 1e-5)
        np.testing.assert_allclose(normalized, expected.astype(np.float32))
        self.assertEqual(float(mean[0, 0]), 2.0)
        self.assertAlmostEqual(float(std[0, 0]), float(np.std(source)), places=7)

    def test_savgol_preserves_cubic_polynomial_including_edges(self):
        x = np.arange(40, dtype=np.float64)
        source = 0.01 * x**3 - 0.2 * x**2 + 2.0 * x - 4.0
        filtered = savgol_filter_9_3(source)
        np.testing.assert_allclose(filtered, source, atol=2e-4, rtol=1e-6)

    def test_40_epochs_are_adapted_and_smoothed(self):
        output = preprocess_payload(payload_for(40, state="raw"))
        point = output["points"][0]
        self.assertEqual(point["status"], "adapted_experimental")
        self.assertEqual(len(point["targetDates"]), 248)
        self.assertEqual(len(point["preprocessedSeriesMm"]), 248)
        self.assertEqual(len(point["normalizedSeries"]), 248)
        self.assertTrue(point["quality"]["adapterApplied"])
        self.assertTrue(point["quality"]["smoothing"]["applied"])
        self.assertEqual(point["velocity"]["source"], "calculated")
        self.assertEqual(point["velocity"]["method"], "least_squares_real_dates")
        self.assertEqual(point["coherence"]["source"], "default")
        self.assertEqual(len(point["features"]["raw"]), 13)
        self.assertEqual(point["features"]["order"], list(FEATURE_NAMES))

    def test_20_epochs_are_adapted_with_sparse_evidence_warning(self):
        output = preprocess_payload(payload_for(20))
        point = output["points"][0]
        self.assertEqual(point["status"], "adapted_experimental")
        self.assertEqual(point["quality"]["effectiveEpochs"], 20)
        self.assertEqual(len(point["targetDates"]), 248)
        self.assertIn(
            "PASC_20_TO_39_EXPLORATORY",
            {item["code"] for item in point["quality"]["warnings"]},
        )

    def test_210_epochs_are_automatically_interpolated_to_248(self):
        output = preprocess_payload(payload_for(210))
        point = output["points"][0]
        self.assertEqual(point["status"], "adapted_experimental")
        self.assertTrue(point["quality"]["adapterApplied"])
        self.assertEqual(point["quality"]["effectiveEpochs"], 210)
        self.assertEqual(len(point["targetDates"]), 248)
        self.assertEqual(len(point["preprocessedSeriesMm"]), 248)
        self.assertEqual(point["targetDates"][0][:10], "2020-01-01")
        self.assertEqual(point["targetDates"][-1][:10], (date(2020, 1, 1) + timedelta(days=209 * 12)).isoformat())

    def test_non_12_day_248_epochs_are_adapted_and_warned(self):
        output = preprocess_payload(payload_for(248, interval_days=24))
        point = output["points"][0]
        self.assertEqual(point["status"], "adapted_experimental")
        self.assertTrue(point["quality"]["adapterApplied"])
        self.assertEqual(point["quality"]["medianGapDays"], 24.0)
        self.assertEqual(point["quality"]["cadenceStatus"], "non_12_day_cadence")
        self.assertIn(
            "PASC_NON_SENTINEL_CADENCE",
            {item["code"] for item in point["quality"]["warnings"]},
        )
    def test_248_epochs_bypass_adapter_and_sg_when_already_smoothed(self):
        payload = payload_for(248)
        output = preprocess_payload(payload)
        point = output["points"][0]
        self.assertEqual(point["status"], "native_248")
        self.assertFalse(point["quality"]["adapterApplied"])
        self.assertFalse(point["quality"]["smoothing"]["applied"])
        self.assertIsNone(point["quality"]["noiseResidualStd"])
        self.assertEqual(point["quality"]["noiseResidualStatus"], "not_available")
        self.assertEqual(point["preprocessedSeriesMm"], [-float(index) for index in range(248)])

    def test_unit_and_sign_are_normalized_before_velocity_and_adapter(self):
        payload = payload_for(40, with_velocity=True)
        payload["settings"]["displacementUnit"] = "cm"
        payload["settings"]["velocityUnit"] = "cm/year"
        payload["settings"]["signConvention"] = "subsidence_positive"
        output = preprocess_payload(payload)
        point = output["points"][0]
        self.assertEqual(point["preprocessedSeriesMm"][0], 0.0)
        self.assertAlmostEqual(point["preprocessedSeriesMm"][-1], 390.0, places=4)
        self.assertEqual(point["velocity"]["valueMmPerYear"], 30.0)

    def test_unsupported_point_returns_reason_without_arrays(self):
        output = preprocess_payload(payload_for(19))
        point = output["points"][0]
        self.assertEqual(point["status"], "unsupported")
        self.assertEqual(point["reason"]["code"], "PASC_TOO_FEW_VALID_EPOCHS")
        self.assertNotIn("normalizedSeries", point)

    def test_unknown_preprocessing_state_blocks_preprocess(self):
        payload = payload_for(40)
        payload["settings"]["preprocessingState"] = "unknown"
        with self.assertRaises(ServiceError) as context:
            preprocess_payload(payload)
        self.assertEqual(context.exception.code, "PASC_PREPROCESSING_STATE_REQUIRED")

    def test_native248_golden_regression(self):
        fixture_path = Path(__file__).parent / "fixtures" / "native248_golden.json"
        fixture = json.loads(fixture_path.read_text(encoding="utf-8"))
        output = preprocess_payload(fixture["request"])
        self.assertEqual(output["summary"], {
            "points": 3,
            "native248": 3,
            "experimental": 0,
            "unsupported": 0,
        })
        atol = fixture["tolerances"]["absolute"]
        rtol = fixture["tolerances"]["relative"]
        for actual, expected in zip(output["points"], fixture["expected"]):
            self.assertEqual(actual["pointId"], expected["pointId"])
            self.assertEqual(actual["targetDates"], expected["targetDates"])
            np.testing.assert_allclose(
                actual["preprocessedSeriesMm"],
                expected["preprocessedSeriesMm"],
                atol=atol,
                rtol=rtol,
            )
            np.testing.assert_allclose(
                actual["normalizedSeries"],
                expected["normalizedSeries"],
                atol=atol,
                rtol=rtol,
            )
            np.testing.assert_allclose(
                actual["features"]["raw"],
                expected["featuresRaw"],
                atol=atol,
                rtol=rtol,
            )
            np.testing.assert_allclose(
                actual["features"]["scaled"],
                expected["featuresScaled"],
                atol=atol,
                rtol=rtol,
            )
            self.assertAlmostEqual(
                actual["velocity"]["valueMmPerYear"],
                expected["velocityMmPerYear"],
                places=5,
            )
            self.assertAlmostEqual(
                actual["coherence"]["value"],
                expected["coherence"],
                places=6,
            )


if __name__ == "__main__":
    unittest.main()

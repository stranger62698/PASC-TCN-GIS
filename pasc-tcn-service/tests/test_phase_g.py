from __future__ import annotations

import json
import os
import unittest
from pathlib import Path

from pasc_tcn_service.inference import reset_runtime
from pasc_tcn_service.phase_g import (
    EXPLORATORY_LINE_1,
    EXPLORATORY_LINE_2,
    EXPLORATORY_TITLE,
    build_external_coordinate_request,
    build_sampling_request,
    build_self_neighborhood_experiment_request,
    build_sign_equivalent_request,
    build_unit_equivalent_request,
    compare_preprocessed,
    evaluate_phase_g,
    self_neighborhood_diagnostics,
)
from pasc_tcn_service.preprocessing import preprocess_payload

SERVICE_ROOT = Path(__file__).resolve().parents[1]
FIXTURE = json.loads(
    (Path(__file__).parent / "fixtures" / "phase_d_inference_golden.json").read_text(encoding="utf-8")
)
ARTIFACT_KEY = "phase-g-test-signing-key-0123456789abcdef"


class PhaseGPureEvidenceTests(unittest.TestCase):
    def setUp(self):
        self.native = FIXTURE["scenarioRequests"]["native248"]

    def test_coordinate_shift_does_not_change_temporal_or_physical_inputs(self):
        reference = preprocess_payload(self.native)
        external = preprocess_payload(build_self_neighborhood_experiment_request(self.native))
        comparison = compare_preprocessed(reference, external)
        self.assertEqual(comparison["normalizedSeriesMaxAbsDiff"], 0.0)
        self.assertEqual(comparison["physicalRawMaxAbsDiff"], 0.0)
        self.assertEqual(comparison["physicalScaledMaxAbsDiff"], 0.0)
        self.assertNotEqual(reference["points"][0]["longitude"], external["points"][0]["longitude"])

    def test_unit_and_sign_equivalent_inputs_normalize_back_to_native(self):
        reference = preprocess_payload(self.native)
        for transformed in (
            build_unit_equivalent_request(self.native),
            build_sign_equivalent_request(self.native),
        ):
            comparison = compare_preprocessed(reference, preprocess_payload(transformed))
            self.assertLessEqual(comparison["normalizedSeriesMaxAbsDiff"], 2e-6)
            self.assertLessEqual(comparison["physicalRawMaxAbsDiff"], 2e-5)
            self.assertLessEqual(comparison["physicalScaledMaxAbsDiff"], 2e-5)

    def test_sampling_is_deterministic_and_preserves_endpoints(self):
        for epochs in (40, 80, 160):
            first = build_sampling_request(self.native, epochs)
            second = build_sampling_request(self.native, epochs)
            self.assertEqual(first, second)
            selected = first["mapping"]["dateColumns"]
            source = self.native["mapping"]["dateColumns"]
            self.assertEqual(len(selected), epochs)
            self.assertEqual(selected[0], source[0])
            self.assertEqual(selected[-1], source[-1])

    def test_self_neighborhood_is_never_applied_to_predictions(self):
        external = preprocess_payload(build_self_neighborhood_experiment_request(self.native))
        diagnostic = self_neighborhood_diagnostics(external["points"])
        self.assertEqual(diagnostic["status"], "evaluated_not_applied")
        self.assertFalse(diagnostic["predictionApplied"])
        self.assertFalse(diagnostic["productionEligible"])
        self.assertFalse(diagnostic["accuracyEvaluated"])
        self.assertGreater(diagnostic["meanCandidateReliability"], 0.0)


class PhaseGFrozenRuntimeTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.saved = {
            name: os.environ.get(name)
            for name in ("PASC_MODEL_BUNDLE_DIR", "PASC_DEVICE", "PASC_ARTIFACT_SIGNING_KEY")
        }
        os.environ.update(
            {
                "PASC_MODEL_BUNDLE_DIR": str(SERVICE_ROOT / ".private-model-bundles" / "pasc-tcn-haikou-v1"),
                "PASC_DEVICE": "cpu",
                "PASC_ARTIFACT_SIGNING_KEY": ARTIFACT_KEY,
            }
        )
        reset_runtime()
        cls.result = evaluate_phase_g(FIXTURE)

    @classmethod
    def tearDownClass(cls):
        reset_runtime()
        for name, value in cls.saved.items():
            if value is None:
                os.environ.pop(name, None)
            else:
                os.environ[name] = value

    def test_external_branch_is_suppressed_and_claims_remain_bounded(self):
        self.assertTrue(self.result["branchEvidence"]["externalSpatialBranchSuppressed"])
        self.assertFalse(self.result["claims"]["externalAccuracyEvaluated"])
        self.assertFalse(self.result["claims"]["arbitraryCityHighAccuracyClaimed"])
        self.assertEqual(
            self.result["requiredProductWording"],
            [EXPLORATORY_TITLE, EXPLORATORY_LINE_1, EXPLORATORY_LINE_2],
        )

    def test_frozen_boundary_and_orbit_limit_are_explicit(self):
        self.assertTrue(all(value is False for value in self.result["frozenBoundary"].values()))
        self.assertEqual(
            self.result["orbitDifference"]["status"],
            "not_evaluable_from_current_contract",
        )
        self.assertFalse(self.result["selfNeighborhood"]["predictionApplied"])

    def test_all_scenarios_are_non_accuracy_evidence(self):
        self.assertEqual(len(self.result["scenarios"]), 8)
        self.assertTrue(all(not item["accuracyEvaluated"] for item in self.result["scenarios"]))
        names = {item["scenario"] for item in self.result["scenarios"]}
        self.assertTrue({"sampled_40", "sampled_80", "sampled_160"}.issubset(names))


if __name__ == "__main__":
    unittest.main()

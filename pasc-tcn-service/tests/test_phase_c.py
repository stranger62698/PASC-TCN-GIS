from __future__ import annotations

import unittest

import numpy as np

from pasc_tcn_service.phase_c import (
    EPOCH_GROUPS,
    SAMPLING_METHODS,
    adapt_selected_series,
    build_sampling_manifest,
    calibrate_probabilities,
    sampling_indices,
)


class PhaseCSamplingTests(unittest.TestCase):
    def test_all_sampling_scenarios_are_exact_unique_and_endpoint_preserving(self):
        for epochs in EPOCH_GROUPS:
            for method in SAMPLING_METHODS:
                with self.subTest(epochs=epochs, method=method):
                    selected = sampling_indices(epochs, method)
                    self.assertEqual(len(selected), epochs)
                    self.assertEqual(len(np.unique(selected)), epochs)
                    self.assertEqual(selected[0], 0)
                    self.assertEqual(selected[-1], 247)
                    self.assertTrue(np.all(np.diff(selected) > 0))

    def test_sampling_is_deterministic(self):
        for epochs in EPOCH_GROUPS:
            for method in SAMPLING_METHODS:
                np.testing.assert_array_equal(
                    sampling_indices(epochs, method),
                    sampling_indices(epochs, method),
                )

    def test_continuous_gap_has_one_missing_run(self):
        selected = sampling_indices(80, "continuous_gap")
        missing = np.setdiff1d(np.arange(248), selected)
        self.assertEqual(len(missing), 168)
        self.assertTrue(np.all(np.diff(missing) == 1))

    def test_front_and_back_density_are_directional(self):
        front_dense = sampling_indices(80, "front_dense_back_sparse")
        back_dense = sampling_indices(80, "front_sparse_back_dense")
        self.assertGreater(np.sum(front_dense < 124), np.sum(front_dense >= 124))
        self.assertLess(np.sum(back_dense < 124), np.sum(back_dense >= 124))

    def test_manifest_has_baseline_and_twenty_five_sampling_scenarios(self):
        columns = [f"D2020{index:04d}" for index in range(248)]
        manifest = build_sampling_manifest(columns)
        self.assertEqual(len(manifest["scenarios"]), 26)
        self.assertEqual(manifest["scenarios"][0]["scenario"], "baseline_248")
        self.assertEqual(len(manifest["sha256"]), 64)

    def test_adapter_restores_248_nodes_and_preserves_endpoints(self):
        days = np.arange(248, dtype=np.float32) * 12
        raw = np.vstack((np.arange(248), -np.arange(248))).astype(np.float32)
        selected = sampling_indices(40, "random_missing")
        adapted, years = adapt_selected_series(raw, days, selected)
        self.assertEqual(adapted.shape, (2, 248))
        self.assertEqual(len(years), 248)
        np.testing.assert_allclose(adapted[:, 0], raw[:, 0])
        np.testing.assert_allclose(adapted[:, -1], raw[:, -1])

    def test_calibration_only_boosts_dynamic_classes_then_renormalizes(self):
        source = np.asarray([[0.2, 0.2, 0.1, 0.1, 0.1, 0.3]], dtype=np.float32)
        calibrated = calibrate_probabilities(source)
        np.testing.assert_allclose(calibrated.sum(axis=1), 1.0)
        ratios = calibrated[0] / source[0]
        self.assertAlmostEqual(ratios[2] / ratios[0], 1.35, places=5)
        self.assertAlmostEqual(ratios[3] / ratios[1], 1.35, places=5)


if __name__ == "__main__":
    unittest.main()

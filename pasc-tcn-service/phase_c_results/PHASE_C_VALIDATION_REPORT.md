# PASC-TCN Phase C — fixed 523-sample validation

> Experimental evidence only. This report defines no acceptance threshold and
> does not declare a supported minimum epoch count. The user owns that decision.

## Protocol

- Fixed 523 test rows; no resplit and no additional samples
- Native 248 baseline; sampled 160/120/80/60/40 groups
- Five deterministic patterns with persisted dates and indices
- Both endpoints preserved, then Phase B linear Adapter to 248 nodes
- Already-smoothed input skips SG
- Frozen M4, frozen Scaler, training-only 1,036-row spatial reference
- Dynamic-class probability boost: 1.35
- Sampling manifest SHA-256: c5515d474cfe0e5f5191a84a25bd5b0a860782588fb1bbabb4e07e97940ea829

## Frozen provenance

| Asset | SHA-256 |
|---|---|
| data | e2740b4c20b82357f1acc1f67230fa3972fa9ee624ad1e5073cbfb8c324a8265 |
| split | 956a8162b95712d7abf49102ee8a869fd9620fcf46e811feb86d4642d02f484c |
| checkpoint | a45b91c0b8288d87481f5c13db82a574d79a13086b28a49eb148617155ca6107 |
| baselinePredictions | 40250d66014da01a0d2295d68b537bd2b7a7c8bb4f0f29401735343bf270fba1 |
| modelCode | 16e4de4a65c8861647103dbafb7758a5236761faab158657fe4abfbe8d64186c |

## Baseline reproduction

- Existing raw labels matched: 523/523
- Maximum raw-confidence difference: 0.0000230067
- Calibrated Accuracy / Macro-F1: 0.927342 / 0.926391
- Raw Accuracy / Macro-F1: 0.923518 / 0.922634

## Scenario results

| Scenario | Epochs | Accuracy | Macro-F1 | Agreement | Confidence shift | Calibration change | Failures |
|---|---|---|---|---|---|---|---|
| baseline_248 | 248 | 0.927342 | 0.926391 | 1.000000 | +0.000000 | 0.003824 | 0 |
| uniform_160 | 160 | 0.925430 | 0.924455 | 0.994264 | +0.000829 | 0.007648 | 0 |
| random_missing_160 | 160 | 0.927342 | 0.926339 | 0.996176 | +0.000229 | 0.005736 | 0 |
| continuous_gap_160 | 160 | 0.837476 | 0.833186 | 0.847036 | -0.022587 | 0.011472 | 0 |
| front_dense_back_sparse_160 | 160 | 0.923518 | 0.922613 | 0.992352 | -0.000815 | 0.003824 | 0 |
| front_sparse_back_dense_160 | 160 | 0.923518 | 0.922563 | 0.994264 | +0.001447 | 0.003824 | 0 |
| uniform_120 | 120 | 0.923518 | 0.922484 | 0.992352 | +0.000858 | 0.003824 | 0 |
| random_missing_120 | 120 | 0.929254 | 0.928583 | 0.982792 | +0.000098 | 0.005736 | 0 |
| continuous_gap_120 | 120 | 0.766730 | 0.742527 | 0.780115 | -0.030747 | 0.007648 | 0 |
| front_dense_back_sparse_120 | 120 | 0.921606 | 0.920719 | 0.994264 | -0.000238 | 0.005736 | 0 |
| front_sparse_back_dense_120 | 120 | 0.936902 | 0.936091 | 0.986616 | -0.001031 | 0.005736 | 0 |
| uniform_80 | 80 | 0.925430 | 0.924401 | 0.994264 | -0.000408 | 0.005736 | 0 |
| random_missing_80 | 80 | 0.915870 | 0.915086 | 0.965583 | -0.002940 | 0.000000 | 0 |
| continuous_gap_80 | 80 | 0.636711 | 0.587269 | 0.640535 | -0.071710 | 0.011472 | 0 |
| front_dense_back_sparse_80 | 80 | 0.921606 | 0.920866 | 0.984704 | -0.001700 | 0.009560 | 0 |
| front_sparse_back_dense_80 | 80 | 0.927342 | 0.926551 | 0.977055 | -0.003681 | 0.009560 | 0 |
| uniform_60 | 60 | 0.923518 | 0.922637 | 0.978967 | -0.002359 | 0.007648 | 0 |
| random_missing_60 | 60 | 0.908222 | 0.907527 | 0.948375 | -0.010130 | 0.005736 | 0 |
| continuous_gap_60 | 60 | 0.663480 | 0.639146 | 0.665392 | -0.060448 | 0.026769 | 0 |
| front_dense_back_sparse_60 | 60 | 0.917782 | 0.916985 | 0.978967 | -0.003950 | 0.001912 | 0 |
| front_sparse_back_dense_60 | 60 | 0.919694 | 0.919071 | 0.969407 | -0.006888 | 0.007648 | 0 |
| uniform_40 | 40 | 0.921606 | 0.920817 | 0.971319 | -0.007034 | 0.003824 | 0 |
| random_missing_40 | 40 | 0.900574 | 0.899402 | 0.938815 | -0.011175 | 0.007648 | 0 |
| continuous_gap_40 | 40 | 0.437859 | 0.405076 | 0.434034 | -0.094099 | 0.034417 | 0 |
| front_dense_back_sparse_40 | 40 | 0.925430 | 0.924267 | 0.978967 | -0.003681 | 0.011472 | 0 |
| front_sparse_back_dense_40 | 40 | 0.908222 | 0.906967 | 0.942639 | -0.018956 | 0.005736 | 0 |

## Descriptive aggregation across five patterns

These mean/min values are descriptive and are not acceptance criteria.

| Epochs | Mean accuracy | Min accuracy | Mean Macro-F1 | Min Macro-F1 | Mean agreement |
|---|---|---|---|---|---|
| 160 | 0.907457 | 0.837476 | 0.905831 | 0.833186 | 0.964818 |
| 120 | 0.895602 | 0.766730 | 0.890081 | 0.742527 | 0.947228 |
| 80 | 0.865392 | 0.636711 | 0.854835 | 0.587269 | 0.912428 |
| 60 | 0.866539 | 0.663480 | 0.861073 | 0.639146 | 0.908222 |
| 40 | 0.818738 | 0.437859 | 0.811306 | 0.405076 | 0.853155 |

## Metric definitions

- Accuracy, Macro-F1 and per-class Precision/Recall/F1 use calibrated labels.
- Prediction Agreement compares each calibrated label with native-248.
- Confidence Shift is mean calibrated confidence minus native-248 confidence.
- Calibration Change Rate is calibrated label different from raw label.
- Failure Count is non-finite or non-normalized probability rows.
- Complete per-class calibrated/raw metrics are in CSV and JSON.

## Scope boundary

No threshold or supported minimum was selected. No /v1/infer endpoint, online
classifier, training entry point, checkpoint copy, or Phase D code was added.

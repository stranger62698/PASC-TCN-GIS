# Phase G Completion Report

Date: 2026-08-24
Branch: codex/pasc-phase-g
Scope: v4 Phase G only — external-region evidence, spatial applicability, and product-honesty controls
Stop boundary: no post-v4 phase or autonomous model change started

## Outcome

Phase G is complete. The repository now contains a reproducible, path-free external-region evidence package and a product applicability presentation that makes out-of-reference results explicitly exploratory. No external labels were available, so Phase G reports controlled robustness and branch behavior, not external-city accuracy.

The frozen PASC-TCN definition, training parameters, 13 physical features, scaler, calibration, spatial reference, gate, radius, thresholds, and production inference path were not changed. Self-neighborhood remains an isolated offline diagnostic and cannot activate in product inference.

## Evaluated evidence

Eight frozen-runtime scenarios are persisted:

1. native 248-node reference;
2. existing Shanghai coordinate-shift golden control;
3. three-point Shanghai-translated external batch;
4. cm/cm-year unit-equivalent input;
5. `subsidence_positive` sign-equivalent input;
6. deterministic 160-node sampling;
7. deterministic 80-node sampling;
8. deterministic 40-node sampling.

The coordinate-shift batch keeps normalized series, raw 13-dimensional physical features, and scaled physical features exactly unchanged while every external point becomes `limited_reference` with spatial reliability and gate equal to zero. This isolates the spatial loss of evidence from the temporal/physical preprocessing path.

Unit conversion caused only float-level differences: maximum `3.58e-7` for normalized series, `7.63e-6` for raw physical features, and `8.34e-7` after frozen scaling. Sign equivalence was exact. Sampling preserved the winning class for the three fixture points, but maximum probability delta increased from `0.00239` at 160 nodes to `0.03125` at 80 and `0.47099` at 40; 40-node inference therefore remains explicitly experimental.

Orbit-direction sensitivity is`not_evaluable_from_current_contract` because the frozen input contract contains no ascending/descending orbit or LOS geometry field. No conclusion was invented.

## Self-neighborhood boundary

The offline diagnostic uses an explicitly synthetic three-point Shanghai cluster with 80 m nominal spacing. It measured candidate mean reliability `0.26757` and maximum reliability `0.29608`, showing that batch-internal support can be computed. The artifact hard-codes:

- `predictionApplied=false`
- `productionEligible=false`
- `accuracyEvaluated=false`
- `syntheticCoordinates=true`

Those candidate neighbors and reliabilities never enter `infer_payload` and do not replace the fixed 1,036-row Haikou reference.

## Product applicability

For `limited_reference`, the analysis panel now displays the exact required wording:

> 探索性识别结果
> 当前数据超出模型主要验证区域，
> 建议结合人工判读使用。

It also explains that suppressed spatial reliability/gating makes the result rely mainly on the TCN temporal branch and kinematic physical features. `full_reference`, `limited_reference`, and`not_evaluated` remain distinct; the fixed six classes, colors, probabilities, and output contract are unchanged.

## Artifacts

- `pasc-tcn-service/phase_g_results/phase_g_results.json`
- `pasc-tcn-service/phase_g_results/phase_g_scenarios.csv`
- `pasc-tcn-service/phase_g_results/PHASE_G_EXTERNAL_REGION_REPORT.md`

The JSON records only a path-independent private hash-verified runtime descriptor. No workspace path, private bundle path, checkpoint, spatial reference matrix, service secret, or complete time-series matrix is persisted.

## Verification

| Check | Result |
|---|---|
| Full Python regression with PyCharm Torch SDK | PASS, 52/52 |
| Phase G Python tests | PASS, 7/7 |
| WebGIS production build | PASS |
| Full Node/WebGIS regression | PASS, 26/26 |
| Phase G TypeScript tests | PASS, 2/2 |
| Demo manifest validation | PASS |
| Strict Phase G lint | PASS, 0 warnings |
| Full repository lint | PASS, 0 errors; 66 existing warning-level findings |
| Phase G evaluator artifact generation | PASS, 8 scenarios |
| External spatial suppression | PASS, all translated points limited/zero reliability/zero gate |
| Frozen source/scaler hash audit | PASS, Phase D/Phase B hashes unchanged |
| No optimizer/backward/fit/train entry point in Phase G | PASS |
| Persisted private-path/secret audit | PASS |

The full Python suite used `D:\Anaconda\env\tsl\python.exe` (Python 3.10.20, Torch 2.12.0.dev20260323+cu128, CUDA available, NumPy 1.24.4). The evaluator was intentionally run on CPU for deterministic deployment-compatible evidence.

## Explicit stop

No model redefinition, retraining, fine-tuning, new labels, calibration adjustment, spatial-reference replacement, Self-neighborhood production activation, threshold change, or post-v4 phase was started. Any future change to those frozen boundaries requires a separate user decision and new validation protocol.

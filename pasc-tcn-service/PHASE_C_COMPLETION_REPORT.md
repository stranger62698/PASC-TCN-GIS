# PASC-TCN Phase C completion report

Date: 2026-08-24
Branch: `codex/pasc-phase-a`
Scope: v4 Phase C only

## Outcome

Phase C is complete. The frozen M4 pipeline was evaluated only on the fixed
523-row formal test set for the native 248-epoch baseline and 25 deterministic
sampling scenarios covering 160/120/80/60/40 retained epochs and five sampling
patterns.

All required metrics and CSV, JSON, Markdown, PNG, and PDF artifacts were
generated. No acceptance threshold or supported minimum epoch count was
selected; that decision remains with the user.

## Protocol

- Fixed formal split: train 1,036, validation 183, test 523; fixed seed 521
- Native baseline: complete 248 epochs
- Sampled groups: 160, 120, 80, 60, and 40 epochs
- Methods: uniform, random missing, continuous gap, front-dense/back-sparse,
  and front-sparse/back-dense
- Phase C sampling base seed: 20260824
- Every scenario preserves the first and last date and persists all selected
  indices and date columns
- Sampled series use the Phase B linear Adapter to 248 nodes
- Frozen Scaler, frozen M4 checkpoint, 1,036-row training-only spatial
  reference, and production dynamic-class probability boost 1.35
- Evaluation boundary: offline only; no service inference endpoint

## Frozen provenance

| Artifact | SHA-256 |
|---|---|
| Formal 1,742-row dataset | `e2740b4c20b82357f1acc1f67230fa3972fa9ee624ad1e5073cbfb8c324a8265` |
| Fixed split CSV | `956a8162b95712d7abf49102ee8a869fd9620fcf46e811feb86d4642d02f484c` |
| Frozen full-size M4 checkpoint | `a45b91c0b8288d87481f5c13db82a574d79a13086b28a49eb148617155ca6107` |
| Existing native-248 predictions | `40250d66014da01a0d2295d68b537bd2b7a7c8bb4f0f29401735343bf270fba1` |
| Formal model code | `16e4de4a65c8861647103dbafb7758a5236761faab158657fe4abfbe8d64186c` |

The checkpoint remains in the sibling research workspace and was not copied
into the product repository.

## Baseline reproduction

The evaluator reproduced all 523 existing raw labels exactly. The maximum raw
confidence difference was `2.3006703339e-05`, within the recorded
cross-runtime numerical tolerance of `5e-05` for the local Torch/CUDA build.

The calibrated native-248 baseline is:

- Accuracy: `0.927342`
- Macro-F1: `0.926391`
- Failure count: `0`

## Descriptive evidence

These values summarize the five patterns per retained-epoch group. They are
descriptive evidence, not acceptance criteria.

| Epochs | Mean Accuracy | Min Accuracy | Max Accuracy | Mean Macro-F1 | Min Macro-F1 | Max Macro-F1 |
|---:|---:|---:|---:|---:|---:|---:|
| 160 | 0.907457 | 0.837476 | 0.927342 | 0.905831 | 0.833186 | 0.926339 |
| 120 | 0.895602 | 0.766730 | 0.936902 | 0.890081 | 0.742527 | 0.936091 |
| 80 | 0.865392 | 0.636711 | 0.927342 | 0.854835 | 0.587269 | 0.926551 |
| 60 | 0.866539 | 0.663480 | 0.923518 | 0.861073 | 0.639146 | 0.922637 |
| 40 | 0.818738 | 0.437859 | 0.925430 | 0.811306 | 0.405076 | 0.924267 |

The pattern effect is material: continuous gaps are the weakest scenarios,
while several distributed or directional samples remain close to the native
baseline. The full scenario and per-class evidence is retained in the result
tables so the user can make the minimum-epoch decision.

## Delivered artifacts

- Sampling index/date manifest in CSV and JSON
- 26-row overall metrics CSV and JSON
- 156-row per-class Precision/Recall/F1 table
- 13,598-row point-level prediction table
- Markdown validation report
- Four-panel quantitative PNG and editable-text PDF
- Offline evaluator, artifact validator, deterministic sampling module, and
  seven Phase C unit tests
- Phase C completion report and SHA-256 file manifest

## Verification

| Check | Result |
|---|---|
| Fixed test identity | PASS, exactly 523 rows |
| Existing native raw labels | PASS, 523/523 |
| Sampling scenarios | PASS, 26 total |
| Sampling index count/uniqueness/endpoints | PASS |
| Scenario evaluation failures | PASS, 0 across all scenarios |
| Artifact consistency validator | PASS |
| Deterministic re-run hashes | PASS, all 9 generated artifacts identical |
| Phase B + Phase C service tests | PASS, 31/31 |
| WebGIS build/core/SSR/demo regression | PASS, 9/9 |
| Spatial and Showcase demo validation | PASS |
| Full repository ESLint | PASS, 0 errors; 71 pre-existing warnings |
| Strict Phase A/new frontend ESLint | PASS, 0 warnings |
| PDF page/render QA | PASS, one page; no clipping, overlap, or illegible labels |
| Phase D forbidden-code audit | PASS |
| `git diff --check` | PASS |

## Explicit stop

Phase D has not been started. No `/v1/infer` endpoint, online classifier,
training/fitting path, checkpoint copy, threshold, or supported minimum epoch
count was added.

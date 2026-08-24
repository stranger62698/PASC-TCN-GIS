# PASC-TCN Phase B completion report

Date: 2026-08-23
Branch: `codex/pasc-phase-a`
Scope: v4 Phase B only

## Outcome

Phase B is complete. The repository now contains a standalone
`pasc-tcn-service` that is authoritative for validation and preprocessing. It
returns compatibility, standardized 248-node data or an unsupported reason,
frozen 13-feature vectors, quality information, and an audit trail.

The service never loads a checkpoint and has no classifier, probability
calibration, inference endpoint, training/fitting path, or Phase C acceptance
threshold.

## Delivered boundary

- Versioned contract, fixed aliases, machine error codes, and Chinese messages
- CSV-text and JSON-record input with server-side mapping validation
- Five required date formats, canonical sorting, per-point finite counts,
  duplicate merging only when values agree, and conflict rejection
- Explicit displacement/velocity units, sign convention, and smoothing state
- 39 unsupported, 40–247 adapted experimental, and complete 248 native behavior
- Per-point relative-time linear Temporal Adapter to 248 nodes
- Raw-only Savitzky-Golay window 9 / polynomial order 3; no second SG pass for
  already-smoothed input
- Frozen float32 row-wise Z-score with epsilon `1e-5`
- Frozen 13-feature definition and checked-in training Scaler; user data is
  never fitted
- Least-squares velocity over real valid dates and explicit coherence default
  0.5 with warning/source
- Series mean/std, missing rate, maximum gap, SG residual availability,
  original data/span, Adapter method, applicability, warnings, and pipeline
  audit
- `GET /v1/models`, `POST /v1/validate`, and `POST /v1/preprocess` via
  ASGI and a standard-library local HTTP server

## Frozen provenance

| Artifact | SHA-256 |
|---|---|
| Formal feature implementation | `16e4de4a65c8861647103dbafb7758a5236761faab158657fe4abfbe8d64186c` |
| Full-area inference report / Scaler source | `26ac2302cd6566fd54a391aa9fb54ee382075be0f8a3effbeaf49be208c74ed5` |
| Formal 1,742-row native-248 golden dataset | `e2740b4c20b82357f1acc1f67230fa3972fa9ee624ad1e5073cbfb8c324a8265` |
| Checked-in three-row golden fixture | `c0952a0b6de891ed78c812cf902147f9748d984193fb074421e96bc0436a5dfb` |

The golden generator is independent of the service implementation and contains
a compact oracle copy of the frozen formal formulas. Rows 0, 871, and 1,741
lock every canonical date, the already-SG millimetre series, normalized series,
all 13 raw/scaled features, velocity, and coherence. The service matches at
absolute tolerance `1e-5` and relative tolerance `1e-6`.

## Verification

| Check | Result |
|---|---|
| Python compile | PASS |
| Phase B unit/API/golden suite | PASS, 24/24 |
| Real local HTTP `GET /v1/models` | PASS; preprocessing true, inference false |
| WebGIS build/core/SSR/demo regression | PASS, 9/9 |
| Spatial Demo validation | PASS, 3,094 rows / 248 epochs |
| Showcase Demo validation | PASS, 3,000 rows / 248 epochs |
| Full repository ESLint | PASS, 0 errors; 71 quarantined legacy warnings |
| Strict Phase A/new frontend ESLint | PASS, 0 warnings |
| `git diff --check` | PASS |
| Phase C/D forbidden-code audit | PASS |

The first WebGIS command attempt could not locate`npm`, and a second attempt
could not locate`node` inside package scripts. The final run used the bundled
workspace Node and pnpm paths and passed; these were environment-path failures,
not product failures.

## Explicit stop

Phase C has not been started. No independent 248/40/out-of-area validation
matrix, acceptance thresholds, cross-region gate, checkpoint hash enforcement,
calibration, or online inference was added.

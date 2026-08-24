# Phase E Completion Report

Date: 2026-08-24
Branch: codex/pasc-phase-e
Scope: v4 Phase E only — WebGIS synchronous small-data online recognition
Stop boundary: Phase F not started

## Outcome

Phase E is complete. The WebGIS now guides a confirmed small-data CSV through field mapping, unit/sign/smoothing confirmation, compatibility grading, authenticated same-origin preprocessing and frozen inference, validated result merge, fixed six-class map rendering, point-level six probabilities, and result-quality filters.

The synchronous boundary is deliberately capped at 500 total points and 8 MiB. Datasets above that boundary are not submitted and are explicitly directed to the future Phase F task flow. Points with fewer than 40 effective epochs remain usable in ordinary WebGIS but are excluded from PASC inference.

## Implemented flow

1. Upload or restore CSV and map WGS84 coordinates, optional ID/velocity/coherence, and real date columns.
2. Explicitly confirm displacement/velocity units, sign convention, and raw or already_smoothed state.
3. Display capability Level and the 39 unsupported, 40 experimental, and 248 native boundaries.
4. Serialize only eligible points into a canonical browser-to-server contract.
5. Call authenticated POST /api/pasc/infer.
6. The server-only proxy calls configured /v1/preprocess and then authenticated /v1/infer.
7. Validate contract/model/audit/probability invariants before merging calibrated outputs.
8. Render the frozen six classes and colors; point detail shows all six probabilities and provenance.
9. Filter low-confidence or limited-spatial results while retaining the full dataset.
10. On any API/proxy/service error, keep existing points, selections, map, and prior PASC results and expose a retry action.

## Security and reliability

- PASC_SERVICE_BASE_URL and PASC_SERVICE_API_KEY are read only in the server route.
- The client cannot provide or override an upstream service URL.
- The Python service key is sent only to /v1/infer and is never returned to the browser.
- The route requires a signed-in ChatGPT user, applies no-store responses, validates UTF-8 JSON, and enforces body/point limits.
- Proxy timeout and upstream errors use structured deterministic messages.
- The failure path does not call setPoints, setBoxPoints, or applyResult.
- No raw time series or service secrets are added to logs.

## Verification

| Check | Result |
|---|---|
| WebGIS build and complete regression | PASS |
| Node tests | PASS, 17/17 total |
| PASC core and Phase E synchronous chain | PASS, 15/15 |
| SSR and lazy client UI bundle regression | PASS, 2/2 |
| Spatial Demo validation | PASS, 3,094 points, 248 epochs |
| Showcase Demo validation | PASS, 3,000 points, 248 epochs |
| Python preprocessing/inference regression | PASS, 41/41 |
| Strict Phase A lint | PASS, 0 warnings |
| Strict Phase E lint | PASS, 0 warnings |
| Full repository lint | PASS, 0 errors; 66 existing warning-level findings |
| git diff --check | PASS |
| Server-secret location audit | PASS |
| API failure-retention audit | PASS |
| Phase F forbidden-surface audit | PASS |

## Runtime configuration

The WebGIS server requires:

    PASC_SERVICE_BASE_URL=http://127.0.0.1:8788
    PASC_SERVICE_API_KEY=<at least 32 characters>

The Python service still requires the private, hash-verified Phase D model bundle described in pasc-tcn-service/README.md.

## Explicit stop

Phase F was not started. This delivery contains no job table, D1/R2 job storage, queue/consumer, chunk processing, progress API, cancellation, retry/idempotency workflow, recovery, or large-data result tiling.

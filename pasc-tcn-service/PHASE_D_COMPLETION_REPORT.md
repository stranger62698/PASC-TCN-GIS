# PASC-TCN Phase D completion report

Date: 2026-08-24
Branch: `codex/pasc-phase-d`
Scope: v4 Phase D only

## Outcome

Phase D is complete. The service now exposes the frozen `pasc-tcn-haikou-v1`
model through the single new endpoint `POST /v1/infer`. Inference accepts only
a service-generated preprocessing artifact whose HMAC integrity is valid and a
caller whose service key is authorized.

The runtime is inference-only, hash-verifies every private model asset, preserves
the formal M4 spatial gate/reliability and fixed calibration, and returns all
required probabilities, labels, confidence, applicability, quality, warnings,
source fields, version metadata, and provenance. Phase E was not started.

## Frozen private bundle

The deterministic deployment bundle contains:

- model config and fixed six-class catalog
- frozen 13-feature Scaler and probability calibration
- frozen full-size M4 checkpoint
- 1,036-row training-only spatial reference
- fixed split identity
- `SHA256SUMS`, per-asset SHA-256, and canonical build hash

| Item | SHA-256 |
|---|---|
| Bundle build hash | `bc10270dfb6b53adfa12473fda9e37bdad95d2ef44c3cf92bc346213ce733db3` |
| Formal 1,742-row dataset | `e2740b4c20b82357f1acc1f67230fa3972fa9ee624ad1e5073cbfb8c324a8265` |
| Fixed split CSV | `956a8162b95712d7abf49102ee8a869fd9620fcf46e811feb86d4642d02f484c` |
| Frozen M4 checkpoint | `a45b91c0b8288d87481f5c13db82a574d79a13086b28a49eb148617155ca6107` |
| Formal model code | `16e4de4a65c8861647103dbafb7758a5236761faab158657fe4abfbe8d64186c` |
| Formal production inference helper | `c984a60b33328e343c0fae3d981e52b92b78e8973c6fe38d513f0d2327a1890a` |
| Phase D inference golden | `19c62387f3bc7b9dce58eef02327452c566a2a81080458bb71e2f68f3b3ff4a5` |

A second clean bundle build produced nine byte-identical files and the same
build hash. The repeat bundle was removed after verification. The usable local
bundle remains under the Git-ignored `.private-model-bundles/` directory; no
`.pth` or `.npz` is tracked by Git.

## Inference contract

- Endpoint: `POST /v1/infer`
- Authorization: Bearer or `X-PASC-Service-Key`, constant-time comparison
- Input: complete signed `/v1/preprocess` response under `preprocessed`
- Maximum synchronous points: 512
- Maximum JSON body: 32 MiB
- Default inference concurrency: 1
- Default queue timeout: 5 seconds, bounded to at most 60 seconds
- 248 epochs:`native_248`
- 40–247 epochs: `experimental_adapted_to_248`
- fewer than 40 epochs: rejected before model execution
- spatial radius with nonzero formal reliability: `full_reference`
- no formal spatial weight: `limited_reference`

Each result includes raw and calibrated six-class probabilities and labels,
final label/color, confidence, low-confidence flag, calibration-change flag,
spatial reliability, spatial gate mean, temporal/spatial applicability,
quality, velocity/coherence sources, and warnings. The envelope includes model
bundle hashes and an audit proving asset verification, 1,036 reference rows,
model execution, no user-data fit, and no training path.

## Security and operational boundary

- HMAC-SHA256 binds every preprocessing field; unsigned or modified artifacts
  fail before inference.
- Model bundle or fixed parameter/hash mismatch fails closed with HTTP 503.
- Built-in HTTP startup and ASGI lifespan both validate the configured bundle.
- Runtime secrets are environment-only and are not accepted as command-line
  values or returned in responses.
- Inference modules contain no optimizer, backward, fit, or training entry.
- The service contains no arbitrary URL/network-fetch path and logs no full
  user time series or secrets.
- A bounded semaphore prevents unbounded concurrent model execution.

## Golden regression

The checked-in golden is independently generated through the formal research
model and production inference helper. It covers:

- three native-248 points
- one adapted-40 point
- one external-city point with zero spatial reference

For every point, tests compare raw probabilities and label, calibrated
probabilities and final label, confidence, spatial reliability, and spatial
gate mean. All match within the recorded cross-runtime absolute tolerance
`5e-5`. The external point returns exact zero reliability/gate and
`limited_reference`.

## Verification

| Check | Result |
|---|---|
| Phase D golden/security/hash/concurrency/startup tests | PASS, 10/10 |
| Complete Python service regression | PASS, 41/41 |
| Python compile audit | PASS |
| Real HTTP preprocess → infer smoke test | PASS, HTTP 200/200 |
| Deterministic private bundle rebuild | PASS, 9/9 files byte-identical |
| WebGIS build/core/SSR/demo regression | PASS, 9/9 |
| Spatial and Showcase demo validation | PASS |
| Strict Phase A/new frontend ESLint | PASS, 0 warnings |
| Full repository ESLint | PASS, 0 errors; 71 pre-existing warnings |
| No training entry/network fetch/private binary audit | PASS |
| `git diff --check` | PASS; existing CSV line-ending warning only |

## Delivered implementation

- inference-only frozen architecture and runtime
- private deterministic model bundle builder
- HMAC preprocessing integrity and service authorization
- versioned `/v1/infer` route plus HTTP/ASGI startup verification
- bounded concurrency, resource limits, deterministic error codes, and audit
- formal-runtime golden generator and Phase D regression fixture/tests
- deployment/security documentation, file manifest, and this report

## Explicit stop

Phase E has not been started. No WebGIS upload-to-inference integration, map
online-recognition UI, asynchronous job/status API, D1/R2 persistence, queue,
or cross-owner task access path was added. The task stops here after Phase D.

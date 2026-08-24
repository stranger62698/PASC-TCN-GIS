# Phase F Completion Report

Date: 2026-08-24
Branch: codex/pasc-phase-f
Scope: v4 Phase F only — durable large-data inference jobs and bounded map delivery
Stop boundary: Phase G not started

## Outcome

Phase F is complete. Signed-in users can create idempotent background PASC jobs from private mapped datasets, follow durable progress and recovery state, cancel work, inspect events and authenticated artifacts, and explicitly load a bounded multilevel result preview into the existing six-class map.

The implementation preserves the Phase D frozen preprocessing and inference boundaries. It adds orchestration and delivery only: no optimizer, training, fitting, checkpoint change, calibration change, spatial-reference change, threshold redefinition, or external-region generalization.

## Implemented flow

1. A user confirms dataset coordinates, at least 40 date columns, units, sign convention, and preprocessing state.
2. `POST /v1/jobs` authenticates the user, checks owner-scoped dataset metadata, and creates or reuses a D1 job by owner/idempotency key.
3. A Python consumer authenticates with a separate bearer key and atomically claims one queued, retry-ready, or stale-leased job.
4. The consumer streams the owner-scoped R2 source and processes bounded chunks through the existing frozen preprocess and infer functions.
5. Progress renews the lease and exposes cancellation at safe chunk boundaries. Retry uses bounded exponential delay and at most three attempts.
6. Validation, sealed preprocessing, chunk predictions, errors, summary, audit, and map levels are written to owner/job/attempt/kind/chunk-scoped R2 keys and indexed in D1.
7. Completion records frozen model package hashes and makes authenticated summary/artifact/map routes available.
8. The task console polls owner-scoped state, shows retry/recovery/cancel status and artifact links, and never exposes internal lease or mapping fields.
9. `/map?job=<jobId>` validates the result payload and loads only 500, 2,000, or 5,000 deterministic sample points according to zoom. It never downloads the full large result.

## Durable data model and APIs

D1 tables: `pasc_jobs`, `pasc_job_events`, `pasc_artifacts`, and `model_versions`, alongside the existing `datasets` and `upload_sessions`. The generated migration includes owner/idempotency, owner/created, status/lease, dataset/created, event, and artifact indexes.

Public authenticated routes:

- `GET/POST /v1/jobs`
- `GET /v1/jobs/{jobId}`
- `GET /v1/jobs/{jobId}/summary`
- `GET /v1/jobs/{jobId}/artifacts`
- `GET /v1/jobs/{jobId}/artifacts/{artifactId}`
- `POST /v1/jobs/{jobId}/cancel`
- `GET /v1/jobs/{jobId}/map?zoom=<z>`

Consumer-only routes:

- `POST /v1/internal/jobs/claim`
- `GET /v1/internal/jobs/{jobId}/source`
- `POST /v1/internal/jobs/{jobId}/progress`
- `PUT /v1/internal/jobs/{jobId}/artifacts`
- `POST /v1/internal/jobs/{jobId}/complete`
- `POST /v1/internal/jobs/{jobId}/fail`

## Security and reliability

- Every public job, event, artifact, dataset source, cancel, and map lookup is owner-scoped.
- Internal routes fail closed unless `PASC_CONSUMER_API_KEY` is configured and matches a bearer token using a constant-time digest comparison.
- Source/progress/artifact/complete/fail calls also require the current job lease token.
- Public job views omit lease token, worker ID, idempotency key, mapping JSON, object keys, consumer key, and private time series.
- Consumer configuration accepts one fixed HTTP(S) origin without credentials/query/fragment and rejects all paths outside the same-origin internal prefix.
- R2 source and artifact responses are authenticated and `private, no-store`; large matrices remain outside D1.
- Progress is monotonic, completion reaches 100%, cancellation wins over retry, attempts are bounded, and stale leases are recoverable.
- Map responses are deterministic and bounded; a preview error retains the current map and prior results.

## Runtime configuration

WebGIS and Python consumer share one server-only secret:

    PASC_CONSUMER_API_KEY=<at least 32 random characters>

Consumer configuration:

    PASC_WEBGIS_BASE_URL=https://<deployed-site-origin>
    PASC_CONSUMER_WORKER_ID=consumer-01
    PASC_CONSUMER_LEASE_SECONDS=300
    PASC_CONSUMER_POLL_SECONDS=5

The consumer also requires the existing Phase D private model bundle and signing configuration. Apply `drizzle/0001_dataset_storage.sql` followed by the additive `drizzle/0002_pasc_jobs.sql` to the bound D1 database, deploy with `DB` and `DATASETS` bindings, install `pasc-tcn-service`, and run `pasc-tcn-consumer`.

## Verification

| Check | Result |
|---|---|
| WebGIS build and full regression | PASS, 24/24 tests |
| Phase F Node contract/integration tests | PASS, 7/7 |
| Phase F Python consumer tests | PASS, 4/4 |
| Full Python regression | PASS, 45/45 |
| Strict Phase F lint | PASS, 0 warnings |
| Full repository lint | PASS, 0 errors; 66 existing warning-level findings |
| D1 migration execution and table/index audit | PASS |
| Public owner isolation and consumer-auth static audit | PASS |
| Bounded map response and fixed-class validation | PASS |
| Consumer configured-origin and no-training audit | PASS |
| `git diff --check` | PASS |

The full Python suite was run with the PyCharm project SDK at `D:\Anaconda\env\tsl\python.exe` (Python 3.10.20, Torch 2.12.0.dev20260323+cu128, CUDA available, NumPy 1.24.4). All 45 tests passed, including native-248, adapted-40, external-city spatial applicability, concurrency timeout, bundle hash, authorization, preprocessing, Phase C sampling, and Phase F consumer coverage. Production still requires the documented private hash-verified model bundle.

## Explicit stop

Phase G was not started. This delivery does not add external-region training/generalization, new labeled data, fine-tuning, optimizer paths, model selection, calibration changes, spatial-reference replacement, or support-threshold changes.

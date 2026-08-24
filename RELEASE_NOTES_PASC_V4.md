# PASC-TCN v4 Release Candidate Notes

Date: 2026-08-24
Branch: `codex/pasc-phase-g`
Release shape: one atomic source commit covering completed Phases A-G
Application version: `0.1.0`
Inference service version: `0.3.0`
Frozen model version: `pasc-tcn-haikou-v1`
Contract version: `pasc-contract-v1`

## Release scope

This candidate integrates the complete v4 workflow:

- fixed six-class PASC contract, CSV compatibility checks, and 248-node WebGIS demonstrations;
- authoritative preprocessing and deterministic sampling validation;
- private hash-verified frozen PASC-TCN inference with no training entry point;
- synchronous small-dataset recognition through a server-only proxy;
- durable owner-scoped large-dataset jobs, retries, cancellation, artifacts, and bounded map previews;
- external-region applicability evidence with mandatory exploratory wording and non-production Self-neighborhood diagnostics.

The release does not contain the private checkpoint, the 1,036-row spatial reference, deployment secrets, environment files, build output, or local runtime state.

## Compatibility and data changes

- Node.js `>=22.13.0` is required.
- Python `>=3.10`, NumPy, and compatible PyTorch are required for inference.
- `public/data/haikou-insar.csv` intentionally changes from the legacy 4,073-row demo to the validated 3,094-point formal PASC spatial dataset.
- Legacy CSV parsing remains supported; the ambiguous legacy `Stepwise` class is not silently remapped to `Piecewise`.
- Fewer than 40 valid epochs remain available to ordinary WebGIS but are excluded from PASC inference. 40-247 epochs remain experimental; 248 is native.

## Database migration order

For a fresh environment, apply:

1. `drizzle/0001_dataset_storage.sql`
2. `drizzle/0002_pasc_jobs.sql`

For an environment that already has the dataset tables from `0001`, apply only `0002`. The PASC migration is additive and idempotent: it uses `IF NOT EXISTS`, preserves existing dataset rows, and creates the job/event/artifact/model tables plus their indexes.

Do not apply the discarded generated `0000_parched_random.sql`; it duplicated existing dataset tables and was removed during release hardening.

## Required bindings and server configuration

The Sites project requires:

- D1 binding `DB`
- R2 binding `DATASETS`

Small-data WebGIS recognition requires server-only `PASC_SERVICE_BASE_URL` and `PASC_SERVICE_API_KEY`.

The Python inference service requires a private hash-verified model bundle plus `PASC_MODEL_BUNDLE_DIR`, `PASC_ARTIFACT_SIGNING_KEY`, `PASC_SERVICE_API_KEY`, and the selected `PASC_DEVICE`.

The durable consumer additionally requires `PASC_WEBGIS_BASE_URL`, `PASC_CONSUMER_API_KEY`, `PASC_CONSUMER_WORKER_ID`, and lease/poll settings documented in the repository README.

## Release verification

The final candidate is accepted only after all of the following pass from the staged tree:

- `pnpm test`
- `pnpm lint` with zero errors (legacy warning-level findings are recorded separately)
- `pnpm run lint:phase-f`
- `pnpm run lint:phase-g`
- `python -m unittest discover -s pasc-tcn-service/tests -v` using the confirmed Torch SDK
- additive migration upgrade/idempotency audit
- Phase C and Phase G artifact consistency checks
- secret/private-path scan
- SHA-256 release manifest validation
- `git diff --check`

## Known limits

- External-region scenarios do not have external labels; they are robustness/applicability evidence, not accuracy claims.
- Orbit sensitivity is not numerically evaluated because the frozen contract has no orbit/LOS geometry field.
- Self-neighborhood is diagnostics-only with `predictionApplied=false` and `productionEligible=false`.
- Production inference requires the separate private model bundle; the public repository fails closed without it.
- Global lint may retain documented warning-level findings in legacy code, but release lint must have zero errors and strict Phase F/G lint must have zero warnings.

## Rollback

Application rollback can point deployment back to the previous commit. The additive PASC database tables should not be dropped automatically during application rollback because they can contain owner-scoped jobs and audit artifacts. Disable consumers first, retain D1/R2 data, and perform any destructive data rollback only under a separate reviewed operation.

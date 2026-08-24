# Progress Log - PASC-TCN Phase A

## Session: 2026-08-23

### Phase 1: Discovery and Baseline
- **Status:** in_progress
- Actions taken:
  - Read the complete v4 implementation plan.
  - Confirmed the current repository started on clean `main` tracking `origin/main`.
  - Created and switched to `codex/pasc-phase-a`.
  - Recorded Phase A scope, frozen constraints, and stopping condition.
  - Initialized persistent planning files.
- Files created/modified:
  - `task_plan.md` (created)
  - `findings.md` (created)
  - `progress.md` (created)

## Test Results
| Test | Input | Expected | Actual | Status |
|------|-------|----------|--------|--------|
| Baseline Git status | `git status --short --branch` | Clean `main` | Clean `main...origin/main` | PASS |
| Phase branch | `git branch --show-current` | `codex/pasc-phase-a` | `codex/pasc-phase-a` | PASS |

## Error Log
| Timestamp | Error | Attempt | Resolution |
|-----------|-------|---------|------------|
| 2026-08-23 | Default-sandbox process creation failed with `apply deny-read ACLs` | 1 | Re-ran read-only inventory with approved escalation |
| 2026-08-23 | Built-in/local `apply_patch` failed due workspace ACL | 1-2 | Tried patch-based `git apply` |
| 2026-08-23 | TTY-fed patch corrupted non-ASCII/control characters | 3 | Replaced planning files directly as UTF-8 after patch methods were exhausted |
| 2026-08-23 | PowerShell treated an unquoted regex pipe as a pipeline | 1 | Re-ran with single-quoted regex arguments |
| 2026-08-23 | Planning record patch hunk counts were wrong | 1-2 | Inspected line numbers and applied smaller exact-context patches |

## 5-Question Reboot Check
| Question | Answer |
|----------|--------|
| Where am I? | Phase 1: discovery and baseline |
| Where am I going? | Contract/core, UI integration, offline demos, verification/report |
| What's the goal? | Complete only Phase A and stop |

### Phase A Completion
- **Status:** complete
- Added the frozen PASC contract, six-class catalog/colors, date/schema compatibility logic, optional real-date velocity calculation, provenance fields, capability Levels 0-3, and temporal/spatial applicability.
- Added five PASC UI components and integrated compatibility, point probability, legend, and region statistics into the map and dataset workflows.
- Unified authenticated dataset operations under `/api/datasets` and multipart writes under `/api/uploads`.
- Generated a 3,094-point Spatial Demo and a 3,000-point Showcase Demo, both with 248 dates and source/output SHA-256 manifests.
- Added deterministic demo generation/validation scripts and eight PASC/legacy regression tests.
- Updated product copy, README, static-output copying, and public demo metrics.
- Kept Adapter, SG execution, Python service/API, checkpoint assets, and online inference out of this phase.

## Final Verification
| Check | Result |
|---|---|
| Branch | `codex/pasc-phase-a` |
|`npm run build` equivalent | PASS |
|`npm test` equivalent | PASS, 9/9 tests |
|`npm run lint` equivalent | PASS, 0 errors (71 quarantined pre-existing warnings remain visible) |
|`npm run lint:phase-a` | PASS, 0 warnings |
| Legacy CSV regression | PASS; ordinary WebGIS preserved and Stepwise flagged legacy |
| Spatial Demo | PASS; 3,094 points, 248 epochs, natural imbalance |
| Showcase Demo | PASS; 3,000 points, 248 epochs, 500/class plus disclaimer |
| `git diff --check` | PASS |

## Stop Condition
Phase A is complete. No Phase B implementation has been started.
| What have I learned? | See `findings.md` |
| What have I done? | Read v4, verified clean baseline, created branch, initialized task records |

### Phase B1: Requirements and Authoritative Source Inventory
- **Status:** complete
- Re-read the complete v4 Phase B scope and stopped all design at preprocessing/API output; no checkpoint, classifier, calibration, or Phase C acceptance threshold is included.
- Verified authoritative feature/Z-score formulas, full-area preparation behavior, frozen Scaler values, default coherence 0.5, source hashes, and the formal 1,742-row native-248 golden dataset.
- Inspected the sibling public export and confirmed it contains research provenance but no existing product service to modify.
- Selected a self-contained service under this repository with NumPy as its only runtime dependency; the standard-library HTTP server avoids adding unverified network dependencies.

### Phase B2: Service Schema and Validation
- **Status:** in_progress
- Created the versioned Python package, frozen contract constants, Chinese machine-error catalog, and immutable Scaler asset with source hashes.
- Implemented CSV/record ingestion, aliases, exact/case-insensitive/heuristic/unresolved mapping reports, all five date formats, sorting, duplicate conflict detection, unit/sign/preprocessing confirmations, per-point effective epochs, and 39/40/248 compatibility reports.

## Phase B Error Log
| Timestamp | Error | Attempt | Resolution |
|-----------|-------|---------|------------|
| 2026-08-23 | Bundled Python lacks SciPy/FastAPI/pytest/httpx | 1 | Keep runtime self-contained with NumPy, standard-library HTTP, and unittest; implement verified SG math locally |

### Phase B2: Service Schema and Validation
- **Status:** complete
- Added CSV-text and JSON-record ingestion; alias discovery methods; five date formats; canonical sorting; identical duplicate merging; conflicting duplicate rejection; explicit unit, sign, and smoothing confirmations; server-side contract-version checks; and per-point 39/40/248 status.

### Phase B3: Authoritative Preprocessing
- **Status:** complete
- Implemented native-248 bypass and per-point relative-time linear adaptation to 248 nodes.
- Implemented raw-only SG window 9/polyorder 3 with interpolation edges, frozen float32 Z-score epsilon, the exact 13-feature order/math, and immutable Scaler clipping.
- Added least-squares velocity from real dates, explicit coherence default 0.5, internal unit/sign normalization, mean/std/noise residual, temporal applicability, warnings, and stage audit output.

### Phase B4: Validate and Preprocess APIs
- **Status:** complete
- Added dependency-free ASGI and standard-library HTTP surfaces for `GET /v1/models`, `POST /v1/validate`, and `POST /v1/preprocess`.
- Every success/error response carries the contract; preprocessing identifies the frozen package but returns `operation=preprocess_only` and `inferenceAvailable=false`.
- Added local run/request/verification documentation and a root README entry.

### Phase B5: Golden Regression and Delivery
- **Status:** in_progress
- Generated an independent 92,004-byte golden fixture from formal source rows 0, 871, and 1,741, locked to source/feature/report SHA-256 values.
- Golden comparison covers all 248 canonical dates, preprocessed series, normalized series, 13 raw/scaled features, velocity, and coherence.
- Current service suite: 21 tests passed after one test-only fixture-access correction; compile and `git diff --check` pass.

### Phase B Completion
- **Status:** complete; stopped before Phase C
- Final Phase B suite passes 24/24 tests; Python compilation, deterministic golden regeneration, forbidden-code audit, real HTTP smoke test, manifest verification, and `git diff --check` pass.
- WebGIS regression passes 9/9, both 248-epoch demos validate, repository lint has 0 errors with 71 pre-existing quarantined warnings, and strict new-frontend lint has 0 warnings.
- Added `pasc-tcn-service/PHASE_B_COMPLETION_REPORT.md` and `pasc-tcn-service/PHASE_B_FILE_MANIFEST.csv`.
- No threshold tuning, external-area validation, checkpoint load, classifier, calibration, probability output, or inference endpoint was implemented.

## Final Phase B Environment/Error Notes
| Timestamp | Error | Attempt | Resolution |
|---|---|---|---|
| 2026-08-23 | Initial WebGIS verification could not resolve`npm` | 1 | Used the bundled workspace pnpm executable |
| 2026-08-23 | pnpm package scripts could not resolve`node` | 2 | Prepended the bundled Node bin directory; all WebGIS checks passed |
| 2026-08-23 | A zero-context patch placed velocity method inside coherence output | 1 | Inspected the rendered object, moved the field to velocity, and re-ran all 24 tests |

## Historical Phase B Stop Condition
At Phase B completion, work stopped before Phase C; Phase C later began only after explicit user instruction.

### Phase C1: Protocol and Authoritative Asset Inventory
- **Status:** complete
- Re-read the complete v4 Phase C requirements and the final completion definition.
- Confirmed the Phase C stop boundary: offline fixed-test-set evaluation and reports only; no user-chosen threshold, service inference endpoint, or Phase D implementation.
- Initialized Phase C1-C5 persistent planning tasks.

## Phase C Session
- Date: 2026-08-24
- Scope: Phase C only
- Required fixed test count: 523

### Phase C1 Inventory Progress
- Located and hashed the fixed 523-row test identity, formal dataset, full-size M4 checkpoint, and existing baseline predictions.
- Confirmed the split is explicit by `Row_Index`, `fid`, `Label`, and `Split`; Phase C will filter `Split=test` without resplitting.
- Located a local CUDA Torch environment, avoiding dependency installation and any checkpoint copy into the product repository.

### Phase C2: Deterministic Sampling Matrix
- **Status:** complete
- Added deterministic baseline plus 25 sampling scenarios with fixed seed 20260824.
- Persisted all selected indices and canonical date columns.
- Added seven tests covering counts, uniqueness, endpoints, continuous gaps, directional density, Adapter restoration, calibration, and determinism.

### Phase C3: Frozen Offline Evaluation
- **Status:** complete
- Reconstructed and verified the authoritative 1,036/183/523 split without resplitting.
- Loaded the frozen M4 checkpoint, training-only spatial reference, frozen Scaler, and production calibration.
- Evaluated all 26 scenarios on exactly 523 test rows; every scenario completed with zero failures.
- Reproduced 523/523 existing native raw labels.

### Phase C4: Evaluation Artifacts
- **Status:** complete
- Generated nine result artifacts: sampling CSV/JSON, overall/per-class/prediction CSVs, strict JSON, Markdown, PNG, and PDF.
- The result JSON explicitly records that no threshold and no supported minimum were selected.
- Rendered the one-page PDF with Poppler and visually verified the four-panel figure for clipping, overlap, and legibility.
- A second full CUDA run reproduced identical SHA-256 hashes for all nine generated artifacts.

### Phase C5: Verification and Delivery
- **Status:** complete; stopped before Phase D
- Artifact validator: PASS (26 scenarios, 156 per-class rows, 13,598 predictions, zero failures).
- Service unit/API/golden/Phase C suite: PASS, 31/31.
- WebGIS build/core/SSR/demo regression: PASS, 9/9.
- Full repository ESLint: PASS, 0 errors and 71 pre-existing warnings.
- Strict Phase A/new frontend ESLint: PASS, 0 warnings.
- Python compile, checkpoint-copy audit, Phase D forbidden-code audit, and git diff check: PASS.
- Added the Phase C completion report and SHA-256 delivery manifest.

## Phase C Error Log
| Timestamp | Error | Attempt | Resolution |
|---|---|---|---|
| 2026-08-24 | Formal fid comparison differed by numeric CSV formatting | 1 | Normalized fid values to integers before comparison |
| 2026-08-24 | Baseline confidence difference was 2.30067e-5 in the current Torch/CUDA runtime | 1 | Locked exact 523/523 labels and recorded 5e-5 numerical tolerance |
| 2026-08-24 | JSON rejected a NaN baseline seed | 1 | Serialized DataFrame missing values as null |
| 2026-08-24 | Artifact validator used the wrong sampling key | 1 | Changed selectedIndices to indices and reran successfully |
| 2026-08-24 | Built-in patch/view helpers hit local ACL failures | multiple | Used approved git patch/exact replacement fallbacks and Poppler plus data preview QA |

## Final Stop Condition
Phase C is complete. No acceptance threshold, supported minimum, /v1/infer endpoint, checkpoint copy, or Phase D implementation was added.

## Phase D Session
- Date: 2026-08-24
- Scope: Phase D only; stop before Phase E.
- **Status:** Phase D complete; stopped before Phase E.
- Read the v4 Phase D API and completion definition.
- Initialized Phase D1-D5 persistent plan sections.
- Confirmed the required endpoint is POST /v1/infer and the online service may accept only its own validated preprocessing result.
- Created and switched to codex/pasc-phase-d.
- Confirmed the existing native-248 fixture can be reused as signed preprocessing input for inference tests.
### Phase D2-D4 complete
- Built and startup-verified the deterministic private `pasc-tcn-haikou-v1` bundle without tracking private assets.
- Added the inference-only architecture/runtime, exact spatial gate/reliability/calibration path, signed preprocessing integrity, service authorization, `/v1/infer`, point/body limits, concurrency queue timeout, structured audit/model status, and ASGI startup refusal.
- Updated deployment/security documentation while leaving all Phase E WebGIS/task/D1/R2 work untouched.

### Phase D5 in progress
- Generated independent formal-runtime native-248, adapted-40, and external-city inference goldens.
- Added ten Phase D golden/security/hash/concurrency/fail-closed/static-boundary tests; all pass.
- Full Python service regression passes 41 tests.
- WebGIS regression passes 9/9; strict lint passes with 0 warnings; full lint has 0 errors and 71 pre-existing warnings.
- Deterministic bundle rebuild, HTTP smoke test, static security/boundary audits, manifest, and completion report all pass.
### Phase D complete
- Final bundle build hash: `bc10270dfb6b53adfa12473fda9e37bdad95d2ef44c3cf92bc346213ce733db3`.
- Private checkpoint/spatial reference remain Git-ignored; the repeat determinism bundle was removed after 9/9 byte-identical comparison.
- Completion report written to `pasc-tcn-service/PHASE_D_COMPLETION_REPORT.md`.
- Explicit stop: Phase E upload/map/job/D1/R2/queue integration was not started.
## Phase E Session
- Date: 2026-08-24
- Scope: Phase E only; stop before Phase F.
- **Status:** Phase E1 in progress.
- Read the complete v4 Phase E/F boundary and completion rule.
- Selected a same-origin synchronous proxy architecture so service secrets remain server-side and no user-controlled upstream URL is accepted.
- Selected a conservative 500-point Phase E cap under the Phase D 512-point synchronous limit.
- Located the existing Phase E integration points in `MapWorkspace`, `insar-v2`, `PascCompatibilityCheck`, `PascAnalysisPanel`, and `WebGisMap`.
- Confirmed inference results can be merged into existing `InsarPoint` objects and rendered through the existing fixed mode palette.
### Phase E1 complete
- Froze the synchronous 500-point WebGIS boundary and explicit Phase F exclusions.
- Inventoried the existing CSV mapping/confirmation, point contract, fixed mode renderer, PASC panels, and route conventions.
- Switched to `codex/pasc-phase-e` while preserving the full Phase A-D worktree.
- Phase E2 secure inference proxy is now in progress.
### Phase E2-E4 complete
- Added the authenticated same-origin /api/pasc/infer proxy with an 8 MiB body cap, a 500-point synchronous cap, configured-only upstream URL, server-only API key, timeout, and structured failures.
- Added canonical point serialization with explicit WGS84 coordinates, real dates, model-native mm sign, and service-side preprocess then infer execution.
- Added the PASC flight-check UI for upload/mapping, unit/sign/smoothing confirmation, capability grading, inference, and map completion.
- Merged only validated calibrated service outputs into existing points and switched to the frozen six-class map palette; point details retain all six probabilities and provenance.
- Added low-confidence and limited-spatial result filters. Sub-40 points remain ordinary WebGIS points and are never included in inference.
- The error path updates only the retryable online status/message and preserves current points, map, selections, and prior results.

### Phase E5 verification in progress
- WebGIS complete test: PASS, 17/17 (15 core including synchronous Phase E E2E, 2 SSR/client bundle).
- PASC demo validation: PASS, 3,094 Spatial points and 3,000 Showcase points.
- Strict Phase A and Phase E lint: PASS, zero warnings.
- Python service regression: PASS, 41/41.
### Phase E complete
- Phase E1-E5 are complete on codex/pasc-phase-e.
- Final WebGIS regression passes 17/17; Python service regression passes 41/41.
- Full lint passes with zero errors and 66 warning-level legacy findings; strict Phase A and Phase E lint pass with zero warnings.
- Security, failure-retention, Phase F forbidden-surface, demo, build, and diff checks pass.
- Delivery report and SHA-256 manifest are PHASE_E_COMPLETION_REPORT.md and PHASE_E_FILE_MANIFEST.csv.
- Explicit stop: Phase F was not started.
## Phase F Session
- Date: 2026-08-24
- Scope: Phase F only; stop before Phase G.
- Status: Phase F1 in progress.
- Read the v4 Phase F, security, test, execution, and final-completion requirements.
- Selected the existing Sites capability path with D1 metadata, R2 objects, and a D1 lease/claim queue equivalent for the Python consumer.
## Phase F Completion
- Status: complete; explicit stop before Phase G.
- Added D1 job, event, artifact, and model metadata plus owner/status/artifact indexes and an executable migration.
- Added owner-scoped public create/list/detail/summary/artifact/map/cancel routes and consumer-only claim/source/progress/artifact/complete/fail routes.
- Added D1 lease claim, stale-lease recovery, bounded exponential retry, cancellation, monotonic progress, attempt-scoped idempotent R2 keys, and terminal result write-back.
- Added the Python streaming consumer with bounded chunks, frozen preprocess/infer reuse, bad-row isolation, progress/cancellation boundaries, summaries, audit/errors, and 500/2,000/5,000 point deterministic map levels.
- Added the dataset-page task console and explicit `/map?job=` preview; zoom changes request only the corresponding bounded map level and failures retain current map data.
- Added pure state-machine, client response, static owner/auth/boundary, and Python consumer regression tests.
- Verification: Phase F Node tests 7/7 PASS; Phase F Python tests 4/4 PASS; full WebGIS test 24/24 PASS; build PASS; strict Phase F lint PASS; full lint PASS with 0 errors and 66 pre-existing warnings; D1 migration PASS in in-memory SQLite; git diff check PASS.
- Full Python suite: 45/45 PASS using the PyCharm `tsl` SDK at `D:/Anaconda/env/tsl/python.exe` (Python 3.10.20, Torch 2.12.0.dev20260323+cu128, CUDA available, NumPy 1.24.4), including all Phase D checkpoint and Phase F consumer tests.
## Phase G Session
- Date: 2026-08-24.
- Scope: external-region evaluation and honest product applicability only.
- Froze model mathematics, training, 13 physical features, scaler, calibration, spatial mechanism/reference, class contract, and thresholds.
- Implemented controlled coordinate, unit, sign, sampling, and orbit-contract evaluation plus path-free JSON/CSV/Markdown evidence.
- Added mandatory limited-reference wording and temporal/physical-dominant explanation to the WebGIS analysis panel.
- Kept dense Self-neighborhood diagnostics synthetic, offline, and excluded from prediction/product activation.
- Corrected intermediate newline, import, and manifest-scope errors before final verification.
- Verification: Python 52/52 PASS; WebGIS build and Node tests 26/26 PASS; demo validation PASS; Phase G lint 0 warnings; global lint 0 errors with 66 legacy warnings.
- Frozen contract, preprocessing, model architecture, inference, and scaler hashes matched their Phase B/D manifests.
- Phase G completed with reports, machine artifacts, manifest, and no post-v4 model change.
## Release preparation session
- Started release R1 on `codex/pasc-phase-g`.
- Recovered the completed Phase A-G plan and confirmed all phase branches still point at the original main commit while A-G changes remain in one cumulative worktree.- R1 inventory: 107 untracked candidate files (~8.99 MB), 19 tracked modifications; ignored build/cache/private-bundle material remains outside the candidate.
- Logged and changed approach after the PowerShell sensitive-scan regex parse error.
- R1 complete: candidate boundary, data replacement, secrets, large files, ignored private assets, locks, and whitespace audited.
- Selected one atomic v4 A-G release commit because shared files cannot be safely reconstructed into historical phase commits.
- R2 release hygiene is in progress.
- R2 audit found a release-blocking migration-order conflict: generated 0000 duplicates tables from tracked 0001; will replace it with an additive PASC upgrade migration and preserve existing deployments.
- Also found two literal newline artifacts in progress.md and expected Phase G manifest drift in the three active planning files.
- Logged Windows rg wildcard-path error; valid output identified Phase F test and README references that must move from conflicting 0000 to additive 0002.
- Built additive drizzle/0002_pasc_jobs.sql, restored the manual-migration journal, removed the conflicting generated 0000 baseline/snapshot, updated docs/tests, and cleaned literal newline artifacts.
- First SQLite upgrade verification command failed at PowerShell parse time; switching to a single-quoted Python argument rather than retrying the same quoting.
- PyCharm tsl runtime lacks a loadable _sqlite3 DLL; migration verification will use the bundled Codex Python while Torch regressions remain on tsl.
- Created RELEASE_NOTES_PASC_V4.md and linked it from README; documented additive migration order, bindings, secrets, checks, limits, and non-destructive rollback.
- R2 complete: additive migration verified, obsolete generated files removed, release notes added, strict Phase F/G checks passed, and 126-entry staging dry-run contains no forbidden/private path.
- R3 staged candidate verification is in progress; final manifests will be generated after planning state freezes.
- First staged diff check failed on historical trailing whitespace/extra EOF blanks and exposed two release-log strings damaged by PowerShell backtick escapes. The candidate will be mechanically normalized and control-character scanned before restaging.
- Replaced the ineffective regex whitespace trim with per-line TrimEnd normalization after the second staged check still found Markdown hard-break spaces.
- Full staged Python run exposed that the first faulty whitespace regex removed trailing lowercase t characters at line ends; schema validation failed 12 tests. No commit was created. Recovery will use the pre-normalization Git blobs rather than guessing repairs.- Recovered schema.py from exact pre-normalization Git blob 7dd017b5 and confirmed it was the only mapped source file with trailing t semantic loss.

- Release verification retry: corrected the focused Python command from the nonexistent D:\Anaconda\envs\tsl path to the installed D:\Anaconda\env\tsl environment.

- Final Python release verification: Schema/API 16/16 PASS; full service suite 52/52 PASS in D:\Anaconda\env\tsl\python.exe, including Phase D Torch tests.

- Final WebGIS release verification: production build PASS; Node tests 26/26 PASS; demo validation PASS; repository lint 0 errors/66 legacy warnings; strict Phase F/G lint PASS.

- Final migration audit PASS: 0001→0002, repeat 0002, six required tables, eight Phase F indexes, and legacy dataset preservation verified in SQLite.

- Release R3 complete: staged candidate reviewed, private/secret scans PASS, branch confirmed as codex/pasc-phase-g, and atomic commit message fixed as eat: integrate PASC-TCN workflow through phase G.

- Pre-commit manifest audit PASS: Phase F 36 entries, Phase G 18 entries, release 125 entries; diff check, text-control, untracked, and unstaged scans clean.

- Release R4 complete: atomic Phase A-G commit created; closure records and refreshed manifests will be folded into the same new commit without touching earlier history. Push/tag/deploy intentionally not performed.

- Publication authorized: proceed with a public PASC-TCN-GIS production repository, Vercel static frontend, and a private inference-service boundary; exclude baselines, paper-only artifacts, large research data, training/reproduction scripts, weights, and secrets.

- Public boundary audit PASS: no baseline/paper/training research entry points, no tracked file at or above 10 MB, private assets remain excluded, Vercel local state is ignored, and package/README metadata now identify PASC-TCN-GIS.

- Deployment metadata verification PASS: production build, 26/26 Node tests, and both bounded demo validations succeeded; P1 complete and P2 started.

- GitHub repository creation succeeded; initial HTTPS push failed with connection reset and will be retried using per-command HTTP/1.1.

- GitHub HTTP/1.1 push retry also failed because github.com:443 was unreachable; next transport check is existing non-interactive SSH authentication.

- GitHub transport diagnosis: SSH reachable but unauthenticated; REST API healthy; target repository remains empty; system Git selected as the final history-preserving push alternative.

- GitHub smart-HTTP blocked after three distinct transport attempts; repository exists but is empty. Awaiting approval for a snapshot-only REST API publication that would omit prior commit history.

- User approved snapshot-only GitHub API publication and Vercel login; P2 continues with a new root commit while preserving the validated public/private file boundary.

- Snapshot API attempt 1 stopped at the first blob with HTTP 409 because the repository was empty; retry will bootstrap main and then replace the tree without retaining the bootstrap file.

- GitHub accepted all 195 blobs; tree assembly failed locally on generic-list JSON conversion. Retry will reuse content SHAs and upload only changed planning/manifest files.

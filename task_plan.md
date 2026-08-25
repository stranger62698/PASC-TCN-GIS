# Task Plan: PASC-TCN Phase A through Phase G

## Goal
Preserve completed Phases A-F and complete only Phase G from the v4 plan: independently evaluate external-region temporal/physical behavior, spatial reliability, orbit/unit/sign and sampling differences; keep Self-neighborhood experimental; surface honest exploratory applicability without changing frozen model mathematics.

## Current Phase
Phase G complete

## Phases

### Phase 1: Discovery and Baseline
- [x] Read the v4 implementation plan and freeze Phase A boundaries
- [x] Confirm current branch and clean working tree
- [x] Inventory application architecture, data types, import flow, API paths, demos, and tests
- [x] Create `codex/pasc-phase-a`
- **Status:** complete

### Phase 2: Contract and Compatibility Core
- [x] Add PASC contract types, fixed six-class catalog, colors, applicability, and point result types
- [x] Implement schema aliases, date parsing/sorting/duplicate detection, capability levels, optional velocity, and coherence source reporting
- [x] Add unit tests for contract and compatibility behavior
- **Status:** complete

### Phase 3: UI and Existing Flow Integration
- [x] Add compatibility, analysis, probability, legend, and region-stat components
- [x] Integrate fixed classes/colors and PASC fields without regressing existing WebGIS behavior
- [x] Unify upload API path
- **Status:** complete

### Phase 4: Offline 248-Epoch Demos
- [x] Generate Spatial and Showcase demos from formal 248-epoch results
- [x] Add provenance/validation manifests and explicit Showcase disclaimer
- [x] Validate epoch counts, point counts, probabilities, classes, and metadata
- **Status:** complete

### Phase 5: Verification and Delivery
- [x] Run build, tests, lint, old-CSV regression, and demo validation
- [x] Produce Phase A file manifest and completion report
- [x] Confirm frozen model mathematics untouched and Phase B not started
- **Status:** complete

### Phase B1: Requirements and Authoritative Source Inventory
- [x] Read the complete Phase B preprocessing, API, and golden-regression requirements
- [x] Inventory authoritative local preprocessing code, frozen scaler/feature order, test fixtures, and service constraints
- [x] Define service boundary and artifact-copy policy without checkpoint/model inference
- **Status:** complete

### Phase B2: Service Schema and Validation
- [x] Create `pasc-tcn-service` package structure and versioned request/response schemas
- [x] Implement streaming CSV schema/date/unit/sign/preprocessing validation and Level 0-3 reports
- [x] Add explicit 39 unsupported, 40-247 experimental, and 248 native statuses
- **Status:** complete

### Phase B3: Authoritative Preprocessing
- [x] Implement validated Temporal Adapter behavior
- [x] Implement authoritative SG, row-wise Z-score epsilon 1e-5, and 13 raw physical features
- [x] Load a frozen scaler artifact without fitting user data
- [x] Record velocity/coherence sources and complete quality/provenance fields
- **Status:** complete

### Phase B4: Validate and Preprocess APIs
- [x] Implement `validate` and `preprocess` API endpoints without model execution
- [x] Add deterministic output artifacts and failure codes
- [x] Document local execution and frozen boundaries
- **Status:** complete

### Phase B5: Golden Regression and Delivery
- [x] Compare native 248 dates, normalized series, 13 raw/scaled features, velocity, and coherence with the authoritative existing flow
- [x] Run service tests, WebGIS regression, lint/static checks, file manifest, and Phase B report
- [x] Confirm no Phase C validation thresholds, checkpoint loading, or inference were implemented
- **Status:** complete


### Phase C1: Protocol and Authoritative Asset Inventory
- [x] Freeze the fixed 523-sample test identity, label order, model/scaler/checkpoint sources, and source hashes
- [x] Inventory existing inference/split code and identify the exact reproducible test-set selection
- [x] Define a Phase C-only offline evaluation boundary without adding a service inference endpoint
- **Status:** complete

### Phase C2: Deterministic Sampling Matrix
- [x] Implement 248 baseline plus 160/120/80/60/40 sampling groups
- [x] Implement uniform, random_missing, continuous_gap, front_dense_back_sparse, and front_sparse_back_dense with fixed seeds
- [x] Persist selected date indices and verify every row/group has the requested unique effective epochs
- **Status:** complete

### Phase C3: Frozen Offline Evaluation
- [x] Run the frozen M4 pipeline only on the fixed 523 test samples
- [x] Compute Accuracy, Macro-F1, per-class Precision/Recall/F1, Prediction Agreement, Confidence Shift, calibration change rate, and failure count
- [x] Preserve 248 baseline predictions and compare every sampling scenario against them
- **Status:** complete

### Phase C4: Evaluation Artifacts
- [x] Produce machine-readable CSV and JSON outputs
- [x] Produce PNG and PDF figures plus a Markdown report
- [x] Record provenance, seeds, date-index manifests, metric definitions, and experimental-only interpretation
- **Status:** complete

### Phase C5: Verification and Delivery
- [x] Re-run determinism and artifact consistency checks
- [x] Run Phase C tests plus Phase A/B/WebGIS regressions and static checks
- [x] Produce a Phase C file manifest/completion report and confirm no acceptance threshold or Phase D API was added
- **Status:** complete
### Phase D1: Exact Requirements and Frozen Runtime Inventory
- [x] Read the complete v4 Phase D API/model/security/operations requirements and final completion definition
- [x] Inventory current Phase B service/API, Phase C evaluator, frozen assets, and allowed packaging boundary
- [x] Freeze the Phase D-only scope and stop before Phase E WebGIS online recognition
- **Status:** complete

### Phase D2: Frozen Model Runtime and Provenance
- [x] Package or reference the frozen checkpoint, Scaler, model code, calibration, and spatial reference under hash enforcement
- [x] Implement startup self-checks and fail-closed model availability
- [x] Preserve the validated preprocessing/model/calibration behavior
- **Status:** complete

### Phase D3: Versioned Inference API
- [x] Implement the exact v4 Phase D endpoints and request/response contract
- [x] Add authentication/authorization and input/resource limits required by the plan
- [x] Return probabilities, class, confidence, applicability, quality, warnings, and provenance
- **Status:** complete

### Phase D4: Reliability, Security, and Operations
- [x] Add deterministic failures, timeouts/concurrency controls, structured audit/health information, and safe logging
- [x] Prevent arbitrary URL fetches, secret leakage, training/fitting, and cross-owner access
- [x] Document deployment/runtime configuration without starting Phase E task/D1/R2 integration
- **Status:** complete

### Phase D5: Golden Regression and Delivery
- [x] Add native-248 and adapted inference golden tests plus API/security/failure tests
- [x] Run service and WebGIS regressions, compile/lint/static audits, and deterministic checks
- [x] Produce Phase D manifest/completion report and confirm Phase E was not started
- **Status:** complete


### Phase E1: Scope, Architecture, and Current-Flow Inventory
- [x] Freeze Phase E small-data synchronous scope and Phase F stop boundary
- [x] Inventory current CSV mapping/confirmation/state flow, map result handling, and server API conventions
- [x] Create and switch to `codex/pasc-phase-e` without discarding Phase A-D changes
- **Status:** complete

### Phase E2: Secure WebGIS Inference Proxy
- [x] Add a same-origin server proxy that performs Python preprocess then infer without exposing service secrets
- [x] Enforce contract, small-data point/body limits, deterministic errors, and no user-controlled upstream URL
- [x] Add proxy contract and failure tests
- **Status:** complete

### Phase E3: Guided Online Recognition and Map Integration
- [x] Add upload → mapping → unit/sign/smoothing confirmation → compatibility → recognition controls
- [x] Merge returned PASC results into existing points without client-side recalibration
- [x] Display fixed class colors and point-level six probabilities/provenance in the existing map workflow
- **Status:** complete

### Phase E4: Filters and Failure Retention
- [x] Add low-confidence and limited-spatial filters with visible counts/status
- [x] Keep fewer-than-40 points available for ordinary WebGIS while excluding them from PASC inference
- [x] Preserve existing dataset/map/results when the API fails and provide a retryable error state
- **Status:** complete

### Phase E5: End-to-End Regression and Delivery
- [x] Add synchronous small-data end-to-end and UI/state regression tests
- [x] Run WebGIS build/test/lint, Python regressions, static security/Phase F boundary audits, and smoke tests
- [x] Produce Phase E manifest/completion report and confirm Phase F was not started
- **Status:** complete


### Phase F1: Scope, Architecture, and Current-Flow Inventory
- [x] Freeze the Phase F large-data job scope and Phase G stop boundary
- [x] Inventory Sites D1/R2 bindings, dataset ownership/storage, service execution boundaries, and map rendering options
- [x] Create and switch to codex/pasc-phase-f without discarding Phase A-E changes
- **Status:** complete

### Phase F2: Durable Job and Artifact APIs
- [x] Add D1 job/event/artifact/model metadata with owner-scoped indexes and migration
- [x] Add authenticated create/status/summary/artifacts/cancel APIs with idempotent job creation
- [x] Store source/results/audit/errors in owner-scoped R2 keys and keep large matrices out of D1
- **Status:** complete

### Phase F3: Queue-Equivalent Consumer and Recovery
- [x] Add an internal authenticated D1 lease/claim protocol as the Sites-compatible Queue equivalent
- [x] Add a Python consumer for configured WebGIS download, chunked frozen inference, progress, cancellation, and result upload
- [x] Add bounded retry, idempotent chunk writes, stale-lease recovery, and terminal failure handling
- **Status:** complete

### Phase F4: Lightweight Result Map
- [x] Produce summary/audit/error artifacts and deterministic multilevel map samples
- [x] Add authenticated result-map loading that never returns the full large dataset
- [x] Reuse frozen class colors and validated PASC output fields for sampled point details
- **Status:** complete

### Phase F5: WebGIS Job Operations UI
- [x] Add large-data job creation, progress stages, retry/recovery status, cancellation, and artifact links
- [x] Poll owner-scoped job state without clearing the current map on failure
- [x] Load only a multilevel sampled result preview into the existing mode map on explicit user action
- **Status:** complete

### Phase F6: End-to-End Regression and Delivery
- [x] Add D1/R2/job/consumer/idempotency/cancellation/recovery/map-sampling tests
- [x] Run WebGIS build/test/lint, Python regressions, migration/static security audits, and smoke tests
- [x] Produce Phase F manifest/completion report and confirm Phase G was not started
- **Status:** complete

### Phase G1: Scope Freeze and Evidence Inventory
- [x] Freeze Phase G as evaluation/product-honesty work; forbid autonomous model, feature, gate, calibration, reference, or threshold changes
- [x] Inventory external-region fixtures/data, orbit metadata, units/sign conventions, sampling patterns, spatial diagnostics, and existing golden coverage
- [x] Create and switch to `codex/pasc-phase-g` without discarding Phase A-F changes
- **Status:** complete

### Phase G2: Independent External-Region Evaluation
- [x] Add a reproducible evaluator that separates temporal/physical outputs from training-reference spatial evidence
- [x] Evaluate orbit/unit/sign normalization and representative sampling differences without refitting or relabeling
- [x] Persist machine-readable scenarios, provenance, metrics, warnings, and limitations
- **Status:** complete

### Phase G3: Spatial Reliability and Self-Neighborhood Experiment
- [x] Quantify training-reference distance, spatial reliability, gate behavior, and `limited_reference` outcomes
- [x] Add Self-neighborhood only as an isolated offline experiment with no production code path or automatic activation
- [x] Compare baseline/reference-limited/Self-neighborhood evidence without claiming accuracy absent labels
- **Status:** complete

### Phase G4: Product Applicability and Evidence UI
- [x] Add explicit exploratory external-region messaging and temporal/spatial evidence detail
- [x] Prevent claims of arbitrary-city high accuracy and preserve fixed six-class/output contracts
- [x] Integrate external evaluation reports without exposing private series/model assets or enabling training
- **Status:** complete

### Phase G5: Regression and Delivery
- [x] Add Python/WebGIS tests for external-region, normalization, sampling, reliability, messaging, and experimental isolation
- [x] Run full build/test/lint, 45-test Python baseline, Phase G evaluator, frozen-math/security audits, and legacy regressions
- [x] Produce Phase G manifest/completion report and confirm no post-v4 scope was started
- **Status:** complete
## Key Questions
1. Where are existing point types, CSV import/date parsing, class-color logic, demo sources, and upload API calls implemented?
2. Which formal 248-epoch result artifact can safely be copied/derived into the public WebGIS repository without exposing private model assets?
3. What existing automated tests cover old CSV import and map analytics?
4. Which formal artifact fixes the exact 523 test rows, and can it be reconstructed without changing the frozen split?
5. Which checkpoint/scaler/spatial-reference/calibration assets are required for faithful offline M4 evaluation?
6. How are the five sampling patterns defined so all epoch counts and date-index selections are deterministic and auditable?
7. Does the formal pipeline already expose pre/post-calibration predictions and confidence needed by the Phase C metrics?

## Decisions Made
| Decision | Rationale |
|----------|-----------|
| Scope ends after Phase A verification/report | Explicit user instruction and v4 execution rule |
| Do not add Adapter, SG, Python service, checkpoint, or online inference | Explicit Phase A prohibition |
| Keep PASC contract version `pasc-contract-v1` and model version `pasc-tcn-haikou-v1` | Frozen v4 contract |
| Phase C evaluates only the fixed formal 523-row test split | v4 requires no resplit or added samples |
| Sampling seed is 20260824 and all selected indices/dates are persisted | Deterministic and auditable Phase C evidence |
| No acceptance threshold or supported minimum is selected | v4 assigns the decision to the user |
| Phase C remains offline and adds no /v1/infer endpoint | Stop boundary before Phase D |
| Phase D private assets remain outside tracked files; the service loads a hash-verified external bundle | v4 forbids checkpoint/private reference in WebGIS and requires private deployment |
| Phase D reimplements only the exact inference architecture and formal spatial/calibration path | Decoupled inference-only runtime with no training APIs |
| Spatial full_reference requires nonzero frozen formal reliability; otherwise limited_reference | Uses the formal radius/weight result without inventing a threshold |
| Create codex/pasc-phase-d while preserving the dirty Phase A-C baseline | v4 Phase-specific branch rule and shared-worktree safety |

| Use a D1 lease/claim queue as the Sites-compatible Queue equivalent | The existing Sites project declares D1/R2 bindings and v4 explicitly permits Queue or an equivalent mechanism |

## Errors Encountered
| Error | Attempt | Resolution |
|-------|---------|------------|
| Initial sandboxed `rg --files` failed with deny-read ACL helper error | 1 | Re-ran read-only inventory with approved escalation |
| Built-in `apply_patch` and local `apply_patch` command were blocked by workspace ACLs | 1-2 | Switched to a direct UTF-8 workspace write after patch alternatives were exhausted |
| TTY-fed `git apply` corrupted non-ASCII text/control characters | 3 | Replaced the file as UTF-8 without BOM and kept planning text ASCII-only |
| A PowerShell command parsed a regex pipe as a shell pipeline | 1 | Re-ran with single-quoted regex arguments |
| A planning-record patch had incorrect hunk counts | 1-2 | Inspected exact line numbers and applied smaller exact-context patches |
| Initial multi-file Phase B plan patch had an invalid hunk count | 1 | Split the update into a smaller valid patch |
| System Python lacked NumPy | 1 | Used the bundled workspace Python runtime |
| Phase C inventory initially looked for `experiment_config.json` under `results/04_m1_m4`, but that file does not exist | 1 | Used the authoritative `experiment_report.json`, explicit split CSV, and later experiment config instead |
| `fixed_validation_test_split.csv` was initially assumed to be in `results/04_m1_m4` | 1 | Located it under `results/07_m3_m4_three_seed_all_sizes`; retained the 04 split CSV as the full-size checkpoint authority |
| Base Anaconda lacks Torch | 1 | Selected the existing `D:/Anaconda/env/tsl` environment with CUDA Torch; no dependency installation |
| Built-in apply_patch was blocked by workspace ACLs; one large TTY patch was corrupted | 1-3 | Used small base64-fed git patches; exact mechanical replacements only after both patch paths failed |
| Fixed split fid values differed only by CSV numeric formatting | 1 | Compared normalized integer fid values |
| Current Torch/CUDA raw confidence differed from the saved baseline by 2.30067e-5 | 1 | Required 523/523 label equality and recorded a 5e-5 numerical reproduction tolerance |
| A zero-context patch temporarily caused an IndentationError | 1 | Moved confidenceTolerance into the baseline reproduction object and compiled before rerun |
| JSON rejected baseline seed NaN | 1 | Converted DataFrame NaN values to JSON null before strict allow_nan=False serialization |
| Initial artifact validator expected selectedIndices instead of indices | 1 | Corrected the manifest field name and reran validation successfully |
| node was not on PATH for PDF artifact marking | 1 | Located and used the bundled Codex node.exe |
| view_image was blocked by the local ACL helper | 1 | Rendered with bundled Poppler and inspected a resized PNG data preview |
| Phase D task_plan apply_patch was blocked by the workspace ACL helper | 1 | Use the previously validated exact UTF-8 replacement fallback and continue logging changes |
| The single-command inference.py patch exceeded the Windows command/path length | 1 | Split the new file into smaller patch chunks instead of retrying the oversized command |
| inference.py final chunk had an incorrect six-line context count | 1 | Correct the hunk from 7 to 6 context lines and reapply only the final chunk |
| Sandboxed Phase D compile check was blocked by the deny-read ACL helper | 1 | Re-run the same non-mutating compile check with approved escalation |
| The first escalated compile used the nonexistent D:/Anaconda/envs/tsl path | 1 | Verified and switched to the existing D:/Anaconda/env/tsl/python.exe runtime |
| Phase D error-log apply_patch was also blocked by the deny-read ACL helper | 1 | Used the previously validated exact UTF-8 replacement fallback |
| The first exact runtime-order replacement did not match the file newline/context | 1 | Inspected exact lines and applied a counted regex replacement |
| apply_patch could not create the Phase D golden generator under the workspace ACL | 1 | Used the validated exact UTF-8 workspace fallback after the patch failure |
| The first golden run used a stale guessed hash for the formal inference helper | 1 | Captured the actual immutable helper SHA-256 and froze it before rerunning |
| apply_patch could not create the Phase D inference test file under the workspace ACL | 1 | Used the validated exact UTF-8 workspace fallback after the patch failure |
| Phase D sealing wrapper exposed that the original preprocess function had not actually been renamed | 1 | Renamed only the first definition to `_preprocess_payload` and retained the public sealed wrapper |
| PowerShell static Regex.Replace treated the intended count argument as options and renamed both preprocess definitions | 1 | Restored the final definition by its last exact ordinal occurrence |
| A combined test-edit command had invalid PowerShell escaping around Python dictionary indexing | 1 | Split the edit and used plain exact replacements without embedded escape sequences |
| The first concurrency edit command had invalid PowerShell escaping in a status dictionary line | 1 | Re-ran with line-array insertion |
| The second concurrency edit relied on CRLF blocks while the source used LF | 1 | Located exact line indices and inserted code without newline assumptions |
| A metadata edit that also removed an unreachable startup branch was rejected as potentially weakening fail-closed behavior | 1 | Kept the startup guard unchanged and applied only safe package metadata updates |
| The first arbitrary-fetch audit matched the harmless local startup URL display string | 1 | Narrowed the audit to network client imports and fetch call sites |
| Phase E task_plan apply_patch was blocked by the workspace deny-read ACL helper | 1 | Used the previously validated exact UTF-8 workspace fallback and logged the failure |
| apply_patch could not create `app/lib/pasc-online.ts` under the workspace ACL | 1 | Used the validated exact UTF-8 workspace fallback after the patch failure |
| The first sign-conversion edit used literal newline escapes and did not match `insar-v2.ts` | 1 | Located exact lines and applied a line-array edit without newline assumptions |
| Initial Phase E core tests exposed JavaScript negative zero after sign conversion | 1 | Canonicalized converted zero displacement and velocity to positive `0` before proxy serialization |
| The second Phase E core run found negative zero could still enter through an existing in-memory series | 1 | Canonicalized zero again at the Phase E request boundary before building the service payload |
| Phase E initial current-phase replacement missed a stale Phase D2 value | 1 | Corrected the exact current-phase line after re-reading the plan |
| The first wrapper restoration used literal newline escapes in a single-quoted PowerShell string | 1 | Replaced the last exact function-signature occurrence without newline assumptions |
| System `npm` was not available for the WebGIS regression | 1 | Switched to the bundled Codex pnpm executable |
| Bundled pnpm initially could not find `node` on PATH | 1 | Prepended the bundled Codex Node bin directory for the test/lint process |

| The first Phase E findings write embedded Markdown backticks into the JavaScript tool wrapper | 1 | Re-ran the exact UTF-8 append without wrapper-sensitive backticks |

| The first Phase E component fallback assumed a browser btoa helper inside the V8 tool wrapper | 1 | Wrote the exact UTF-8 component with a PowerShell literal here-string instead |

| The first package script insertion treated a single matched line as a character in PowerShell | 1 | Inserted the Phase E lint script by an exact line index instead |

| The first combined Phase E test/README tool wrapper was broken by Markdown fence backticks | 1 | Split the writes and used wrapper-safe literal text |

| Initial Phase E SSR test expected inactive PASC-tab content in server HTML | 1 | Kept the /map SSR assertion and verified the lazy client bundle contains the complete Phase E flight-check UI |

| The first Phase E Python regression ran from the repository root without the service src on PYTHONPATH | 1 | Re-ran with the documented pasc-tcn-service/src package path |

| The combined final audit command returned exit 1 because the expected Phase F forbidden-term search found no matches | 1 | Preserved the successful lint/diff/key results and reran forbidden-term validation with an explicit no-match success condition |

| Initial Phase F file inventory included a nonexistent migrations directory in rg | 1 | Kept the valid API/db/service inventory and will generate the first migration from the updated schema |

| Initial Phase F route writer used Resolve-Path on bracketed dynamic-route directories, which PowerShell treated as wildcard patterns | 1 | Re-ran with absolute System.IO paths and Directory.CreateDirectory |

| Release sensitive-pattern audit command had unsafe PowerShell quoting around a regex quantifier | 1 | Split the scan into wrapper-safe fixed-pattern searches |

| Windows rg rejected a shell-style PHASE_* filename argument during migration-reference search | 1 | Use rg globs or explicit filenames and retain the valid matches already returned |

| apply_patch could not update migration files because the Windows ACL helper denied reads | 1 | Used the established exact UTF-8 fallback, validated workspace-bound cleanup targets, and removed only the two obsolete generated files |

| First SQLite upgrade verification used Python string quoting that PowerShell parsed as command syntax | 1 | Re-run Python -c as a single-quoted PowerShell argument with double-quoted Python strings |

| PyCharm tsl Python could not import sqlite3 because its _sqlite3 DLL dependency is missing | 1 | Use the bundled Codex Python runtime for the database-only migration audit; keep tsl for Torch tests |

| Obsolete-migration audit matched the intentional release-note warning about the discarded file | 1 | Treat the documented do-not-apply warning as expected and keep the removed path out of code/tests/deploy instructions |

| First staged diff check found historical trailing whitespace/extra EOF blanks and two release-log strings corrupted by PowerShell backtick escapes | 1 | Normalize candidate text whitespace, repair the affected log text, rescan control characters, and restage |

| First bulk whitespace normalizer used a single-quoted regex whose literal backtick tokens removed trailing lowercase t characters | 1 | Recover exact pre-normalization Git blobs and use only per-line TrimEnd normalization |

| Full Python release run failed after schema.py report was truncated to repor by the faulty normalizer | 1 | Restored schema.py from exact Git blob 7dd017b5 and require a clean 52-test rerun before commit |

| Focused Python rerun used `D:\Anaconda\envs\tsl\python.exe`, but the installed environment path is `D:\Anaconda\env\tsl\python.exe` | 1 | Correct the path and rerun the same focused suite |


| Publication planning apply_patch was blocked by the workspace deny-read ACL helper | 1 | Used the established exact UTF-8 fallback and kept the edit scoped to planning records |


| First push to the new GitHub repository was reset during HTTPS transfer | 1 | Kept the successfully created repository and retried once with per-command HTTP/1.1 transport |


| HTTP/1.1 GitHub push retry could not connect to github.com port 443 | 2 | Checked existing non-interactive SSH authentication before choosing a different transport |


| GitHub SSH transport was reachable but no SSH public key is configured | 1 | Did not alter user SSH credentials and tested the separate system Git implementation |


| System Git also could not reach the GitHub smart-HTTP endpoint on port 443 | 3 | Stopped repeating history-preserving pushes and obtained approval for snapshot-only GitHub API publication |


| Snapshot authorization record command contained wrapper-sensitive newline escapes | 1 | Replaced embedded escape tokens with character constants before retrying |


| GitHub rejected blob creation while the repository had no initial ref | 1 | Initialize main through the Contents API, then replace the bootstrap tree with the complete production snapshot |


| Snapshot blob upload completed but ConvertTo-Json rejected the generic tree-entry list | 2 | Reuse uploaded blobs by content SHA, use a plain PowerShell array, and upload only changed planning/manifest blobs |


| Operations planning apply_patch was blocked by the workspace deny-read ACL helper | 1 | Used the established exact UTF-8 fallback for planning records only |


| Direct view_image access to the clipboard temp path was blocked by the Windows sandbox ACL helper | 1 | Use the visible attached image already supplied in the conversation and source/API evidence; do not copy user temp data unnecessarily |

## Notes
- Six classes and colors are frozen by v4.
- 40 epochs remain experimental; 39 is unsupported; 248 is native.
- Planning files are cumulative implementation records for completed Phases A-F and active Phase G.

### Release R1: Worktree Provenance and Boundary Audit
- [x] Inventory all tracked/untracked/ignored files and distinguish product artifacts from private/build/runtime material
- [x] Audit secrets, large files, local paths, generated caches, and release-only documentation
- [x] Choose a commit structure that does not split overlapping A-G files unsafely
- **Status:** complete
### Release R2: Release Hygiene and Metadata
- [x] Remove or ignore disposable outputs while preserving evidence and user-owned data
- [x] Normalize release documentation, manifests, and version metadata where required
- [x] Verify no private model/checkpoint/reference or environment secret can be staged
- **Status:** complete
### Release R3: Final Verification
- [x] Run full Python and WebGIS build/test/lint plus manifest/security checks from the staged candidate
- [x] Review staged diff summary and commit contents before mutation
- [x] Confirm branch and release commit message
- **Status:** complete

### Release R4: Commit Organization
- [x] Create the approved clean release commit(s) without rewriting prior history
- [x] Verify clean worktree, commit contents, and final commit identifiers
- [x] Produce a concise release handoff
- **Status:** complete
### Publish P1: Public Repository Boundary
- [x] Reconfirm that only the production PASC-TCN runtime, WebGIS integration, tests, and bounded demo data are public
- [x] Exclude baseline models, paper-only materials, large research data, training/reproduction scripts, private weights, and secrets
- [x] Refresh release manifests and create a deployment-metadata commit
- **Status:** complete

### Publish P2: GitHub Hosting
- [x] Create public repository stranger62698/PASC-TCN-GIS
- [x] Publish the validated production candidate snapshot to main
- [x] Verify repository visibility, default branch, commit, and public file boundary
- **Status:** complete

### Publish P3: Vercel Frontend
- [x] Authenticate Vercel and create/link project pasc-tcn-gis
- [x] Connect the GitHub repository and deploy the validated static frontend
- [x] Verify the production URL and primary WebGIS/demo routes
- **Status:** complete

### Publish P4: Private Inference Handoff
- [x] Preserve the private model bundle and service credentials outside GitHub and Vercel static output
- [x] Document the remaining private Python/Torch service requirements for live inference
- [x] Confirm the public frontend fails closed until a private inference service is configured
- **Status:** complete
### Operations O1: Authentication Diagnosis
- [x] Inspect the reported registration/login failure and reproduce the live API response
- [x] Audit Vercel authentication function dependencies, environment variables, and persistence backend
- [x] Identify the smallest safe fix without exposing credentials or weakening authentication
- **Status:** complete

### Operations O2: Authentication Remediation
- [x] Implement and test the authorized authentication repair
- [x] Configure required Vercel resources/secrets and redeploy
- [x] Verify registration, login, session, and private-data isolation in production
- **Status:** complete

### Operations O3: Private PASC-TCN Inference Design
- [x] Inventory the private model bundle, Torch runtime, service entrypoint, and hosting constraints
- [x] Package and launch the private inference service without publishing weights or secrets
- [x] Connect a same-origin production proxy and verify health/inference/rollback behavior
- **Status:** complete

### Operations O4: CSV Automatic Classification
- [x] Audit the current CSV upload/mapping/confirmation flow and the 500-point Phase E boundary
- [x] Implement automatic classification after a valid CSV is confirmed, including large-file job routing
- [x] Preserve validation, unit/sign/preprocessing confirmations, progress, failure retention, and honest applicability labels
- [x] Verify a representative compliant CSV reaches classified map results in production
- **Status:** complete

### Operations O5: ENVI CSV Compatibility and Import Reliability
- [x] Reproduce the supplied `500.csv` import and inventory ENVI headers, encoding, row shape, and current parser behavior
- [x] Accept `D_YYYYMMDD` as a date column by canonicalizing it to `YYYY-MM-DD` without changing source values
- [x] Diagnose and repair the non-JSON import response so local CSV analysis does not depend on an unavailable server route
- [x] Add STAMPS/ENVI regression coverage, run full build/tests, and verify automatic PASC-TCN classification end to end
- [x] Publish the validated public code and redeploy Vercel without exposing private weights or secrets
- **Status:** complete

### Operations O6: Large InSAR Task Classification
- [x] Reproduce the 21,610-point boundary and audit whether existing Phase F APIs/storage/worker are deployable on current Vercel production
- [x] Design a server-owned persistent job that reads the private CSV, classifies bounded batches, records progress/results, and resumes safely
- [x] Integrate a clear large-data classification module into the import/map workflow without depending on the visitor computer or browser lifetime
- [x] Add job, retry, ownership, result-map, and 21,610-point regression coverage; run full frontend/private-service verification
- [x] Publish GitHub and deploy/verify production while keeping weights, keys, and user research data private
- **Status:** complete
### Operations O7: 20-Epoch Temporal Adapter Boundary
- [x] Audit the authoritative 248-epoch adapter, real-date interpolation, 12-day cadence assumptions, and every 40-epoch gate
- [x] Change the full-stack minimum from 40 to 20 without changing frozen classifier weights or hiding temporal domain shift
- [x] Add 19/20/210-to-248/irregular-cadence regression coverage and run WebGIS/private-service verification
- [ ] Publish GitHub and redeploy the frontend/private service with production checks
- **Status:** in_progress

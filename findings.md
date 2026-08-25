# Findings & Decisions - PASC-TCN Phase A

## Requirements
- Execute only Phase A from the v4 implementation plan, then stop.
- Work on branch `codex/pasc-phase-a`.
- Add `app/types/pasc.ts`, `app/lib/pasc.ts`, and `app/lib/pasc-schema.ts`.
- Add `PascCompatibilityCheck`, `PascAnalysisPanel`, `PascProbabilityBars`, `PascPatternLegend`, and `PascRegionStats`.
- Freeze six-class IDs/names/colors; extend point/result types.
- Parse/sort/deduplicate dates; make velocity optional/calculable; report coherence source.
- Support Levels 0-3, 39/40/248 states, temporal and spatial applicability.
- Add compatibility and PASC result displays.
- Provide validated 248-epoch Spatial and Showcase demos with provenance and Showcase-use disclaimer.
- Preserve old CSV behavior and unify upload API paths.
- Pass build, tests, lint, original-feature regression, demo validation, and produce a file manifest/report.

## Research Findings
- Initial branch was clean `main`, tracking `origin/main`; work now continues on `codex/pasc-phase-a`.
- The v4 plan is in sibling path `../fyw0822/LANJIFYW_PASC_TCN_*.md`.
- Phase A explicitly excludes Temporal Adapter execution, SG, Python APIs, checkpoints, and online inference.
- Contract constants: `pasc-contract-v1`, `pasc-tcn-haikou-v1`; target epochs 248; 40 experimental minimum.
- Six classes: Stable `#76D65B`, Linear `#E69F00`, Piecewise `#0072B2`, Decelerating `#F0E442`, Accelerating `#D73027`, Undefined `#4D4D4D`.

## Technical Decisions
| Decision | Rationale |
|----------|-----------|
| Treat `Stepwise` as legacy requiring explicit warning, never silent conversion | v4 contract rule |
| Calculate optional velocity from real dates using least-squares slope | v4 unit/missing-data rule |
| Calculate effective epoch count per point from finite non-null date/value pairs | v4 data-contract rule |

## Issues Encountered
| Issue | Resolution |
|-------|------------|
| Workspace process/write ACL rejected normal sandbox and built-in patch operations | Used approved escalation; after patch mechanisms failed, wrote planning records directly as UTF-8 |

## Resources
- `../fyw0822/LANJIFYW_PASC_TCN_*.md`
- `package.json`

## Repository Inventory
- `app/lib/insar.ts` owns CSV inspection/parsing, aliases, slope calculation, quality reports, rendering values, and QGIS ramps.
- `app/data/site.ts` owns the existing `InsarPoint` type and public-site demo metadata.
- `app/components/MapWorkspace.tsx` owns the active CSV workflow, map/statistics UI, and still calls `/api/private-datasets`.
- `public/data/haikou-insar.csv` has 4,073 points and 210 date columns; its legacy class values include `Stepwise`.
- Current parser requires velocity in strict imports, keeps date header order, only recognizes dates lexically, and uses `0` as missing coherence.
- Current fallback velocity is already least-squares based, but date parsing falls back to synthetic monthly spacing for unsupported date formats.
- Current automated`npm test` only runs the server-render HTML test after a build; `tests/analytics.test.mjs` is not included in that script.
- `README.md` still documents five legacy classes and a first/last velocity estimate, both requiring Phase A correction.
- `app/data/site.ts` public case metrics still advertise 4,073 points and 210 epochs.
- The project uses strict TypeScript, ESLint, Node test runner, vinext build, React 19, and Leaflet.

## Formal Demo Source
- Formal full-area predictions are at `../fyw0822/results/08_full_area_prediction/PASC_TCN_full_area_predictions_755780.csv` (755,780 rows).
- Formal 248-epoch SG series are at `../fyw0822/data/SG_Filtered_subsidence_candidates_full_755780.csv` (about 1.13 GB).
- Both sources join on `fid`; prediction output supplies six calibrated probabilities, confidence, low-confidence flag, spatial reliability, and gate mean.
- The formal inference report confirms 248 epochs, frozen M4 strategy, fixed 1,036-row spatial reference policy, and class counts.
- The checked-in prediction CSV is compact (metadata/predictions only), so Phase A demo generation must stream/join it with the SG time-series source.
- The SG headers run from `D20170322` through `D20250503`, exactly 248 date fields.
- The full-data files are public-package artifacts with SHA-256 entries in the sibling package manifest; no checkpoint or private training reference will be copied.
- Existing canonical inference output uses Chinese labels, while the WebGIS contract must store ID plus English canonical name and use Chinese only for display.

## Phase A Completion Findings
- Spatial Demo selection uses bbox `[110.324, 20.07, 110.37, 20.10]` then one deterministic point per approximately 50m grid cell, yielding 3,094 points.
- Spatial natural class counts are Stable 1,611; Linear 121; Piecewise 394; Decelerating 200; Accelerating 30; Undefined 738.
- Showcase uses deterministic full-area class-stratified selection, 500 points per class (3,000 total), and explicitly states that it does not represent scientific class proportions.
- Formal source hashes are predictions `06e7925f...` and 248-epoch series `2163d28f...`; output hashes are stored in the two demo manifests.
- The old `/api/private-datasets` frontend path has been removed; list/mutate/read use `/api/datasets`, while multipart creation/parts/completion use `/api/uploads`.
- Existing repository lint debt was already present in seven legacy files. It is quarantined as visible warnings for the full lint command, while `lint:phase-a` enforces zero warnings on new Phase A files.
- The checked-in demo includes only formal offline prediction outputs and time series. It contains no checkpoint, training reference asset, model execution code, or user data.

## Final Decisions
| Decision | Outcome |
|---|---|
| 39 epochs | unsupported |
| 40-247 epochs | experimental only |
| 248 epochs | native |
| >248 epochs | adapted applicability label only; no Adapter execution in Phase A |
| missing velocity | calculate least-squares slope from the point's real valid dates when at least two values exist |
| missing coherence |`not_available`; no silent model default |
| duplicate date conflict | fail closed with `PASC_DUPLICATE_DATE_CONFLICT` |
| old Stepwise | preserve as legacy and require confirmation; never map silently |

## Phase B Research
- Phase B must create `pasc-tcn-service` and implement authoritative schema/date/unit/sign validation, Temporal Adapter, SG decision/execution, row-wise Z-score, the frozen 13-feature vector, frozen training scaler, quality/audit output, and `GET /v1/models`, `POST /v1/validate`, `POST /v1/preprocess`.
- Phase B explicitly does not load a checkpoint or classify; Phase C threshold validation and Phase D inference are out of scope.
- Authoritative preprocessing order is mapping → dates → units → sign → sort/deduplicate → missing/effective epochs → velocity → Adapter → SG → mean/std → Z-score → 13 features → frozen scaler → applicability → quality/audit.
- Adapter is per point: real valid dates/values → relative time 0-1 → 248 equally spaced nodes → linear interpolation. Native complete 248 must bypass unconditional re-interpolation.

## Phase B Decisions
| Decision | Rationale |
|---|---|
| Put `pasc-tcn-service` inside the current product repository | v4 names this service boundary; sibling repositories remain unchanged |
| Support both `csvText` and JSON `records` request bodies | CSV is the product path; records make contract tests and trusted integrations deterministic |
| Use NumPy-only SG polynomial fitting and a standard-library HTTP server | The bundled verified runtime has NumPy but lacks SciPy/FastAPI; no network install is needed |
| Convert `subsidence_positive` to frozen model-native negative subsidence only after explicit confirmation | v4 forbids sign guessing but requires a normalized internal convention |
| Missing coherence becomes frozen default 0.5 with source and warning in preprocessing | Matches the formal full-area flow and keeps provenance explicit |
- `raw` runs SG after adaptation with window 9/polyorder 3; `already_smoothed` skips SG; `unknown` blocks PASC. Noise residual is quality-only and null for already-smoothed data without pre-SG series.
- Z-score is exactly `(series - mean) / (std + 1e-5)`.
- Feature order is total, slope, early_slope, late_slope, acceleration, rate_jump, curvature_rms, linear_residual, amplitude, monotonic_subsidence, late_early_ratio, velocity, coherence.
- Formal feature math lives in `../fyw0822/code/run_spatial_physics_tcn_patent_prototype.py`; full-area preparation uses it from `predict_pasc_tcn_full_area.py`.
- Frozen scaler values are recorded in `../fyw0822/results/08_full_area_prediction/PASC_TCN_full_area_inference_report.json`.
- Formal native series input is already SG-filtered and has 248 shared dates; it is the appropriate golden-regression source for `already_smoothed`.

- The system Python 3.11.3 has no NumPy. The bundled workspace Python is `C:/Users/Administrator/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe` and should be used for local service verification.
- A sibling `../pasc-tcn-public` repository exists and must be inspected before copying or reimplementing authoritative preprocessing.
- Formal source hashes: feature implementation `16e4de4a...`, full-area inference report `26ac2302...`, real 1,742-row 248-epoch dataset `e2740b4c...`.



## Phase B Verification Findings
- The native-248 service output matches the independent formal-flow oracle for all locked fields at absolute tolerance 1e-5 and relative tolerance 1e-6.
- The golden fixture SHA-256 is `c0952a0b6de891ed78c812cf902147f9748d984193fb074421e96bc0436a5dfb`.
- The service source contains no Torch import, checkpoint loading, optimizer/backpropagation, classifier, probability calibration, or inference endpoint.
- The service deliberately reports spatial applicability as`not_evaluated_in_phase_b`; Phase C thresholds and Phase D inference remain absent.
- Every supported point retains original dates/values, span/count, Adapter method, SG decision, normalization statistics, feature order, Scaler identity, velocity/coherence source, warnings, and pipeline audit.

## Phase B Final Boundary
- Delivery manifest locks 19 Phase B/root delivery files, including the completion report and golden fixture, by SHA-256; mutable planning logs are intentionally excluded.
- Final tests cover contract version rejection, optional alias ambiguity, explicit missing date columns, all date formats, duplicate conflicts, unit/sign/state confirmations, 39/40/248 behavior, Adapter, SG, Z-score, Scaler/features, source/default metadata, API failures, and the formal golden oracle.

## Phase C Requirements
- Use only the fixed 523 formal test samples; do not resplit or add samples.
- Evaluate a 248-epoch baseline and 160/120/80/60/40 epoch groups.
- Sampling patterns are `uniform`, `random_missing`, `continuous_gap`, `front_dense_back_sparse`, and `front_sparse_back_dense`.
- Every stochastic choice uses a fixed seed, and every selected date index must be persisted.
- Required metrics are Accuracy, Macro-F1, per-class Precision/Recall/F1, Prediction Agreement, Confidence Shift, calibration change rate, and failure count.
- Required artifact formats are CSV, JSON, PNG, PDF, and Markdown.
- Codex must not invent or apply an acceptance threshold; the user decides the supported minimum from the evidence.
- Phase C is offline validation only. It must not add `/v1/infer` or begin Phase D service integration.

## Phase C Initial Decision
- Treat the formal split, frozen checkpoint, Scaler, calibration, and spatial reference as read-only authoritative inputs in the sibling research repository; copy only non-sensitive derived evaluation evidence into this product repository.
- Phase B is complete and execution must stop before Phase C.

## Phase C1 Asset Findings
- The authoritative split is `results/04_m1_m4/M2_M3_M4_fixed_real_split.csv`: 1,742 rows split into train 1,036, validation 183, and test 523 with fixed seed 521.
- Fixed split SHA-256: `956a8162b95712d7abf49102ee8a869fd9620fcf46e811feb86d4642d02f484c`.
- The full-size frozen M4 checkpoint is `results/04_m1_m4/fraction_1.00_M4.pth`, size 3,336,863 bytes, SHA-256 `a45b91c0b8288d87481f5c13db82a574d79a13086b28a49eb148617155ca6107`.
- Existing full-size M4 test predictions contain the same 523 rows; SHA-256 `40250d66014da01a0d2295d68b537bd2b7a7c8bb4f0f29401735343bf270fba1`.
- Formal real dataset SHA-256 remains `e2740b4c20b82357f1acc1f67230fa3972fa9ee624ad1e5073cbfb8c324a8265`.
- Local `D:/Anaconda/env/tsl/python.exe` has a CUDA-enabled Torch 2.12 development build and can run the frozen model; base Anaconda has the data/plot stack but no Torch.

## Phase C Final Findings

- The native-248 calibrated baseline is Accuracy 0.927342 and Macro-F1 0.926391.
- The frozen evaluator exactly reproduced all 523 existing raw labels; the maximum confidence difference was 2.30067e-5 under the current Torch/CUDA build.
- All 26 scenarios evaluated exactly 523 rows with zero probability/finiteness failures.
- Continuous-gap sampling is consistently the most damaging pattern: at 40 epochs Accuracy is 0.437859 and Macro-F1 is 0.405076.
- Other sampling patterns can remain close to the native baseline even at lower counts; for example front-dense/back-sparse at 40 epochs has Accuracy 0.925430 and Macro-F1 0.924267.
- The evidence therefore shows that retained-date geometry materially affects results; epoch count alone is not a sufficient summary.
- These are descriptive observations only. Phase C does not select an acceptable minimum or define a threshold.

## Phase C Figure Contractt

- Core conclusion: sampling geometry materially changes fixed-test performance, with continuous gaps causing the clearest degradation.
- Figure archetype: quantitative grid.
- Target/output: reproducible Phase C validation report in PNG and editable-text PDF.
- Backend: Python/matplotlib exclusively for plotting, export, and preview.
- Final size: 13 x 9 inches, one page.
- Panel map: Accuracy; Macro-F1; native-248 prediction agreement; mean confidence shift.
- Hero evidence: aligned Accuracy and Macro-F1 curves with the native-248 reference.
- Validation evidence: prediction agreement and confidence shift against the same baseline.
- Controls/robustness: all five sampling patterns, five retained-epoch groups, fixed n=523, fixed model/split/seed.
- Statistics/source data: one fixed test split and checkpoint; no folds or confidence intervals; all panel values trace to phase_c_overall_metrics.csv.
- Image integrity: vector PDF plus 300-dpi PNG; no image manipulation.
- Reviewer risk: a single split cannot quantify between-seed variability, and no acceptance threshold may be inferred automatically.

## Phase C Delivery Boundary

- The product API remains preprocessing-only and exposes no inference route.
- The frozen checkpoint remains outside the product repository.
- Phase C outputs contain derived metrics/predictions and provenance hashes, not model weights.
- Phase D was not started.

## Phase D Requirements

- Phase D adds only POST /v1/infer and must stop before Phase E WebGIS online-recognition integration.
- The inference endpoint accepts only preprocessing output generated and validated by this service.
- The inference-only runtime must hash-check the private pasc-tcn-haikou-v1 model package and fail startup when an asset hash mismatches.
- Runtime inputs are the frozen M4 checkpoint, frozen Scaler, 1,036-row fixed-training spatial reference, formal spatial reliability/gate logic, and fixed probability calibration.
- Output must include raw and calibrated probabilities/labels, final confidence, calibration change, spatial reliability, gate mean, temporal/spatial applicability, quality, warnings, contractVersion, modelVersion, and provenance.
- External-city inputs must return spatial applicability limited_reference; user points must never become the model spatial reference.
- Golden regression must compare raw probabilities, raw label, calibrated probabilities, final label, confidence, spatial reliability, and gate mean.
- The Phase D runtime must contain no optimizer, backward, fit, fine-tuning, or training entry point.
- Phase E upload-to-map integration, D1/R2 jobs, queues, progress, cancellation, and large-data workflows remain out of scope.

## Phase D1 Inventory Findings

- The current online service is NumPy-only and dependency-free at runtime; /v1/models reports inferenceAvailable=false and phase B.
- Existing dispatch supports only /v1/models, /v1/validate, and /v1/preprocess with a 32 MiB body limit and no authorization header handling.
- Phase B preprocessing already returns a service-generated point artifact containing normalizedSeries, raw/scaled 13 features, coordinates, quality, applicability, warnings, and an audit record with modelExecuted=false.
- The Phase C evaluator already proves the authoritative inference sequence against the frozen checkpoint, but it imports model code and research assets directly from the sibling workspace and is not an online runtime.
- The model bundle contract must bind the checkpoint/model structure, classes, target/min steps, SG/Z-score constants, feature order/version, Scaler, coherence default, calibration, 1,036-row spatial reference, neighbor/radius/distance parameters, low-confidence threshold, and SHA-256 for every asset.
- WebGIS source code must not contain the checkpoint, private training reference, or model execution code. Phase D should therefore load a private external bundle at service runtime and keep private assets out of tracked delivery files.
- Exact frozen applicability values are temporal native_248/adapted_to_248/experimental_adapted_to_248/unsupported and spatial full_reference/limited_reference/not_evaluated.
- Security requirements include server-to-Python secret authentication, no arbitrary URL fetches, no full private-series/secret logging, and traceable asset/version audit.

## Phase D1 Runtime Direction

- No ready-made frozen model bundle exists in the formal workspace; the authoritative sources are the full-size checkpoint, formal dataset/split, full-area inference module, and training prototype model definition.
- Phase C uses sklearn NearestNeighbors with 9 queried nodes (self/extra accounting) and passes 8 neighbors, radius 500 m, and distance scale 180 m to the formal query function.
- Phase C inference sequence is frozen model eval -> encode 1,036 reference nodes -> query spatial neighbors/reliability -> infer_chunk gate fusion -> dynamic-class boost 1.35 -> renormalize.
- A Phase D private-bundle builder is needed to extract only inference assets. The checked-in service should contain an inference-only architecture/runtime with no training APIs, while checkpoint and private 1,036-row reference assets remain in a gitignored external/private bundle.
- Startup must verify the private bundle manifest and every file hash before constructing the runtime; /v1/models must fail closed/report unavailable until verification succeeds.

## Frozen Inference Mathematics

- The inference-only model needs only Chomp1d, TemporalBlock, TCNEncoder, and PhysicsTCN; baseline models and training loss/functions are excluded.
- PhysicsTCN uses the frozen temporal encoder, 32-wide physics encoder, 128-wide node projection, physics/classifier logits, learned physics_scale, and reliability-scaled spatial gate.
- Formal spatial weights combine Gaussian distance, squared temporal similarity, and square-root query/reference coherence; weights outside 500 m are zero.
- Formal reliability is 1 - exp(-raw_weight_sum / (8 * 0.35)); zero usable reference weight naturally identifies limited_reference without inventing a new numerical acceptance threshold.
- Query coordinates use the frozen reference latitude origin with x=longitude*111320*cos(latitude0) and y=latitude*110540.
- Formal low-confidence threshold is 0.60.
- The inference function uses torch.inference_mode, encodes reference nodes once, fuses neighbor context, applies softmax to raw logits, and returns spatial gate mean.

## Phase D Branch and Worktree State

- Phase A-C changes remain intentionally uncommitted in the shared worktree; they are the required baseline and must be preserved.
- Current branch at Phase D start is codex/pasc-phase-a and codex/pasc-phase-d does not yet exist.
- The v4 execution rule requires a Phase-specific branch, so Phase D will create codex/pasc-phase-d without discarding or resetting any existing changes.
## Phase D Frozen Runtime and API Findings
- The deterministic private bundle build hash is `bc10270dfb6b53adfa12473fda9e37bdad95d2ef44c3cf92bc346213ce733db3`; it contains eight hash-enforced runtime assets and is excluded from Git.
- The runtime loads only the frozen inference architecture, strict checkpoint state, frozen Scaler/calibration, and 1,036 training reference rows. It encodes reference nodes once and exposes no optimizer, backward, fit, or training entry point.
- Both the built-in HTTP server and ASGI lifespan perform fail-closed model verification when inference is configured or required.
- `/v1/infer` requires service authorization and an HMAC-signed, unmodified `/v1/preprocess` artifact. Arbitrary URLs and unsigned client-constructed arrays are not accepted.
- Native-248, adapted-40, and external-city outputs match an independently generated formal-runtime golden for raw/calibrated probabilities and labels, confidence, spatial reliability, and spatial gate mean within 5e-5.
- External-city spatial weights correctly collapse to zero and return `limited_reference`; no new spatial threshold was introduced.
- Synchronous inference is limited to 512 points and guarded by a bounded concurrency semaphore with a configurable queue timeout.
## Phase E Requirements and Initial Architecture
- Phase E is synchronous small-data WebGIS recognition only: upload → mapping → explicit unit/sign/smoothing confirmation → capability grading → compatibility → inference → map.
- Points with fewer than 40 valid epochs remain usable in ordinary WebGIS and must not be sent to PASC inference.
- Point detail must show the frozen six probabilities; the map uses fixed class colors and supports low-confidence and limited-spatial filters.
- Any API failure must preserve the currently loaded dataset and any existing classification results.
- Phase F job APIs, D1/R2 task persistence, Queue, chunking, progress, cancellation, retry orchestration, idempotent recovery, and large-data map delivery are explicitly out of scope.
- The browser must never receive the Python service key. A same-origin server route will call the configured Python service `/v1/preprocess` and then `/v1/infer`; the upstream base URL is deployment configuration, never request input.
- The Phase E UI should extend the established refined industrial/geospatial dashboard rather than redesign it. The distinctive interaction is a compact recognition flight-check panel that exposes every confirmation and applicability boundary before execution.
- The Phase D service already caps synchronous inference at 512 points; the WebGIS Phase E small-data surface will use a conservative 500-point dataset cap and report larger data as Phase F-required.
## Phase E1 Current WebGIS Integration Findings
- `MapWorkspace` already owns the full local CSV lifecycle: file read → `inspectCsv` → mapping dialog → explicit displacement/velocity unit, sign, and preprocessing-state confirmation → `parseMappedCsv` → `applyResult` → map state.
- The mapping dialog is therefore the correct upstream checkpoint; online recognition should become available only after `confirmMapping` has produced a valid `DatasetParseResult` and retained the original CSV text plus mapping.
- `DatasetParseResult.compatibility` already reports Level, native/experimental/unsupported counts and blocking confirmations. The existing `PascCompatibilityCheck` and `PascAnalysisPanel` are the natural Phase E status/detail surfaces.
- `InsarPoint` already carries `pasc`, fixed canonical mode, confidence, temporal/spatial applicability, velocity/coherence sources, and warnings. Phase E can merge inference output without changing the frozen point contract or recalibrating probabilities in TypeScript.
- `WebGisMap` already renders `mode` with frozen `colorForMode`, so updating point `mode`/`pasc` and switching the render attribute to `mode` is sufficient for online class-color display.
- Current filters cover velocity, coherence, and anomaly only. Phase E needs explicit low-confidence and limited-spatial selections, but does not need a new map renderer.
- Existing server routes use vinext route handlers and Cloudflare bindings. The Phase E proxy should remain binding-agnostic and use server environment variables/fetch; it must not write D1/R2 or create jobs.
- `applyResult` replaces the dataset only after successful parsing. Online recognition must instead update the existing points only after a successful complete response; error handling must never call `setPoints` or clear selection/results.
## Phase E1 Canonical Request and Merge Decision
- The WebGIS mapping sign values map to model-native values as follows: `toward_satellite_positive` already represents subsidence-negative/model-native; `away_from_satellite_positive` must be multiplied by -1. Phase E will make `parseMappedCsv` apply this sign consistently to both series and velocity.
- Sending raw CSV directly creates an ID mismatch when no point-id column exists (WebGIS uses one-based generated IDs while the Python service uses zero-based row indices), and can reintroduce invalid rows already excluded by the map parser.
- Phase E will therefore send canonical per-point records built from the successfully parsed `InsarPoint` collection: explicit point IDs, WGS84 coordinates, model-native mm/mm-year values, real per-point dates, optional velocity/coherence, and the user-confirmed raw/already-smoothed state.
- The server proxy converts those canonical points into the existing Python records/mapping contract, then calls preprocess and infer. Python still performs authoritative date/effective-epoch validation, Adapter/SG, features, frozen Scaler, signing, and inference.
- Only Level-3 points (40+ effective epochs) are included in inference. Unsupported points remain untouched in the current map dataset.
- Successful merge uses response pointId as the stable key and updates `pasc`, canonical mode, confidence, applicability, sources, and warnings. The browser never recalibrates or reselects the label.
## Phase E2/E3 WebGIS insertion points
- MapWorkspace owns parsed points, confirmed mapping, compatibility summary, selection, result filters, and the existing PASC tab; the Phase E control belongs at the top of that tab.
- Existing active filters are a closed union (none, velocity, coherence, anomaly) mirrored into AnalysisContext, so Phase E low-confidence and limited-reference filters must extend both unions and descriptions.
- applyResult is the correct reset boundary for an online run state; the online failure path must avoid calling it or any point-clearing setter.
- The existing point PASC panel already renders all six probabilities and provenance, while the map mode renderer already uses frozen class colors.
- Phase A-only/offline copy remains in PASC panels and must be updated to Phase E wording without weakening the 39/40/248 boundary.
## Phase E state-model constraints
- MapWorkspace uses one compact state declaration and mirrors filter descriptions into both regional AI input and AnalysisContext; both description records need the two PASC keys to keep TypeScript exhaustiveness.
- AnalysisContext SelectedRegion already supports source filter, so no new persisted source kind is needed for Phase E result subsets.
- The PASC tab composes compatibility, point analysis, region statistics, and the fixed legend; inserting the online flight-check first preserves the existing drill-down flow.
## Phase E UI contract details
- Compatibility issues distinguish error, confirmation, and warning; online recognition blocks on error/confirmation but a warning for sub-40 points only excludes those points.
- Existing point analysis already renders the six class bars, calibrated confidence, applicability, input sources, and warnings; Phase E needs only copy updates and selection synchronization after merge.
- Package scripts support a dedicated strict Phase E lint target in addition to the cumulative build/test command.
## Phase E proxy/UI response boundary
- The same-origin route returns the validated inference response directly with no-store headers; client merge can consume the response body without an extra envelope.
- Authentication, body limits, configured upstream URL, and server-only API key are enforced before proxy execution; UI errors should surface the structured message and preserve all current point state.
## Phase E regression and documentation targets
- The existing SSR regression helper can render an arbitrary route; adding a /map assertion covers the new flight-check labels and failure-retention promise without requiring a browser automation stack.
- Root README still describes Phase E as not started and needs a Phase E section covering the 500-point synchronous cap, signed-in same-origin proxy, server-only environment variables, 39/40/248 behavior, and explicit Phase F exclusion.
## Phase E final service and boundary auditt
- The existing Python regression entry is standard-library unittest discovery and Phase D tests provision the private bundle/API key internally.
- Phase E production additions contain no job, queue, chunk, cancellation, D1, R2, or /v1/jobs implementation; the only new server surface is synchronous /api/pasc/infer.
## Phase E completion
- The synchronous 500-point WebGIS path is complete and verified end to end at the product boundary.
- All final audits pass: server-only secret configuration, configured-only upstream, failure retention, frozen output validation, 39/40/248 behavior, and absence of Phase F job/queue/storage surfaces.
- Delivery stops before Phase F.
## Phase F requirements and initial architecture
- Phase F must add D1 jobs/events/artifact metadata, owner-scoped R2 objects, Queue or equivalent dispatch, a Python consumer, chunking, progress, cancellation, retry, idempotency, recovery, and result write-back.
- The required public job surface is POST /v1/jobs, GET /v1/jobs/{jobId}, GET /summary, GET /artifacts, and POST /cancel; the WebGIS may expose same-origin counterparts while the Python service remains the frozen executor.
- Large-data maps must use aggregation, GeoParquet, PMTiles/vector tiles, viewport loading, or multilevel decimation and must never load all points at once.
- D1/R2 must be owner-isolated; job IDs cannot cross owners; downloads require authenticated Worker access; logs cannot contain full private series or secrets.
- The existing Sites configuration already declares logical DB and DATASETS bindings. A durable D1 lease/claim queue is the least invasive Queue-equivalent supported by this existing checkout.
- Phase G external-region generalization is explicitly out of scope.
## Phase F platform constraints confirmed
- Sites capability guidance requires D1 for structured durable job state and R2 for source/result bytes; each logical binding is already declared in .openai/hosting.json.
- D1 batch executes prepared statements transactionally and rolls back the batch on failure; Phase F can use owner-scoped prepared queries plus optimistic status/lease predicates.
- R2 Worker bindings accept streams for put/get, so source downloads and result uploads can avoid buffering large objects in the Worker.
- Cloudflare Queues supports external HTTP pull consumers, but this Sites checkout has no logical queue binding surface. The v4-approved equivalent is a D1 lease/claim protocol with the same pull, acknowledge/retry, visibility-timeout, and recovery semantics.
- Security remains server-side: SIWC authentication for user routes and a separate configured consumer bearer key for internal routes.
## Phase F current implementation inventory
- Existing multipart upload streams 32 MiB parts directly to R2 and records owner-scoped upload sessions/datasets in D1; Phase F can reuse dataset source_key rather than re-uploading large CSV through a job request.
- Dataset mapping and quality metadata are stored in datasets.schema_json, and every user dataset/source route already predicates on owner_id.
- Existing source downloads stream R2 bodies with private no-store headers, providing the model for consumer-only source and artifact streaming.
- The runtime imports DB and DATASETS from cloudflare:workers; no existing integration-test D1/R2 mock exists, so Phase F core logic should isolate deterministic state-machine/contract helpers and use build plus static SQL/API audits around route bindings.
- The existing upload architecture already recommends background streaming, GeoParquet/tiles, and never loading all rows. Phase F will implement the permitted multilevel-decimation option without introducing a new map engine.
## Phase F frozen-runtime reuse
- The Worker Env currently exposes ASSETS, DB, and DATASETS; Phase F needs no new public binding when using D1 leases.
- Python exposes sealed preprocess_payload and verified infer_payload functions. The consumer can call these exact frozen public boundaries per chunk, preserving the signed preprocessing integrity check and the 512-point inference ceiling.
- Each chunk response already contains calibrated probabilities, final label, confidence, spatial reliability/gate, applicability, quality, sources, warnings, model package hashes, and audit; the consumer must aggregate summaries but must not recalculate probabilities.
- Direct consumer reuse avoids routing large matrices back through the WebGIS Worker and does not add optimizer, fit, training, or arbitrary URL inputs.
## Phase F migration and test integration
- Drizzle generated one initial six-table migration containing datasets/upload sessions plus the four Phase F tables and all requested owner/status/artifact indexes.
- The current JavaScript test builder has a single entry; it must be extended to compile a separate Phase F pure contract/state-machine test without importing cloudflare:workers route code into Node.
- The Python package has no added runtime dependency requirement; the consumer can remain standard-library HTTP/CSV/gzip plus the existing NumPy/Torch inference extras.
## Phase F completion findings
- The existing Sites D1/R2 bindings are sufficient when D1 leases provide queue-equivalent pull, visibility timeout, retry, and stale-worker recovery semantics.
- Owner predicates are present on public job/detail/event/artifact/map/cancel paths; internal paths require a separate constant-time compared consumer bearer key and a valid per-job lease token.
- Job public views omit lease tokens, worker IDs, idempotency keys, request mappings, source keys, and full private series.
- The Python consumer never accepts a user-controlled source URL. It uses one configured WebGIS origin and rejects any returned path outside same-origin `/v1/internal/jobs/`.
- R2 keys are owner/job/attempt/kind/chunk scoped; retries do not overwrite prior attempts, while repeated writes within an attempt upsert the same D1 artifact identity.
- The existing Leaflet mode map can safely show Phase F output by converting only validated multilevel result samples; 500/2,000/5,000 point levels are selected by zoom and the full large dataset is never returned.
- Phase F required no changes to checkpoint math, Adapter, SG, frozen features, Scaler, calibration, spatial reference, optimizer, training, or support thresholds.
- Phase G external-region generalization remains unstarted.
- The configured PyCharm `tsl` SDK resolves to `D:/Anaconda/env/tsl/python.exe`; its CUDA-enabled Torch runtime passes the complete 45/45 Python regression, so no dependency installation or test waiver is required.
## Phase G requirements and frozen boundary
- The v4 scope is external-region generalization evaluation, not automatic retraining or a claim of arbitrary-city accuracy.
- Phase G must independently examine temporal/physical behavior, training-reference spatial reliability/gate behavior, orbit, units, sign convention, and sampling differences.
- External-region product language must say “exploratory recognition result,” explain that the data are outside the primary validation region, and recommend human interpretation.
- Existing inference already degrades distant training-reference evidence through lower spatial reliability/gate and returns `limited_reference`; the product must make this evidence visible.
- Self-neighborhood is allowed only as an isolated experiment and must not automatically enter production inference.
- Any need to change model definition, training parameters, physical features, spatial mechanism, calibration, reference set, or thresholds is a stop condition requiring user approval.
## Phase G evidence inventory

- The Phase D golden fixture already provides a controlled external-coordinate case: identical `fid=553266`, time series, velocity, and coherence, with coordinates moved from Haikou to Shanghai. This isolates the spatial branch while holding temporal and physical inputs constant.
- The current expected external result is `rawLabel=5`, `finalLabel=5`, `confidence≈0.56735`, `spatialReliability=0`, `spatialGateMean=0`, and `spatialApplicability=limited_reference`.
- Production inference uses a fixed private `spatial_reference.npz` with 1,036 reference rows; default spatial settings are 8 neighbors, 500 m radius, and 180 m distance scale.
- Existing Phase D tests already protect the core out-of-reference behavior. Phase G should extend this into reproducible evidence artifacts and product wording without changing model math.
## Phase G implementation implications

- The frozen runtime computes the temporal/physical node first, then applies spatial context through a reliability-scaled gate. When the reference radius yields no weight, reliability and gate become zero, so the prediction is produced by the unchanged temporal/physical path. This is directly auditable without exposing or changing hidden model interfaces.
- The current WebGIS analysis panel exposes raw applicability codes and numeric spatial metrics, but it does not yet show the mandatory external-region wording or explain that temporal/physical evidence dominates when the spatial gate is suppressed.
- The existing TypeScript test bundle has Phase Core and Phase F entries only. Phase G needs a new pure applicability helper, UI integration, a focused test entry, and build/package script registration.
- Phase G will treat the existing coordinate-shift fixture as controlled robustness evidence, not as an external labeled accuracy dataset. Accuracy claims remain explicitly unsupported.
## Phase G evaluation design decisions

- Unit and sign robustness can be evaluated as semantic-equivalence tests: convert the same native inputs from mm/mm-year/model-native into cm/cm-year and into sign-inverted `subsidence_positive`; preprocessing should recover the same normalized series and physical features within float tolerance.
- Orbit-direction robustness cannot be numerically evaluated because orbit direction is not part of the frozen service contract. Phase G must report this as`not_evaluable_from_current_contract`, not fabricate a conclusion.
- Sampling robustness will use the frozen temporal adapter on deterministic subsets of the existing 248-node fixture (40, 80, and 160 nodes) and report prediction/probability deltas relative to native 248. These are controlled perturbations without external labels.
- Self-neighborhood will remain a diagnostics-only experiment: compute support statistics from the external batch itself, never feed those neighbors into the frozen model, and mark `predictionApplied=false`, `productionEligible=false`, and `accuracyEvaluated=false`.
- Product applicability states remain the existing contract values `full_reference`, `limited_reference`, and`not_evaluated`; `limited_reference` maps to the mandatory exploratory wording and a temporal/physical-dominant explanation.
## Phase G implemented evidence behavior

- The controlled evaluator now covers native 248, existing Shanghai golden control, a three-point Shanghai-translated batch, cm unit equivalence, inverted-sign equivalence, and deterministic 40/80/160-node sampling.
- Runtime evaluation confirms every shifted external-batch point has `limited_reference`, zero spatial reliability, and zero spatial gate while its temporal/physical preprocessing artifacts remain exactly invariant to the coordinate shift.
- Orbit sensitivity is explicitly reported as not numerically evaluable because the frozen contract has no orbit/LOS geometry field.
- Self-neighborhood produces only offline candidate-support diagnostics and carries three hard safeguards: `predictionApplied=false`, `productionEligible=false`, and `accuracyEvaluated=false`.
- Focused verification passed: 7 Phase G Python tests and 2 Phase G TypeScript tests.
## Phase G generated evidence values

- External coordinate controls preserve temporal/physical preprocessing exactly (`normalizedSeries`, raw physical features, and scaled physical features all max diff 0) while the fixed-reference spatial branch is fully suppressed.
- Unit equivalence produced only float-level drift (normalized series `3.58e-7`, raw physical features `7.63e-6`, scaled physical features `8.34e-7`); sign equivalence was exact.
- Deterministic sampling retained the native class for all three fixture points at 160/80/40 nodes, but the maximum probability delta grew from `0.00239` to `0.03125` to `0.47099`. Therefore 40-node output remains explicitly experimental even when the winning class happens to agree.
- The existing three native fixture points are about 8.86 km apart after translation, so their batch self-neighborhood has no support inside the 500 m experimental radius. A separate explicitly synthetic dense-coordinate diagnostic is needed if Phase G is to measure the candidate mechanism rather than only its sparse-batch rejection.
## Phase G dense self-neighborhood diagnostic

- The transparent synthetic three-point external cluster uses 80 m nominal longitude spacing and is marked `syntheticCoordinates=true`.
- It yields candidate mean reliability `0.26757`, maximum candidate reliability `0.29608`, and support for all three points, demonstrating that batch-internal support could exist.
- The experiment still has `predictionApplied=false`, `productionEligible=false`, and `accuracyEvaluated=false`; no synthetic coordinate or candidate reliability enters frozen inference.
## Phase G frozen and security auditt

- The current contract, preprocessing implementation, model architecture, inference runtime, and physics scaler hashes exactly match their authoritative Phase D/Phase B manifests.
- Phase G evaluator/runner source contains no optimizer, backward, fit, or train entry points.
- Generated JSON/report/CSV persist no workspace path, private bundle path, service secret, private key, series matrix, checkpoint, or spatial reference asset.
- The runner source legitimately names the deployment-local default `.private-model-bundles` directory so an operator can execute the evaluator; this path is not emitted into artifacts and is not model material.
- Phase G handoff documentation now explains the evaluator, exact limited-reference wording, path-free artifacts, non-accuracy boundary, and Self-neighborhood isolation in both repository and service READMEs.

## Release preparation inventory baseline

- `codex/pasc-phase-g` and all earlier phase branches still point to `b6c0969`; the complete A-G implementation exists as one uncommitted working tree on top of `origin/main`.
- Because many WebGIS and service files contain cumulative cross-phase edits, reconstructing historical phase-by-phase commits now would require risky hunk archaeology. Commit organization should be component- or release-oriented unless the file audit proves a safer boundary.
- The release task must preserve the user's pre-existing repository history and avoid rewriting or discarding the cumulative worktree.
## Release file inventory

- The candidate contains 107 untracked, non-ignored files totaling about 8.99 MB plus 19 tracked modifications.
- The largest intended additions are the 5.45 MB static Showcase demo, 1.84 MB Phase C prediction evidence, and Phase C PNG/PDF artifacts. No individual candidate file exceeds normal Git hosting limits.
- Build outputs, dependency trees, caches, local deployment state, and the private model bundle are already ignored. They must remain unstaged.
- The first combined sensitive-pattern command failed at PowerShell parse time because a regex quantifier was interpreted outside the intended quoting context; the audit will be rerun with wrapper-safe fixed patterns.
## Release boundary decision

- Secret scanning found no private-key headers, cloud access keys, GitHub tokens, or OpenAI-style secret literals. Key-name matches are environment lookups, documentation placeholders, or test-only constants.
- The private PASC model bundle is confirmed ignored by the exact `.gitignore` rule; build outputs, caches, and local runtime state are also excluded from the candidate.
- `public/data/haikou-insar.csv` is an intentional semantic replacement, not line-ending churn: 4,073 legacy rows/214 columns become the validated 3,094-point formal PASC spatial dataset with 273 columns. The already-passing legacy and demo regressions cover this transition.
- Both existing lockfiles are unchanged. The candidate adds 107 source/evidence files and modifies 19 tracked files; whitespace validation passes.
- A single atomic release commit is safer than synthetic phase-by-phase commits because A-G changes overlap in shared WebGIS, schema, documentation, test, and service files, and every phase branch still points to the same pre-integration commit. The commit will describe the complete v4 PASC-TCN product integration through Phase G.
## Release hygiene findings

- Root app version remains `0.1.0` and service/runtime version remains `0.3.0`; no API/model-version bump is required for a source release commit because Phase G adds offline evidence/UI wording without changing the frozen inference contract.
- Hosting requires D1 binding `DB` and R2 binding `DATASETS`; runtime also needs the documented server/consumer keys and a private hash-verified model bundle.
- Migration hygiene needs correction before release: tracked `0001_dataset_storage.sql` already creates `datasets` and `upload_sessions`, while newly generated `0000_parched_random.sql` recreates those tables and the Drizzle journal now lists only `0000`. Applying that generated baseline to an environment that already ran `0001` can fail. The release needs an additive upgrade migration for the PASC tables/indexes instead of a competing baseline.
- `progress.md` contains two literal backtick-newline artifacts from earlier PowerShell writes; task/findings/progress otherwise have no NUL or replacement characters. Clean these before staging.
- Candidate documents and evidence contain no absolute workspace path. The Phase G manifest currently differs only for the three planning files changed by this release session and must be refreshed at the final immutable candidate point.
- Migration filename coupling exists in tests/pasc-phase-f.test.ts, root README, Phase F report, and the Drizzle journal. The static Phase F test must point at the new additive migration and continue asserting all four PASC tables plus indexes/auth boundaries.

- Release metadata keeps app 0.1.0, service 0.3.0, model pasc-tcn-haikou-v1, and contract pasc-contract-v1; no compatibility-changing version bump is needed. RELEASE_NOTES_PASC_V4.md is now the authoritative deployment, migration, verification, limitations, and rollback handoff.

## Release hygiene completion

- The additive `0002_pasc_jobs.sql` preserves existing dataset rows, creates all required PASC tables/indexes, and can be applied twice without error. The conflicting generated baseline and snapshot were removed; the manual migration journal is restored.
- Focused Phase F tests pass 7/7 and strict Phase F/G lint passes with zero warnings after migration hardening.
- Dry-run staging contains 126 entries and no environment file, private model bundle, checkpoint, spatial reference, build output, PEM material, or symlink.
- The only obsolete-migration scan hit was the intentional release-note warning that tells operators not to use the discarded generated baseline. It is documentation, not a candidate file reference.
- Final Phase F, Phase G, and release SHA-256 manifests will be generated only after the planning records stop changing, immediately before the commit.

## Staged normalization recovery

- Searching all 435 Git blobs found exact pre-normalization mappings for 38 candidate text files.
- Only `pasc-tcn-service/src/pasc_tcn_service/schema.py` had a semantic character loss: the faulty regex removed the final `t` from `.report`. The exact staged blob `7dd017b5...` was restored byte-for-byte, then normalized with safe per-line whitespace trimming.
- The other mapped files differed only in trailing whitespace/EOF formatting. Planning files require a separate comparison because release error logging changed them after staging.
## Release recovery verification

- The restored Phase F schema entry point is semantically intact: `inspect_payload(payload).report` is present at line 450.
- NUL-byte matches are confined to expected binary PDF/PNG release artifacts; no text source/configuration file was flagged.
- The working tree still contains recovered, unstaged versions of `schema.py`, `task_plan.md`, `findings.md`, and `progress.md`; the candidate must be restaged before verification.
## Final staged Python verification

- Recovered Schema/API surface passed 16/16 focused tests in the installed Torch environment.
- The complete service regression passed 52/52 tests, including all four Phase D inference tests that were previously unavailable without Torch.
- This confirms the recovered `schema.py` is semantically sound and the earlier `report` truncation is resolved.
## Final staged WebGIS verification

- Production build, 26/26 Node tests, and both generated demo dataset validations passed.
- Repository-wide lint completed with 0 errors and 66 known legacy warnings.
- Phase F and Phase G strict lint targets passed with `--max-warnings 0`.
## Final migration verification

- In-memory SQLite upgrade audit passed for `0001_dataset_storage.sql` followed by `0002_pasc_jobs.sql`.
- Reapplying `0002` is idempotent, all six required tables and eight Phase F indexes exist, and a pre-upgrade dataset row is preserved unchanged.
## Final release candidate decision

- Branch is `codex/pasc-phase-g` on baseline `b6c0969`; no prior history will be rewritten.
- The reviewed candidate contains 125 files before the release manifest, with 55,152 insertions and 4,179 deletions.
- Final private-path and high-confidence secret-literal scans passed.
- Because Phase A-G changes overlap shared application, service, data, test, and planning files, the safe commit structure is one atomic commit: `feat: integrate PASC-TCN workflow through phase G`.
## Final manifest and pre-commit audit

- Phase F manifest verifies 36 files; the obsolete generated `0000`/snapshot entries are gone and additive `0002_pasc_jobs.sql` is recorded.
- Phase G manifest verifies 18 files; the full release manifest verifies 125 release files and intentionally excludes itself.
- `git diff --cached --check`, text NUL scan, untracked-file scan, and unstaged-delta scan passed before commit.
## Release commit organization completed

- The approved Phase A-G candidate was created as one atomic commit on `codex/pasc-phase-g` with message `feat: integrate PASC-TCN workflow through phase G`.
- Planning closure and manifest hashes are folded into that same commit by amending only the newly created release commit; prior repository history remains untouched.
- No push, tag, deployment, or remote mutation is part of this release-preparation task.
## Publication boundary confirmed

- The source research repository stranger62698/pasc-tcn is private and contains paper-only baselines, training/reproduction scripts, large research outputs, and PASC-TCN research materials.
- The user confirmed the public product should retain only the production PASC-TCN/WebGIS path; baseline models are not product dependencies.
- Public deployment therefore uses the already validated A-G runtime integration and excludes training/reproduction scripts, large research data, private weights, and secrets.
- End users can browse the WebGIS and bounded demonstrations without research assets. Live prediction additionally requires a separately deployed private Python/Torch service and model bundle.
## Public production candidate audit

- No tracked path contains the second repository's baseline, BiLSTM, Transformer, paper workflow, training, or reproducible-experiment entry points.
- No tracked file is 10 MB or larger. The bounded Phase C/G evidence and demonstration data remain product QA assets, not the source repository's large research datasets.
- Private model bundles, checkpoints, environment files, build outputs, and Vercel local project state are not tracked. The sole broad private-path regex match was build/sites-vite-plugin.ts, which is ordinary source code rather than a generated build directory.
- Repository metadata still used the starter package name; it was changed to pasc-tcn-gis and the README now states the public/private boundary.
## Deployment-metadata verification

- The package and npm lock metadata consistently use pasc-tcn-gis; no starter package name remains.
- Production vinext build, 26 WebGIS/Phase A-G tests, and both bounded demo validations passed after the metadata update.
- No runtime source changed in this step.
## GitHub publication attempt

- The public repository stranger62698/PASC-TCN-GIS was created successfully.
- The first HTTPS push was interrupted by a connection reset before the main branch could be verified.
- The local remote is retained; the safe retry is a per-command HTTP/1.1 push without changing credentials or repository visibility.
## GitHub transport diagnosis

- GitHub SSH endpoints on ports 22 and 443 are reachable, but the account has no usable local SSH key; no credential changes will be made.
- GitHub REST API remains authenticated and healthy, and the new public repository is still empty.
- A separate system Git installation is available. Testing it is the last history-preserving transport alternative before reporting a network blocker.
## GitHub smart-HTTP blocker

- Bundled Git default HTTPS, bundled Git forced HTTP/1.1, and the independent system Git all failed to reach the GitHub smart-HTTP endpoint.
- Repeating another Git push would violate the three-attempt rule and is unlikely to change the outcome.
- The authenticated GitHub REST API is available, so a current-tree snapshot can still be published, but that would not preserve the existing WebGIS commit history and therefore requires explicit user approval.
## Snapshot publication authorization

- The user explicitly approved publishing the complete current production tree through the authenticated GitHub REST API.
- The resulting public repository begins with a new root commit and does not preserve the original WebGIS commit history.
- The source file boundary remains unchanged: production PASC-TCN/WebGIS code and bounded QA data only; no baselines, training/reproduction research scripts, large research datasets, weights, or secrets.
## Empty-repository API initialization

- GitHub returned HTTP 409 when creating the first Git blob because the new repository had no branch or initial commit.
- No production file was published by that failed call.
- The compatible sequence is a minimal Contents API bootstrap on main, followed by a complete Git tree commit whose tree omits the bootstrap file.
## Snapshot tree assembly fallback

- All 195 tracked file blobs were accepted by GitHub before local tree JSON assembly failed.
- GitHub blob identifiers are standard Git content SHA-1 values, so the uploaded objects can be reused without retransmitting unchanged files.
- The retry uses plain arrays and local git hash-object values, then uploads only the planning/manifests changed by this error record.
## GitHub snapshot publication verified

- Public repository stranger62698/PASC-TCN-GIS now has main as its default branch and contains a non-truncated 195-file production tree.
- The temporary bootstrap file is absent from the final tree.
- Remote path audit found no private model bundle, checkpoint, environment file, baseline model, paper-only reproducible experiment, node_modules, dist, or .next output.
- Remote package metadata identifies pasc-tcn-gis and the README identifies PASC-TCN-GIS.
## Vercel authentication

- Vercel device authorization completed for account fengyaowu78-2739 in scope fyw.
- Existing projects do not include pasc-tcn-gis, so a new project can be created without renaming or mutating the prior lanjifyw-insar-webgis deployment.
- The project-local .vercel state remains Git-ignored.
## Vercel production deployment

- New Vercel project fyw/pasc-tcn-gis was created and linked locally; its Git source is explicitly connected to stranger62698/PASC-TCN-GIS rather than the prior origin remote.
- Production deployment dpl_D1gaf8Af6jyzpHvHGsz2yR9MM4q9 completed with status Ready and stable alias https://pasc-tcn-gis.vercel.app.
- The configured static build succeeded on Vercel. Root, /map, /showcase, and the bounded showcase manifest all returned HTTP 200.
- The project-local .vercel metadata and generated .env.local remain ignored and are not public source.
## Private inference boundary verified

- Production POST /api/pasc/infer returns HTTP 404 and the static output contains no PASC inference endpoint.
- This is the intended fail-closed state until a private Python/Torch service, API key, and hash-verified model bundle are configured.
- Generated .env.local and .vercel project metadata are matched by Git ignore rules and remain outside the public repository.
- README now records the public production URL, source URL, and private inference requirements.
## Authentication and inference operations task

- The user reports that production account registration/login is unavailable and asks how to implement the separately hosted private model service.
- Diagnosis must distinguish the static frontend, Vercel authentication functions, persistence resources, and the separate Python/Torch inference runtime.
- Browser testing will be used only for the visible login flow; Vercel/GitHub CLI and local source inspection remain the primary semantic surfaces.
## Reported authentication symptom

- The attached registration page accepts username, email, and password input but displays the message 认证服务暂时不可用，请稍后重试.
- This wording indicates the client reached its authentication error fallback; it does not by itself prove invalid user credentials.
- Direct local reopening of the clipboard image was blocked by the sandbox ACL, but the attached image is already visible in the conversation and contains no additional diagnostic instructions.
## Authentication dependency audit

- The production Vercel project currently has zero configured environment variables.
- server/auth.ts requires AUTH_SECRET with at least 32 characters to sign and validate session cookies.
- User registration and login persistence call @vercel/blob private get/put operations under auth/users, which require a Blob store and its server-side token.
- api/auth.ts intentionally converts unexpected storage/secret errors into the screenshot message 认证服务暂时不可用，请稍后重试.
- Therefore the visible failure is consistent with deployment configuration being incomplete, not with an invalid email or password. Exact runtime confirmation remains pending a controlled live request and log inspection.
## Authentication root cause confirmed

- A controlled non-mutating login probe returned HTTP 500 with the same public fallback message as the screenshot.
- Vercel runtime logs identify the exact cause: Vercel Blob found no credentials. No BLOB_READ_WRITE_TOKEN, VERCEL_OIDC_TOKEN plus store ID, or linked Blob store is available to the production function.
- The project also lacks AUTH_SECRET, which would become the next failure when registration reaches session-token creation.
- Current Vercel CLI supports create-store, list-stores, and token/store-ID options. The minimal repair is one project-linked private Blob store plus a generated 32+ byte AUTH_SECRET for production/preview/development, followed by redeployment.
- Blob-store creation is a persistent external resource and may have plan/usage cost implications, so current official billing terms must be checked before mutation.

## 2026-08-24 Auth deployment findings
- Production auth failure is caused by missing Vercel Blob credentials; both registration and login fail in server/auth.ts while reading/writing auth/users/<sha256(email)>.json.
- The Vercel project currently has no environment variables. After Blob is connected, AUTH_SECRET (minimum 32 characters) is also required to issue signed session cookies.
- Official Vercel documentation says a project-created Blob store automatically adds BLOB_READ_WRITE_TOKEN; a private store can be created with vercel blob create-store <name> --access private.
- Blob is available on all plans. Hobby includes limited free storage/operations/transfer and pauses Blob access after included limits are exceeded rather than charging overage.
- Read-only local Vercel CLI inspection was blocked first by workspace ACL initialization, then the escalated shell did not inherit the CLI executable path. No Vercel resource was created or changed.

## 2026-08-24 Private inference initial inventory
- The WebGIS already contains a same-origin Phase E proxy implementation in app/api/pasc/infer/route.ts; it reads server-only PASC_SERVICE_BASE_URL and PASC_SERVICE_API_KEY, calls /v1/preprocess then authenticated /v1/infer, and enforces point/body/time limits.
- The deployed Vercel project uses framework: null and outputDirectory: static-dist. The Next-style app/api/pasc/infer/route.ts is therefore not part of the current static deployment; a root Vercel Function bridge or a non-static framework deployment is required.
- The proxy intentionally keeps the service URL/key out of browser code and requires an API key of at least 32 characters.

- No root .private-model-bundles exists. pasc-tcn-service/.private-model-bundles exists but the targeted file listing returned no files, so the frozen private bundle is not currently present in this checkout.
- No Dockerfile, compose file, or .dockerignore exists; container deployment packaging still needs to be added.
- A project-local Vercel CLI exists at node_modules/.bin/vercel.cmd; earlier CLI failures were PATH-related, not a missing dependency.

## 2026-08-24 Authorized remediation and automatic-classification gap
- The user explicitly authorized repairing authentication and deploying the private model service.
- The attached production screenshot shows a valid 3,000-point/248-epoch CSV reaches Level 3 compatibility, but the UI stops at manual preprocessing confirmation and says Phase F will not submit automatically.
- The intended product behavior is: upload a compliant CSV, complete only unavoidable schema/unit/sign/preprocessing confirmations, then automatically run PASC-TCN classification and render classified map results.
- The private bundle is present under `pasc-tcn-service/.private-model-bundles`; it is Git-ignored and must remain outside the public repository.
- A project-local Vercel CLI is installed in `node_modules/.bin`; it needs the bundled Node runtime added to PATH before use.
## 2026-08-24 Service and UI implementation evidence
- The complete frozen bundle is available locally and ignored from Git: checkpoint (3,336,863 bytes), spatial reference (986,943 bytes), manifest, SHA256SUMS, model config, class catalog, scaler, calibration, and reference split.
- `pasc-tcn-service` is a Python >=3.10 package with NumPy and optional Torch; its console entry points are `pasc-tcn-service` and `pasc-tcn-consumer`.
- The service already exposes `/health`, `/v1/preprocess`, and authenticated `/v1/infer`, supports `PASC_DEVICE`, verifies bundle hashes, and enforces concurrency/queue limits.
- The product gap is confirmed in code: `PascOnlineRecognition` marks every dataset above 500 points blocked, prints “本阶段不会自动提交”, and only invokes inference from a manual button.
- A 3,000-point compliant CSV therefore cannot currently reach either synchronous inference or an automatically-created Phase F job from the map workflow, even though Phase F job APIs/components exist elsewhere.
## 2026-08-24 Hosting decision evidence
- Current Vercel Python Functions support Python 3.12-3.14, `pyproject.toml`/requirements dependencies, `BaseHTTPRequestHandler` entry points, and a 500 MB standard uncompressed bundle.
- New Vercel projects created after 2026-06-30 are automatically eligible for Large Functions on Fluid Compute, up to 5 GB, which makes the Torch dependency feasible without altering the frozen model.
- Hobby functions are limited to 60 seconds per invocation. Therefore the private service should keep each inference request bounded to the existing <=512-point contract; a 3,000-point browser workflow can safely sequence six <=500-point requests rather than send one oversized request.
- The existing Python `Handler` implementation already matches Vercel’s recognized `BaseHTTPRequestHandler` pattern, so a thin Vercel adapter can reuse the validated `dispatch` code.
- A separate Vercel project is the smallest deployable choice with the already-authenticated account: no additional hosting login is required, weights remain absent from public GitHub, and the bearer-key boundary remains intact.- The frontend project link is intact: project `pasc-tcn-gis`, project ID `prj_nt99glFmW5J6IIkaWcXvyCymRQk2`, team ID `team_MLsPrFNjf2NRbGn4P1JhsGJh`.- Bundled Node is `C:/Users/Administrator/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node.exe`; it successfully runs the project-local Vercel CLI 59.1.4.
- The authenticated Vercel identity remains `fengyaowu78-2739` in scope `fyw`.- No Blob store is currently connected to `pasc-tcn-gis`.
- CLI 59.1.4 requires explicit `--access private`; `--yes` connects all environments by default, while repeated `--environment` can scope the connection.- Latest Ready production deployment before auth remediation: `pasc-tcn-80bt2agvj-fyw.vercel.app`.
- Vercel `redeploy` rebuilds an existing deployment artifact with current environment configuration, avoiding accidental inclusion of local ignored/private files.- Auth-remediation production deployment is Ready at the stable alias `https://pasc-tcn-gis.vercel.app`; functions run in `iad1`, matching the private Blob region.- Production authentication persistence is operational: the synthetic registered user was stored as a private 339-byte Blob object.
## 2026-08-24 Automatic classification implementation design
- CSV imports already require a single `验证并导入` action for field mapping and the scientifically necessary displacement-unit, sign, and preprocessing-state confirmations.
- The automatic trigger can safely start immediately from `confirmMapping` using the just-parsed points and confirmed mapping; no fragile state-watching effect is required.
- Existing per-request contracts remain unchanged at 500 frontend points / 512 service points. A new batching helper will split up to 10,000 eligible points into sequential <=500-point requests and merge only after every batch succeeds.
- Batch results must be staged off-map until the complete run passes, preserving the existing failure-retention guarantee. Service version/build hash must remain identical across all batches.
- The UI should show total/batch progress, allow retry after failure, and remove the misleading 500-point hard block for the reported 3,000-point case.
- The root Vercel proxy must authenticate with the existing signed session cookie and read only server-side `PASC_SERVICE_BASE_URL` and `PASC_SERVICE_API_KEY`.- Correct private-service secret name is `PASC_ARTIFACT_SIGNING_KEY` (not `PASC_PREPROCESSING_HMAC_KEY`); both it and `PASC_SERVICE_API_KEY` require at least 32 bytes.
- The service has a minimal ASGI `application` and a pure `dispatch`, but its `/health` endpoint is implemented by the standalone server wrapper rather than `api.dispatch`; the Vercel adapter must provide health explicitly or route `/v1/models` as the health check.
- `confirmMapping` has the freshly parsed points and confirmed mapping in scope, so it can call an argument-taking automatic runner immediately after import.
- `buildPascOnlineRequest` should retain its 500-point single-request invariant for existing tests/security. A separate exported batching helper will provide the larger automatic workflow.- Created private Vercel project `fyw/pasc-tcn-private-service` with project ID `prj_916YnUkTJai1x4OeuirSXfsYGIvr`; it is not connected to public GitHub.
- The official PyTorch CPU index provides a Python 3.12 x86_64 wheel for `torch 2.12.0+cpu`, closely matching the validated local 2.12 runtime without pulling CUDA libraries into the serverless bundle.- The working private deployment recipe must exclude the package `pyproject.toml` and use the pinned `requirements.txt`; the successful clean deployment contains 27 source files and a 264.45 MB Python function.- Vercel created a harmless service-local `.gitignore` containing only `.vercel` and `.env*`; keeping it documents and reinforces the private project-state boundary.- The deployed frontend now contains the nested root Vercel Function route `/api/pasc/infer`; remaining proxy issue is runtime initialization, not route absence.
## 2026-08-24 Frontend proxy ESM repair
- Vercel root functions execute transpiled local modules as Node ESM, so runtime-relative imports must retain .js extensions in emitted code.
- TypeScript bundler resolution correctly maps those .js specifiers back to the .ts sources; lint, PASC tests, and the application build all pass.
## 2026-08-24 Signed artifact production probe
- The frontend session, same-origin proxy, API-key authorization, request conversion, and private `/v1/preprocess` endpoint are all working in production.
- The remaining live inference blocker is isolated to cross-request preprocessing-artifact signature validation inside the private service.## 2026-08-24 Production inference completion
- Preserving the raw Python preprocess response text when embedding the signed artifact into `/v1/infer` prevents JavaScript float exponent reserialization from invalidating the HMAC.
- The repair is covered by a regression fixture whose `1e-07` spelling would change under JavaScript `JSON.stringify`.
- A real 248-epoch public Showcase row now completes the entire production chain: auth session → frontend proxy → private preprocess → signed artifact → frozen Torch inference → six-class response.
## 2026-08-25 ENVI CSV initial evidence
- The supplied `500.csv` is UTF-8 without BOM, 42,022 bytes, 127 data rows, and 63 columns.
- Its actual header contains 46 plain `YYYYMMDD` acquisition columns from `20180217` through `20230615`; it also has ENVI-style quality fields plus `xpos`, `ypos`, and `zpos`. The user reports other ENVI exports use `D_YYYYMMDD`, so both spellings must map to the same canonical date.
- The current PASC date test covers `DYYYYMMDD` and slash dates but not `D_YYYYMMDD`. The dataset upload component has several unguarded `response.json()` calls, consistent with the screenshot exposing a plain-text/HTML server response as `Unexpected token`.## 2026-08-25 Root cause and implementation boundary
- The production static Vercel app deploys the authenticated root function `/api/private-datasets`, which already supports list, chunk write/read, completion, patch, and delete using private Vercel Blob.
- `DatasetPage` still calls obsolete Cloudflare-only `/api/uploads/*` and `/api/datasets/*` routes. `MapWorkspace` also uses `/api/datasets` and `/api/datasets/:id/source`. Those paths are absent from the static Vercel deployment, explaining the plain `The page could...` response and unsafe `response.json()` error.
- The smallest correct production repair is client-side routing to `/api/private-datasets`: generate the dataset UUID in the browser, upload <=4 MiB chunks, complete with metadata, and reconstruct analysis-ready CSV bytes from authenticated chunk reads.
- Chunk text must be decoded only after byte concatenation, because decoding each arbitrary byte slice independently can corrupt UTF-8 characters at chunk boundaries.
- `parsePascDateHeader` accepts `YYYYMMDD`, `DYYYYMMDD`, and separated year-first dates, but not `D_YYYYMMDD`. Extending only its prefix grammar preserves all downstream canonical sorting, duplicate detection, real-date velocity, and PASC request conversion.

## 2026-08-25 Large-dataset classification report
- The screenshot shows 21,610 valid 46-epoch candidates, which are blocked by the browser-only 10,000-candidate safety cap before any classification result is committed.
- The desired production behavior is persistent server-side task processing: bounded model requests, visible progress, retry/resume, and final classified-map loading even if the browser closes.
- Client hardware must not be part of the execution contract; browser devices should only upload, monitor, and render sampled/results data.
- Existing Phase F code is not connected to the deployed stack: its `/v1/jobs` routes import `cloudflare:workers`, require D1/R2 bindings and ChatGPT/Sites identity, while production is a static Vercel frontend with root Vercel functions and Vercel Blob/session-cookie storage.
- `PascJobPanel` therefore describes a durable pipeline that is unavailable on the current production deployment; it cannot receive the 21,610-point dataset stored by `/api/private-datasets`.
- The frozen private model already enforces a safe <=512-point request. Large-data support should preserve that model boundary and add persistent orchestration above it rather than increasing one inference payload to tens of thousands of points.
- Current official Vercel limits show Fluid Compute Hobby functions run up to 300 seconds on 1 vCPU/2 GB; this is CPU server compute, not the visitor's GPU.
- Vercel Queues is in public beta on all plans and provides durable asynchronous delivery, push consumers, automatic retries, visibility leases and idempotency. It is a direct production replacement for the undeployed Cloudflare D1 lease queue.
- Hobby Cron is only daily and imprecise, so Cron cannot drive interactive 21,610-point classification. A Vercel Queue push consumer is the appropriate autonomous trigger.
- Queue messages should contain only owner/job/dataset/chunk identifiers. CSV series remain in private Blob; each consumer loads one bounded chunk, calls the existing private PASC proxy/service, writes an idempotent result artifact, updates job metadata, and enqueues the next chunk.
- Installed official `@vercel/queue` 0.5.0. Its `QueueClient.handleNodeCallback` directly supports the `(req, res)` signature used by root Vercel Functions, so no public consumer endpoint or ad-hoc callback authentication is needed.
- The existing `runPascOnlineProxy` already accepts a canonical <=500-point request and reads the private service URL/key only on the server. Queue workers can reuse it directly instead of round-tripping through the session-protected public proxy.
- Private dataset storage is `users/{userId}/datasets/{datasetId}/chunks/{index}` plus `users/{userId}/meta/{datasetId}.json`; job/result keys can stay under the same owner prefix and never expose another user's objects.
## 2026-08-25 O6 implementation findings
- Production implementation now uses Vercel Blob for owner-scoped job metadata, request batches, and result batches plus Vercel Queues for durable push delivery. Queue messages contain only owner/job/batch identifiers; CSV content, model package, and service key are never placed in the queue or browser.
- The supplied 21,610-candidate shape is deterministically split into 44 requests: 43 batches of 500 and a final batch of 110. The existing private inference service remains the only model executor and currently reports CPU.
- Each queue delivery processes at most one 500-point inference batch with a 300-second function boundary. Result blobs make retries idempotent; batch summaries are keyed by index so redelivery cannot double-count progress.
- Private CSV upload chunks are reconstructed as bytes and decoded once as UTF-8, preventing a multibyte character from being corrupted when it crosses a 4 MiB chunk boundary.
- The map now routes >10,000 candidates to the persistent task API instead of treating them as a terminal browser error. The data center polls progress and exposes cancel/retry; completed jobs load all result batches and merge them into the original full point map.
- Visitor GPU is not used. Any modern browser can upload, monitor, and render; classification speed depends on the server-side private service. A GPU host can accelerate future inference but is not required for correctness.
- Verification passed: 21,610/44-batch regression, Phase F 8/8, full suite 32/32, production static build, strict lint on all new modules, and Vercel production-equivalent build with the queue trigger present in the consumer function bundle.
- Final production topology is active: static WebGIS and authenticated task API on `pasc-tcn-gis`, durable queue consumer in `iad1`, private Blob state scoped under `users/{ownerId}`, and the frozen CPU inference service behind the server-only key.

## 2026-08-25 O7 temporal adapter audit
- The authoritative Python adapter uses parsed acquisition dates, converts them to elapsed-day offsets, and linearly interpolates every non-248 sequence onto 248 normalized nodes. A 210-epoch upload therefore already follows the same automatic 210-to-248 path.
- Exactly 248 epochs bypass temporal adaptation; 20-247 and >248 inputs are adapted. The experimental label denotes validation scope, not a missing interpolation step.
- Velocity and physical features use real elapsed years. The frozen TCN still consumes 248 index-space nodes learned mainly from Sentinel-like 12-day sequences, so materially different cadence/sensor/span remains a temporal domain shift.
- The current private bundle declares a minimum of 40 in its signed configuration and the service validates that exact value at startup. Lowering the boundary requires regenerating the private bundle metadata and hashes, but not changing checkpoint, scaler, calibration, or spatial references.
- Selected policy: accept >=20 effective epochs; keep every adapted 20-247 sequence explicitly experimental; add a stronger 20-39 evidence warning and a non-12-day cadence warning instead of claiming native equivalence.
- Audit command errors: a Windows `rg` glob for `PHASE_*_COMPLETION_REPORT.md` was invalid, and an exploratory search named a nonexistent `model_runtime.py`; neither affected the successful source audit.- Additional audit errors: a search referenced nonexistent repository-root `tools` and the bundle script was first read from the wrong path; the authoritative script is `pasc-tcn-service/tools/build_private_model_bundle.py`.
- The live Python task consumer has two distinct 40 literals: the epoch gate must become 20, while `chunk_size = max(40, ...)` is a batching floor and must remain unchanged.
- UI wording should state that non-native series are already interpolated by real acquisition dates to 248 nodes; “experimental” describes evidence/domain scope rather than whether adaptation ran.
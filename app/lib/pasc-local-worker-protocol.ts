import type { PascLocalSettings } from "./pasc-local-preprocess";

export const PASC_LOCAL_WORKER_URL = "/__pasc-local/worker/worker.js";

export type PascLocalTaskState =
  | "idle"
  | "loading_file"
  | "parsing"
  | "streaming"
  | "preprocessing"
  | "loading_model"
  | "predicting"
  | "finalizing"
  | "ready"
  | "error"
  | "cancelled";

export type PascLocalStartMessage = {
  type: "START";
  file: File;
  settings: PascLocalSettings;
  batchSize: 256 | 512 | 1024 | 2048;
  analysisScope?: "quick" | "full";
  quickPointLimit?: number;
  forceWasm?: boolean;
};

export type PascLocalCancelMessage = { type: "CANCEL" };
export type PascLocalWorkerRequest = PascLocalStartMessage | PascLocalCancelMessage;

export type PascLocalCompletePayload = {
  pointIds: string[];
  rawModeIndex: Uint8Array;
  modeIndex: Uint8Array;
  confidence: Float32Array;
  probabilities: Float32Array;
  classCounts: Uint32Array;
  longitude: Float32Array;
  latitude: Float32Array;
  velocity: Float32Array;
  velocityProvided: Uint8Array;
  coherence: Float32Array;
  coherenceProvided: Uint8Array;
  missingRate: Float32Array;
  displacementSeries: Int16Array | Int32Array;
  displacementScale: 0.1;
  displacementEncoding: "int16_tenth_mm" | "int32_tenth_mm";
  spatialReliability: Float32Array;
  spatialGateMean: Float32Array;
  spatialReferenceSource: Uint8Array;
  dates: string[];
  sourceEpochs: number;
  insertedEpochs: number;
  totalRows: number;
  invalidRows: number;
  timeSteps: number;
  elapsedMs: number;
  provider: "webgpu" | "wasm";
  batchSize: number;
  fileSizeBytes: number;
  csvParsingMs: number;
  preprocessingMs: number;
  modelLoadingMs: number;
  inferenceMs: number;
  averageBatchMs: number;
  batchCount: number;
  totalPredictedPoints?: number;
  mapSampled?: boolean;
  largeFileMode?: boolean;
  resultStorage?: {
    kind: "opfs";
    directory: string;
    fileName: string;
    byteLength: number;
  };
  analysisScope?: "quick" | "full";
  sourceTruncated?: boolean;
};

export type PascLocalWorkerResponse =
  | { type: "PROGRESS"; state: PascLocalTaskState; progress: number; detail: string }
  | { type: "BATCH_DONE"; completed: number; total: number; elapsedMs: number }
  | { type: "COMPLETE"; result: PascLocalCompletePayload }
  | { type: "ERROR"; message: string }
  | { type: "CANCELLED" };

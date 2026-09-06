export type EvidenceAction =
  | { type: "focus-points"; pointIds: string[] }
  | { type: "focus-feature"; layerId: string; featureId: string }
  | { type: "focus-layer"; layerId: string };

export type AiEvidence = {
  id: string;
  kind: "tool" | "rag" | "scope" | "warning";
  label: string;
  detail: string;
  action?: EvidenceAction;
};

export type LocalAiResult = {
  answer: string;
  evidence: AiEvidence[];
  toolNames: string[];
  createdAt: string;
  boundaryLimited: boolean;
};

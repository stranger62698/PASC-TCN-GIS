import type { RoadEvidence, RoadIssue, RoadSegment } from "./roadops-quality";

export const TYPESAFE_SYSTEM_ONE_URL = "https://api.typesafe.ai/v1/systemone";
export const TYPESAFE_DEFAULT_MODEL = "jev-latest";

export type RoadIssueTypeSafeRequest = {
  model: string;
  state: {
    workflow: "roadops_quality_review";
    policy: string;
    issue: Pick<RoadIssue, "id" | "ruleCode" | "ruleVersion" | "category" | "severity" | "title" | "description" | "suggestion" | "evidence">;
    roads: Array<Pick<RoadSegment, "id" | "name" | "reference" | "roadClass" | "roadGroup" | "direction" | "maxSpeedKph" | "access" | "surface" | "bridge" | "tunnel" | "lengthMeters">>;
    evidences: Array<Pick<RoadEvidence, "id" | "type" | "distanceMeters" | "confidence" | "summary" | "status">>;
  };
  questions: {
    review_queue: {
      type: "choice";
      instructions: string;
      criteria: Record<"field_check" | "map_edit_review" | "attribute_research" | "hold", string>;
    };
    field_check_need: { type: "score"; instructions: string; criteria: [string, string, string, string, string] };
    semantic_ambiguity: { type: "noul"; instructions: string; criteria: { true: string; false: string } };
  };
};

export type RoadIssueTypeSafeAssessment = {
  provider: "typesafe";
  model: string;
  issueId: string;
  reviewQueue: "field_check" | "map_edit_review" | "attribute_research" | "hold";
  reviewQueueConfidence: number;
  reviewQueueProbabilities: Record<string, number>;
  fieldCheckNeed: number;
  fieldCheckConfidence: number;
  fieldCheckProbabilities: Record<string, number>;
  semanticAmbiguityProbability: number;
  inputTokens: number | null;
  cached: boolean;
};

const bounded = <T>(values: T[], limit: number) => values.slice(0, limit);

export function buildRoadIssueTypeSafeRequest(issue: RoadIssue, segments: RoadSegment[], evidences: RoadEvidence[], model = TYPESAFE_DEFAULT_MODEL): RoadIssueTypeSafeRequest {
  return {
    model,
    state: {
      workflow: "roadops_quality_review",
      policy: "Deterministic RoadOps rules remain authoritative. Select only a human-review queue; do not infer legal access, road safety, or a map edit that is absent from the evidence.",
      issue: {
        id: issue.id, ruleCode: issue.ruleCode, ruleVersion: issue.ruleVersion, category: issue.category,
        severity: issue.severity, title: issue.title, description: issue.description, suggestion: issue.suggestion,
        evidence: issue.evidence,
      },
      roads: bounded(segments.filter(segment => issue.roadSegmentIds.includes(segment.id)), 4).map(segment => ({
        id: segment.id, name: segment.name, reference: segment.reference, roadClass: segment.roadClass,
        roadGroup: segment.roadGroup, direction: segment.direction, maxSpeedKph: segment.maxSpeedKph,
        access: segment.access, surface: segment.surface, bridge: segment.bridge, tunnel: segment.tunnel,
        lengthMeters: Math.round(segment.lengthMeters * 10) / 10,
      })),
      evidences: bounded(evidences.filter(evidence => issue.evidenceIds.includes(evidence.id)), 6).map(evidence => ({
        id: evidence.id, type: evidence.type, distanceMeters: evidence.distanceMeters, confidence: evidence.confidence,
        summary: evidence.summary, status: evidence.status,
      })),
    },
    questions: {
      review_queue: {
        type: "choice",
        instructions: "Choose the single most suitable next human-review queue for `issue`, using only `roads`, `evidences`, and `policy`.",
        criteria: {
          field_check: "On-site observation is the most useful next step because the issue cannot be resolved from the supplied map attributes and evidence.",
          map_edit_review: "A map-data reviewer should inspect topology or geometry against permitted source material before any edit.",
          attribute_research: "The main gap is a missing or ambiguous road attribute that should be researched from permitted sources.",
          hold: "Evidence is insufficient, conflicting, or too weak; keep the deterministic candidate without advancing it.",
        },
      },
      field_check_need: {
        type: "score",
        instructions: "Score how strongly this candidate needs an on-site field check. This is a review-priority signal, not a safety conclusion.",
        criteria: [
          "0 — no field check: deterministic issue can be handled with existing permitted map evidence.",
          "1 — low: field evidence would add context but is not needed for the next review step.",
          "2 — moderate: important facts remain uncertain and a field check may resolve them.",
          "3 — high: field evidence is probably required before accepting or rejecting the candidate.",
          "4 — urgent review: supplied evidence indicates a time-sensitive need for human field verification, without asserting danger.",
        ],
      },
      semantic_ambiguity: {
        type: "noul",
        // Batched questions are independent: do not refer to review_queue's answer.
        instructions: "Using only `issue`, `roads`, `evidences`, and `policy`, do the supplied source fields contain material semantic ambiguity or conflicting meanings that require human clarification? Do not infer answers to other questions.",
        criteria: {
          true: "The meaning of the attributes, evidence summary, or rule outcome is materially ambiguous or conflicting.",
          false: "The supplied source fields have coherent meanings. Missing evidence stays unknown; this does not confirm legal access, road safety, or permission to act.",
        },
      },
    },
  };
}

const finiteProbability = (value: unknown, label: string) => {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1) throw new Error(`TypeSafe ${label} 无效`);
  return value;
};
const finiteScore = (value: unknown) => {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 4) throw new Error("TypeSafe field_check_need 无效");
  return value;
};
const probabilities = (value: unknown) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("TypeSafe 概率分布无效");
  return Object.fromEntries(Object.entries(value).map(([key, probability]) => [key, finiteProbability(probability, `${key} probability`)]));
};

export function parseRoadIssueTypeSafeResponse(issueId: string, raw: unknown, cached = false): RoadIssueTypeSafeAssessment {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("TypeSafe 响应格式无效");
  const result = raw as { model?: unknown; answers?: Record<string, unknown>; usage?: { input_tokens?: unknown } };
  const review = result.answers?.review_queue as { type?: unknown; choice?: unknown; confidence?: unknown; probabilities?: unknown } | undefined;
  const field = result.answers?.field_check_need as { type?: unknown; score?: unknown; confidence?: unknown; probabilities?: unknown } | undefined;
  const ambiguity = result.answers?.semantic_ambiguity as { type?: unknown; noul?: unknown } | undefined;
  const allowedQueues = new Set(["field_check", "map_edit_review", "attribute_research", "hold"]);
  if (review?.type !== "choice" || typeof review.choice !== "string" || !allowedQueues.has(review.choice)) throw new Error("TypeSafe review_queue 无效");
  if (field?.type !== "score" || ambiguity?.type !== "noul") throw new Error("TypeSafe 问题类型不匹配");
  return {
    provider: "typesafe", model: typeof result.model === "string" ? result.model : TYPESAFE_DEFAULT_MODEL, issueId,
    reviewQueue: review.choice as RoadIssueTypeSafeAssessment["reviewQueue"],
    reviewQueueConfidence: finiteProbability(review.confidence, "review_queue confidence"),
    reviewQueueProbabilities: probabilities(review.probabilities),
    fieldCheckNeed: finiteScore(field.score), fieldCheckConfidence: finiteProbability(field.confidence, "field_check_need confidence"),
    fieldCheckProbabilities: probabilities(field.probabilities),
    semanticAmbiguityProbability: finiteProbability(ambiguity.noul, "semantic_ambiguity"),
    inputTokens: typeof result.usage?.input_tokens === "number" && Number.isFinite(result.usage.input_tokens) ? result.usage.input_tokens : null,
    cached,
  };
}

export async function runRoadIssueTypeSafeReview(input: {
  apiKey: string;
  issue: RoadIssue;
  segments: RoadSegment[];
  evidences: RoadEvidence[];
  model?: string;
  fetcher?: typeof fetch;
  signal?: AbortSignal;
}) {
  const apiKey = input.apiKey.trim();
  if (!apiKey) throw new Error("TYPESAFE_API_KEY 未配置");
  const payload = buildRoadIssueTypeSafeRequest(input.issue, input.segments, input.evidences, input.model);
  const response = await (input.fetcher ?? fetch)(TYPESAFE_SYSTEM_ONE_URL, {
    method: "POST", headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify(payload), signal: input.signal,
  });
  const raw = await response.json().catch(() => null);
  if (!response.ok) throw new Error(response.status === 429 ? "TypeSafe 请求达到速率限制，请稍后重试" : `TypeSafe 请求失败（HTTP ${response.status}）`);
  return parseRoadIssueTypeSafeResponse(input.issue.id, raw);
}

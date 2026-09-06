import { AI_KNOWLEDGE, type KnowledgeChunk } from "../data/ai-knowledge";

function tokens(value: string) {
  const normalized = value.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ");
  const latin = normalized.split(/\s+/).filter(Boolean);
  const han = [...normalized.replace(/[^\p{Script=Han}]/gu, "")];
  const bigrams = han.slice(0, -1).map((item, index) => item + han[index + 1]);
  return [...new Set([...latin, ...han, ...bigrams])];
}

export type RagMatch = KnowledgeChunk & { score: number };

export function retrieveKnowledge(query: string, limit = 3): RagMatch[] {
  const queryTokens = tokens(query);
  if (!queryTokens.length) return [];
  return AI_KNOWLEDGE.map((chunk) => {
    const titleTokens = new Set(tokens(`${chunk.title} ${chunk.tags.join(" ")}`));
    const contentTokens = new Set(tokens(chunk.content));
    const score = queryTokens.reduce((sum, token) => sum + (titleTokens.has(token) ? 4 : 0) + (contentTokens.has(token) ? 1 : 0), 0);
    return { ...chunk, score };
  }).filter((item) => item.score > 0).sort((a, b) => b.score - a.score).slice(0, limit);
}

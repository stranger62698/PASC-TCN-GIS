/** Local identity and login continuation only; never persists a File or analysis result. */
export type LocalAnalysisSession = {
  schemaVersion: "local-analysis-session-v1";
  datasetId: string;
  analysisId: string;
  /** Stable only for this File instance; a new user selection is a new import. */
  importId: string;
  file: { name: string; size: number; lastModified: number };
  fingerprint: { algorithm: "SHA-256"; coverage: "full" | "sampled-first-middle-last"; sampledBytes: number; digest: string };
};

function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.entries(value).filter(([, item]) => item !== undefined).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(",")}}`;
}

/** A deterministic identity, not a cryptographic integrity or scientific provenance claim. */
export function localIdentityHash(value: unknown): string {
  const input = canonical(value);
  let first = 2166136261, second = 2246822507;
  for (let index = 0; index < input.length; index += 1) {
    first = Math.imul(first ^ input.charCodeAt(index), 16777619);
    second = Math.imul(second ^ input.charCodeAt(index), 3266489909);
  }
  return `${(first >>> 0).toString(16).padStart(8, "0")}${(second >>> 0).toString(16).padStart(8, "0")}`;
}

export function createLocalAnalysisId(datasetId: string, settings: unknown, scope: unknown = null): string {
  if (!datasetId.trim()) throw new Error("分析缺少数据集标识。");
  return `local-analysis-${localIdentityHash({ datasetId, settings, scope })}`;
}

const fileImports = new WeakMap<File, string>();
let importSequence = 0;
function localFileImportId(file: File): string {
  const previous = fileImports.get(file);
  if (previous) return previous;
  const id = `local-import-${globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${++importSequence}-${Math.random().toString(36).slice(2)}`}`;
  fileImports.set(file, id);
  return id;
}

/** Reads at most 96 KiB. Large-file fingerprints are explicitly sampled, not whole-file SHA-256.
 * A File-scoped import identity prevents unobserved sample gaps from reusing an earlier dataset identity.
 */
export async function createLocalAnalysisSession(file: File, settings: unknown, scope: unknown = null): Promise<LocalAnalysisSession> {
  const importId = localFileImportId(file);
  const sampleSize = 32 * 1024;
  const candidates = [0, Math.max(0, Math.floor((file.size - sampleSize) / 2)), Math.max(0, file.size - sampleSize)].sort((a, b) => a - b);
  const ranges: Array<[number, number]> = [];
  for (const start of candidates) {
    const end = Math.min(file.size, start + sampleSize), previous = ranges.at(-1);
    if (previous && start <= previous[1]) previous[1] = Math.max(previous[1], end);
    else ranges.push([start, end]);
  }
  const chunks = await Promise.all(ranges.map(([start, end]) => file.slice(start, end).arrayBuffer()));
  const sampledBytes = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
  const content = new Uint8Array(sampledBytes);
  let offset = 0;
  for (const chunk of chunks) { content.set(new Uint8Array(chunk), offset); offset += chunk.byteLength; }
  const digest = Array.from(new Uint8Array(await globalThis.crypto.subtle.digest("SHA-256", content)), byte => byte.toString(16).padStart(2, "0")).join("");
  const metadata = { name: file.name, size: file.size, lastModified: file.lastModified };
  const datasetId = `local-file-${localIdentityHash({ importId, ...metadata, ranges, digest })}`;
  return {
    schemaVersion: "local-analysis-session-v1", datasetId, importId,
    analysisId: createLocalAnalysisId(datasetId, settings, scope), file: metadata,
    fingerprint: { algorithm: "SHA-256", coverage: sampledBytes === file.size ? "full" : "sampled-first-middle-last", sampledBytes, digest },
  };
}

function unsafeUrlCharacters(value: string): boolean {
  return Array.from(value).some(character => character === "\\" || character.charCodeAt(0) <= 32 || character.charCodeAt(0) === 127);
}

/** Resolve only local/same-origin URLs. Auth/API targets and browser URL parser ambiguities are rejected. */
export function safeReturnTo(value: string | null | undefined, origin: string, fallback = "/datasets"): string {
  if (!value || value.trim() !== value || unsafeUrlCharacters(value) || value.startsWith("//")) return fallback;
  try {
    const base = new URL(origin), target = new URL(value, base.origin);
    if (!["http:", "https:"].includes(target.protocol) || target.origin !== base.origin || target.username || target.password) return fallback;
    if (!value.startsWith("/") && !/^https?:\/\//i.test(value)) return fallback;
    const decodedPath = decodeURIComponent(target.pathname);
    if (decodedPath.startsWith("//") || unsafeUrlCharacters(decodedPath) || /^\/(?:login|api)(?:\/|$)/i.test(decodedPath)) return fallback;
    return `${target.pathname}${target.search}${target.hash}`;
  } catch { return fallback; }
}

export function buildLoginContinuationHref(returnTo: string, origin: string): string {
  const query = new URLSearchParams({ returnTo: safeReturnTo(returnTo, origin, "/map"), resume: "1" });
  return `/login?${query.toString()}`;
}

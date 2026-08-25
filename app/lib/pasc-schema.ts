export type PascSemanticField =
  | "point_id"
  | "longitude"
  | "latitude"
  | "velocity"
  | "coherence"
  | "project_name";

export type PascMappingMethod = "exact_alias" | "case_insensitive_alias" | "heuristic" | "unresolved";

export type PascFieldResolution = {
  semantic: PascSemanticField;
  field: string;
  method: PascMappingMethod;
  candidates: string[];
  requiresConfirmation: boolean;
};

export type PascParsedDateColumn = {
  original: string;
  canonical: string;
  timestamp: number;
  index: number;
};

export type PascDateSchemaAnalysis = {
  parsed: PascParsedDateColumn[];
  sorted: PascParsedDateColumn[];
  failed: string[];
  duplicateDates: Array<{ canonical: string; fields: string[] }>;
};

export const PASC_FIELD_ALIASES: Record<PascSemanticField, readonly string[]> = {
  point_id: ["FID", "fid", "point_id", "id", "pid", "点号", "点位编号"],
  longitude: ["xpos", "lon", "lng", "longitude", "longitude_wgs84", "X", "经度"],
  latitude: ["ypos", "lat", "latitude", "latitude_wgs84", "Y", "纬度"],
  velocity: ["Vel", "velocity", "rate", "mean_velocity", "avg_velocity", "年均速率", "平均速率"],
  coherence: ["coherence", "coh", "correlation", "平均相干性", "相干性"],
  project_name: ["project_name", "project", "area", "region", "city", "location", "项目名称", "研究区", "区域", "地区", "城市"],
};

const normalize = (value: string) => value.trim().toLowerCase().replace(/[\s-]+/g, "_");

function heuristicCandidates(headers: string[], semantic: PascSemanticField) {
  const patterns: Record<PascSemanticField, RegExp> = {
    point_id: /(?:point|fid|pid).*id|编号/i,
    longitude: /(?:long|lng|x).*?(?:wgs|coord)?|经度/i,
    latitude: /(?:lat|y).*?(?:wgs|coord)?|纬度/i,
    velocity: /vel|rate|speed|速率/i,
    coherence: /coh|corr|quality|相干/i,
    project_name: /project|region|area|city|项目|区域|城市/i,
  };
  return headers.filter(header => patterns[semantic].test(header));
}

export function resolvePascField(headers: string[], semantic: PascSemanticField): PascFieldResolution {
  const aliases = PASC_FIELD_ALIASES[semantic];
  const exact = headers.filter(header => aliases.includes(header));
  if (exact.length === 1) {
    return { semantic, field: exact[0], method: "exact_alias", candidates: exact, requiresConfirmation: false };
  }
  const normalizedAliases = new Set(aliases.map(normalize));
  const insensitive = headers.filter(header => normalizedAliases.has(normalize(header)));
  if (insensitive.length === 1) {
    return { semantic, field: insensitive[0], method: "case_insensitive_alias", candidates: insensitive, requiresConfirmation: false };
  }
  const candidates = heuristicCandidates(headers, semantic);
  if (candidates.length === 1) {
    return { semantic, field: candidates[0], method: "heuristic", candidates, requiresConfirmation: true };
  }
  const ambiguous = [...new Set([...exact, ...insensitive, ...candidates])];
  return { semantic, field: "", method: "unresolved", candidates: ambiguous, requiresConfirmation: true };
}

export function parsePascDateHeader(value: string): PascParsedDateColumn | null {
  const original = value.trim();
  let match = original.match(/^(?:D_?)?((?:19|20)\d{2})(\d{2})(\d{2})$/i);
  if (!match) match = original.match(/^((?:19|20)\d{2})[-_/.](\d{1,2})[-_/.](\d{1,2})$/);
  if (!match) return null;
  const year = Number(match[1]), month = Number(match[2]), day = Number(match[3]);
  const timestamp = Date.UTC(year, month - 1, day);
  const date = new Date(timestamp);
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  const canonical = `${year.toString().padStart(4, "0")}-${month.toString().padStart(2, "0")}-${day.toString().padStart(2, "0")}`;
  return { original, canonical, timestamp, index: -1 };
}

export function isPascDateField(value: string) {
  return parsePascDateHeader(value) !== null;
}

export function resemblesPascDateField(value: string) {
  return /^(?:d|date|time|t)?[._/-]?(?:19|20)\d/i.test(value.trim());
}

export function analyzePascDateColumns(headers: string[], selected?: string[]): PascDateSchemaAnalysis {
  const selectedSet = new Set(selected ?? headers.filter(header => isPascDateField(header) || resemblesPascDateField(header)));
  const parsed: PascParsedDateColumn[] = [];
  const failed: string[] = [];
  headers.forEach((header, index) => {
    if (!selectedSet.has(header)) return;
    const date = parsePascDateHeader(header);
    if (date) parsed.push({ ...date, index });
    else if (resemblesPascDateField(header) || selected !== undefined) failed.push(header);
  });
  const groups = new Map<string, PascParsedDateColumn[]>();
  parsed.forEach(item => groups.set(item.canonical, [...(groups.get(item.canonical) ?? []), item]));
  return {
    parsed,
    sorted: [...parsed].sort((a, b) => a.timestamp - b.timestamp || a.index - b.index),
    failed,
    duplicateDates: [...groups.entries()]
      .filter(([, items]) => items.length > 1)
      .map(([canonical, items]) => ({ canonical, fields: items.map(item => item.original) })),
  };
}

export function duplicateDateConflicts(row: string[], headers: string[], analysis: PascDateSchemaAnalysis) {
  const indexByHeader = new Map(headers.map((header, index) => [header, index]));
  return analysis.duplicateDates.filter(group => {
    const values = group.fields
      .map(field => Number(row[indexByHeader.get(field) ?? -1]))
      .filter(Number.isFinite);
    return new Set(values.map(value => value.toPrecision(14))).size > 1;
  });
}

export function uniqueSortedDateColumns(analysis: PascDateSchemaAnalysis) {
  const seen = new Set<string>();
  return analysis.sorted.filter(item => {
    if (seen.has(item.canonical)) return false;
    seen.add(item.canonical);
    return true;
  });
}

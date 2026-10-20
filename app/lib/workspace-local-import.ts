import type { InsarPoint } from "../data/site";
import type { CsvInspection, CsvMapping, DatasetParseResult } from "./insar-v2";
import type { PascLocalFieldMapping, PascLocalSettings } from "./pasc-local-preprocess";

/** An in-memory handoff. The parent retains the original import draft and File. */
export type WorkspaceLocalImport = {
  file: File;
  inspection?: CsvInspection;
  mapping?: CsvMapping;
  result?: DatasetParseResult;
  coherenceMin?: number;
};

export function localSettingsForWorkspaceImport(mapping?: CsvMapping): Partial<PascLocalSettings> {
  if (!mapping) return {};
  const settings: Partial<PascLocalSettings> = {
    fieldMapping: { longitude: mapping.lon, latitude: mapping.lat, point_id: mapping.id, velocity: mapping.velocity, coherence: mapping.coherence },
  };
  if (mapping.displacementUnit && mapping.displacementUnit !== "unknown") settings.displacementUnit = mapping.displacementUnit;
  if (mapping.velocityUnit && mapping.velocityUnit !== "unknown") settings.velocityUnit = mapping.velocityUnit;
  // Both parsers preserve toward-positive values and negate away-positive values.
  if (mapping.signConvention === "toward_satellite_positive") settings.signConvention = "model_native";
  if (mapping.signConvention === "away_from_satellite_positive") settings.signConvention = "subsidence_positive";
  if (mapping.preprocessingState === "raw" || mapping.preprocessingState === "already_smoothed") settings.preprocessingState = mapping.preprocessingState;
  return settings;
}

export function mergeLocalImportFieldMapping(detected: PascLocalFieldMapping, confirmed?: PascLocalFieldMapping): PascLocalFieldMapping {
  return { ...detected, ...confirmed };
}

export function workspaceImportCoherenceMinimum(value?: number): number | null {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : null;
}

export function workspaceImportVisiblePointIds(points: InsarPoint[], minimum: number | null): string[] | null {
  if (minimum === null) return null;
  return points.filter(point => Number.isFinite(point.coherence) && point.coherence >= minimum && point.coherenceSource !== "not_available" && point.coherenceSource !== "default").map(point => point.id);
}

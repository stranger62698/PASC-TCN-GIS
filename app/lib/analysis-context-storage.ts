import type { AnalysisContextState, SelectedRegion } from "./analysis-context";
import type { AoiGeometry } from "./aoi-analysis";

export const ANALYSIS_CONTEXT_STORAGE_KEY = "lanjifyw-analysis-context-v2";
export const ANALYSIS_CONTEXT_MAX_PERSISTED_IDS = 2_048;
export const ANALYSIS_CONTEXT_MAX_STORAGE_BYTES = 256 * 1024;
type SessionStorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;
const byteLength = (text: string) => new TextEncoder().encode(text).byteLength;
const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === "object" && !Array.isArray(value));
const validBounds = (value: unknown): value is SelectedRegion["bounds"] => Array.isArray(value) && value.length === 4 && value.every(item => typeof item === "number" && Number.isFinite(item)) && value[0] <= value[2] && value[1] <= value[3];
const validGeometry = (value: unknown): value is AoiGeometry => isRecord(value) && ["rectangle", "polygon"].includes(String(value.type)) && Array.isArray(value.coordinates) && value.coordinates.length >= 3 && value.coordinates.every(item => Array.isArray(item) && item.length === 2 && item.every(coordinate => typeof coordinate === "number" && Number.isFinite(coordinate)));

/** Storage metadata never replaces the live selection's complete membership. */
function compactRegion(region: SelectedRegion, omitIds = false, omitGeometry = false): SelectedRegion {
  const ids = region.pointIds;
  const pointCount = region.pointIdsComplete === false && Number.isSafeInteger(region.pointCount) && region.pointCount! >= ids.length ? region.pointCount! : ids.length;
  const complete = !omitIds && region.pointIdsComplete !== false && ids.length <= ANALYSIS_CONTEXT_MAX_PERSISTED_IDS;
  return {
    bounds: region.bounds,
    pointIds: complete ? ids.slice() : [],
    pointCount,
    pointIdsComplete: complete,
    ...(region.geometry && !omitGeometry ? { geometry: region.geometry } : {}),
    ...(region.geometryComplete === false || omitGeometry ? { geometryComplete: false } : {}),
    ...(complete && region.regionId ? { regionId: region.regionId } : {}),
    label: (region.label || "分析范围").replace(/（(?:范围|边界范围)已恢复，需重新圈选点位）$/, "").slice(0, 256),
    source: complete ? region.source : omitGeometry ? "rectangle" : region.geometry?.type || "rectangle",
  };
}
function selectionIndependent(state: Partial<AnalysisContextState>): Partial<AnalysisContextState> {
  if (state.selectedRegion?.pointIdsComplete !== false) return state;
  return {
    ...state,
    selectedRegionStats: null,
    filters: { active: "none", velocityMax: null, coherenceMin: null, resultCount: 0 },
  };
}

/** Bound serialized IDs before JSON.stringify; the runtime state is not mutated. */
export function serializeAnalysisContext(state: AnalysisContextState): string | null {
  let persisted = selectionIndependent({
    ...state,
    datasetName: state.datasetName.slice(0, 512),
    selectedRegion: state.selectedRegion ? compactRegion(state.selectedRegion) : null,
  });
  let text = JSON.stringify(persisted);
  if (byteLength(text) > ANALYSIS_CONTEXT_MAX_STORAGE_BYTES) {
    persisted = selectionIndependent({ ...persisted, selectedRegionStats: null, selectedRegion: state.selectedRegion ? compactRegion(state.selectedRegion, true) : null });
    text = JSON.stringify(persisted);
  }
  if (byteLength(text) > ANALYSIS_CONTEXT_MAX_STORAGE_BYTES) {
    persisted = selectionIndependent({ ...persisted, selectedRegion: state.selectedRegion ? compactRegion(state.selectedRegion, true, true) : null });
    text = JSON.stringify(persisted);
  }
  return byteLength(text) <= ANALYSIS_CONTEXT_MAX_STORAGE_BYTES ? text : null;
}

/** Legacy contexts are accepted, but an omitted ID set never restores old statistics/filter membership. */
export function parseAnalysisContext(text: string): Partial<AnalysisContextState> {
  const value: unknown = JSON.parse(text);
  if (!isRecord(value)) throw new Error("Invalid saved analysis context");
  const parsed = value as Partial<AnalysisContextState>;
  const patternVisibility = parsed.patternVisibility === "anomaly" || parsed.patternVisibility === "anomaly_with_undefined" ? parsed.patternVisibility : "all";
  let region: SelectedRegion | null = null;
  if (isRecord(value.selectedRegion) && validBounds(value.selectedRegion.bounds)) {
    const bounds = value.selectedRegion.bounds, stored = value.selectedRegion, ids = Array.isArray(stored.pointIds) ? stored.pointIds : [];
    const count = Number.isSafeInteger(stored.pointCount) && Number(stored.pointCount) >= ids.length ? Number(stored.pointCount) : ids.length;
    const complete = Array.isArray(stored.pointIds) && stored.pointIdsComplete !== false && ids.length <= ANALYSIS_CONTEXT_MAX_PERSISTED_IDS && ids.every(id => typeof id === "string") && new Set(ids).size === ids.length && count === ids.length && (stored.pointCount === undefined || stored.pointCount === ids.length);
    region = compactRegion({
      bounds,
      pointIds: complete ? ids as string[] : [],
      pointCount: count,
      pointIdsComplete: complete,
      ...(validGeometry(stored.geometry) ? { geometry: stored.geometry } : {}),
      ...(stored.geometryComplete === false ? { geometryComplete: false } : {}),
      ...(typeof stored.label === "string" ? { label: stored.label } : {}),
      ...(typeof stored.regionId === "string" ? { regionId: stored.regionId } : {}),
      ...(typeof stored.source === "string" && ["rectangle", "polygon", "filter", "anomaly", "anomalyRegion"].includes(stored.source) ? { source: stored.source as SelectedRegion["source"] } : {}),
    });
    if (!complete) region.label += region.geometryComplete === false ? "（边界范围已恢复，需重新圈选点位）" : "（范围已恢复，需重新圈选点位）";
  }
  return selectionIndependent({ ...parsed, patternVisibility, selectedRegion: region, ...(region ? {} : { selectedRegionStats: null }) });
}

/** A denied Storage getter or a full quota disables this adapter, never the running map. */
export function createAnalysisContextPersistence(getStorage: () => SessionStorageLike) {
  let disabled = false;
  return {
    read(): Partial<AnalysisContextState> | null {
      if (disabled) return null;
      let storage: SessionStorageLike;
      try { storage = getStorage(); } catch { disabled = true; return null; }
      try {
        const text = storage.getItem(ANALYSIS_CONTEXT_STORAGE_KEY);
        if (!text) return null;
        try { return parseAnalysisContext(text); }
        catch { storage.removeItem(ANALYSIS_CONTEXT_STORAGE_KEY); return null; }
      } catch { disabled = true; return null; }
    },
    write(state: AnalysisContextState): boolean {
      if (disabled) return false;
      try {
        const text = serializeAnalysisContext(state), storage = getStorage();
        if (text === null) { storage.removeItem(ANALYSIS_CONTEXT_STORAGE_KEY); return false; }
        storage.setItem(ANALYSIS_CONTEXT_STORAGE_KEY, text); return true;
      } catch { disabled = true; return false; }
    },
  };
}
"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { RenderAttribute } from "./insar-v2";
import type { AoiGeometry } from "./aoi-analysis";
import { PASC_CLASSES, pascColor, pascDisplayName } from "./pasc";
import type { PatternVisibility } from "./v2-map-analysis";
import { createAnalysisContextPersistence } from "./analysis-context-storage";

export type AnalysisTimeRange = {
  startIndex: number;
  endIndex: number;
  startDate: string;
  endDate: string;
};

export type AnalysisFilters = {
  active: "none" | "velocity" | "coherence" | "anomaly" | "pascLowConfidence" | "pascLimitedSpatial";
  velocityMax: number | null;
  coherenceMin: number | null;
  resultCount: number;
  description?: string;
};

export type SelectedRegion = {
  bounds: [number, number, number, number];
  pointIds: string[];
  /** Restored geometry can retain its count while membership awaits a fresh selection. */
  pointCount?: number;
  pointIdsComplete?: boolean;
  geometryComplete?: boolean;
  geometry?: AoiGeometry;
  regionId?: string;
  label?: string;
  source?: "rectangle" | "polygon" | "filter" | "anomaly" | "anomalyRegion";
};

export type SelectedRegionStats = {
  pointCount: number;
  averageVelocity: number;
  maximumDisplacement: number;
  timeSeriesAvailable?: boolean;
  qualityCount: number;
  modeCounts: Record<string, number>;
  averageDisplacement?: number;
  averageCoherence?: number | null;
  minimumVelocity?: number;
  maximumVelocity?: number;
  areaKm2?: number | null;
  medianVelocity?: number;
  medianDisplacement?: number;
  lowCoherenceCount?: number;
  missingDataCount?: number;
  velocityHistogram?: Array<{
    min: number;
    max: number;
    count: number;
  }>;
};

export type AnalysisMapView = {
  center: [number, number];
  zoom: number;
  bounds: [number, number, number, number];
};

export type AnalysisContextState = {
  datasetId: string;
  datasetName: string;
  timeRange: AnalysisTimeRange;
  filters: AnalysisFilters;
  activeColorMode: RenderAttribute;
  patternVisibility: PatternVisibility;
  selectedPointId: string | null;
  selectedRegion: SelectedRegion | null;
  selectedRegionStats: SelectedRegionStats | null;
  mapView: AnalysisMapView | null;
};

const defaultAnalysisContext: AnalysisContextState = {
  datasetId: "demo-haikou",
  datasetName: "海口公开示例 · 时序 InSAR",
  timeRange: { startIndex: 0, endIndex: 0, startDate: "—", endDate: "—" },
  filters: { active: "none", velocityMax: null, coherenceMin: null, resultCount: 0 },
  activeColorMode: "velocity",
  patternVisibility: "all",
  selectedPointId: null,
  selectedRegion: null,
  selectedRegionStats: null,
  mapView: null,
};

type AnalysisContextValue = {
  analysis: AnalysisContextState;
  isReady: boolean;
  updateAnalysis: (patch: Partial<AnalysisContextState>) => void;
  resetAnalysis: () => void;
};

const AnalysisContext = createContext<AnalysisContextValue | null>(null);

export function AnalysisProvider({ children }: { children: ReactNode }) {
  const [analysis, setAnalysis] = useState<AnalysisContextState>(defaultAnalysisContext);
  const [isReady, setIsReady] = useState(false);
  const restored = useRef(false);
  const [persistence] = useState(() => createAnalysisContextPersistence(() => window.sessionStorage));

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const parsed = persistence.read();
      if (parsed) setAnalysis(current => ({ ...current, ...parsed }));
      restored.current = true;
      setIsReady(true);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [persistence]);

  useEffect(() => {
    if (!restored.current) return;
    persistence.write(analysis);
  }, [analysis, persistence]);

  const updateAnalysis = useCallback((patch: Partial<AnalysisContextState>) => {
    setAnalysis(current => ({ ...current, ...patch }));
  }, []);

  const resetAnalysis = useCallback(() => setAnalysis(defaultAnalysisContext), []);
  const value = useMemo(() => ({ analysis, isReady, updateAnalysis, resetAnalysis }), [analysis, isReady, updateAnalysis, resetAnalysis]);

  return <AnalysisContext.Provider value={value}>{children}</AnalysisContext.Provider>;
}

export function useAnalysisContext() {
  const value = useContext(AnalysisContext);
  if (!value) throw new Error("useAnalysisContext 必须在 AnalysisProvider 内使用");
  return value;
}

export const deformationModeOrder = PASC_CLASSES.map(item => item.nameZh);

export const deformationModeColors: Record<string, string> = Object.fromEntries(
  PASC_CLASSES.map(item => [item.nameZh, item.color]),
);
deformationModeColors["Stepwise（旧版，待确认）"] = "#4D4D4D";
deformationModeColors["未分类"] = "#94a3b8";

export function normalizedMode(mode: string) {
  return pascDisplayName(mode);
}

export function colorForMode(mode: string) {
  return deformationModeColors[normalizedMode(mode)] ?? pascColor(mode);
}

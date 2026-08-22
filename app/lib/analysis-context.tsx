"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { RenderAttribute } from "./insar";

export type AnalysisTimeRange = {
  startIndex: number;
  endIndex: number;
  startDate: string;
  endDate: string;
};

export type AnalysisFilters = {
  active: "none" | "velocity" | "coherence" | "anomaly";
  velocityMax: number | null;
  coherenceMin: number | null;
  resultCount: number;
  description?: string;
};

export type SelectedRegion = {
  bounds: [number, number, number, number];
  pointIds: string[];
  label?: string;
  source?: "rectangle" | "filter" | "anomaly";
};

export type SelectedRegionStats = {
  pointCount: number;
  averageVelocity: number;
  maximumDisplacement: number;
  qualityCount: number;
  modeCounts: Record<string, number>;
  averageDisplacement?: number;
  averageCoherence?: number | null;
  minimumVelocity?: number;
  maximumVelocity?: number;
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

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const stored = window.sessionStorage.getItem("lanjifyw-analysis-context-v2");
      if (stored) {
        try {
          const parsed = JSON.parse(stored) as Partial<AnalysisContextState>;
          setAnalysis(current => ({ ...current, ...parsed }));
        } catch {
          window.sessionStorage.removeItem("lanjifyw-analysis-context-v2");
        }
      }
      restored.current = true;
      setIsReady(true);
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!restored.current) return;
    window.sessionStorage.setItem("lanjifyw-analysis-context-v2", JSON.stringify(analysis));
  }, [analysis]);

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

export const deformationModeOrder = ["稳定", "线性沉降", "加速沉降", "阶段形变", "局部抬升", "周期形变", "未分类"] as const;

export const deformationModeColors: Record<string, string> = {
  "稳定": "#24a685",
  "线性沉降": "#f59e0b",
  "加速沉降": "#e94b4b",
  "阶段形变": "#7c5ce5",
  "局部抬升": "#1677ff",
  "周期形变": "#06b6d4",
  "未分类": "#94a3b8",
};

const aliases: Record<string, string> = {
  stable: "稳定",
  linear: "线性沉降",
  piecewise: "阶段形变",
  accelerating: "加速沉降",
  uplift: "局部抬升",
  seasonal: "周期形变",
  "0": "稳定",
  "1": "线性沉降",
  "2": "加速沉降",
  "3": "阶段形变",
  "4": "局部抬升",
  "5": "周期形变",
};

export function normalizedMode(mode: string) {
  const clean = (mode || "未分类").trim();
  return aliases[clean.toLowerCase()] || (deformationModeColors[clean] ? clean : "未分类");
}

export function colorForMode(mode: string) {
  return deformationModeColors[normalizedMode(mode)];
}

"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { RoadOpsDrivingPlan, RoadOpsDrivingRequest } from "./roadops-driving";
import { compareStrategySnapshots, createStrategySnapshot, ROAD_STRATEGY_COMPARISON_MAX_AGE_MS, type RoadStrategyComparison, type RoadStrategySnapshot } from "./roadops-strategy-comparison";

/** One prior successful result, only in this mounted page. No storage, logging, export or fetch. */
export function useRoadOpsStrategyComparison(scopeKey: string | null) {
  const baseline = useRef<RoadStrategySnapshot | null>(null);
  const scope = useRef(scopeKey);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [visible, setVisible] = useState<{ scopeKey: string | null; value: RoadStrategyComparison | null } | null>(null);
  // Reset state on an input transition, not merely hide it: A -> B -> A must not revive A.
  if (visible !== null && visible.scopeKey !== scopeKey) setVisible(null);
  const discard = useCallback(() => {
    baseline.current = null;
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = null;
  }, []);
  const clear = useCallback(() => { discard(); setVisible(null); }, [discard]);
  const begin = useCallback(() => { setVisible(null); }, []);
  useLayoutEffect(() => {
    scope.current = scopeKey;
    discard();
  }, [scopeKey, discard]);
  useEffect(() => {
    const hidden = () => { if (document.visibilityState === "hidden") clear(); };
    document.addEventListener("visibilitychange", hidden);
    window.addEventListener("pagehide", clear);
    return () => {
      document.removeEventListener("visibilitychange", hidden);
      window.removeEventListener("pagehide", clear);
      discard();
    };
  }, [clear, discard]);
  const accept = useCallback((request: RoadOpsDrivingRequest, plan: RoadOpsDrivingPlan) => {
    if (scopeKey === null || scope.current !== scopeKey || document.visibilityState === "hidden") { clear(); return; }
    const next = createStrategySnapshot(request, plan), now = Date.now();
    if (!next) { clear(); return; }
    if (!Number.isFinite(next.generatedAtMs) || next.generatedAtMs > now || now - next.generatedAtMs > ROAD_STRATEGY_COMPARISON_MAX_AGE_MS) {
      clear();
      setVisible({ scopeKey, value: { status: "unavailable", reason: !Number.isFinite(next.generatedAtMs) ? "invalid_time" : next.generatedAtMs > now ? "future_time" : "expired" } });
      return;
    }
    const previous = baseline.current;
    const value = previous ? compareStrategySnapshots(previous, next, now) : null;
    discard();
    baseline.current = next;
    setVisible({ scopeKey, value });
    const expiry = Math.min(next.generatedAtMs, previous && value?.status === "comparable" ? previous.generatedAtMs : next.generatedAtMs) + ROAD_STRATEGY_COMPARISON_MAX_AGE_MS;
    timer.current = setTimeout(() => {
      discard();
      setVisible({ scopeKey, value: { status: "unavailable", reason: "expired" } });
    }, Math.max(1, expiry - now + 1));
  }, [scopeKey, clear, discard]);
  return { comparison: visible?.scopeKey === scopeKey ? visible.value : null, begin, accept, clear };
}

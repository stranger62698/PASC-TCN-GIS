"use client";

import { useLayoutEffect, useState, type RefObject } from "react";

/** Keep chart labels at a readable size while the plotting area follows its panel. */
export function useChartWidth(ref: RefObject<SVGSVGElement | null>, fallback: number, enabled = true) {
  const [width, setWidth] = useState(fallback);
  useLayoutEffect(() => {
    const svg = ref.current;
    if (!svg || !enabled) return;
    const measure = () => {
      const measured = svg.getBoundingClientRect().width;
      if (measured > 0) setWidth(Math.max(320, Math.round(measured)));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(svg);
    return () => observer.disconnect();
  }, [ref, enabled]);
  return width;
}

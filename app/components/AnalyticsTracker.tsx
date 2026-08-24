"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { trackEvent } from "../lib/analytics";

export function AnalyticsTracker() {
  const pathname = usePathname();
  useEffect(() => { trackEvent("page_view", { page: pathname || "/" }); }, [pathname]);
  return null;
}

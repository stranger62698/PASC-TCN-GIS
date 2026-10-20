export const DEFAULT_PANEL_WIDTH = 380;
export const MIN_PANEL_WIDTH = 340;
export const MAX_PANEL_WIDTH = 960;

/** Keep at least 300 px of the map available on desktop. Mobile uses a bottom sheet. */
export function maxPanelWidth(available: number): number {
  return Math.max(MIN_PANEL_WIDTH, Math.min(MAX_PANEL_WIDTH, available - 300));
}

export function clampPanelWidth(width: number, maximum: number): number {
  return Math.round(Math.max(MIN_PANEL_WIDTH, Math.min(maximum, width)));
}

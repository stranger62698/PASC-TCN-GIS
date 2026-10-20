export type RouteScreenPoint = { x: number; y: number };
export type RouteDirectionArrow = RouteScreenPoint & { angleDegrees: number };

// Clip the sampling interval, not the road geometry. A long off-screen segment
// must not create thousands of invisible markers at a close map zoom.
function visibleInterval(from: RouteScreenPoint, to: RouteScreenPoint, width: number, height: number) {
  const dx = to.x - from.x, dy = to.y - from.y;
  const p = [-dx, dx, -dy, dy], q = [from.x, width - from.x, from.y, height - from.y];
  let start = 0, end = 1;
  for (let index = 0; index < 4; index += 1) {
    if (p[index] === 0) {
      if (q[index] < 0) return null;
      continue;
    }
    const ratio = q[index] / p[index];
    if (p[index] < 0) start = Math.max(start, ratio);
    else end = Math.min(end, ratio);
    if (start > end) return null;
  }
  return [start, end] as const;
}

/** Arrows follow supplied polyline order; they are not turn instructions. */
export function sampleRouteDirectionArrows(
  points: RouteScreenPoint[],
  viewport: { width: number; height: number },
  spacing = 110,
  maximum = 60,
): RouteDirectionArrow[] {
  if (!Number.isFinite(spacing) || spacing < 24 || !Number.isFinite(maximum) || maximum <= 0
    || !Number.isFinite(viewport.width) || !Number.isFinite(viewport.height) || viewport.width <= 0 || viewport.height <= 0) return [];
  const arrows: RouteDirectionArrow[] = [];
  let travelled = 0;
  for (let index = 1; index < points.length && arrows.length < Math.floor(maximum); index += 1) {
    const from = points[index - 1], to = points[index];
    if (![from.x, from.y, to.x, to.y].every(Number.isFinite)) continue;
    const dx = to.x - from.x, dy = to.y - from.y, length = Math.hypot(dx, dy);
    if (!length) continue;
    const visible = visibleInterval(from, to, viewport.width, viewport.height);
    if (visible) {
      const first = Math.max(0, Math.ceil((travelled + length * visible[0] - spacing / 2) / spacing));
      const last = Math.floor((travelled + length * visible[1] - spacing / 2) / spacing);
      for (let sample = first; sample <= last && arrows.length < Math.floor(maximum); sample += 1) {
        const fraction = (sample * spacing + spacing / 2 - travelled) / length;
        // A vertex belongs to the following segment, avoiding duplicate arrows.
        if (fraction < 0 || fraction >= 1) continue;
        arrows.push({ x: from.x + fraction * dx, y: from.y + fraction * dy, angleDegrees: Math.atan2(dy, dx) * 180 / Math.PI });
      }
    }
    travelled += length;
  }
  return arrows;
}

type Coordinate = [number, number];
type MarkerInput = { id: string; coordinate: Coordinate };

/** Visual aggregation only: preserve every occurrence; do not merge stops, tasks or costs. */
export function groupCoincidentFieldMarkers<T extends MarkerInput>(points: T[]): Array<{ coordinate: Coordinate; members: T[] }> {
  const groups = new Map<string, { coordinate: Coordinate; members: T[] }>();
  points.forEach(point => {
    // Exact coordinates only; nearby parking positions must not be silently snapped together.
    const key = JSON.stringify(point.coordinate), group = groups.get(key);
    if (group) group.members.push(point);
    else groups.set(key, { coordinate: [...point.coordinate], members: [point] });
  });
  return [...groups.values()];
}

export function fieldMarkerBadge(points: Array<{ role: "origin" | "candidate" | "destination"; index?: number; visitIndex?: number | null }>) {
  const start = points.some(point => point.role === "origin"), end = points.some(point => point.role === "destination");
  if (start && end) return { kind: "start" as const, label: "起/返" };
  if (start) return { kind: "start" as const, label: "起" };
  if (end) return { kind: "end" as const, label: "终" };
  const labels = points.map(point => point.index ?? point.visitIndex).filter(value => value !== undefined && value !== null);
  return { kind: "waypoint" as const, label: labels.length > 1 ? `${labels[0]}+` : String(labels[0] ?? "站") };
}

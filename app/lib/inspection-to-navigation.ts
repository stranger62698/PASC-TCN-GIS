import type { AnomalyRegion } from "./anomaly-regions";
import { NAVIGATION_MAX_WAYPOINTS, navigationPoints, type NavigationDraft, type NavigationInspectionSource, type NavigationPoint } from "./roadops-navigation";
import { localIdentityHash } from "./local-analysis-session";

export type InspectionNavigationPoint = { id: string; lon: number; lat: number };
export type InspectionNavigationContext = {
  datasetId: string;
  analysisId: string;
  datasetTitle: string;
  observationDate: string;
  ruleSummary: string;
};
export type InspectionNavigationResult = { draft: NavigationDraft; point: NavigationPoint; added: boolean };

function validPoint(point: InspectionNavigationPoint): boolean {
  return !!point.id.trim() && Number.isFinite(point.lon) && Number.isFinite(point.lat) && Math.abs(point.lon) <= 180 && Math.abs(point.lat) <= 90;
}

/** The target is an observed member. A centroid is only the reference used for deterministic selection. */
export function selectInspectionRepresentative(region: AnomalyRegion, points: readonly InspectionNavigationPoint[]): InspectionNavigationPoint {
  const ids = new Set(region.pointIds);
  const members = points.filter(point => ids.has(point.id) && validPoint(point));
  if (!members.length) throw new Error("当前数据中未找到该区域的真实成员点，未加入路线。");
  const [longitude, latitude] = region.centroid;
  if (!Number.isFinite(longitude) || !Number.isFinite(latitude)) throw new Error("候选区域参考位置无效，未加入路线。");
  const radians = Math.PI / 180;
  const distance = (point: InspectionNavigationPoint) => {
    const latDelta = (point.lat - latitude) * radians, lngDelta = (point.lon - longitude) * radians;
    return Math.sin(latDelta / 2) ** 2 + Math.cos(latitude * radians) * Math.cos(point.lat * radians) * Math.sin(lngDelta / 2) ** 2;
  };
  return [...members].sort((first, second) => distance(first) - distance(second) || first.id.localeCompare(second.id))[0];
}

function contextSource(context: InspectionNavigationContext, point: InspectionNavigationPoint): NavigationInspectionSource {
  if (!context.datasetId.trim() || !context.analysisId.trim()) throw new Error("候选缺少数据集或分析标识，未加入路线。");
  if (!validPoint(point)) throw new Error("候选点坐标无效，未加入路线。");
  return {
    schemaVersion: "inspection-navigation-source-v1", kind: "point", ...context,
    representativePointId: point.id, sourceCoordinate: [point.lon, point.lat],
    representativeSelection: "selected-point", targetAdjusted: false, arrivalSelection: "unconfirmed",
  };
}

function append(draft: NavigationDraft, source: NavigationInspectionSource): InspectionNavigationResult {
  const sourceKey = localIdentityHash({ datasetId: source.datasetId, analysisId: source.analysisId, kind: source.kind, representativePointId: source.representativePointId, regionMembershipId: source.regionMembershipId ?? null });
  const id = `inspection-waypoint-${sourceKey}`;
  const existing = draft.waypoints.find(point => point.id === id);
  if (existing) return { draft, point: existing, added: false };
  const matchingCoordinate = navigationPoints(draft).find(point => point.coordinate?.every((value, index) => Number(value.toFixed(6)) === Number(source.sourceCoordinate[index].toFixed(6))));
  if (matchingCoordinate) throw new Error("该位置已在当前行程中，请查看已有点位；未添加重复途经点。");
  if (draft.waypoints.length >= NAVIGATION_MAX_WAYPOINTS) throw new Error(`当前行程已有 ${NAVIGATION_MAX_WAYPOINTS} 个途经点，请先删除一个再加入。`);
  const point: NavigationPoint = {
    id, name: source.kind === "region" ? `${source.regionId} · ${source.representativePointId}` : source.representativePointId,
    role: "candidate", coordinate: [...source.sourceCoordinate], dwellMinutes: 20,
    vehicleCoordinate: null, accessReview: "unknown", accessNote: "", inspectionSource: source,
  };
  return { draft: { ...draft, waypoints: [...draft.waypoints, point] }, point, added: true };
}

export function addInspectionPointToNavigation(draft: NavigationDraft, point: InspectionNavigationPoint, context: InspectionNavigationContext): InspectionNavigationResult {
  return append(draft, contextSource(context, point));
}

export function addInspectionRegionToNavigation(draft: NavigationDraft, region: AnomalyRegion, points: readonly InspectionNavigationPoint[], context: InspectionNavigationContext): InspectionNavigationResult {
  const point = selectInspectionRepresentative(region, points);
  return append(draft, {
    ...contextSource(context, point), kind: "region", regionId: region.id,
    regionPointCount: region.pointIds.length,
    regionMembershipId: localIdentityHash([...new Set(region.pointIds)].sort()),
    representativeSelection: "nearest-member-to-centroid",
  });
}

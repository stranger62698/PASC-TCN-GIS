import { compileFieldTaskRouting } from "../../app/lib/roadops-task-routing";
import type { FieldTaskPlan } from "../../app/lib/roadops-task-plan";
import { roadOpsPlanningForRequest, type RoadOpsDrivingPlan } from "../../app/lib/roadops-driving";

/** Test-only contract response. Synthetic lines never enter the UI or replace a failed service. */
export function simulatedFieldResponse(task: FieldTaskPlan, order?: string[], seconds?: number[]): RoadOpsDrivingPlan {
  const compiled = compileFieldTaskRouting(task), request = compiled.request!;
  const pointById = new Map(request.points.map(point => [point.id, point]));
  const stopOrder = order ?? compiled.visits.map(visit => visit.pointId);
  const legs = stopOrder.slice(0, -1).map((fromId, index) => {
    const toId = stopOrder[index + 1];
    const coordinates = [[...pointById.get(fromId)!.coordinate], [...pointById.get(toId)!.coordinate]] as [number, number][];
    return { id: `simulated-leg-${index}`, index: index + 1, fromId, toId, coordinates,
      bounds: [Math.min(...coordinates.map(point => point[0])), Math.min(...coordinates.map(point => point[1])), Math.max(...coordinates.map(point => point[0])), Math.max(...coordinates.map(point => point[1]))] as [number, number, number, number],
      distanceMeters: 1000 + index * 500, durationSeconds: seconds?.[index] ?? 600, traffic: [], tollsYuan: null, tag: "测试/模拟" };
  });
  const drivingDurationSeconds = legs.reduce((sum, leg) => sum + leg.durationSeconds, 0);
  const drivingMinutes = drivingDurationSeconds / 60;
  return { schemaVersion: "roadops-driving-plan-v1", provider: "didi_web_service", mode: "didi_live",
    generatedAt: "2026-10-08T01:00:00.000Z", inputFingerprint: "test-only", planning: roadOpsPlanningForRequest(request), status: "ready",
    stopOrder, selectedCandidateIds: stopOrder.slice(1, -1), excluded: [],
    totalDistanceMeters: legs.reduce((sum, leg) => sum + leg.distanceMeters, 0), drivingMinutes, drivingDurationSeconds, dwellMinutes: 0, totalMinutes: drivingMinutes, workMinutes: request.workMinutes, overtimeMinutes: 0,
    usage: { cached: true, upstreamRequests: 0, dailyUsed: 0, dailyBudget: 100, dailyRemaining: 100, perIdentityUsed: 0, perIdentityLimit: 100 },
    map: { fixtureId: "test-only", mode: "didi_live", bounds: null,
      stops: stopOrder.map((id, index) => ({ ...pointById.get(id)!, defaultDwellMinutes: 0, reachable: true,
        markerRole: index === 0 ? "start" : index === stopOrder.length - 1 ? "end" : "waypoint", visitIndex: index === 0 || index === stopOrder.length - 1 ? null : index })),
      features: legs.map(leg => ({ type: "Feature", id: leg.id, geometry: { type: "LineString", coordinates: leg.coordinates }, properties: { from: leg.fromId, to: leg.toId, legIndex: leg.index, distanceMeters: leg.distanceMeters, durationSeconds: leg.durationSeconds, source: "didi_web_service" } })) },
    field: { schemaVersion: "roadops-field-detail-v1", guidance: "geometry_only", legs,
      access: request.points.map(point => ({ pointId: point.id, coordinate: point.coordinate, roadCoordinate: point.coordinate, offsetMeters: 0, status: "near_route", thresholdMeters: 50 })),
      routePackCount: 0, limitations: ["测试/模拟，不是实际道路或安全证明"] }, boundary: "测试/模拟" };
}

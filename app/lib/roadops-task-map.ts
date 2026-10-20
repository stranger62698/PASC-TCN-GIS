import { parseFieldTaskPlan, type FieldTaskPlan } from "./roadops-task-plan";
import { buildFieldTaskReport } from "./roadops-task-report";
import type { FieldTaskRouteReceipt } from "./roadops-task-routing";
import type { RoadOpsRouteMapPlan, RoadOpsRouteMapStop } from "./roadops-route";

type Coordinate = [number, number];
export type FieldTaskMapPoint = {
  id: string; visitId: string; stopId: string; name: string;
  coordinate: Coordinate; role: "origin" | "candidate" | "destination"; index: number;
  taskIds: string[]; taskNames: string[]; taskCount: number;
  accessStatus: "needs_review";
};
export type FieldTaskTargetPoint = {
  id: string; visitId: string; stopId: string; taskId: string; name: string;
  coordinate: Coordinate; vehicleCoordinate: Coordinate | null;
  accessStatus: "needs_review";
};
export type FieldTaskRouteMapStop = RoadOpsRouteMapStop & {
  visitId: string; stopId: string; taskIds: string[]; taskNames: string[]; taskCount: number;
  accessStatus: "needs_review";
};
export type FieldTaskRouteMapPlan = Omit<RoadOpsRouteMapPlan, "stops"> & { stops: FieldTaskRouteMapStop[] };

function visitLabel(plan: FieldTaskPlan, index: number) {
  if (index === 0) return "起点";
  if (index === plan.visits.length - 1) return plan.tripMode === "return_to_start" ? "返回驻点" : "终点";
  return `停靠 ${index}`;
}

function visitName(plan: FieldTaskPlan, visitId: string, index: number) {
  const visit = plan.visits.find(value => value.visitId === visitId)!;
  const tasks = new Map(plan.tasks.map(task => [task.taskId, task]));
  const names = visit.taskIds.map(taskId => tasks.get(taskId)!.name);
  return names.length ? `${visitLabel(plan, index)} · ${names.length} 项任务：${names.join("、")}` : `${visitLabel(plan, index)} · 无核查任务`;
}

/** User-owned draft markers only. Coincident visits retain their IDs and exact coordinates. */
export function fieldTaskMapPoints(value: FieldTaskPlan): FieldTaskMapPoint[] {
  const plan = parseFieldTaskPlan(value), stops = new Map(plan.stops.map(stop => [stop.stopId, stop]));
  const tasks = new Map(plan.tasks.map(task => [task.taskId, task]));
  return plan.visits.flatMap((visit, index) => {
    const coordinate = stops.get(visit.stopId)!.coordinate;
    return coordinate ? [{ id: visit.visitId, visitId: visit.visitId, stopId: visit.stopId,
      name: visitName(plan, visit.visitId, index), coordinate: [...coordinate] as Coordinate, role: visit.role, index,
      taskIds: [...visit.taskIds], taskNames: visit.taskIds.map(id => tasks.get(id)!.name), taskCount: visit.taskIds.length,
      accessStatus: "needs_review" as const }] : [];
  });
}

/** One target per task/occurrence. This DTO never contains a target-to-vehicle line. */
export function fieldTaskTargetPoints(value: FieldTaskPlan): FieldTaskTargetPoint[] {
  const plan = parseFieldTaskPlan(value), stops = new Map(plan.stops.map(stop => [stop.stopId, stop]));
  const tasks = new Map(plan.tasks.map(task => [task.taskId, task]));
  return plan.visits.flatMap(visit => visit.taskIds.flatMap(taskId => {
    const task = tasks.get(taskId)!, coordinate = task.targetCoordinate;
    const vehicleCoordinate = stops.get(visit.stopId)!.coordinate;
    return coordinate ? [{ id: JSON.stringify([plan.planId, visit.visitId, task.taskId]), visitId: visit.visitId,
      stopId: visit.stopId, taskId, name: task.name, coordinate: [...coordinate] as Coordinate,
      vehicleCoordinate: vehicleCoordinate ? [...vehicleCoordinate] as Coordinate : null,
      accessStatus: "needs_review" as const }] : [];
  }));
}

/**
 * In-memory supplier map only. Validation binds each directed leg to the current visit snapshot.
 * No synthesized road, station connector, persistence, network request, or access certification.
 */
export function fieldTaskRouteMap(value: FieldTaskPlan, receipt: FieldTaskRouteReceipt | null): FieldTaskRouteMapPlan | null {
  const plan = parseFieldTaskPlan(value);
  const report = buildFieldTaskReport(plan, receipt, { assessedAt: receipt?.generatedAt ?? plan.updatedAt });
  if (report.mode === "no_station_driving") return null;
  // buildFieldTaskReport rejects a missing/stale receipt or incomplete directed legs.
  const features: RoadOpsRouteMapPlan["features"] = receipt!.legs.map(leg => ({
    type: "Feature", id: leg.id,
    properties: { from: leg.fromVisitId, to: leg.toVisitId, distanceMeters: leg.distanceMeters,
      durationSeconds: leg.durationSeconds, source: "didi_web_service", legIndex: leg.index },
    geometry: { type: "LineString", coordinates: leg.coordinates.map(point => [...point] as Coordinate) },
  }));
  const stops: FieldTaskRouteMapStop[] = report.visits.map((visit, index) => ({
    id: visit.visitId, visitId: visit.visitId, stopId: visit.stopId,
    name: `${visit.role === "origin" ? "起点" : visit.role === "destination" ? plan.tripMode === "return_to_start" ? "返回驻点" : "终点" : `停靠 ${index}`} · ${visit.tasks.length} 项任务${visit.tasks.length ? `：${visit.tasks.map(task => task.name).join("、")}` : ""}`, role: visit.role, coordinate: [...visit.coordinate] as Coordinate,
    markerRole: index === 0 ? "start" : index === report.visits.length - 1 ? "end" : "waypoint",
    visitIndex: index === 0 || index === report.visits.length - 1 ? null : index,
    defaultDwellMinutes: visit.dwellMinutes, inspectionValue: 0, required: true,
    // Legacy field describes availability in the route graph, not verified site access.
    reachable: true, sourceFeatureId: null,
    sourceRoadName: "滴图道路分段 · 车辆接近、停车与进入条件待核验",
    taskIds: visit.tasks.map(task => task.taskId), taskNames: visit.tasks.map(task => task.name), taskCount: visit.tasks.length,
    accessStatus: "needs_review",
  }));
  const coordinates = [...features.flatMap(feature => feature.geometry.coordinates), ...stops.map(stop => stop.coordinate)];
  const bounds: RoadOpsRouteMapPlan["bounds"] = coordinates.length ? [
    Math.min(...coordinates.map(point => point[0])), Math.min(...coordinates.map(point => point[1])),
    Math.max(...coordinates.map(point => point[0])), Math.max(...coordinates.map(point => point[1])),
  ] : null;
  return { fixtureId: JSON.stringify(["field-task-route", plan.planId, plan.revision]), mode: "didi_live", features, stops, bounds };
}

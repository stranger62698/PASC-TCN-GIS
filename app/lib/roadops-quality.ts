import type { GisBounds, GisFeature, GisLayer, Position } from "./gis-layer";

export type RoadIssueSeverity = "high" | "medium" | "low";
export type RoadIssueCategory = "geometry" | "topology" | "attribute" | "risk";

export type RoadNode = {
  id: string;
  longitude: number;
  latitude: number;
  source: "osm" | "user" | "derived";
  sourceId: string | null;
  connectedSegmentIds: string[];
};

export type RoadSegment = {
  id: string;
  featureId: string;
  source: "osm" | "user" | "derived";
  sourceId: string;
  sourceVersion: string | null;
  geometry: { type: "LineString"; coordinates: Position[] };
  startNodeId: string;
  endNodeId: string;
  name: string | null;
  reference: string | null;
  roadClass: string;
  roadGroup: "expressway" | "arterial" | "collector" | "local" | "service" | "non_motor" | "unknown";
  direction: "both" | "forward" | "reverse" | "unknown";
  maxSpeedKph: number | null;
  access: string | null;
  surface: string | null;
  bridge: boolean;
  tunnel: boolean;
  status: "active" | "suspected_change" | "under_review" | "accepted" | "rejected" | "published";
  confidence: number | null;
  sourceUpdatedAt: string | null;
  importedAt: string;
  lengthMeters: number;
  rawTags: Record<string, string>;
};

export type RoadEvidence = {
  id: string;
  roadSegmentId: string;
  type: "insar" | "landslide" | "field_photo" | "gps_trace" | "manual" | "topology_rule";
  sourceId: string;
  capturedAt: string | null;
  distanceMeters: number | null;
  confidence: number | null;
  summary: string;
  status: "candidate" | "confirmed" | "rejected" | "stale";
};

export type RoadIssue = {
  id: string;
  roadSegmentIds: string[];
  featureIds: string[];
  ruleCode: RoadRuleCode;
  ruleVersion: typeof ROADOPS_RULE_VERSION;
  category: RoadIssueCategory;
  severity: RoadIssueSeverity;
  title: string;
  description: string;
  evidenceIds: string[];
  evidence: Record<string, unknown>;
  suggestion: string;
  status: "candidate" | "needs_field_check" | "accepted" | "rejected" | "published";
  assignee: string | null;
  createdAt: string;
  reviewedAt: string | null;
  decisionNote: string | null;
};

export type RoadRiskEvidenceInput = {
  id: string;
  type: "insar" | "landslide" | "field_photo" | "gps_trace" | "manual";
  longitude: number;
  latitude: number;
  capturedAt?: string | null;
  confidence?: number | null;
  summary: string;
};

export const ROADOPS_RULE_VERSION = "roadops-quality-rules-v1" as const;
export const ROADOPS_RULE_CODES = ["R001", "R002", "R003", "R004", "R005", "R006", "R007", "R008", "R009", "R010"] as const;
export type RoadRuleCode = (typeof ROADOPS_RULE_CODES)[number];

export type RoadQualityParameters = {
  minimumLengthMeters: number;
  endpointBoundaryToleranceMeters: number;
  evidenceRadiusMeters: number;
  intersectionGridDegrees: number;
};

export const DEFAULT_ROAD_QUALITY_PARAMETERS: RoadQualityParameters = {
  minimumLengthMeters: 5,
  endpointBoundaryToleranceMeters: 16,
  evidenceRadiusMeters: 80,
  intersectionGridDegrees: 0.003,
};

export type RoadQualityReport = {
  schemaVersion: "roadops-quality-report-v1";
  ruleVersion: typeof ROADOPS_RULE_VERSION;
  datasetId: string;
  generatedAt: string;
  parameters: RoadQualityParameters;
  counts: {
    inputFeatures: number;
    normalizedSegments: number;
    nodes: number;
    evidences: number;
    ruleHits: number;
    issues: number;
    errors: number;
  };
  denominators: {
    geometryRules: number;
    topologyRules: number;
    attributeRules: number;
    riskEvidenceInputs: number;
  };
  ruleCounts: Record<RoadRuleCode, number>;
  severityCounts: Record<RoadIssueSeverity, number>;
  categoryCounts: Record<RoadIssueCategory, number>;
  nodes: RoadNode[];
  segments: RoadSegment[];
  evidences: RoadEvidence[];
  issues: RoadIssue[];
};

const RULE_META: Record<RoadRuleCode, { category: RoadIssueCategory; severity: RoadIssueSeverity; title: string; suggestion: string }> = {
  R001: { category: "geometry", severity: "high", title: "几何无效", suggestion: "返回源数据修复坐标或几何后重新入库。" },
  R002: { category: "geometry", severity: "medium", title: "极短或零长度路段", suggestion: "核对是否为重复节点、误切分或应与相邻路段合并。" },
  R003: { category: "geometry", severity: "medium", title: "重复道路几何", suggestion: "人工核对道路层级和来源，保留唯一有效对象。" },
  R004: { category: "topology", severity: "medium", title: "疑似悬挂端点", suggestion: "核对道路是否真实终止、被 AOI 裁剪或缺失连接。" },
  R005: { category: "topology", severity: "high", title: "相交未打断", suggestion: "核对桥隧关系；若为平面路口，应补充共享拓扑节点。" },
  R006: { category: "geometry", severity: "medium", title: "自相交或异常折返", suggestion: "人工检查采集轨迹与节点顺序，修正自交几何。" },
  R007: { category: "attribute", severity: "medium", title: "道路分类未知", suggestion: "根据现场、影像或合规来源补充准确 highway 分类。" },
  R008: { category: "attribute", severity: "low", title: "关键属性缺失", suggestion: "按道路等级补齐名称、限速、路面或方向信息；无法确认时保持空值。" },
  R009: { category: "topology", severity: "high", title: "单行方向冲突", suggestion: "核对相邻同名道路的 digitizing direction 与 oneway 标记。" },
  R010: { category: "risk", severity: "medium", title: "道路邻域高价值证据", suggestion: "进入人工审核；必要时转为外业核查候选，不直接形成安全结论。" },
};

const finitePosition = (value: unknown): value is Position => Array.isArray(value) && value.length >= 2
  && typeof value[0] === "number" && Number.isFinite(value[0]) && value[0] >= -180 && value[0] <= 180
  && typeof value[1] === "number" && Number.isFinite(value[1]) && value[1] >= -90 && value[1] <= 90;
const tag = (properties: Record<string, unknown>, key: string): string | null => {
  const value = properties[key];
  if (value === undefined || value === null || String(value).trim() === "") return null;
  return String(value).trim();
};
const rawTags = (properties: Record<string, unknown>) => Object.fromEntries(Object.entries(properties)
  .filter(([, value]) => ["string", "number", "boolean"].includes(typeof value))
  .map(([key, value]) => [key, String(value)]).sort(([a], [b]) => a.localeCompare(b)));
const coordinateKey = ([longitude, latitude]: Position) => `${longitude.toFixed(7)},${latitude.toFixed(7)}`;
const fnv1a = (value: string) => {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
};
const stableIssueId = (ruleCode: RoadRuleCode, objectIds: string[]) => `road-issue-${ruleCode.toLowerCase()}-${fnv1a([...objectIds].sort().join("|"))}`;
const toRadians = (degrees: number) => degrees * Math.PI / 180;
const haversineMeters = (a: Position, b: Position) => {
  const lat1 = toRadians(a[1]), lat2 = toRadians(b[1]);
  const dLat = lat2 - lat1, dLon = toRadians(b[0] - a[0]);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 6371008.8 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(Math.max(0, 1 - h)));
};
const lineLengthMeters = (coordinates: Position[]) => coordinates.slice(1).reduce((sum, point, index) => sum + haversineMeters(coordinates[index], point), 0);
const roadGroup = (highway: string): RoadSegment["roadGroup"] => {
  if (["motorway", "motorway_link", "trunk", "trunk_link"].includes(highway)) return "expressway";
  if (["primary", "primary_link", "secondary", "secondary_link"].includes(highway)) return "arterial";
  if (["tertiary", "tertiary_link", "unclassified"].includes(highway)) return "collector";
  if (["residential", "living_street"].includes(highway)) return "local";
  if (highway === "service") return "service";
  if (["pedestrian", "footway", "cycleway", "path"].includes(highway)) return "non_motor";
  return "unknown";
};
const direction = (value: string | null): RoadSegment["direction"] => {
  if (!value || ["no", "0", "false"].includes(value.toLowerCase())) return "both";
  if (["yes", "1", "true"].includes(value.toLowerCase())) return "forward";
  if (value === "-1" || value.toLowerCase() === "reverse") return "reverse";
  return "unknown";
};
const speedKph = (value: string | null) => {
  if (!value) return null;
  const number = Number.parseFloat(value.replace(",", "."));
  if (!Number.isFinite(number) || number <= 0) return null;
  return Math.round((/mph/i.test(value) ? number * 1.609344 : number) * 10) / 10;
};
const truthyOsm = (value: string | null) => Boolean(value && !["no", "0", "false"].includes(value.toLowerCase()));
const geometryParts = (feature: GisFeature): unknown[][] => feature.geometry.type === "LineString"
  ? [feature.geometry.coordinates]
  : feature.geometry.type === "MultiLineString" ? feature.geometry.coordinates : [];

const makeIssue = (ruleCode: RoadRuleCode, roadSegmentIds: string[], featureIds: string[], description: string, evidence: Record<string, unknown>, createdAt: string, overrides: Partial<Pick<RoadIssue, "severity" | "status">> = {}): RoadIssue => {
  const meta = RULE_META[ruleCode], ids = roadSegmentIds.length ? roadSegmentIds : featureIds;
  return {
    id: stableIssueId(ruleCode, ids), roadSegmentIds: [...roadSegmentIds].sort(), featureIds: [...featureIds].sort(), ruleCode,
    ruleVersion: ROADOPS_RULE_VERSION, category: meta.category, severity: overrides.severity ?? meta.severity,
    title: meta.title, description, evidenceIds: [], evidence, suggestion: meta.suggestion,
    status: overrides.status ?? (ruleCode === "R010" ? "needs_field_check" : "candidate"), assignee: null,
    createdAt, reviewedAt: null, decisionNote: null,
  };
};

const normalizeSegments = (layer: GisLayer, createdAt: string) => {
  const segments: RoadSegment[] = [], issues: RoadIssue[] = [];
  for (const feature of [...layer.features].sort((a, b) => a.id.localeCompare(b.id))) {
    const parts = geometryParts(feature);
    if (!parts.length) {
      issues.push(makeIssue("R001", [], [feature.id], "道路对象不是 LineString 或 MultiLineString。", { geometryType: feature.geometry.type }, createdAt));
      continue;
    }
    parts.forEach((part, partIndex) => {
      if (!Array.isArray(part) || part.length < 2 || !part.every(finitePosition)) {
        issues.push(makeIssue("R001", [], [feature.id], "道路几何为空、坐标非法或有效点少于 2 个。", { partIndex, coordinateCount: Array.isArray(part) ? part.length : 0 }, createdAt));
        return;
      }
      const coordinates = part as Position[], properties = feature.properties ?? {}, highway = tag(properties, "highway") ?? "unknown";
      const id = parts.length === 1 ? feature.id : `${feature.id}#${partIndex + 1}`;
      segments.push({
        id, featureId: feature.id, source: layer.provenance?.kind === "osm" ? "osm" : "user",
        sourceId: tag(properties, "osm_id") ?? feature.id, sourceVersion: tag(properties, "version"),
        geometry: { type: "LineString", coordinates: coordinates.map(point => [point[0], point[1]]) },
        startNodeId: `road-node-${coordinateKey(coordinates[0])}`, endNodeId: `road-node-${coordinateKey(coordinates.at(-1)!)}`,
        name: tag(properties, "name"), reference: tag(properties, "ref"), roadClass: highway, roadGroup: roadGroup(highway),
        direction: direction(tag(properties, "oneway")), maxSpeedKph: speedKph(tag(properties, "maxspeed")),
        access: tag(properties, "motor_vehicle") ?? tag(properties, "access"), surface: tag(properties, "surface"),
        bridge: truthyOsm(tag(properties, "bridge")), tunnel: truthyOsm(tag(properties, "tunnel")), status: "active",
        confidence: null, sourceUpdatedAt: tag(properties, "timestamp"), importedAt: createdAt,
        lengthMeters: lineLengthMeters(coordinates), rawTags: rawTags(properties),
      });
    });
  }
  return { segments, issues };
};

const buildNodes = (segments: RoadSegment[]) => {
  const map = new Map<string, RoadNode>();
  for (const segment of segments) {
    segment.geometry.coordinates.forEach(([longitude, latitude]) => {
      const id = `road-node-${coordinateKey([longitude, latitude])}`;
      const existing = map.get(id);
      if (existing) existing.connectedSegmentIds.push(segment.id);
      else map.set(id, { id, longitude, latitude, source: "derived", sourceId: null, connectedSegmentIds: [segment.id] });
    });
  }
  return [...map.values()].map(node => ({ ...node, connectedSegmentIds: [...new Set(node.connectedSegmentIds)].sort() })).sort((a, b) => a.id.localeCompare(b.id));
};

const canonicalGeometry = (coordinates: Position[]) => {
  const forward = coordinates.map(coordinateKey).join(";");
  const reverse = [...coordinates].reverse().map(coordinateKey).join(";");
  return forward < reverse ? forward : reverse;
};
const segmentBounds = (segment: RoadSegment): GisBounds => segment.geometry.coordinates.reduce<GisBounds>((bounds, [longitude, latitude]) => ({
  west: Math.min(bounds.west, longitude), south: Math.min(bounds.south, latitude), east: Math.max(bounds.east, longitude), north: Math.max(bounds.north, latitude),
}), { west: Infinity, south: Infinity, east: -Infinity, north: -Infinity });
const boundsOverlap = (a: GisBounds, b: GisBounds) => a.west <= b.east && a.east >= b.west && a.south <= b.north && a.north >= b.south;
const orientation = (a: Position, b: Position, c: Position) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
const properIntersection = (a: Position, b: Position, c: Position, d: Position) => {
  const o1 = orientation(a, b, c), o2 = orientation(a, b, d), o3 = orientation(c, d, a), o4 = orientation(c, d, b), epsilon = 1e-12;
  return ((o1 > epsilon && o2 < -epsilon) || (o1 < -epsilon && o2 > epsilon)) && ((o3 > epsilon && o4 < -epsilon) || (o3 < -epsilon && o4 > epsilon));
};
const linesCross = (a: RoadSegment, b: RoadSegment) => {
  const aCoords = a.geometry.coordinates, bCoords = b.geometry.coordinates;
  for (let ai = 1; ai < aCoords.length; ai += 1) for (let bi = 1; bi < bCoords.length; bi += 1) {
    if (properIntersection(aCoords[ai - 1], aCoords[ai], bCoords[bi - 1], bCoords[bi])) return true;
  }
  return false;
};
const selfIntersects = (segment: RoadSegment) => {
  const points = segment.geometry.coordinates;
  for (let left = 1; left < points.length; left += 1) for (let right = left + 2; right < points.length; right += 1) {
    if (left === 1 && right === points.length - 1 && coordinateKey(points[0]) === coordinateKey(points.at(-1)!)) continue;
    if (properIntersection(points[left - 1], points[left], points[right - 1], points[right])) return true;
  }
  return false;
};
const candidatePairs = (segments: RoadSegment[], cellSize: number) => {
  const cells = new Map<string, number[]>(), bounds = segments.map(segmentBounds);
  bounds.forEach((box, index) => {
    const x0 = Math.floor(box.west / cellSize), x1 = Math.floor(box.east / cellSize), y0 = Math.floor(box.south / cellSize), y1 = Math.floor(box.north / cellSize);
    for (let x = x0; x <= x1; x += 1) for (let y = y0; y <= y1; y += 1) {
      const key = `${x}:${y}`, values = cells.get(key) ?? [];
      values.push(index); cells.set(key, values);
    }
  });
  const keys = new Set<string>();
  for (const indices of cells.values()) for (let left = 0; left < indices.length; left += 1) for (let right = left + 1; right < indices.length; right += 1) {
    const a = Math.min(indices[left], indices[right]), b = Math.max(indices[left], indices[right]);
    if (a !== b && boundsOverlap(bounds[a], bounds[b])) keys.add(`${a}:${b}`);
  }
  return [...keys].sort((a, b) => a.localeCompare(b)).map(key => key.split(":").map(Number) as [number, number]);
};
const nearBoundary = (point: Position, bounds: GisBounds | null, toleranceMeters: number) => {
  if (!bounds) return false;
  const horizontal = Math.min(haversineMeters(point, [bounds.west, point[1]]), haversineMeters(point, [bounds.east, point[1]]));
  const vertical = Math.min(haversineMeters(point, [point[0], bounds.south]), haversineMeters(point, [point[0], bounds.north]));
  return Math.min(horizontal, vertical) <= toleranceMeters;
};
const pointSegmentMeters = (point: Position, a: Position, b: Position) => {
  const latitude = toRadians(point[1]), scaleX = 111320 * Math.cos(latitude), scaleY = 110540;
  const px = 0, py = 0, ax = (a[0] - point[0]) * scaleX, ay = (a[1] - point[1]) * scaleY, bx = (b[0] - point[0]) * scaleX, by = (b[1] - point[1]) * scaleY;
  const dx = bx - ax, dy = by - ay, denominator = dx * dx + dy * dy;
  const t = denominator ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / denominator)) : 0;
  return Math.hypot(ax + t * dx, ay + t * dy);
};
const pointLineMeters = (point: Position, segment: RoadSegment) => segment.geometry.coordinates.slice(1).reduce((minimum, b, index) => Math.min(minimum, pointSegmentMeters(point, segment.geometry.coordinates[index], b)), Infinity);
const sameRoadKey = (segment: RoadSegment) => segment.reference || segment.name || "";
const directionRole = (segment: RoadSegment, nodeId: string) => {
  if (segment.direction === "forward") return nodeId === segment.startNodeId ? "out" : "in";
  if (segment.direction === "reverse") return nodeId === segment.startNodeId ? "in" : "out";
  return "both";
};

export function buildRoadQualityReport(layer: GisLayer, riskInputs: RoadRiskEvidenceInput[] = [], overrides: Partial<RoadQualityParameters> = {}): RoadQualityReport {
  const parameters = { ...DEFAULT_ROAD_QUALITY_PARAMETERS, ...overrides };
  const generatedAt = layer.importedAt || "1970-01-01T00:00:00.000Z";
  const normalized = normalizeSegments(layer, generatedAt), segments = normalized.segments.sort((a, b) => a.id.localeCompare(b.id)), nodes = buildNodes(segments);
  const issues: RoadIssue[] = [...normalized.issues], evidences: RoadEvidence[] = [];
  const segmentById = new Map(segments.map(segment => [segment.id, segment]));
  const endpointNodeIds = new Set(segments.flatMap(segment => [segment.startNodeId, segment.endNodeId]));

  segments.filter(segment => segment.lengthMeters <= parameters.minimumLengthMeters).forEach(segment => issues.push(makeIssue("R002", [segment.id], [segment.featureId], `路段长度 ${segment.lengthMeters.toFixed(2)} m，不高于阈值 ${parameters.minimumLengthMeters} m。`, { lengthMeters: segment.lengthMeters, thresholdMeters: parameters.minimumLengthMeters }, generatedAt)));

  const duplicates = new Map<string, RoadSegment[]>();
  segments.forEach(segment => { const key = canonicalGeometry(segment.geometry.coordinates), values = duplicates.get(key) ?? []; values.push(segment); duplicates.set(key, values); });
  [...duplicates.values()].filter(group => group.length > 1).forEach(group => issues.push(makeIssue("R003", group.map(item => item.id), group.map(item => item.featureId), `${group.length} 条道路拥有相同或反向完全一致的几何。`, { duplicateCount: group.length }, generatedAt)));

  nodes.filter(node => endpointNodeIds.has(node.id) && node.connectedSegmentIds.length === 1).forEach(node => {
    const segment = segmentById.get(node.connectedSegmentIds[0]);
    if (!segment || ["local", "service"].includes(segment.roadGroup) || nearBoundary([node.longitude, node.latitude], layer.bounds, parameters.endpointBoundaryToleranceMeters)) return;
    issues.push(makeIssue("R004", [segment.id], [segment.featureId], `节点 ${node.id} 仅连接 1 条非支路道路，且不位于 AOI 裁剪边界。`, { nodeId: node.id, degree: 1 }, generatedAt));
  });

  for (const [leftIndex, rightIndex] of candidatePairs(segments, parameters.intersectionGridDegrees)) {
    const left = segments[leftIndex], right = segments[rightIndex];
    const sharedCoordinates = new Set(left.geometry.coordinates.map(coordinateKey));
    if (right.geometry.coordinates.some(point => sharedCoordinates.has(coordinateKey(point)))) continue;
    if (left.bridge || left.tunnel || right.bridge || right.tunnel || !linesCross(left, right)) continue;
    issues.push(makeIssue("R005", [left.id, right.id], [left.featureId, right.featureId], "两条道路几何发生平面相交，但坐标序列中没有共享拓扑节点。", { bridgeOrTunnelExcluded: true }, generatedAt));
  }

  segments.filter(selfIntersects).forEach(segment => issues.push(makeIssue("R006", [segment.id], [segment.featureId], "道路坐标序列存在非相邻线段自相交。", { coordinateCount: segment.geometry.coordinates.length }, generatedAt)));
  segments.filter(segment => segment.roadClass === "road" || segment.roadGroup === "unknown").forEach(segment => issues.push(makeIssue("R007", [segment.id], [segment.featureId], `highway=${segment.roadClass} 无法映射为明确的产品道路分类。`, { highway: segment.roadClass }, generatedAt, { severity: segment.roadClass === "road" ? "medium" : "low" })));
  segments.forEach(segment => {
    const missing: string[] = [];
    if (["arterial", "collector", "local"].includes(segment.roadGroup) && !segment.name && !segment.reference) missing.push("name/ref");
    if (["expressway", "arterial"].includes(segment.roadGroup) && segment.maxSpeedKph === null) missing.push("maxspeed");
    if (["local", "service"].includes(segment.roadGroup) && !segment.surface) missing.push("surface");
    if (segment.direction === "unknown") missing.push("oneway(valid)");
    if (missing.length) issues.push(makeIssue("R008", [segment.id], [segment.featureId], `关键属性缺失或无效：${missing.join("、")}。`, { missingFields: missing, roadGroup: segment.roadGroup }, generatedAt));
  });

  nodes.forEach(node => {
    const connected = node.connectedSegmentIds.map(id => segmentById.get(id)).filter((item): item is RoadSegment => Boolean(item));
    if (connected.length !== 2 || connected.some(segment => !["forward", "reverse"].includes(segment.direction))) return;
    const roadKey = sameRoadKey(connected[0]);
    if (!roadKey || roadKey !== sameRoadKey(connected[1])) return;
    const roles = connected.map(segment => directionRole(segment, node.id));
    if (roles[0] === roles[1]) issues.push(makeIssue("R009", connected.map(item => item.id), connected.map(item => item.featureId), `同名/同编号的两条单行路在节点 ${node.id} 同时流入或同时流出。`, { nodeId: node.id, directionRole: roles[0], roadKey }, generatedAt));
  });

  [...riskInputs].sort((a, b) => a.id.localeCompare(b.id)).forEach(input => {
    if (!Number.isFinite(input.longitude) || !Number.isFinite(input.latitude) || !segments.length) return;
    let nearest: RoadSegment | null = null, distance = Infinity;
    segments.forEach(segment => { const candidate = pointLineMeters([input.longitude, input.latitude], segment); if (candidate < distance) { distance = candidate; nearest = segment; } });
    if (!nearest || distance > parameters.evidenceRadiusMeters) return;
    const segment = nearest as RoadSegment;
    const evidence: RoadEvidence = { id: `road-evidence-${fnv1a(`${input.type}|${input.id}|${segment.id}`)}`, roadSegmentId: segment.id, type: input.type, sourceId: input.id, capturedAt: input.capturedAt ?? null, distanceMeters: Math.round(distance * 10) / 10, confidence: input.confidence ?? null, summary: input.summary, status: "candidate" };
    evidences.push(evidence);
    const issue = makeIssue("R010", [segment.id], [segment.featureId], `${input.type} 证据距道路约 ${evidence.distanceMeters} m：${input.summary}`, { evidenceType: input.type, sourceId: input.id, distanceMeters: evidence.distanceMeters, confidence: evidence.confidence }, generatedAt);
    issue.evidenceIds = [evidence.id]; issues.push(issue);
  });

  // IDs represent a rule + road object set. Multiple endpoints or source
  // observations belong to that same work order; keep every observation while
  // preserving its existing ID and locally saved review state.
  const issueGroups = new Map<string, RoadIssue[]>();
  for (const issue of issues) {
    const group = issueGroups.get(issue.id) ?? [];
    group.push(issue); issueGroups.set(issue.id, group);
  }
  const orderedIssues = [...issueGroups.values()].map(group => {
    const first = group[0];
    if (group.length === 1) return first;
    return {
      ...first,
      description: [...new Set(group.map(issue => issue.description))].join("；"),
      evidenceIds: [...new Set(group.flatMap(issue => issue.evidenceIds))].sort(),
      evidence: { ...first.evidence, observationCount: group.length, observations: group.map(issue => ({ description: issue.description, evidence: issue.evidence, evidenceIds: issue.evidenceIds })) },
    };
  }).sort((a, b) => a.ruleCode.localeCompare(b.ruleCode) || a.id.localeCompare(b.id));
  const ruleCounts = Object.fromEntries(ROADOPS_RULE_CODES.map(code => [code, orderedIssues.filter(issue => issue.ruleCode === code).length])) as Record<RoadRuleCode, number>;
  const severityCounts = Object.fromEntries((["high", "medium", "low"] as const).map(severity => [severity, orderedIssues.filter(issue => issue.severity === severity).length])) as Record<RoadIssueSeverity, number>;
  const categoryCounts = Object.fromEntries((["geometry", "topology", "attribute", "risk"] as const).map(category => [category, orderedIssues.filter(issue => issue.category === category).length])) as Record<RoadIssueCategory, number>;
  return {
    schemaVersion: "roadops-quality-report-v1", ruleVersion: ROADOPS_RULE_VERSION, datasetId: layer.id, generatedAt, parameters,
    counts: { inputFeatures: layer.features.length, normalizedSegments: segments.length, nodes: nodes.length, evidences: evidences.length, ruleHits: issues.length, issues: orderedIssues.length, errors: normalized.issues.length },
    denominators: { geometryRules: layer.features.length, topologyRules: segments.length, attributeRules: segments.length, riskEvidenceInputs: riskInputs.length },
    ruleCounts, severityCounts, categoryCounts, nodes, segments, evidences: evidences.sort((a, b) => a.id.localeCompare(b.id)), issues: orderedIssues,
  };
}

const csvCell = (value: unknown) => `"${String(value ?? "").replaceAll('"', '""')}"`;
export function roadQualityReportToCsv(report: RoadQualityReport) {
  const headers = ["issue_id", "rule_code", "rule_version", "category", "severity", "status", "segment_ids", "feature_ids", "title", "description", "evidence_ids", "suggestion", "created_at"];
  const rows = report.issues.map(issue => [issue.id, issue.ruleCode, issue.ruleVersion, issue.category, issue.severity, issue.status, issue.roadSegmentIds.join("|"), issue.featureIds.join("|"), issue.title, issue.description, issue.evidenceIds.join("|"), issue.suggestion, issue.createdAt]);
  return [headers, ...rows].map(row => row.map(csvCell).join(",")).join("\r\n") + "\r\n";
}

export function roadQualityReportToJson(report: RoadQualityReport) {
  return JSON.stringify(report, null, 2) + "\n";
}

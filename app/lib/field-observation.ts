import type { InsarPoint } from "../data/site";

export type FieldCoordinateSource = "exif" | "watermark" | "manual" | "map-center" | "csv";
export type PhotoCoordinateSource = "exif" | "watermark" | null;
export type InsarLinkStatus = "candidate" | "confirmed-primary" | "confirmed-secondary" | "rejected" | "stale";

export type ObservationPhoto = {
  id: string;
  name: string;
  photoUrl: string;
  blob?: Blob;
  capturedAt: string | null;
  note: string;
  exifLongitude: number | null;
  exifLatitude: number | null;
  coordinateSource: PhotoCoordinateSource;
  coordinateConfidence: number | null;
  coordinateConflict: boolean;
};

export type InsarLink = {
  datasetId: string;
  insarPointId: string;
  distanceMeters: number;
  radiusMeters: number;
  status: InsarLinkStatus;
  confirmedAt: string | null;
};

export type FieldObservation = {
  id: string;
  name: string;
  longitude: number;
  latitude: number;
  capturedAt: string | null;
  note: string;
  coordinateSource: FieldCoordinateSource;
  accuracyMeters: number | null;
  photos: ObservationPhoto[];
  links: InsarLink[];
  associationRadiusMeters: number;
  createdAt: string;
  updatedAt: string;
};

export type NewObservationPhoto = {
  file: File;
  capturedAt: string | null;
  note?: string;
  exifLongitude: number | null;
  exifLatitude: number | null;
  coordinateSource: PhotoCoordinateSource;
  coordinateConfidence: number | null;
};

export type NewFieldObservationInput = {
  name: string;
  longitude: number;
  latitude: number;
  capturedAt: string | null;
  note: string;
  coordinateSource: FieldCoordinateSource;
  photos: NewObservationPhoto[];
};

export type PhotoExifMetadata = {
  longitude: number | null;
  latitude: number | null;
  altitude: number | null;
  capturedAt: string | null;
};

export type InsarCandidate<T extends { id: string; lon: number; lat: number } = InsarPoint> = {
  point: T;
  distanceMeters: number;
  status: InsarLinkStatus;
};

export type FieldVisitCsvRow = {
  visitId: string;
  visitName: string;
  fileName: string;
  longitude: number;
  latitude: number;
  capturedAt: string | null;
  note: string;
};

const typeSize: Record<number, number> = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 7: 1, 9: 4, 10: 8 };

export async function readPhotoExif(file: File): Promise<PhotoExifMetadata> {
  const empty = { longitude: null, latitude: null, altitude: null, capturedAt: null };
  if (!/jpe?g/i.test(file.type) && !/\.jpe?g$/i.test(file.name)) return empty;
  try {
    const buffer = await file.arrayBuffer();
    const view = new DataView(buffer);
    if (view.byteLength < 12 || view.getUint16(0, false) !== 0xffd8) return empty;
    let segment = 2;
    while (segment + 4 < view.byteLength) {
      if (view.getUint8(segment) !== 0xff) break;
      const marker = view.getUint8(segment + 1);
      if (marker === 0xda || marker === 0xd9) break;
      const length = view.getUint16(segment + 2, false);
      if (marker === 0xe1 && length >= 8 && segment + 2 + length <= view.byteLength) {
        const header = String.fromCharCode(...new Uint8Array(buffer, segment + 4, 6));
        if (header === "Exif\0\0") return parseTiffExif(view, segment + 10);
      }
      segment += 2 + length;
    }
    return empty;
  } catch {
    return empty;
  }
}

function parseTiffExif(view: DataView, tiffStart: number): PhotoExifMetadata {
  const empty = { longitude: null, latitude: null, altitude: null, capturedAt: null };
  if (tiffStart + 8 > view.byteLength) return empty;
  const byteOrder = view.getUint16(tiffStart, false);
  const little = byteOrder === 0x4949;
  if (!little && byteOrder !== 0x4d4d) return empty;
  const get16 = (offset: number) => view.getUint16(offset, little);
  const get32 = (offset: number) => view.getUint32(offset, little);
  const valueOffset = (entry: number, type: number, count: number) => (typeSize[type] || 1) * count <= 4 ? entry + 8 : tiffStart + get32(entry + 8);
  const entries = (ifd: number) => {
    const found = new Map<number, { entry: number; type: number; count: number }>();
    if (ifd < tiffStart || ifd + 2 > view.byteLength) return found;
    const count = get16(ifd);
    for (let index = 0; index < count; index += 1) {
      const entry = ifd + 2 + index * 12;
      if (entry + 12 > view.byteLength) break;
      found.set(get16(entry), { entry, type: get16(entry + 2), count: get32(entry + 4) });
    }
    return found;
  };
  const ascii = (record: { entry: number; type: number; count: number } | undefined) => {
    if (!record) return "";
    const start = valueOffset(record.entry, record.type, record.count);
    if (start < 0 || start + record.count > view.byteLength) return "";
    return String.fromCharCode(...new Uint8Array(view.buffer, start, record.count)).replace(/\0+$/, "").trim();
  };
  const rationals = (record: { entry: number; type: number; count: number } | undefined) => {
    if (!record || record.type !== 5) return [];
    const start = valueOffset(record.entry, record.type, record.count);
    const values: number[] = [];
    for (let index = 0; index < record.count; index += 1) {
      const offset = start + index * 8;
      if (offset + 8 > view.byteLength) break;
      const denominator = get32(offset + 4);
      values.push(denominator ? get32(offset) / denominator : 0);
    }
    return values;
  };
  const ifd0 = entries(tiffStart + get32(tiffStart + 4));
  let capturedAt: string | null = null;
  const exifPointer = ifd0.get(0x8769);
  if (exifPointer) {
    const exifIfd = entries(tiffStart + get32(exifPointer.entry + 8));
    capturedAt = ascii(exifIfd.get(0x9003)) || ascii(exifIfd.get(0x9004)) || null;
  }
  const gpsPointer = ifd0.get(0x8825);
  if (!gpsPointer) return { ...empty, capturedAt };
  const gps = entries(tiffStart + get32(gpsPointer.entry + 8));
  const latitudeParts = rationals(gps.get(2));
  const longitudeParts = rationals(gps.get(4));
  if (latitudeParts.length < 3 || longitudeParts.length < 3) return { ...empty, capturedAt };
  const decimal = (parts: number[]) => parts[0] + parts[1] / 60 + parts[2] / 3600;
  const latitudeRef = ascii(gps.get(1)).toUpperCase();
  const longitudeRef = ascii(gps.get(3)).toUpperCase();
  const altitudeValues = rationals(gps.get(6));
  const altitudeRef = gps.get(5);
  const altitudeOffset = altitudeRef ? valueOffset(altitudeRef.entry, altitudeRef.type, altitudeRef.count) : -1;
  const altitudeSign = altitudeOffset >= 0 && altitudeOffset < view.byteLength && view.getUint8(altitudeOffset) === 1 ? -1 : 1;
  return {
    latitude: decimal(latitudeParts) * (latitudeRef === "S" ? -1 : 1),
    longitude: decimal(longitudeParts) * (longitudeRef === "W" ? -1 : 1),
    altitude: altitudeValues.length ? altitudeValues[0] * altitudeSign : null,
    capturedAt,
  };
}

export function distanceMeters(a: { longitude: number; latitude: number }, b: { longitude: number; latitude: number }) {
  const toRadians = (value: number) => value * Math.PI / 180;
  const latitudeDelta = toRadians(b.latitude - a.latitude);
  const longitudeDelta = toRadians(b.longitude - a.longitude);
  const latitudeA = toRadians(a.latitude);
  const latitudeB = toRadians(b.latitude);
  const h = Math.sin(latitudeDelta / 2) ** 2 + Math.cos(latitudeA) * Math.cos(latitudeB) * Math.sin(longitudeDelta / 2) ** 2;
  return 6_371_008.8 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(Math.max(0, 1 - h)));
}

export function nearestInsarPoint<T extends { id: string; lon: number; lat: number }>(observation: Pick<FieldObservation, "longitude" | "latitude">, points: T[]) {
  return insarCandidates(observation, points, Number.POSITIVE_INFINITY)[0] ?? null;
}

export function insarCandidates<T extends { id: string; lon: number; lat: number }>(
  observation: Pick<FieldObservation, "longitude" | "latitude" | "links">,
  points: T[],
  radiusMeters = 500,
  datasetId = "",
): InsarCandidate<T>[] {
  return points
    .map(point => {
      const distance = distanceMeters(observation, { longitude: point.lon, latitude: point.lat });
      const link = observation.links?.find(item => item.datasetId === datasetId && item.insarPointId === point.id);
      return { point, distanceMeters: distance, status: link?.status ?? "candidate" as InsarLinkStatus };
    })
    .filter(item => item.distanceMeters <= radiusMeters)
    .sort((a, b) => a.distanceMeters - b.distanceMeters || a.point.id.localeCompare(b.point.id));
}

export function primaryInsarPoint<T extends { id: string; lon: number; lat: number }>(
  observation: FieldObservation,
  points: T[],
  datasetId: string,
): InsarCandidate<T> | null {
  const link = observation.links.find(item => item.datasetId === datasetId && item.status === "confirmed-primary");
  if (!link) return null;
  const point = points.find(item => item.id === link.insarPointId);
  if (!point) return null;
  return { point, distanceMeters: distanceMeters(observation, { longitude: point.lon, latitude: point.lat }), status: link.status };
}

export function confirmPrimaryInsarLink(observation: FieldObservation, datasetId: string, point: { id: string; lon: number; lat: number }, radiusMeters: number) {
  const now = new Date().toISOString();
  const distance = distanceMeters(observation, { longitude: point.lon, latitude: point.lat });
  const links = observation.links
    .filter(link => !(link.datasetId === datasetId && link.insarPointId === point.id))
    .map(link => link.datasetId === datasetId && link.status === "confirmed-primary" ? { ...link, status: "confirmed-secondary" as const } : link);
  links.push({ datasetId, insarPointId: point.id, distanceMeters: distance, radiusMeters, status: "confirmed-primary", confirmedAt: now });
  return { ...observation, links, associationRadiusMeters: radiusMeters, updatedAt: now };
}

export function rejectInsarLink(observation: FieldObservation, datasetId: string, point: { id: string; lon: number; lat: number }, radiusMeters: number) {
  const now = new Date().toISOString();
  const links = observation.links.filter(link => !(link.datasetId === datasetId && link.insarPointId === point.id));
  links.push({ datasetId, insarPointId: point.id, distanceMeters: distanceMeters(observation, { longitude: point.lon, latitude: point.lat }), radiusMeters, status: "rejected", confirmedAt: now });
  return { ...observation, links, updatedAt: now };
}

export function reconcileInsarLinks(observation: FieldObservation, datasetId: string, pointIds: Set<string>) {
  let changed = false;
  const links = observation.links.map(link => {
    if (link.status === "stale") return link;
    if (link.datasetId !== datasetId || !pointIds.has(link.insarPointId)) {
      changed = true;
      return { ...link, status: "stale" as const };
    }
    return link;
  });
  return changed ? { ...observation, links, updatedAt: new Date().toISOString() } : observation;
}

export function photoCoordinateConflict(photo: Pick<ObservationPhoto, "exifLongitude" | "exifLatitude">, observation: Pick<FieldObservation, "longitude" | "latitude">, thresholdMeters = 50) {
  if (photo.exifLongitude === null || photo.exifLatitude === null) return false;
  return distanceMeters(observation, { longitude: photo.exifLongitude, latitude: photo.exifLatitude }) > thresholdMeters;
}

export function parseFieldVisitCsv(text: string): FieldVisitCsvRow[] {
  const rows = text.replace(/^\uFEFF/, "").split(/\r?\n/).filter(line => line.trim());
  if (rows.length < 2) return [];
  const headers = rows[0].split(",").map(value => value.trim().toLowerCase());
  const index = (name: string) => headers.indexOf(name);
  const required = ["visit_id", "file_name", "longitude", "latitude"];
  if (required.some(name => index(name) < 0)) throw new Error("CSV 缺少 visit_id、file_name、longitude 或 latitude 字段。");
  return rows.slice(1).map((line, rowIndex) => {
    const values = line.split(",").map(value => value.trim());
    const longitude = Number(values[index("longitude")]);
    const latitude = Number(values[index("latitude")]);
    if (!Number.isFinite(longitude) || !Number.isFinite(latitude) || Math.abs(longitude) > 180 || Math.abs(latitude) > 90) throw new Error(`CSV 第 ${rowIndex + 2} 行坐标无效。`);
    return {
      visitId: values[index("visit_id")],
      visitName: index("visit_name") >= 0 ? values[index("visit_name")] : values[index("visit_id")],
      fileName: values[index("file_name")],
      longitude,
      latitude,
      capturedAt: index("captured_at") >= 0 ? values[index("captured_at")] || null : null,
      note: index("note") >= 0 ? values[index("note")] : "",
    };
  });
}

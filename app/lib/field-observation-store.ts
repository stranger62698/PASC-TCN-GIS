import type { FieldObservation, ObservationPhoto } from "./field-observation";

const DATABASE_NAME = "lanjifyw-field-observations";
const DATABASE_VERSION = 1;
const STORE_NAME = "visits";

type StoredPhoto = Omit<ObservationPhoto, "photoUrl"> & { blob: Blob };
type StoredObservation = Omit<FieldObservation, "photos"> & { photos: StoredPhoto[] };

function openDatabase() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(STORE_NAME)) database.createObjectStore(STORE_NAME, { keyPath: "id" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("现场资料本地数据库不可用。"));
  });
}

function transactionDone(transaction: IDBTransaction) {
  return new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error("现场资料保存失败。"));
    transaction.onabort = () => reject(transaction.error ?? new Error("现场资料保存被中止。"));
  });
}

async function photoBlob(photo: ObservationPhoto) {
  if (photo.blob) return photo.blob;
  const response = await fetch(photo.photoUrl);
  if (!response.ok) throw new Error(`无法读取照片 ${photo.name}。`);
  return response.blob();
}

export async function loadFieldObservations(): Promise<FieldObservation[]> {
  if (typeof indexedDB === "undefined") return [];
  const database = await openDatabase();
  try {
    const transaction = database.transaction(STORE_NAME, "readonly");
    const completed = transactionDone(transaction);
    const request = transaction.objectStore(STORE_NAME).getAll();
    const records = await new Promise<StoredObservation[]>((resolve, reject) => {
      request.onsuccess = () => resolve(request.result as StoredObservation[]);
      request.onerror = () => reject(request.error ?? new Error("现场资料读取失败。"));
    });
    await completed;
    return records.map(record => ({
      ...record,
      photos: record.photos.map(photo => ({ ...photo, coordinateSource: photo.coordinateSource ?? (photo.exifLongitude !== null ? "exif" : null), coordinateConfidence: photo.coordinateConfidence ?? null, blob: photo.blob, photoUrl: URL.createObjectURL(photo.blob) })),
    }));
  } finally {
    database.close();
  }
}

export async function saveFieldObservations(observations: FieldObservation[]) {
  if (typeof indexedDB === "undefined") return;
  const records: StoredObservation[] = await Promise.all(observations.map(async observation => ({
    ...observation,
    photos: await Promise.all(observation.photos.map(async photo => ({
      id: photo.id,
      name: photo.name,
      blob: await photoBlob(photo),
      capturedAt: photo.capturedAt,
      note: photo.note,
      exifLongitude: photo.exifLongitude,
      exifLatitude: photo.exifLatitude,
      coordinateSource: photo.coordinateSource ?? (photo.exifLongitude !== null ? "exif" : null),
      coordinateConfidence: photo.coordinateConfidence ?? null,
      coordinateConflict: photo.coordinateConflict,
    }))),
  })));
  const database = await openDatabase();
  try {
    const transaction = database.transaction(STORE_NAME, "readwrite");
    const completed = transactionDone(transaction);
    const store = transaction.objectStore(STORE_NAME);
    store.clear();
    records.forEach(record => store.put(record));
    await completed;
  } finally {
    database.close();
  }
}

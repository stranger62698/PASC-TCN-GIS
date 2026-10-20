/** Empty form fields are missing coordinates; an explicitly entered zero is valid. */
export function parseFieldDraftCoordinates(longitude: string, latitude: string): { longitude: number; latitude: number } | null {
  if (!longitude.trim() || !latitude.trim()) return null;
  const lon = Number(longitude), lat = Number(latitude);
  if (!Number.isFinite(lon) || !Number.isFinite(lat) || lon < -180 || lon > 180 || lat < -90 || lat > 90) return null;
  return { longitude: lon, latitude: lat };
}

/** Own draft previews independently of metadata updates and invalidate superseded reads. */
export function createFieldPhotoDraftLifecycle(revokePreview: (url: string) => void = url => URL.revokeObjectURL(url)) {
  let generation = 0;
  let previewUrls = new Set<string>();
  const replacePreviewUrls = (urls: Iterable<string>) => {
    const next = new Set(urls);
    for (const url of previewUrls) if (!next.has(url)) revokePreview(url);
    previewUrls = next;
  };
  return {
    beginRead: () => ++generation,
    isCurrentRead: (run: number) => run === generation,
    replacePreviewUrls,
    clear: () => { generation += 1; replacePreviewUrls([]); },
  };
}

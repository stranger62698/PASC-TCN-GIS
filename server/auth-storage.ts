import { BlobError, BlobPreconditionFailedError, get, put } from "@vercel/blob";

export type AuthStore = {
  read(path: string): Promise<{ value: unknown; etag: string } | null>;
  compareAndSwap(path: string, etag: string | null, value: unknown): Promise<boolean>;
};

/** Only account metadata and one fixed authentication counter live here. */
export function createAuthStore(io: { get: typeof get; put: typeof put } = { get, put }): AuthStore {
  return {
    async read(path) {
      const result = await io.get(path, { access: "private", useCache: false, abortSignal: AbortSignal.timeout(8_000) });
      if (!result) return null;
      if (result.statusCode !== 200 || !result.stream || !result.blob.etag || (result.blob.size ?? 0) > 16_384) throw new Error("Invalid auth storage response");
      const text = await new Response(result.stream).text();
      if (Buffer.byteLength(text, "utf8") > 16_384) throw new Error("Auth metadata too large");
      return { value: JSON.parse(text) as unknown, etag: result.blob.etag };
    },
    async compareAndSwap(path, etag, value) {
      try {
        await io.put(path, JSON.stringify(value), {
          access: "private", addRandomSuffix: false, contentType: "application/json", cacheControlMaxAge: 60,
          // Creation must never replace an existing account/counter. Updates
          // require its exact revision; unknown failures never authorize a retry.
          allowOverwrite: etag !== null, ...(etag !== null ? { ifMatch: etag } : {}),
          abortSignal: AbortSignal.timeout(8_000),
        });
        return true;
      } catch (error) {
        if (error instanceof BlobPreconditionFailedError) return false;
        if (etag === null && error instanceof BlobError && /\balready exists\b/i.test(error.message)) return false;
        throw error;
      }
    },
  };
}

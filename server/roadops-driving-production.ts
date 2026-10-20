import { BlobPreconditionFailedError, get, put } from "@vercel/blob";
import { createRoadOpsDrivingService, type RoadOpsDrivingService } from "../app/lib/roadops-driving-server.js";
import { createSharedRoadOpsQuota, type SharedQuotaStore } from "../app/lib/roadops-shared-quota.js";

export const ROADOPS_PRODUCTION_LEDGER_PATH = "roadops/quota/driving-v1.json";
const STORE_TIMEOUT_MS = 8_000;
const MAX_LEDGER_BYTES = 24_000;

/** This path is provisioned once before enabling the supplier key. A missing
 * ledger after provisioning must never silently recreate an empty budget. */
export function createProductionQuotaStore(): SharedQuotaStore {
  return {
    async read() {
      const result = await get(ROADOPS_PRODUCTION_LEDGER_PATH, {
        access: "private", useCache: false, abortSignal: AbortSignal.timeout(STORE_TIMEOUT_MS),
      });
      if (!result || result.statusCode !== 200 || !result.stream || !result.blob.etag) throw new Error("Shared quota ledger unavailable");
      if (result.blob.size !== null && result.blob.size > MAX_LEDGER_BYTES) throw new Error("Shared quota ledger too large");
      const text = await new Response(result.stream).text();
      if (new TextEncoder().encode(text).byteLength > MAX_LEDGER_BYTES) throw new Error("Shared quota ledger too large");
      return { etag: result.blob.etag, value: JSON.parse(text) as unknown };
    },
    async compareAndSwap(etag, value) {
      if (!etag) throw new Error("Production quota cannot auto-initialize");
      try {
        await put(ROADOPS_PRODUCTION_LEDGER_PATH, JSON.stringify(value), {
          access: "private", addRandomSuffix: false, allowOverwrite: true,
          ifMatch: etag, contentType: "application/json", cacheControlMaxAge: 60,
          abortSignal: AbortSignal.timeout(STORE_TIMEOUT_MS),
        });
        return true;
      } catch (error) {
        // Only a definite precondition conflict may retry. A timeout/unknown
        // result might already have committed; it must not result in sending.
        if (error instanceof BlobPreconditionFailedError) return false;
        throw error;
      }
    },
  };
}

let productionService: RoadOpsDrivingService | null = null;
export function getProductionRoadOpsDrivingService(): RoadOpsDrivingService {
  if (!productionService) {
    const sharedQuota = createSharedRoadOpsQuota({ store: createProductionQuotaStore() });
    productionService = createRoadOpsDrivingService({
      env: { ...process.env, DIDI_ROUTE_DAILY_BUDGET: "100", DIDI_ROUTE_PER_USER_DAILY_LIMIT: "20", DIDI_ROUTE_QPS_LIMIT: "1" },
      sharedQuota, requireSharedQuota: true,
    });
  }
  return productionService;
}

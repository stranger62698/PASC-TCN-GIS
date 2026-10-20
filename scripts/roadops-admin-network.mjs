import { createRequire } from "node:module";

// The Blob SDK uses its own installed undici client, which does not inherit
// Node's --use-env-proxy flag. Reuse the existing configured environment proxy.
// This changes no OS network setting, endpoint, certificate, or TLS validation.
export function configureExistingBlobProxy() {
  if (!process.env.HTTP_PROXY && !process.env.HTTPS_PROXY) return;
  const require = createRequire(import.meta.resolve("@vercel/blob"));
  const { EnvHttpProxyAgent, setGlobalDispatcher } = require("undici");
  setGlobalDispatcher(new EnvHttpProxyAgent());
}

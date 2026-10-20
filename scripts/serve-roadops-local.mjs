import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseEnv } from "node:util";
import { build } from "vite";

const projectRoot = fileURLToPath(new URL("../", import.meta.url));

export async function buildRoadOpsLocalServer(outDir = resolve(projectRoot, ".work/roadops-local-server")) {
  await build({
    root: projectRoot, configFile: false, publicDir: false, logLevel: "warn",
    build: {
      outDir, emptyOutDir: false, copyPublicDir: false, minify: false, target: "es2022",
      lib: { entry: resolve(projectRoot, "scripts/roadops-local-server.ts"), formats: ["es"], fileName: () => "server.mjs" },
      rollupOptions: { external: [/^node:/] },
    },
  });
  return resolve(outDir, "server.mjs");
}

export async function loadRoadOpsLocalEnvironment(path = resolve(projectRoot, ".env.local"), inherited = process.env) {
  // Select only server-side routing settings, never VITE_/NEXT_PUBLIC_ variables.
  let local = {};
  try { local = parseEnv(await readFile(path, "utf8")); }
  catch (cause) { if (cause?.code !== "ENOENT") throw new Error("Cannot read the local server environment file."); }
  const names = [
    "DIDI_MAP_WEB_SERVICE_KEY", "DIDI_ROUTE_DAILY_BUDGET", "DIDI_ROUTE_PER_USER_DAILY_LIMIT",
    "DIDI_ROUTE_MAX_MATRIX_POINTS", "DIDI_ROUTE_MAX_CANDIDATES", "DIDI_ROUTE_CACHE_TTL_SECONDS", "DIDI_ROUTE_QPS_LIMIT",
  ];
  return Object.fromEntries(names.map(name => [name, inherited[name] ?? local[name]]));
}

export function parseRoadOpsLocalArguments(args, now = Date.now()) {
  const flags = new Map();
  for (let index = 0; index < args.length; index += 2) {
    const flag = args[index], value = args[index + 1];
    if (!["--port", "--used-today", "--usage-date"].includes(flag) || flags.has(flag) || value === undefined || value.startsWith("--")) {
      throw new Error("Usage: node scripts/serve-roadops-local.mjs [--port 4192] [--used-today N --usage-date YYYY-MM-DD]");
    }
    flags.set(flag, value);
  }
  const port = Number(flags.get("--port") ?? 4192);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error("Port must be an integer between 1024 and 65535.");
  if (flags.has("--used-today") !== flags.has("--usage-date")) throw new Error("Usage carry-over requires both --used-today and --usage-date.");
  if (!flags.has("--used-today")) return { port };
  const rawUsed = flags.get("--used-today"), used = Number(rawUsed), date = flags.get("--usage-date");
  const today = new Date(now + 8 * 60 * 60 * 1_000).toISOString().slice(0, 10);
  if (!/^\d+$/.test(rawUsed) || !Number.isSafeInteger(used) || date !== today) {
    throw new Error("Usage carry-over requires today's Asia/Shanghai date and a non-negative integer count.");
  }
  return { port, usageCarryover: { date, used } };
}

export async function startRoadOpsLocalServer(args = process.argv.slice(2)) {
  const { port, usageCarryover } = parseRoadOpsLocalArguments(args);
  const env = await loadRoadOpsLocalEnvironment();
  const modulePath = await buildRoadOpsLocalServer();
  const { createRoadOpsLocalServer } = await import(pathToFileURL(modulePath).href);
  const server = await createRoadOpsLocalServer({ staticRoot: resolve(projectRoot, "static-dist"), env, usageCarryover });
  await new Promise((resolveListen, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => { server.off("error", reject); resolveListen(); });
  });
  console.info(`RoadOps local preview: http://127.0.0.1:${port}/map?demo=road`);
  console.info(`Driving API configured: ${Boolean(env.DIDI_MAP_WEB_SERVICE_KEY?.trim())}. Local-only, no automatic upstream requests.`);
  if (usageCarryover) console.info(`Local HTTP usage carried over: ${usageCarryover.used} attempts for ${usageCarryover.date} (Asia/Shanghai).`);
  const stop = () => { server.close(); server.closeAllConnections(); };
  process.once("SIGINT", stop); process.once("SIGTERM", stop);
  return server;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { await startRoadOpsLocalServer(); }
  catch (cause) {
    console.error(cause?.code === "EADDRINUSE" ? "The local preview port is already in use; stop that preview or choose --port." : "RoadOps local server could not start. Check static-dist/index.html, Node version and the port setting.");
    process.exitCode = 1;
  }
}

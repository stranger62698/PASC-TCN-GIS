import assert from "node:assert/strict";
import { lstat, readdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { USER_DATA_LOCAL_ONLY, LOCAL_DATA_BLOCKED_ENDPOINTS, ONLINE_SERVICE_ENDPOINTS, localDataOnlyResponse } from "../app/lib/data-processing-policy.ts";

const inside = (root, target) => {
  const path = relative(root, target);
  return path !== "" && !isAbsolute(path) && path !== ".." && !path.startsWith(`..${sep}`);
};

/** Remove only the named generated function directories, never source or cloud data. */
export async function enforceLocalDataDeployment(output = resolve(".vercel/output")) {
  assert.equal(USER_DATA_LOCAL_ONLY, true, "This release must keep user data local");
  const root = resolve(output), functions = resolve(root, "functions");
  assert.ok(inside(root, functions));
  assert.ok(!(await lstat(functions)).isSymbolicLink(), "Function root must be a real output directory");
  const canonicalFunctions = await realpath(functions);
  const config = JSON.parse(await readFile(resolve(root, "config.json"), "utf8"));
  assert.equal(config.version, 3);
  assert.ok(config.routes.some(route => route.src === "^/api(/.*)?$" && route.status === 404), "Unpublished APIs must terminate with a static 404");
  const removed = [];
  for (const endpoint of LOCAL_DATA_BLOCKED_ENDPOINTS) {
    const target = resolve(functions, `${endpoint}.func`);
    assert.ok(inside(functions, target), "Refuse to remove a path outside generated functions");
    let info;
    try { info = await lstat(target); } catch (error) { if (error.code === "ENOENT") continue; throw error; }
    assert.ok(info.isDirectory() && !info.isSymbolicLink(), "Function target must be a real directory");
    assert.ok(inside(canonicalFunctions, await realpath(target)), "Function target escapes the output root");
    await rm(target, { recursive: true, force: false });
    removed.push(endpoint);
  }
  const found = [];
  const visit = async (directory, prefix = "") => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      assert.ok(!entry.isSymbolicLink(), "Unexpected function link");
      if (!entry.isDirectory()) continue;
      const name = `${prefix}${entry.name}`;
      if (entry.name.endsWith(".func")) found.push(name.slice(0, -5));
      else await visit(resolve(directory, entry.name), `${name}/`);
    }
  };
  await visit(functions);
  assert.deepEqual(found.sort(), [...ONLINE_SERVICE_ENDPOINTS].sort(), "Only authentication and driving may publish server functions");
  await writeFile(resolve(root, "static/data-processing-policy.json"), JSON.stringify({ ...localDataOnlyResponse(), blockedEndpoints: LOCAL_DATA_BLOCKED_ENDPOINTS }, null, 2) + "\n");
  const src = `^/(?:${LOCAL_DATA_BLOCKED_ENDPOINTS.join("|")})(?:/.*|\\.(?:ts|js))?$`;
  config.routes = [
    { src, dest: "/data-processing-policy.json", status: 403, headers: { "Cache-Control": "no-store", "Content-Type": "application/json; charset=utf-8", "X-Data-Processing": "local-only" } },
    ...config.routes.filter(route => route.src !== src),
  ];
  await writeFile(resolve(root, "config.json"), JSON.stringify(config, null, 2) + "\n");
  return { userDataLocalOnly: true, removed, publishedFunctions: found };
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  console.log(JSON.stringify(await enforceLocalDataDeployment()));
}

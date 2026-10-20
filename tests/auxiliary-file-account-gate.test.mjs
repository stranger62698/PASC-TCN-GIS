import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import test from "node:test";
import ts from "typescript";
import { createFieldPhotoDraftLifecycle, parseFieldDraftCoordinates } from "../app/lib/field-observation-draft.ts";

const user = { id: "fixture-user", email: "local@example.test", name: "Local user", roles: [] };
const noop = () => {};
const settle = () => new Promise(resolve => setImmediate(resolve));

// Exercise the real component event handlers without a DOM, model, storage, or network.
// Hook slots are retained across renders so an expired-session retry uses the original File.
function panelHarness(name, props, modules = {}) {
  const source = readFileSync(new URL(`../app/components/${name}.tsx`, import.meta.url), "utf8");
  const compiled = ts.transpileModule(source, { compilerOptions: {
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS,
    jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true,
  } }).outputText;
  const slots = [];
  let cursor = 0, pendingEffects = [], authentication = null;
  const account = { status: "anonymous", user: null, refresh: async () => {}, logout: async () => {}, error: "" };
  const memo = (create, dependencies) => {
    const index = cursor++;
    if (!slots[index] || dependencies?.some((value, i) => value !== slots[index].dependencies?.[i])) {
      slots[index] = { value: create(), dependencies };
    }
    return slots[index].value;
  };
  const effect = (create, dependencies) => {
    const index = cursor++;
    if (!slots[index] || !dependencies || dependencies.some((value, i) => value !== slots[index].dependencies?.[i])) {
      const prior = slots[index];
      slots[index] = { dependencies };
      pendingEffects.push(() => { prior?.cleanup?.(); slots[index].cleanup = create(); });
    }
  };
  const hooks = {
    useState(initial) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = typeof initial === "function" ? initial() : initial;
      return [slots[index], next => { slots[index] = typeof next === "function" ? next(slots[index]) : next; }];
    },
    useRef(initial) { const index = cursor++; return slots[index] ??= { current: initial }; },
    useMemo: memo, useCallback: (callback, dependencies) => memo(() => callback, dependencies),
    useEffect: effect, useLayoutEffect: effect,
  };
  const jsx = (type, properties) => ({ type, props: properties ?? {} });
  const stubs = {
    react: hooks,
    "react/jsx-runtime": { jsx, jsxs: jsx, Fragment: Symbol("Fragment") },
    "../lib/account-session": {
      useAccountSession: () => account,
      requireAccountSession: async () => authentication,
    },
    "../lib/local-analysis-session": { buildLoginContinuationHref: () => "/login?resume=1" },
    ...modules,
  };
  const exports = {};
  const timer = () => 1;
  runInNewContext(compiled, {
    exports, require(id) { assert.ok(id in stubs, `Unexpected component dependency: ${id}`); return stubs[id]; },
    crypto: { randomUUID: () => "fixture-id" },
    window: { addEventListener: noop, removeEventListener: noop, setTimeout: timer, clearTimeout: noop },
    URL: { createObjectURL: () => "blob:fixture", revokeObjectURL: noop },
    fetch() { assert.fail("A local file import must never upload or fetch user data"); },
    console,
  }, { timeout: 1_000 });
  return {
    account,
    authorize(value) { authentication = value; },
    render() {
      cursor = 0; pendingEffects = [];
      const result = exports[name](props);
      pendingEffects.forEach(run => run());
      return result;
    },
  };
}

function nodes(tree) {
  if (Array.isArray(tree)) return tree.flatMap(nodes);
  if (!tree || typeof tree !== "object") return [];
  return [tree, ...nodes(tree.props?.children)];
}
function textOf(tree) {
  if (Array.isArray(tree)) return tree.map(textOf).join("");
  if (tree == null || typeof tree === "boolean") return "";
  if (typeof tree !== "object") return String(tree);
  return textOf(tree.props?.children);
}
const fileInput = (tree, accept) => nodes(tree).find(node => node.type === "input" && node.props.type === "file" && node.props.accept.includes(accept));
const retryButton = tree => nodes(tree).find(node => node.type === "button" && textOf(node) === "登录后重试导入");
const selectFile = (input, file) => input.props.onChange({ target: { files: [file], value: "selected" }, currentTarget: { value: "selected" } });

test("field photo and coordinate CSV imports verify fresh login before reads and retain selected files for explicit retry", async () => {
  let exifReads = 0, csvReads = 0;
  const photo = { name: "photo.jpg" };
  const csv = { name: "visits.csv", async text() { csvReads += 1; return "fixture"; } };
  const harness = panelHarness("FieldObservationPanel", {
    observations: [{ id: "public", name: "公开考察点", longitude: 110, latitude: 20, photos: [], links: [] }],
    activeId: null, mapCenter: [20, 110], storageState: "ready", onAdd: noop, onSelect: noop, onRemove: noop,
  }, {
    "next/image": noop,
    "../lib/field-observation-draft": { createFieldPhotoDraftLifecycle, parseFieldDraftCoordinates },
    "../lib/field-observation": {
      readPhotoExif: async () => { exifReads += 1; return { longitude: 110, latitude: 20, capturedAt: null }; },
      parseFieldVisitCsv: () => [{ fileName: "photo.jpg", visitId: "fixture", longitude: 110, latitude: 20 }],
    },
    "../lib/photo-watermark": { readWatermarkCoordinates() { assert.fail("No OCR expected for fixture EXIF GPS"); } },
  });
  let tree = harness.render();
  assert.equal(fileInput(tree, "image/jpeg").props.disabled, true);
  assert.match(textOf(tree), /公开考察点/);
  harness.account.status = "authenticated";
  selectFile(fileInput(harness.render(), "image/jpeg"), photo);
  await settle();
  assert.equal(exifReads, 0, "cached authenticated UI must not bypass fresh authorization");
  harness.authorize(user);
  retryButton(harness.render()).props.onClick();
  await settle();
  assert.equal(exifReads, 1);
  assert.match(textOf(harness.render()), /photo.jpg/);
  harness.authorize(null);
  selectFile(fileInput(harness.render(), ".csv"), csv);
  await settle();
  assert.equal(csvReads, 0);
  assert.match(textOf(harness.render()), /photo.jpg/, "expired login must retain the existing photo draft");
  harness.authorize(user);
  retryButton(harness.render()).props.onClick();
  await settle();
  assert.equal(csvReads, 1);
  assert.equal(retryButton(harness.render()), undefined);
});

test("GIS import cannot invoke the file parser after login expiry; its same File retry preserves public OSM layers", async () => {
  const imported = [];
  const file = { name: "user.geojson" };
  const harness = panelHarness("GisLayerPanel", {
    layers: [{ id: "osm", name: "公开道路基线", features: [], featureCount: 1, geometryTypes: ["LineString"], sourceType: "geojson", visible: true, opacity: 1, role: "road", provenance: { kind: "osm", builtIn: true } }],
    activeFeatureId: null, busy: false, message: "", onImport: value => imported.push(value),
    onUpdate: noop, onRemove: noop, onFocus: noop, riskInputs: [], onFocusFeature: noop, onRoutePlanChange: noop,
  }, { "./RoadQualityPanel": { RoadQualityPanel: noop } });
  let tree = harness.render();
  assert.equal(fileInput(tree, ".geojson").props.disabled, true);
  assert.match(textOf(tree), /公开道路基线/);
  harness.account.status = "authenticated";
  selectFile(fileInput(harness.render(), ".geojson"), file);
  await settle();
  assert.equal(imported.length, 0);
  harness.authorize(user);
  retryButton(harness.render()).props.onClick();
  await settle();
  assert.equal(imported.length, 1);
  assert.equal(imported[0], file);
  assert.match(textOf(harness.render()), /公开道路基线/);
});

test("task JSON import keeps the current draft and unread File through expiry, then requires login again at confirmation", async () => {
  let reads = 0, saves = 0;
  const draft = { waypoints: [], startTime: "08:30", workMinutes: 480 };
  const importedPlan = { name: "导入副本", tasks: [], visits: [], revision: 1, startTime: "08:30", workMinutes: 480 };
  const file = { name: "task.json", size: 100, async text() { reads += 1; return JSON.stringify(importedPlan); } };
  const harness = panelHarness("RoadTaskDraftPanel", { draft, disabled: false, onRestore: noop, onRestoreTaskPlan: noop }, {
    "../lib/roadops-navigation": { createNavigationDraft: () => draft },
    "../lib/roadops-task-plan": {
      createFieldTaskPlan: () => importedPlan, fieldTaskPlanToNavigationDraft: () => draft,
      parseFieldTaskPlan: value => value, serializeFieldTaskPlan: JSON.stringify, updateFieldTaskPlan: value => value,
      prepareFieldTaskPlanRestore: value => value, FIELD_TASK_PLAN_MAX_BYTES: 1024 * 1024,
    },
    "../lib/roadops-task-store": { createFieldTaskStore: () => ({ list: async () => [], save: async value => { saves += 1; return value; } }) },
  });
  let tree = harness.render();
  assert.equal(fileInput(tree, ".json").props.disabled, true);
  harness.account.status = "authenticated";
  selectFile(fileInput(harness.render(), ".json"), file);
  await settle();
  assert.equal(reads, 0);
  assert.equal(saves, 0);
  harness.authorize(user);
  retryButton(harness.render()).props.onClick();
  await settle();
  assert.equal(reads, 1);
  tree = harness.render();
  assert.equal(nodes(tree).find(node => node.type === "input" && node.props.id === "road-task-name").props.value, "未命名外业任务");
  assert.match(textOf(tree), /确认导入副本/);
  harness.authorize(null);
  nodes(tree).find(node => node.type === "button" && textOf(node) === "确认导入副本").props.onClick();
  await settle();
  assert.equal(saves, 0, "confirmation cannot complete an import under an expired session");
  assert.match(textOf(harness.render()), /当前任务与待导入副本已保留/);
});

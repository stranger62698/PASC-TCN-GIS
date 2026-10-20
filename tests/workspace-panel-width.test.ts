import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { clampPanelWidth, DEFAULT_PANEL_WIDTH, MAX_PANEL_WIDTH, MIN_PANEL_WIDTH, maxPanelWidth } from "../app/lib/workspace-panel-width.js";

test("drawer widths retain the 340 px minimum, 380 px default and 960 px cap", () => {
  assert.equal(MIN_PANEL_WIDTH, 340);
  assert.equal(DEFAULT_PANEL_WIDTH, 380);
  assert.equal(MAX_PANEL_WIDTH, 960);
  assert.equal(clampPanelWidth(DEFAULT_PANEL_WIDTH, MAX_PANEL_WIDTH), 380);
  assert.equal(clampPanelWidth(0, MAX_PANEL_WIDTH), 340);
  assert.equal(clampPanelWidth(1_500, MAX_PANEL_WIDTH), 960);
});

test("desktop drawer maximum leaves 300 px for the map where the minimum allows", () => {
  for (const available of [640, 768, 900, 1_024, 1_260]) {
    assert.equal(maxPanelWidth(available), available - 300);
  }
  assert.equal(maxPanelWidth(1_920), 960);
  assert.equal(maxPanelWidth(320), 340);
  assert.equal(maxPanelWidth(0), 340);
});

test("drawer width changes clamp both boundaries and round to whole pixels", () => {
  assert.equal(clampPanelWidth(-12.5, 724), 340);
  assert.equal(clampPanelWidth(339.6, 724), 340);
  assert.equal(clampPanelWidth(512.49, 724), 512);
  assert.equal(clampPanelWidth(512.5, 724), 513);
  assert.equal(clampPanelWidth(800, 724), 724);
  assert.equal(clampPanelWidth(380, 340), 340);
});

test("all three task drawer wrappers use one workspace width, with the left data card excluded", () => {
  const workspace = readFileSync("app/components/MapWorkspace.tsx", "utf8");
  const wrappers = workspace.match(/<ResizableAnalysisPanel\b[^>]*>/g) ?? [];
  assert.equal(wrappers.length, 3, "export, task and analysis drawers must share the reusable splitter");
  for (const wrapper of wrappers) {
    assert.match(wrapper, /width=\{drawerWidth\}/);
    assert.match(wrapper, /onWidthChange=\{setDrawerWidth\}/);
  }
  assert.equal((workspace.match(/\[drawerWidth,\s*setDrawerWidth\]\s*=\s*useState\(DEFAULT_PANEL_WIDTH\)/g) ?? []).length, 1);
  assert.match(wrappers[0], /className="workspace-export-drawer"/);
  assert.match(wrappers[1], /resizable=\{leftTab !== "data"\}/);
  assert.match(wrappers[2], /collapsed=\{rightCollapsed\}/);
  assert.match(workspace, /"--analysis-panel-width":\s*`\$\{drawerWidth\}px`/);
  assert.match(workspace, /"--drawer-width":\s*surface\s*&&\s*!\(surface === "left" && leftTab === "data"\)\s*\?\s*`\$\{drawerWidth\}px`\s*:\s*"0px"/);
});

test("splitter is controlled, hides for collapsed/data drawers and preserves desktop width on mobile", () => {
  const panel = readFileSync("app/components/ResizableAnalysisPanel.tsx", "utf8");
  assert.match(panel, /width:\s*number/);
  assert.match(panel, /onWidthChange:\s*Dispatch<SetStateAction<number>>/);
  assert.doesNotMatch(panel, /\[\s*width\s*,[^\]]*\]\s*=\s*useState/);
  assert.doesNotMatch(panel, /useState\(DEFAULT_PANEL_WIDTH\)/);
  assert.doesNotMatch(panel, /style\.setProperty\("--(?:analysis-panel|drawer)-width"/);
  assert.match(panel, /!collapsed && resizable && <div/);
  assert.match(panel, /if\s*\(shell\.clientWidth < 768\)\s*return/);
  assert.match(panel, /setWidth\(clampPanelWidth\(next, maximum\)\)/);
});

test("splitter keeps pointer capture, cancellation, reset and keyboard access", () => {
  const panel = readFileSync("app/components/ResizableAnalysisPanel.tsx", "utf8");
  assert.match(panel, /role="separator"/);
  assert.match(panel, /aria-valuenow=\{width\}/);
  assert.match(panel, /drag\.startWidth \+ drag\.startX - event\.clientX/);
  assert.match(panel, /setPointerCapture\(event\.pointerId\)/);
  assert.match(panel, /releasePointerCapture\(drag\.pointerId\)/);
  assert.match(panel, /onPointerCancel=\{\(\) => \{ if \(dragRef\.current\) changeWidth\(dragRef\.current\.startWidth\); finishDrag\(\); \}\}/);
  assert.match(panel, /onDoubleClick=\{\(\) => changeWidth\(DEFAULT_PANEL_WIDTH\)\}/);
  for (const key of ["ArrowLeft", "ArrowRight", "Home", "End", "Escape"]) assert.ok(panel.includes(`event.key === "${key}"`));
});

test("desktop CSS sizes every right drawer from the shared width and hides the handle on mobile", () => {
  const styles = readFileSync("app/globals.css", "utf8").replace(/\s+/g, "");
  assert.match(styles, /@media\(min-width:768px\)\{\.map-route-shell\.navigation-workspace\.workspace-task-drawer:not\(\.is-data-drawer\),\.map-route-shell\.navigation-workspace\.workspace-export-drawer\{width:var\(--analysis-panel-width,380px\)\}/);
  assert.match(styles, /\.analysis-panel-resizer\{[^}]*right:calc\(var\(--analysis-panel-width,380px\)-8px\)/);
  assert.match(styles, /\.navigation-workspace\.gis-map\{inset:0var\(--drawer-width\)/);
  assert.match(styles, /@media\(max-width:767px\)\{\.analysis-panel-resizer\{display:none\}\}/);
});

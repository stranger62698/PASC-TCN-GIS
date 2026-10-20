import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

// Source contracts only: these guard selector coverage and responsive intent.
// They do not evaluate browser layout, the computed cascade or visual contrast.
const source = path => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const css = source("app/site-ui.css").replace(/\/\*[\s\S]*?\*\//g, "");
const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(([, selector, declarations]) => ({
  selector: selector.trim(), declarations,
}));
const rule = selector => {
  const result = rules.find(item => item.selector === selector);
  assert.ok(result, `Expected a scoped rule for ${selector}`);
  return result.declarations;
};
const groupedRule = selector => {
  const result = rules.find(item => item.selector.split(",").some(part => part.trim() === selector));
  assert.ok(result, `Expected a scoped or grouped rule for ${selector}`);
  return result.declarations;
};
const mediaBlock = width => {
  const start = css.indexOf(`@media (max-width: ${width}px)`);
  assert.ok(start >= 0, `Expected a ${width}px responsive breakpoint`);
  const open = css.indexOf("{", start);
  let depth = 1;
  for (let index = open + 1; index < css.length; index += 1) {
    if (css[index] === "{") depth += 1;
    if (css[index] === "}") depth -= 1;
    if (depth === 0) return css.slice(open + 1, index);
  }
  assert.fail(`Unclosed ${width}px media block`);
};

test("account styles use the compound page scope to outrank legacy two-class rules", () => {
  const auth = source("app/components/AuthPage.tsx");
  const legacy = source("app/globals.css");
  assert.match(auth, /className="new-login phase-eight-login"/);
  assert.match(legacy, /\.phase-eight-login \.login-scene\s*\{/);
  assert.match(auth, /className="auth-orbit-visual" aria-hidden="true"/);
  assert.match(auth, /src="\/insar-satellite-v2\.png" alt=""/);
  for (const selector of [".login-panel", ".auth-panel-shell"]) {
    const declarations = rule(`.new-login.phase-eight-login ${selector}`);
    // Three class selectors are intentional: imported CSS precedes the legacy rules.
    assert.match(declarations, /background:\s*#[\da-f]{3,8}\s*;/i);
    assert.doesNotMatch(declarations, /gradient\(/);
  }
  assert.match(rule(".new-login.phase-eight-login .login-scene:after"), /display:\s*none/);
  assert.match(rule(".new-login.phase-eight-login .auth-panel-shell"), /box-shadow:\s*none/);
});

test("navigation, language and case selection share blue text on a pale blue surface", () => {
  const language = source("app/lib/language-context.tsx");
  assert.match(language, /aria-current=\{locale === "zh" \? "true" : undefined\}/);
  assert.match(language, /aria-current=\{locale === "en" \? "true" : undefined\}/);
  const palette = groupedRule(".site-surface");
  assert.match(palette, /--accent:\s*#1769d2\s*;/i);
  assert.match(palette, /--accent-soft:\s*#eef5ff\s*;/i);
  for (const selector of [
    ".site-surface .nav-entry>a.active",
    '.site-surface .language-switch button[aria-current="true"]',
    ".site-surface .case-gallery-selector>button.active",
  ]) {
    const selected = groupedRule(selector);
    assert.match(selected, /(?:^|;)\s*color:\s*var\(--accent\)\s*;/);
    assert.match(selected, /background:\s*var\(--accent-soft\)\s*;/);
  }
  assert.match(rule(".site-surface .nav-entry>a:after"), /display:\s*none/);
  assert.doesNotMatch(css, /\.language-switch button\.active/);
});

test("the homepage uses one full-width decorative scene with an explicit illustration disclaimer", () => {
  const home = source("app/components/HomePage.tsx");
  const hero = rule(".site-surface .home-hero");
  const scene = rule(".site-surface .hero-scene");
  assert.match(hero, /position:\s*relative\s*;/);
  assert.match(hero, /max-width:\s*none\s*;/);
  assert.match(scene, /position:\s*absolute\s*;/);
  assert.match(scene, /inset:\s*0\s*;/);
  assert.match(scene, /background-image:.*hero-insar-observation-v2\.webp/);
  assert.match(scene, /pointer-events:\s*none\s*;/);
  assert.match(home, /className="hero-scene" aria-hidden="true"/);
  assert.match(home, /className="hero-scene-note"/);
  assert.match(home, /背景为 InSAR 观测场景示意，非实测结果/);
  assert.match(home, /Illustrative InSAR observation scene, not measured results/);
  assert.doesNotMatch(home, /hero-visual|hero-observation-flow|hero-method-badge/);
});

test("homepage desktop spacing is compact and retains clear blue primary actions", () => {
  const hero = rule(".site-surface .home-hero");
  const minimumHeight = Number(hero.match(/min-height:\s*(\d+)px/)?.[1]);
  const sectionPadding = Number(rule(".site-surface .section").match(/padding:\s*(\d+)px/)?.[1]);
  assert.ok(minimumHeight > 0 && minimumHeight <= 620, "The hero must not return to the oversized 740px minimum");
  assert.ok(sectionPadding > 0 && sectionPadding <= 64, "Ordinary sections should not restore the former 88px gutters");
  assert.match(rule(".site-surface .hero-copy h1 em"), /color:\s*var\(--accent\)/);
  assert.match(groupedRule(".site-surface .button.primary"), /background:\s*var\(--accent\)/);
  assert.match(groupedRule(".site-surface .button.primary"), /color:\s*#fff(?:fff)?\s*;/);
});

test("data lifecycle and server-job containers share scoped neutral surfaces", () => {
  for (const selector of [".dataset-import-workflow", ".pasc-job-console"]) {
    const declarations = rule(`.site-surface ${selector}`);
    assert.match(declarations, /background:\s*#fff\s*;/);
    assert.match(declarations, /border-color:\s*var\(--line\)/);
    assert.match(declarations, /box-shadow:\s*none/);
  }
  for (const name of [".import-stepper", ".mapping-confirm-grid", ".time-field-picker", ".quality-error-report", ".pasc-job-create", ".pasc-job-artifacts", ".pasc-job-events"]) {
    const matchingRules = rules.filter(item => item.selector.includes(name));
    assert.ok(matchingRules.length, `Expected styling coverage for ${name}`);
    assert.ok(matchingRules.every(item => item.selector.startsWith(".site-surface ")), `${name} must not restyle the map globally`);
  }
  assert.match(rule(".site-surface .pasc-job-error"), /background:/);
  assert.ok(rules.some(item => item.selector.includes(".is-failed,.is-cancelled")), "Job failure states retain separate semantic styling");
});

test("case evidence and field workflow containers use neutral surfaces", () => {
  for (const selector of [".research-area-background", ".scenario-flow", ".insar-action-concept"]) {
    const declarations = rule(`.site-surface ${selector}`);
    assert.match(declarations, /background:\s*#fff\s*;/);
    assert.doesNotMatch(declarations, /gradient\(/);
  }
  assert.match(rule(".site-surface .research-area-background:before"), /display:\s*none/);
  assert.match(rule(".site-surface .case-metrics span"), /background:\s*#fff/);
  assert.match(rule(".site-surface .insar-action-flow article"), /border-radius:\s*0/);
});

test("the six-step workflow adapts to three columns and then a single column", () => {
  assert.match(rule(".site-surface .case-study-journey>div"), /grid-template-columns:\s*repeat\(6,\s*minmax\(0,\s*1fr\)\)/);
  assert.match(mediaBlock(900), /\.site-surface \.case-study-journey>div\s*\{[^}]*grid-template-columns:\s*repeat\(3,\s*minmax\(0,\s*1fr\)\)/);
  assert.match(mediaBlock(620), /\.site-surface \.case-study-journey>div\s*\{[^}]*grid-template-columns:\s*1fr\s*;/);
});

test("image-card headings keep an explicit light foreground above dark imagery", () => {
  assert.match(rule(".site-surface .platform-highlight-grid .signature-copy h3"), /color:\s*#fff(?:fff)?\s*;/);
  assert.match(rule(".site-surface .signature-shade"), /background:\s*linear-gradient/);
});

test("capability image sizing reflects a two-column desktop and one-column mobile grid", () => {
  const home = source("app/components/HomePage.tsx");
  assert.match(rule(".site-surface .platform-highlight-grid"), /grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/);
  assert.match(mediaBlock(620), /\.site-surface \.platform-highlight-grid[^{}]*\{[^}]*grid-template-columns:\s*1fr\s*;/);
  assert.match(home, /className="signature-image"[^>]*sizes="\(max-width: 620px\) 100vw, 50vw"/);
});

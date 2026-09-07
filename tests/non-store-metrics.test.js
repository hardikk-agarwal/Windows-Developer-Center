"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const discovery = require("../certificate-discovery.js");

const source = fs.readFileSync(path.join(__dirname, "..", "portal.js"), "utf8");
const start = source.indexOf("  function storeCertRowHTML(a) {");
const end = source.indexOf("  // Store-developer app row", start);
assert.ok(start >= 0 && end > start);
const context = vm.createContext({
  appIcoImg: () => "",
  storeLocked: app => !!app.locked,
  appTypeMeta: () => ({ key: "win32", label: "EXE / MSI" }),
  analyticsPending: discovery.isAnalyticsPending,
  healthCellInner: () => "Preparing data",
  anaData: app => {
    assert.equal(discovery.isAnalyticsPending(app), false, "Pending apps must not read crash figures");
    return { crashRate: 1.25 };
  },
  acqData: () => ({ instTotal: 42000 }),
  ratingsData: () => ({ avg: 4.2 }),
  fmtCompact: () => "42K",
  esc: value => String(value)
});
vm.runInContext(source.slice(start, end), context);

function cells(app) {
  return [...context.storeCertRowHTML(app).matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/g)].map(match => match[1]);
}

function assertLockedTeaser(cell, appId) {
  assert.match(cell, /class="metric-teaser"/);
  assert.match(cell, /class="metric-teaser__val/);
  assert.match(cell, /class="metric-teaser__lock"/);
  assert.match(cell, /fluent:lock-closed-12-filled/);
  assert.ok(cell.includes('data-store="' + appId + '"'));
}

test("new non-Store apps retain locked metric teasers while crash data prepares", () => {
  const app = { id: "pending", name: "Pending app", discovered: true, discoveredAt: Date.now(), store: false };
  const row = cells(app);
  assert.equal(row.length, 7);
  assertLockedTeaser(row[3], app.id);
  assertLockedTeaser(row[5], app.id);
  assert.match(row[4], /Preparing data/);
  assert.doesNotMatch(row[4], /metric-teaser|1\.25%/);
});

test("non-Store apps keep metric teasers after crash data becomes ready", () => {
  const app = { id: "ready", name: "Ready app", discovered: true, discoveredAt: Date.now() - 2 * discovery.ANALYTICS_DELAY_MS, store: false };
  const row = cells(app);
  assertLockedTeaser(row[3], app.id);
  assertLockedTeaser(row[5], app.id);
  assert.match(row[4], /1\.25%/);
  assert.doesNotMatch(row[4], /Preparing data/);
});

test("unverified-certificate handling remains unchanged", () => {
  const row = cells({ id: "locked", name: "Locked app", locked: true, store: false });
  assert.match(row[2], /Verify certificate ownership/);
  assert.doesNotMatch(row[3] + row[4] + row[5], /metric-teaser|Preparing data|1\.25%/);
});
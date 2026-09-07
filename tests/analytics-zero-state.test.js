"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const discovery = require("../certificate-discovery.js");
const source = fs.readFileSync(path.join(__dirname, "..", "portal.js"), "utf8");

function definition(name, next) {
  const start = source.indexOf("  function " + name + "("), end = source.indexOf("  function " + next + "(", start);
  assert.ok(start >= 0 && end > start);
  return source.slice(start, end);
}

const context = vm.createContext({
  anaDemoState: "auto",
  analyticsPending: discovery.isAnalyticsPending,
  isMsix: app => app.pkgType === "msix",
  esc: value => String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")
});
vm.runInContext(definition("zeroStateHTML", "latencyZeroHTML") + definition("crashTab", "symbolsPanel") +
  definition("crashZeroActive", "demoSwitchHTML") +
  definition("canAggregateAnalytics", "anaZeros"), context);

test.beforeEach(() => { context.anaDemoState = "auto"; });

test("new certificate apps use the existing crash zero state and symbols action", () => {
  const app = { id: "new-app", name: "Example & Co", discovered: true, discoveredAt: Date.now() };
  const html = context.crashTab(app);
  assert.equal(html, context.zeroStateHTML(app));
  assert.match(html, /ca-zero__art/);
  assert.match(html, /ca-zero__nudge/);
  assert.match(html, /data-ca-upload="1"/);
  assert.match(html, /Example &amp; Co/);
  assert.doesNotMatch(html, /ana-pending|We’re preparing your crash analytics/);
});

test("the existing MSIX zero state keeps its packaged-app guidance", () => {
  const app = { id: "packaged", name: "Example", pkgType: "msix", discovered: true, discoveredAt: Date.now() };
  const html = context.crashTab(app);
  assert.equal(html, context.zeroStateHTML(app));
  assert.match(html, /Stack traces resolve automatically/);
  assert.doesNotMatch(html, /data-ca-upload/);
});

test("when all apps are preparing, analytics keeps setup scoped to an individual app", () => {
  const waiting = { discovered: true, discoveredAt: Date.now() };
  assert.equal(context.canAggregateAnalytics([waiting, waiting]), false);
  assert.equal(context.canAggregateAnalytics([waiting, { store: true }]), true);
});

test("explicit crash demo choices override the preparation state without changing app data", () => {
  const app = { discovered: true, discoveredAt: Date.now() }, original = { ...app };
  assert.equal(context.crashZeroActive(app), true);
  context.anaDemoState = "live";
  assert.equal(context.crashZeroActive(app), false);
  context.anaDemoState = "newapp";
  assert.equal(context.crashTab(app), context.zeroStateHTML(app));
  assert.deepEqual(app, original);
  assert.equal(discovery.isAnalyticsPending(app), true);
});
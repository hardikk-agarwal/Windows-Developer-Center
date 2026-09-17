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

function trackingContext() {
  const cert = { id: "cert", thumb: "A", label: "Publisher" };
  const rows = [{ name: "Editor", file: "Editor.exe", kind: "app", applicationId: "editor" },
    { name: "Sync Service", file: "Sync.exe", kind: "helper", parentApplicationId: "editor" },
    { name: "Shared Service", file: "Shared.exe", kind: "helper" }];
  let id = 0;
  const saved = discovery.applyTrackingSelection(discovery.normalize(rows, cert, []), [cert], [], { createId: () => "target-" + ++id, now: 123 });
  const scope = vm.createContext({ discovery, state: saved, anaScope: "background", analyticsAppId: saved.certs[0].executables[1].id });
  scope.appById = targetId => scope.state.apps.find(app => app.id === targetId) || null;
  vm.runInContext(definition("anaLiveApps", "renderAnalyticsScopes"), scope);
  return scope;
}

test("background executables resolve for crash and symbol workflows without entering Apps or app aggregates", () => {
  const scope = trackingContext();
  assert.equal(scope.state.apps.length, 1);
  assert.equal(scope.anaLiveApps().length, 1);
  assert.equal(scope.backgroundTargets().length, 2);
  assert.equal(scope.currentAnalyticsTarget().file, "Sync.exe");
  assert.equal(scope.appById(scope.analyticsAppId), null);
  assert.equal(scope.analyticsTargetById(scope.analyticsAppId).discoveredAt, 123);
});

test("related-executable navigation requires explicit product metadata, never just the same certificate", () => {
  const scope = trackingContext();
  const related = scope.relatedExecutables(scope.state.apps[0]);
  assert.ok(related.some(target => target.name === "Sync Service"));
  assert.ok(!related.some(target => target.name === "Shared Service"));
  assert.ok(!related.some(target => target.id === scope.state.apps[0].primaryTargetId));
  assert.equal(scope.analyticsTargetById(scope.state.apps[0].id).id, scope.state.apps[0].primaryTargetId);
});

test("deleting an app excludes only its own main executables and keeps independent helper tracking", () => {
  const scope = trackingContext(), appId = scope.state.apps[0].id;
  scope.localStorage = { getItem: () => "[]", setItem() {} };
  scope.save = () => true; scope.renderAll = () => {}; scope.toast = () => {};
  scope.anaRelatedApp = appId; scope.anaFailure = null;
  vm.runInContext(definition("doDeleteApp", "wireDel"), scope);
  scope.doDeleteApp(appId);
  assert.equal(scope.state.apps.length, 0);
  assert.equal(scope.state.certs[0].executables[0].mode, "none");
  assert.equal(scope.state.certs[0].executables[0].discoveredAt, 123);
  assert.equal(scope.backgroundTargets().length, 2);
  assert.equal(scope.anaRelatedApp, "");
});
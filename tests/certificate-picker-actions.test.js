"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const discovery = require("../certificate-discovery.js");
const review = require("../certificate-review.js");

test("short reviews show suggested roles while details and bulk controls stay on demand", () => {
  const state = review.createState(discovery.normalize([
    { name: "Reader", file: "Reader.exe", kind: "app", path: "c:/reader.exe" },
    { name: "Unknown.exe", file: "Unknown.exe" },
    { name: "Sync Service", file: "Sync.exe", kind: "helper" }
  ], { id: "cert", thumb: "A" }, []));
  state.expanded.add("helper");
  review.setMode(state, 2, "app");
  const html = review.resultsHTML(state);
  assert.doesNotMatch(html, /cr-detail-cell|cr-pagination|data-cr-counts|fluent-checkbox/);
  assert.match(html, /<th class="cr-role-cell">Suggested role<\/th>/);
  assert.match(html, /<td class="cr-role-cell">Main executable<\/td>/);
  assert.match(html, /<td class="cr-role-cell">Helper executable<\/td>/);
  assert.match(html, /<td class="cr-role-cell">Needs review<\/td>/);
  assert.equal(state.candidates[2].mode, "app");
  assert.match(html, /class="cr-name"[^>]*data-cr-details="0"[^>]*aria-expanded="false"/);
  assert.ok(html.indexOf('data-cr-toggle="review"') < html.indexOf('data-cr-toggle="app"'));
  assert.doesNotMatch(html, /<dt>Path<\/dt>/);
  state.details.add(0);
  assert.match(review.resultsHTML(state), /aria-expanded="true"/);
  assert.match(review.resultsHTML(state), /<dt>Path<\/dt><dd>c:\/reader.exe<\/dd>/);
  assert.match(review.resultsHTML(state), /id="cr-details-0"><td colspan="3">/);
  state.bulkEditing = true;
  assert.match(review.resultsHTML(state), /id="cr-details-0"><td colspan="4">/);
});

test("large executable reviews render one page per open group and keep helpers collapsed", () => {
  const rows = Array.from({ length: 650 }, (_, index) => ({ name: "Executable " + index, file: "Executable" + index + ".exe", kind: index < 100 ? "app" : "process" }));
  const state = review.createState(discovery.normalize(rows, { id: "cert", thumb: "A" }, []));
  const html = review.resultsHTML(state);
  assert.equal((html.match(/data-cr-row=/g) || []).length, 25);
  assert.match(html, /cr-group-helper" hidden/);
  assert.doesNotMatch(html, /Select this page/);
  state.bulkEditing = true;
  assert.match(review.resultsHTML(state), /Select this page/);
  state.expanded.add("helper");
  assert.equal((review.resultsHTML(state).match(/data-cr-row=/g) || []).length, 50);
});

test("bulk inclusion changes marked rows across pages but never Store-managed entries", () => {
  const cert = { id: "cert", thumb: "A" };
  const rows = Array.from({ length: 80 }, (_, index) => ({ name: "Service " + index, kind: "process", path: "c:/" + index + ".exe" }));
  const state = review.createState(discovery.normalize(rows, cert, [{ id: "store", name: "Store", certId: cert.id, discoveryKey: "p:c:/0.exe", store: true }]));
  state.candidates.forEach(candidate => state.marked.add(candidate.index));
  review.applyBulk(state, "analytics");
  assert.equal(state.candidates[0].mode, "app");
  assert.ok(state.candidates.slice(1).every(candidate => candidate.mode === "analytics"));
  state.pages.helper = 2;
  assert.equal(review.pageItems(state, "helper").shown.length, 25);
});

test("searching and filtering preserve choices and reset bulk scope explicitly", () => {
  const state = review.createState(discovery.normalize([{ name: "Sync Service", file: "Sync.exe", kind: "process" }, { name: "Reader", kind: "app" }], { id: "cert", thumb: "A" }, []));
  review.setMode(state, 0, "app"); state.marked.add(0);
  review.setFilters(state, { query: "sync" });
  assert.equal(state.marked.size, 0);
  assert.equal(review.matches(state)[0].mode, "app");
  assert.equal(state.candidates[0].suggestedRole, "helper");
  assert.ok(state.expanded.has("helper"));
});

test("mode changes refresh filtered rows after the event and restore focus to a slotted control", () => {
  const listeners = {}, nodes = new Map(), updates = [], frames = [];
  const remainingControl = {}, filterControl = {};
  let focused, mounted;
  const dropdown = control => ({ querySelector: () => control });
  const scope = vm.createContext({
    module: { exports: {} }, require: () => discovery, AbortController,
    queueMicrotask: callback => updates.push(callback),
    requestAnimationFrame: callback => frames.push(callback),
    HTMLElement: { prototype: { focus() { focused = this; } } }
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, "..", "certificate-review.js"), "utf8"), scope);
  const component = scope.module.exports;
  const host = {
    querySelector(selector) {
      if (selector === '[data-cr-mode]:not([disabled])') return component.matches(mounted.state).length ? dropdown(remainingControl) : null;
      if (selector === '#crModeFilter') return dropdown(filterControl);
      if (!nodes.has(selector)) nodes.set(selector, { innerHTML: '', toggleAttribute(name, force) { assert.equal(typeof force, 'boolean'); this[name] = force; }, setAttribute() {} });
      return nodes.get(selector);
    },
    querySelectorAll: selector => selector === '[data-cr-save], #crSaveMore' ? ['[data-cr-save="primary"]', '[data-cr-save="secondary"]', '#crSaveMore'].map(key => host.querySelector(key)) : [],
    addEventListener: (name, listener) => { listeners[name] = listener; }
  };
  mounted = component.mount(host, { candidates: discovery.normalize([
    { name: "Sync", file: "Sync.exe", kind: "helper" },
    { name: "Updater", file: "Updater.exe", kind: "helper" }
  ], { id: "cert", thumb: "A" }, []) });
  assert.equal(nodes.get('[data-cr-save="primary"]').disabled, false);
  assert.equal(nodes.get('#crSaveMore').disabled, false);
  function changeMode(index, mode) {
    const element = { value: mode, dataset: { crMode: String(index) }, closest: selector => selector === '[data-cr-mode]' ? element : null };
    listeners.change({ target: element });
  }
  function flush() {
    while (updates.length) updates.shift()();
    while (frames.length) frames.shift()();
  }
  const results = nodes.get('.cr-results'), initialHTML = results.innerHTML;
  changeMode(0, "app");
  assert.equal(results.innerHTML, initialHTML);
  assert.equal(updates.length, 0);
  changeMode(0, "analytics");
  mounted.state.filtersExpanded = true;
  listeners.change({ target: { id: 'crModeFilter', value: 'analytics', closest: () => null } });
  assert.match(results.innerHTML, /data-cr-row="0"/);
  changeMode(0, "app");
  assert.match(results.innerHTML, /data-cr-row="0"/);
  flush();
  assert.doesNotMatch(results.innerHTML, /data-cr-row="0"/);
  assert.match(results.innerHTML, /data-cr-row="1"/);
  assert.equal(focused, remainingControl);
  changeMode(1, "none");
  flush();
  assert.match(results.innerHTML, /No matching executables/);
  assert.doesNotMatch(results.innerHTML, /selections are unchanged/);
  assert.equal(focused, filterControl);
  assert.equal(mounted.state.candidates[0].mode, "app");
  assert.equal(mounted.state.candidates[1].mode, "none");
  mounted.dispose();
});

test("analytics-only selections route to Analytics and have no app entries in the preview", () => {
  const state = review.createState(discovery.normalize([{ name: "Sync Service", kind: "process" }], { id: "cert", thumb: "A" }, []));
  assert.equal(review.destination(state), "analytics");
  assert.match(review.summaryHTML(state), /<strong>0<\/strong> apps/);
  review.setMode(state, 0, "none");
  assert.equal(review.destination(state), "close");
  assert.equal(review.changed(state), true);
});

test("the compact summary omits irrelevant zeros and save actions keep both destinations", () => {
  const candidates = discovery.normalize([{ name: "Reader", kind: "app" }], { id: "cert", thumb: "A" }, []);
  const initial = review.createState(candidates);
  assert.equal(review.summaryHTML(initial), '<span><strong>1</strong> app</span>');
  assert.deepEqual(review.saveActions(initial), {
    primary: { label: 'Save and view apps', destination: 'apps' },
    secondary: { label: 'Save and close', destination: 'close' }
  });
  const editing = review.createState(candidates, { managing: true });
  assert.deepEqual(review.saveActions(editing), {
    primary: { label: 'Save changes', destination: 'close' },
    secondary: { label: 'Save and view apps', destination: 'apps' }
  });
  review.setMode(initial, 0, 'analytics');
  assert.equal(review.saveActions(initial).primary.label, 'Save and view analytics');
  review.setMode(initial, 0, 'none');
  assert.deepEqual(review.saveActions(initial), {
    primary: { label: 'Save changes', destination: 'close' }, secondary: null
  });
});

const source = fs.readFileSync(path.join(__dirname, "..", "portal.js"), "utf8");
const saveStart = source.indexOf("  function saveCertificateTracking(");
const saveEnd = source.indexOf('  // After a cert scan:', saveStart);
assert.ok(saveStart >= 0 && saveEnd > saveStart);
const handler = source.slice(saveStart, saveEnd);

function harness({ managing = false, removeAll = false, failSave = false, accountChanged = false, analyticsOnly = false } = {}) {
  const cert = { id: "cert", label: "Publisher", thumb: "A".repeat(40), trust: "Valid" };
  const app = { id: "existing", name: "Reader", certId: cert.id, discoveryKey: "p:c:/reader.exe", discoveredAt: 123 };
  const candidates = discovery.normalize([{ name: "Reader", file: "Reader.exe", path: "c:/reader.exe", kind: "app" }], cert, managing ? [app] : []);
  candidates.forEach(c => { if (removeAll) c.mode = "none"; if (analyticsOnly) c.mode = "analytics"; });
  const events = [];
  let callbacks;
  const focus = () => events.push("focus-origin");
  const origin = { classList: { contains: () => true }, querySelector: () => null, querySelectorAll: () => [{ focus, getClientRects: () => [{}] }] };
  const host = { querySelector: () => ({ focus() {} }) };
  const scope = vm.createContext({
    context: { managing, owner: "owner", certs: [cert], returnView: "certificates" },
    candidates, state: { apps: managing ? [app] : [], certs: [cert] }, discovery,
    discoveryOwner: () => accountChanged ? "someone-else" : "owner",
    certById: id => id === cert.id ? cert : null,
    $: id => id === "certificate-review" ? host : origin,
    window: { CertificateReview: { mount: (_, options) => { callbacks = options; return { dispose: () => events.push("dispose") }; } } },
    certificateReviewSession: null, certDiscoveryActive: true, appIcoImg() {}, uid: () => "new-app", today: () => "Sep 17, 2026",
    save: () => { events.push("save"); return !failSave; },
    appsActiveTab: "store", renderAll: () => events.push("render"),
    anaScope: "apps", anaRelatedApp: "", anaBackgroundCert: "", anaTab: "crashes", anaFailure: null, analyticsAppId: null,
    goView: view => events.push("view:" + view),
    toast: () => events.push("toast")
  });
  vm.runInContext(handler, scope);
  scope.showCertAppPicker(candidates, scope.context); events.length = 0;
  return { scope, events, confirm: destination => callbacks.onSave(candidates, destination), cancel: () => callbacks.onClose() };
}

test("Save and close persists initial choices and stays on the originating page", () => {
  const { scope, events, confirm } = harness();
  confirm("close");
  assert.equal(scope.state.apps.length, 1);
  assert.equal(scope.state.certs[0].appSelectionReviewed, true);
  assert.ok(events.indexOf("save") < events.indexOf("dispose"));
  assert.ok(events.includes("focus-origin"));
  assert.ok(events.includes("view:certificates"));
});

test("Save and view apps persists the same choices before navigating to Apps", () => {
  const { scope, events, confirm } = harness();
  confirm("apps");
  assert.equal(scope.state.apps.length, 1);
  assert.equal(scope.appsActiveTab, "signed");
  assert.ok(events.indexOf("save") < events.indexOf("view:apps"));
  assert.ok(!events.includes("focus-origin"));
});

test("either save outcome can confirm removing every previously selected app", () => {
  for (const target of ["close", "apps"]) {
    const { scope, events, confirm } = harness({ managing: true, removeAll: true });
    confirm(target);
    assert.equal(scope.state.apps.length, 0);
    assert.ok(events.includes("save"));
    assert.equal(events.includes("view:apps"), target === "apps");
  }
});

test("failed persistence rolls back both collections and neither closes nor navigates", () => {
  for (const target of ["close", "apps", "analytics"]) {
    const { scope, events, confirm } = harness({ failSave: true });
    const previousApps = scope.state.apps, previousCerts = scope.state.certs;
    const result = confirm(target);
    assert.equal(scope.state.apps, previousApps);
    assert.equal(scope.state.certs, previousCerts);
    assert.deepEqual(events, ["save"]);
    assert.match(result.error, /could not save/);
  }
});

test("rapidly activating both save buttons cannot duplicate saves or override the first destination", () => {
  const { scope, events, confirm } = harness();
  confirm("close");
  confirm("apps");
  assert.equal(events.filter(e => e === "save").length, 1);
  assert.ok(!events.includes("view:apps"));
  assert.equal(scope.state.apps.length, 1);
});

test("cancelling the full-page review discards choices but preserves the certificate", () => {
  const { scope, events, confirm, cancel } = harness();
  cancel(); confirm("apps");
  assert.equal(scope.state.apps.length, 0);
  assert.equal(scope.state.certs.length, 1);
  assert.ok(!events.includes("save"));
  assert.ok(events.includes("view:certificates"));
});

test("an account change prevents either save destination from writing or navigating", () => {
  const { events, confirm } = harness({ accountChanged: true });
  const result = confirm("apps");
  assert.deepEqual(events, []);
  assert.match(result.error, /account or certificate changed/);
});

test("saving analytics-only entries opens their crash analytics without adding apps", () => {
  const { scope, events, confirm } = harness({ analyticsOnly: true });
  confirm("analytics");
  assert.equal(scope.state.apps.length, 0);
  assert.equal(scope.state.certs[0].executables.length, 1);
  assert.equal(scope.anaScope, "background");
  assert.equal(scope.analyticsAppId, "new-app");
  assert.ok(events.includes("view:analytics"));
});
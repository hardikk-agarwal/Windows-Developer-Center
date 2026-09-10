"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const discovery = require("../certificate-discovery.js");

const source = fs.readFileSync(path.join(__dirname, "..", "portal.js"), "utf8");
const helperStart = source.indexOf("  function certPickerIntro(managing) {");
const helperEnd = source.indexOf("  function showCertAppPicker(", helperStart);
assert.ok(helperStart >= 0 && helperEnd > helperStart);
const helpers = vm.createContext({});
vm.runInContext(source.slice(helperStart, helperEnd), helpers);

test("picker copy describes the task without backend or demo disclaimers", () => {
  for (const managing of [true, false]) {
    const copy = helpers.certPickerIntro(managing);
    assert.match(copy, /Select the apps you want to track/);
    assert.doesNotMatch(copy, /sample|demo|offline|discovery|verified|signed by/i);
  }
  assert.match(helpers.certPickerIntro(false), /Recommended apps are preselected/);
  assert.doesNotMatch(helpers.certPickerIntro(true), /preselected/);
});

test("editing offers two distinct save outcomes and a non-saving cancel", () => {
  const html = helpers.certPickerActionsHTML(true, true);
  assert.match(html, /data-cpk-close>Cancel/);
  assert.match(html, /appearance="outline" data-cpk-confirm="close">Save and close/);
  assert.match(html, /appearance="primary" data-cpk-confirm="apps">Save and view apps/);
  assert.equal((html.match(/appearance="primary"/g) || []).length, 1);
  assert.equal((html.match(/data-cpk-confirm=/g) || []).length, 2);
});

test("first-time selection has an explicit Select later exit without saving", () => {
  const html = helpers.certPickerActionsHTML(true, false);
  assert.match(html, /appearance="transparent" data-cpk-close>Select later/);
  assert.doesNotMatch(html, />Cancel/);
  assert.equal((html.match(/data-cpk-confirm=/g) || []).length, 2);
});

test("an empty discovery result offers Close without save actions", () => {
  const html = helpers.certPickerActionsHTML(false);
  assert.match(html, /data-cpk-close>Close/);
  assert.doesNotMatch(html, /data-cpk-confirm/);
});

const saveStart = source.indexOf("    function confirmSelection(destination) {");
const saveEnd = source.indexOf('    dlg.querySelectorAll("[data-cpk-confirm]").forEach', saveStart);
assert.ok(saveStart >= 0 && saveEnd > saveStart);
const handler = source.slice(saveStart, saveEnd);

function harness({ managing = false, removeAll = false, failSave = false, accountChanged = false } = {}) {
  const cert = { id: "cert", label: "Publisher", thumb: "A".repeat(40), trust: "Valid" };
  const app = { id: "existing", name: "Reader", certId: cert.id, discoveryKey: "p:c:/reader.exe", discoveredAt: 123 };
  const candidates = discovery.normalize([{ name: "Reader", file: "Reader.exe", path: "c:/reader.exe", kind: "app" }], cert, managing ? [app] : []);
  candidates.forEach(c => { c.initialSelected = c.selected; if (removeAll) c.selected = false; });
  const events = [], error = { hidden: true, textContent: "" };
  const scope = vm.createContext({
    committed: false, context: { managing, owner: "owner", certs: [cert], returnView: "certificates" },
    candidates, state: { apps: managing ? [app] : [], certs: [cert] }, discovery,
    selected: () => candidates.filter(c => c.selected),
    changed: () => candidates.some(c => c.selected !== c.initialSelected),
    discoveryOwner: () => accountChanged ? "someone-else" : "owner",
    certById: id => id === cert.id ? cert : null,
    dlg: { querySelector: () => error }, uid: () => "new-app", today: () => "Sep 10, 2026",
    save: () => { events.push("save"); return !failSave; },
    syncSelection: () => events.push("sync"), close: () => events.push("close"),
    appsActiveTab: "store", renderAll: () => events.push("render"),
    goView: view => events.push("view:" + view), restoreTriggerFocus: () => events.push("focus-origin"),
    toast: () => events.push("toast")
  });
  vm.runInContext(handler, scope);
  return { scope, events, error };
}

test("Save and close persists initial choices and stays on the originating page", () => {
  const { scope, events } = harness();
  scope.confirmSelection("close");
  assert.equal(scope.state.apps.length, 1);
  assert.equal(scope.state.certs[0].appSelectionReviewed, true);
  assert.ok(events.indexOf("save") < events.indexOf("close"));
  assert.ok(events.includes("focus-origin"));
  assert.ok(!events.some(e => e.startsWith("view:")));
});

test("Save and view apps persists the same choices before navigating to Apps", () => {
  const { scope, events } = harness();
  scope.confirmSelection("apps");
  assert.equal(scope.state.apps.length, 1);
  assert.equal(scope.appsActiveTab, "signed");
  assert.ok(events.indexOf("save") < events.indexOf("view:apps"));
  assert.ok(!events.includes("focus-origin"));
});

test("either save outcome can confirm removing every previously selected app", () => {
  for (const target of ["close", "apps"]) {
    const { scope, events } = harness({ managing: true, removeAll: true });
    scope.confirmSelection(target);
    assert.equal(scope.state.apps.length, 0);
    assert.ok(events.includes("save"));
    assert.equal(events.includes("view:apps"), target === "apps");
  }
});

test("failed persistence rolls back both collections and neither closes nor navigates", () => {
  for (const target of ["close", "apps"]) {
    const { scope, events, error } = harness({ failSave: true });
    const previousApps = scope.state.apps, previousCerts = scope.state.certs;
    scope.confirmSelection(target);
    assert.equal(scope.state.apps, previousApps);
    assert.equal(scope.state.certs, previousCerts);
    assert.deepEqual(events, ["save"]);
    assert.equal(error.hidden, false);
    assert.equal(scope.committed, false);
  }
});

test("rapidly activating both save buttons cannot duplicate saves or override the first destination", () => {
  const { scope, events } = harness();
  scope.confirmSelection("close");
  scope.confirmSelection("apps");
  assert.equal(events.filter(e => e === "save").length, 1);
  assert.ok(!events.includes("view:apps"));
  assert.equal(scope.state.apps.length, 1);
});

test("unchanged edits and invalid destinations do not save", () => {
  const unchanged = harness({ managing: true });
  unchanged.scope.confirmSelection("close");
  unchanged.scope.confirmSelection("apps");
  assert.deepEqual(unchanged.events, []);
  const invalid = harness();
  invalid.scope.confirmSelection("elsewhere");
  assert.deepEqual(invalid.events, []);
});

test("an account change prevents either save destination from writing or navigating", () => {
  const { scope, events, error } = harness({ accountChanged: true });
  scope.confirmSelection("apps");
  assert.deepEqual(events, []);
  assert.equal(error.hidden, false);
});
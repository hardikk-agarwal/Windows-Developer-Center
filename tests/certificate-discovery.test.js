"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const discovery = require("../certificate-discovery.js");
const cert = { id: "cert-a", thumb: "A".repeat(40), label: "Example Publisher" };

test("reference-feed product names and scientific-notation engagement are supported", () => {
  const items = discovery.normalize([
    { ProductName: "OBS Studio", TotalEngagementDurationMS: "5.21166E+13" },
    { ProductName: "obs updater", TotalEngagementDurationMS: "59558613552" },
    { ProductName: "OBS-BROWSER-PAGE.EXE", TotalEngagementDurationMS: "3865516" }
  ], cert);
  assert.equal(items[0].engagementMs, 52116600000000);
  assert.deepEqual(items.map(c => c.selected), [true, false, false]);
  assert.equal(items[2].file, "OBS-BROWSER-PAGE.EXE");
});

test("activity never promotes a known service or an ambiguous executable", () => {
  const items = discovery.normalize([
    { ProductName: "High Activity Service", kind: "process", TotalEngagementDurationMS: 9e14 },
    { ProductName: "AWCCOVERLAY.EXE", TotalEngagementDurationMS: 9e14 },
    { ProductName: "Low Activity App", kind: "app", TotalEngagementDurationMS: 0 }
  ], cert);
  assert.deepEqual(items.map(c => c.recommended), [false, false, true]);
  assert.equal(discovery.view(items)[0].name, "Low Activity App");
});

test("the simple checklist sorts by name within recommendation groups, not engagement", () => {
  const items = discovery.normalize([
    { ProductName: "Zebra", kind: "app", engagementMs: 9e14 },
    { ProductName: "Access", kind: "app", engagementMs: 1 },
    { ProductName: "Background service", kind: "process", engagementMs: 9e15 }
  ], cert);
  assert.deepEqual(discovery.view(items, { sort: "name" }).map(c => c.name), ["Access", "Zebra", "Background service"]);
});

test("normalization deduplicates Windows paths and retains already-added apps", () => {
  const rows = [{ name: "Notes", path: "C:\\Apps\\Notes.exe", file: "Notes.exe", kind: "app" },
    { name: "Notes", path: "c:/apps/notes.exe", TotalEngagementDurationMS: 3000 }];
  const items = discovery.normalize(rows, cert, [{ id: "existing", discoveryKey: "p:C:\\Apps\\Notes.exe" }]);
  assert.equal(items.length, 1);
  assert.equal(items[0].existingId, "existing");
  assert.equal(items[0].engagementMs, 3000);
});

test("missing paths never collapse unrelated product-name rows or different certificates", () => {
  const items = discovery.normalize([{ ProductName: "Alpha" }, { ProductName: "Beta" }], cert);
  const otherCert = discovery.normalize([{ ProductName: "Alpha" }], { ...cert, thumb: "B".repeat(40) });
  assert.notEqual(items[0].key, items[1].key);
  assert.notEqual(items[0].key, otherCert[0].key);
});

test("Start menu launchers are suggestions but uninstallers remain unselected", () => {
  const items = discovery.normalize([{ name: "Launcher.exe", hasStartMenuEntry: true },
    { name: "Uninstall Example", file: "Uninstaller.exe", hasStartMenuEntry: true }], cert);
  assert.deepEqual(items.map(c => c.recommended), [true, false]);
});

test("search, grouping, and sorting preserve choices for thousands of results", () => {
  const rows = Array.from({ length: 2000 }, (_, i) => ({ ProductName: "Example " + i, kind: i % 2 ? "process" : "app", engagementMs: i }));
  const items = discovery.normalize(rows, cert);
  items[0].selected = false;
  items[1999].selected = true;
  assert.equal(discovery.view(items, { group: "selected" }).length, 1000);
  assert.equal(discovery.view(items, { query: "Example 1999", group: "selected" })[0].name, "Example 1999");
  assert.equal(items[0].selected, false);
  assert.equal(items[1999].selected, true);
  assert.notEqual(discovery.view(items), items);
});

test("invalid or unavailable engagement stays unknown, and unknown items remain selectable", () => {
  const items = discovery.normalize([null, {}, { ProductName: "Tool.exe", engagementMs: "bad" },
    { ProductName: "Helper.exe", engagementMs: -10 }, { ProductName: "Notes", engagementMs: 0 }], cert);
  assert.equal(items.length, 3);
  assert.equal(items[0].engagementMs, null);
  assert.equal(items[1].engagementMs, null);
  assert.equal(discovery.formatEngagement(null), "Not available");
  assert.equal(discovery.formatEngagement(0), "0 h");
  items[0].selected = true;
  assert.ok(discovery.view(items, { group: "selected" }).includes(items[0]));
});

test("analytics pending is app-specific, lasts 24 hours, and does not affect Store apps", () => {
  const now = Date.now();
  const app = { discovered: true, discoveredAt: now };
  assert.equal(discovery.isAnalyticsPending(app, now), true);
  assert.equal(discovery.isAnalyticsPending(app, now + discovery.ANALYTICS_DELAY_MS - 1), true);
  assert.equal(discovery.isAnalyticsPending(app, now + discovery.ANALYTICS_DELAY_MS), false);
  assert.equal(discovery.isAnalyticsPending({ ...app, store: true }, now), false);
  assert.equal(discovery.isAnalyticsPending({ discovered: true }, now), false);
  assert.equal(discovery.isAnalyticsPending({ ...app, discoveredAt: "invalid" }, now), false);
});

test("certificate rotation is explicitly selectable without duplicating the existing app", () => {
  const [item] = discovery.normalize([{ name: "Notes", path: "c:/apps/notes.exe", kind: "app" }], cert,
    [{ id: "notes", certId: "old-cert", discoveryKey: "p:c:/apps/notes.exe" }]);
  assert.equal(item.existingId, null);
  assert.equal(item.relinkId, "notes");
  assert.equal(item.selected, false);
});

test("editing choices removes deselected apps and preserves retained IDs and analytics timestamps", () => {
  const apps = [
    { id: "notes", name: "Notes", certId: cert.id, discoveryKey: "p:c:/notes.exe", discovered: true, discoveredAt: 1000 },
    { id: "reader", name: "Reader", certId: cert.id, discoveryKey: "p:c:/reader.exe", discovered: true, discoveredAt: 2000 },
    { id: "unrelated", name: "Other app", certId: "other-cert" }
  ];
  const rows = [{ name: "Notes", path: "c:/notes.exe", kind: "app" }, { name: "Reader", path: "c:/reader.exe", kind: "app" },
    { name: "New editor", path: "c:/editor.exe", kind: "app" }];
  const candidates = discovery.normalize(rows, cert, apps);
  assert.equal(candidates[0].locked, false);
  assert.equal(candidates[2].selected, false);
  candidates[0].selected = false;
  candidates[2].selected = true;
  const next = discovery.applySelection(candidates, [cert], apps, { createId: () => "new-editor", now: 5000 });
  assert.deepEqual(next.apps.map(a => a.id), ["reader", "unrelated", "new-editor"]);
  assert.equal(next.apps[0], apps[1]);
  assert.equal(next.apps[0].discoveredAt, 2000);
  assert.equal(next.apps[2].discoveredAt, 5000);
  assert.equal(apps.length, 3);
  assert.equal(cert.appSelections, undefined);
  assert.deepEqual(discovery.normalize(rows, next.certs[0], next.apps).map(c => c.selected), [false, true, true]);
});

test("tracked apps absent from a scan remain editable rather than disappearing", () => {
  const apps = [{ id: "stopped", name: "Stopped app", certId: cert.id, discoveryKey: "p:c:/stopped.exe", discovered: true }];
  const [candidate] = discovery.normalize([], cert, apps);
  assert.equal(candidate.existingId, "stopped");
  assert.equal(candidate.selected, true);
  assert.equal(candidate.locked, false);
  candidate.selected = false;
  const next = discovery.applySelection([candidate], [cert], apps, { createId: () => "unused" });
  assert.deepEqual(next.apps, []);
  assert.equal(next.removed, 1);
  assert.equal(next.certs[0].appSelectionReviewed, true);
  assert.equal(next.certs[0].appSelections[candidate.key], false);
});

test("deselecting every editable item never deletes Store apps or other certificates' apps", () => {
  const apps = [
    { id: "signed", name: "Signed", certId: cert.id, discoveryKey: "p:c:/signed.exe", discovered: true },
    { id: "live", name: "Published", certId: cert.id, discoveryKey: "p:c:/live.exe", store: true },
    { id: "draft", name: "Draft", certId: cert.id, discoveryKey: "p:c:/draft.exe", storeStatus: "in-progress" },
    { id: "other", name: "Other", certId: "other-cert" }
  ];
  const candidates = discovery.normalize([], cert, apps);
  candidates.forEach(c => { c.selected = false; });
  const next = discovery.applySelection(candidates, [cert], apps, { createId: () => "unused" });
  assert.deepEqual(next.apps.map(a => a.id), ["live", "draft", "other"]);
  assert.equal(next.removed, 1);
  assert.equal(next.apps[0], apps[1]);
});

test("saving unchanged selections cannot duplicate an app or reset its analytics", () => {
  const app = { id: "retained", name: "Retained", certId: cert.id, discoveryKey: "p:c:/retained.exe", discovered: true, discoveredAt: 123 };
  const candidates = discovery.normalize([], cert, [app]);
  const next = discovery.applySelection(candidates, [cert], [app], { createId: () => { throw new Error("Unexpected new app"); } });
  assert.equal(next.apps[0], app);
  assert.equal(next.added, 0);
  assert.equal(next.removed, 0);
});
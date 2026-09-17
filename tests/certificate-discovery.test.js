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

test("main executables default to Apps while useful helpers default to analytics only", () => {
  const items = discovery.normalize([{ name: "Studio", file: "Studio.exe", kind: "app" },
    { name: "Studio Sync Service", file: "Sync.exe", kind: "process" },
    { name: "Studio Installer", file: "Setup.exe", kind: "process" }, { name: "UNKNOWN.EXE" }], cert, []);
  assert.deepEqual(items.map(item => item.mode), ["app", "analytics", "none", "none"]);
  assert.deepEqual(items.map(item => item.suggestedRole), ["app", "helper", "helper", "review"]);
  let id = 0;
  const next = discovery.applyTrackingSelection(items, [cert], [], { createId: () => "target-" + ++id, now: 1000 });
  assert.deepEqual(next.apps.map(app => app.name), ["Studio"]);
  assert.equal(discovery.executableTargets(next.certs, next.apps).length, 2);
  assert.equal(discovery.trackingCounts(next.certs[0], next.apps).analyticsOnly, 1);
});

test("an analytics-only setup can be saved and promoted or demoted without resetting history", () => {
  const rows = [{ name: "Sync Service", file: "Sync.exe", kind: "process" }];
  let id = 0;
  const options = { createId: () => "target-" + ++id, now: 1000 };
  let next = discovery.applyTrackingSelection(discovery.normalize(rows, cert, []), [cert], [], options);
  assert.equal(next.apps.length, 0);
  assert.equal(next.certs[0].appSelectionReviewed, true);
  const original = next.certs[0].executables[0];
  let candidates = discovery.normalize(rows, next.certs[0], next.apps);
  candidates[0].mode = "app";
  next = discovery.applyTrackingSelection(candidates, next.certs, next.apps, { ...options, now: 9000 });
  assert.equal(next.apps[0].id, original.id);
  assert.equal(next.apps[0].discoveredAt, 1000);
  candidates = discovery.normalize(rows, next.certs[0], next.apps);
  candidates[0].mode = "analytics";
  next = discovery.applyTrackingSelection(candidates, next.certs, next.apps, { ...options, now: 10000 });
  assert.equal(next.apps.length, 0);
  assert.equal(next.certs[0].executables[0].id, original.id);
  assert.equal(next.certs[0].executables[0].discoveredAt, 1000);
});

test("excluding and re-enabling an executable preserves its identity and explicit override", () => {
  const rows = [{ name: "Sync Service", file: "Sync.exe", kind: "process" }];
  const options = { createId: () => "sync-target", now: 1000 };
  let next = discovery.applyTrackingSelection(discovery.normalize(rows, cert, []), [cert], [], options);
  let items = discovery.normalize(rows, next.certs[0], next.apps);
  items[0].mode = "none";
  next = discovery.applyTrackingSelection(items, next.certs, next.apps, options);
  assert.equal(discovery.executableTargets(next.certs, next.apps).length, 0);
  items = discovery.normalize([{ ...rows[0], recommendedAnalytics: true }], next.certs[0], next.apps);
  assert.equal(items[0].mode, "none");
  items[0].mode = "analytics";
  next = discovery.applyTrackingSelection(items, next.certs, next.apps, { ...options, now: 5000 });
  assert.equal(next.certs[0].executables[0].id, "sync-target");
  assert.equal(next.certs[0].executables[0].discoveredAt, 1000);
});

test("legacy apps and Store-protected entries survive migration and unrelated certificates are untouched", () => {
  const otherCert = { ...cert, id: "other", thumb: "B".repeat(40) };
  const apps = [{ id: "legacy", certId: cert.id, name: "Editor", file: "Editor.exe", discoveredAt: 123 },
    { id: "store", certId: cert.id, name: "Published", file: "Published.exe", store: true }, { id: "other", certId: otherCert.id }];
  const items = discovery.normalize([], cert, apps);
  items.forEach(item => { item.mode = "analytics"; });
  const next = discovery.applyTrackingSelection(items, [cert, otherCert], apps, { createId: () => { throw new Error("Unexpected identity change"); } });
  assert.deepEqual(next.apps.map(app => app.id), ["store", "other"]);
  assert.equal(next.certs[1], otherCert);
  assert.equal(next.certs[0].executables.find(item => item.id === "legacy").discoveredAt, 123);
});

test("retained helpers missing from a scan stay editable and recommendations never overwrite saved choices", () => {
  const rows = [{ name: "Sync Service", file: "Sync.exe", kind: "process" }];
  const next = discovery.applyTrackingSelection(discovery.normalize(rows, cert, []), [cert], [], { createId: () => "sync" });
  const missing = discovery.normalize([], next.certs[0], next.apps);
  assert.equal(missing.length, 1);
  assert.equal(missing[0].mode, "analytics");
  assert.equal(missing[0].missingFromScan, true);
  assert.equal(discovery.normalize([{ ...rows[0], kind: "app" }], next.certs[0], next.apps)[0].mode, "analytics");
});

test("a reliable application identity groups versions into one app but retains executable analytics", () => {
  const rows = [{ name: "Editor x64", productName: "Editor", file: "Editor.exe", path: "c:/editor/x64/editor.exe", kind: "app", applicationId: "editor" },
    { name: "Editor ARM64", productName: "Editor", file: "Editor.exe", path: "c:/editor/arm64/editor.exe", kind: "app", applicationId: "editor" },
    { name: "Editor", file: "DifferentEditor.exe", path: "c:/other/editor.exe", kind: "app" }];
  let id = 0;
  const options = { createId: () => "target-" + ++id, now: 123 };
  let items = discovery.normalize(rows, cert, []);
  assert.equal(discovery.reviewCounts(items).apps, 2);
  let next = discovery.applyTrackingSelection(items, [cert], [], options);
  assert.equal(next.apps.length, 2);
  assert.equal(next.certs[0].executables.length, 3);
  const grouped = next.apps.find(app => app.applicationKey === "editor");
  assert.ok(!next.certs[0].executables.some(target => target.id === grouped.id));
  assert.equal(next.certs[0].executables.filter(target => target.appId === grouped.id).length, 2);
  items = discovery.normalize(rows, next.certs[0], next.apps);
  items[0].mode = "analytics";
  next = discovery.applyTrackingSelection(items, next.certs, next.apps, options);
  assert.equal(next.apps.length, 2);
  assert.ok(next.apps.some(app => app.id === grouped.id));
  assert.equal(next.certs[0].executables[0].discoveredAt, 123);
  const withoutMetadata = discovery.normalize(rows.map(row => ({ ...row, applicationId: undefined })), next.certs[0], next.apps);
  assert.equal(discovery.reviewCounts(withoutMetadata).apps, 2);
});

test("moving a tracked helper to a rotated certificate preserves history without an app entry", () => {
  const other = { ...cert, id: "rotated", thumb: "B".repeat(40) };
  const rows = [{ name: "Sync Service", file: "Sync.exe", path: "c:/sync.exe", kind: "process" }];
  const previous = discovery.applyTrackingSelection(discovery.normalize(rows, cert, []), [cert, other], [], { createId: () => "sync-target", now: 123 });
  const items = discovery.normalize(rows, other, [], previous.certs);
  assert.equal(items[0].mode, "none");
  assert.equal(items[0].relinkTargetId, "sync-target");
  items[0].mode = "analytics";
  const next = discovery.applyTrackingSelection(items, previous.certs, previous.apps, { createId: () => { throw new Error("Must preserve identity"); }, now: 999 });
  assert.equal(next.apps.length, 0);
  assert.equal(next.certs[0].executables.length, 0);
  assert.equal(next.certs[1].executables[0].id, "sync-target");
  assert.equal(next.certs[1].executables[0].discoveredAt, 123);
});

test("analytics-only changes cannot demote or reassign another certificate's Store entry", () => {
  const other = { ...cert, id: "other-cert", thumb: "B".repeat(40) };
  const app = { id: "store-app", name: "Published", certId: cert.id, discoveryKey: "p:c:/published.exe", store: true };
  const items = discovery.normalize([{ name: "Published", file: "Published.exe", path: "c:/published.exe", kind: "app" }], other, [app], [cert, other]);
  assert.equal(items[0].storeManaged, true);
  items[0].mode = "analytics";
  const next = discovery.applyTrackingSelection(items, [cert, other], [app], { createId: () => "unused" });
  assert.equal(next.apps[0], app);
  assert.equal(next.apps[0].certId, cert.id);
  assert.equal(discovery.executableTargets(next.certs, next.apps).filter(target => target.certId === other.id).length, 0);
});

test("a friendly product name without a user-facing entry point does not create an app automatically", () => {
  const [item] = discovery.normalize([{ productName: "Windows Operating System", file: "BackgroundHost.exe", hasStartMenuEntry: false }], cert, []);
  assert.equal(item.suggestedRole, "review");
  assert.equal(item.mode, "none");
  item.mode = "app";
  const saved = discovery.applyTrackingSelection([item], [cert], [], { createId: () => "override" });
  assert.equal(saved.apps.length, 1);
});
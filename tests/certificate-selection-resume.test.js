"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const discovery = require("../certificate-discovery.js");

const source = fs.readFileSync(path.join(__dirname, "..", "portal.js"), "utf8");
const cert = { id: "resume-cert", label: "Example Publisher", thumb: "A".repeat(40), thumbKind: "cert", trust: "Valid", verified: true };
const rows = [
  { name: "Reader", file: "Reader.exe", kind: "app" },
  { name: "Notes", file: "Notes.exe", kind: "app" },
  { name: "Update service", file: "Updater.exe", kind: "process" }
];

function definition(name, next) {
  const start = source.indexOf("  function " + name + "("), end = source.indexOf("  function " + next + "(", start);
  assert.ok(start >= 0 && end > start);
  return source.slice(start, end);
}

function renderer(certs = [cert], apps = []) {
  const ctx = vm.createContext({
    discovery, state: { certs, apps }, scanning: false, scanningCertId: null, certDiscoveryActive: false,
    STORE: true, UNIFIED: true,
    esc: value => String(value).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]))
  });
  vm.runInContext(definition("canEditCertificateApps", "certRowHTML") + definition("emptyAnalyticsHTML", "anaRng"), ctx);
  return ctx;
}

test("review state recognizes saved choices and legacy linked apps, not discovery alone", () => {
  assert.equal(discovery.hasReviewedSelection(cert, []), false);
  assert.equal(discovery.hasReviewedSelection({ ...cert, discoverySummary: { identified: 3, source: "live" } }, []), false);
  assert.equal(discovery.hasReviewedSelection({ ...cert, appSelectionReviewed: true }, []), true);
  assert.equal(discovery.hasReviewedSelection({ ...cert, appSelections: { old: false } }, []), true);
  assert.equal(discovery.hasReviewedSelection(cert, [{ certId: cert.id }]), true);
  assert.equal(discovery.hasReviewedSelection(cert, [{ certId: "other" }]), false);
});

test("legacy all-clear choices stay unchecked when new recommendations appear", () => {
  const items = discovery.normalize(rows, { ...cert, appSelections: { old: false } }, []);
  assert.ok(items.every(c => !c.selected));
});

test("an unreviewed saved certificate has a persistent, directly actionable next step", () => {
  const saved = JSON.parse(JSON.stringify({ ...cert, discoverySummary: { identified: 3, source: "live" } }));
  const ctx = renderer([saved]);
  assert.equal(ctx.certificateSelectionState(saved), "pending");
  assert.equal(ctx.certsNeedingAppSelection().length, 1);
  assert.match(ctx.certSelectionReminderHTML(), /Your certificate is saved/);
  assert.match(ctx.certSelectionReminderHTML(), /Select apps to get crash analytics/);
  assert.match(ctx.certSelectionReminderHTML(), /data-certreview-pending aria-haspopup="dialog"/);
  assert.match(ctx.certSelectionActionHTML(saved), /aria-label="Select apps for Example Publisher"/);
  assert.match(ctx.certSelectionStatsHTML(saved), /<strong>0<\/strong> selected as apps/);
  assert.match(ctx.certSelectionStatsHTML(saved), /Selection needed/);
  assert.doesNotMatch(ctx.certSelectionReminderHTML(), /sample|offline|unavailable|Preparing|ready|role="alert"/i);
});

test("reloading before discovery finishes still leaves a way to select apps", () => {
  const ctx = renderer();
  assert.equal(ctx.certificateSelectionState(cert), "pending");
  assert.match(ctx.certSelectionActionHTML(cert), />Select apps<\/fluent-button>/);
});

test("intentional all-clear and legacy linked Store apps do not get incomplete-setup reminders", () => {
  for (const saved of [{ ...cert, appSelectionReviewed: true }, { ...cert, appSelections: { old: false } }]) {
    const ctx = renderer([saved]);
    assert.equal(ctx.certificateSelectionState(saved), "reviewed");
    assert.equal(ctx.certSelectionReminderHTML(), "");
    assert.match(ctx.certSelectionActionHTML(saved), />Edit app selection<\/fluent-button>/);
  }
  const ctx = renderer([cert], [{ id: "store-app", certId: cert.id, store: true }]);
  assert.equal(ctx.certSelectionReminderHTML(), "");
});

test("a successful empty scan offers Check for apps, not a misleading selection reminder", () => {
  const saved = { ...cert, discoverySummary: { identified: 0, source: "live" } };
  const ctx = renderer([saved]);
  assert.equal(ctx.certificateSelectionState(saved), "not-found");
  assert.equal(ctx.certSelectionReminderHTML(), "");
  assert.match(ctx.certSelectionActionHTML(saved), />Check for apps<\/fluent-button>/);
  assert.match(ctx.emptyAnalyticsHTML(), /No apps found yet/);
});

test("invalid and unverified certificates cannot bypass ownership through resume actions", () => {
  for (const saved of [{ ...cert, verified: false }, { ...cert, trust: "NotTrusted" }]) {
    const ctx = renderer([saved]);
    assert.equal(ctx.certificateSelectionState(saved), "unavailable");
    assert.equal(ctx.certSelectionReminderHTML(), "");
    assert.equal(ctx.certSelectionActionHTML(saved), "");
  }
});

test("batch resume includes only certificates still needing selection", () => {
  const second = { ...cert, id: "second", thumb: "B".repeat(40) };
  const reviewed = { ...cert, id: "reviewed", appSelectionReviewed: true };
  const empty = { ...cert, id: "empty", discoverySummary: { identified: 0 } };
  const ctx = renderer([cert, second, reviewed, empty]);
  assert.deepEqual(Array.from(ctx.certsNeedingAppSelection(), c => c.id), [cert.id, second.id]);
  assert.match(ctx.certSelectionReminderHTML(), /2 certificates still need app selection/);
  ctx.certDiscoveryActive = true;
  assert.match(ctx.certSelectionReminderHTML(), /aria-haspopup="dialog" disabled/);
  ctx.scanning = true;
  assert.equal(ctx.certSelectionReminderHTML(), "");
});

test("empty Analytics resumes selection rather than requiring publishing or re-verification", () => {
  const ctx = renderer();
  for (const [store, unified] of [[true, true], [true, false], [false, false]]) {
    ctx.STORE = store; ctx.UNIFIED = unified;
    const html = ctx.emptyAnalyticsHTML();
    assert.match(html, /data-theme-image="data-trending"/);
    assert.match(html, /Select apps to get crash analytics/);
    assert.match(html, /data-certreview-pending/);
    assert.match(html, /24 hours.*after you save/);
    assert.doesNotMatch(html, /data-newapp|data-certmodal|publish|verify/i);
  }
});

test("Analytics respects an intentionally empty selection with a quiet edit action", () => {
  const ctx = renderer([{ ...cert, appSelectionReviewed: true }]);
  const html = ctx.emptyAnalyticsHTML();
  assert.match(html, /No apps selected for crash analytics/);
  assert.match(html, /data-certreview="resume-cert"/);
  assert.match(html, />Edit app selection<\/fluent-button>/);
  assert.doesNotMatch(html, /data-certreview-pending/);
});

test("no-certificate Analytics keeps its existing onboarding", () => {
  const ctx = renderer([]);
  assert.match(ctx.emptyAnalyticsHTML(), /data-newapp/);
  assert.doesNotMatch(ctx.emptyAnalyticsHTML(), /data-certreview/);
});

test("saving clears the reminder and starts analytics preparation at selection time", () => {
  const candidates = discovery.normalize(rows, cert, []);
  let id = 0;
  const saved = discovery.applySelection(candidates, [cert], [], { createId: () => "app-" + ++id, now: 90000 });
  const ctx = renderer(saved.certs, saved.apps);
  assert.equal(ctx.certSelectionReminderHTML(), "");
  assert.match(ctx.certSelectionActionHTML(saved.certs[0]), />Edit app selection<\/fluent-button>/);
  assert.ok(saved.apps.every(a => a.discoveredAt === 90000 && discovery.isAnalyticsPending(a, 90000)));
});

const scanStart = source.indexOf("  async function discoverCertApps("), scanEnd = source.indexOf("  function rescanApps(", scanStart);
const pickerStart = source.indexOf("  function showCertAppPicker(");
const releaseStart = source.indexOf("    function release()", pickerStart), focusStart = source.indexOf("    function restoreTriggerFocus()", releaseStart);
const closeStart = source.indexOf("    function close()", focusStart), closeEnd = source.indexOf('    dlg.addEventListener("toggle"', closeStart);
assert.ok(scanStart >= 0 && scanEnd > scanStart && releaseStart > pickerStart && closeEnd > closeStart);

test("closing before confirmation keeps the certificate, discards checkbox edits, and resumes first-time selection", async () => {
  const events = [], snapshots = [], shown = [];
  const ctx = vm.createContext({
    state: { certs: [{ ...cert }], apps: [] }, discovery: { ...discovery, requestJson: async () => ({ offline: false, data: rows }) },
    scanning: false, scanningCertId: null, certDiscoveryActive: false, backendOffline: false,
    document: { querySelector: () => ({ id: "certificates" }) }, AbortController, setTimeout, clearTimeout,
    discoveryOwner: () => "owner", renderAll: () => events.push("render"), renderCerts() {}, renderApps() {},
    showCertAppPicker: (items, context) => shown.push({ items, context }),
    committed: false, closed: false, dlg: { hide: () => events.push("hide") }, restoreTriggerFocus() {}, toast() {}
  });
  ctx.save = () => { snapshots.push(JSON.stringify(ctx.state)); return true; };
  vm.runInContext(source.slice(scanStart, scanEnd) + source.slice(releaseStart, focusStart) + source.slice(closeStart, closeEnd), ctx);
  await ctx.discoverCertApps(ctx.state.certs);
  assert.equal(shown[0].context.managing, false);
  shown[0].items.forEach(c => { c.selected = false; });
  ctx.close(); ctx.close();
  assert.equal(events.filter(e => e === "hide").length, 1);
  assert.equal(snapshots.length, 1);
  assert.equal(ctx.state.certs.length, 1);
  assert.equal(ctx.state.certs[0].discoverySummary.identified, 3);
  assert.equal(ctx.state.certs[0].appSelectionReviewed, undefined);
  assert.equal(ctx.state.certs[0].appSelections, undefined);
  assert.equal(ctx.state.apps.length, 0);
  ctx.state = JSON.parse(snapshots[0]);
  await ctx.discoverCertApps(ctx.state.certs);
  assert.equal(shown[1].context.managing, false);
  assert.deepEqual(Array.from(shown[1].items, c => c.selected), [true, true, false]);
});
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const discovery = require("../certificate-discovery.js");

const cert = { id: "summary-cert", label: "Example Publisher", thumb: "A".repeat(40), thumbKind: "cert", trust: "Valid", verified: true };
const rows = [
  { name: "Reader", file: "Reader.exe", path: "c:/apps/reader.exe", kind: "app" },
  { name: "Notes", file: "Notes.exe", path: "c:/apps/notes.exe", kind: "app" },
  { name: "Update Service", file: "Updater.exe", path: "c:/apps/updater.exe", kind: "process" },
  { name: "Reader", file: "Reader.exe", path: "C:\\Apps\\Reader.exe", kind: "app" }
];

test("identified counts include apps and processes once, not just preselected recommendations", () => {
  const candidates = discovery.normalize(rows, cert, []);
  const summary = discovery.summarizeDiscovery(candidates, cert.id, "live", 123);
  assert.deepEqual(summary, { identified: 3, source: "live", checkedAt: 123 });
  assert.deepEqual(discovery.selectionCounts({ ...cert, discoverySummary: summary }, []), { identified: 3, selected: 0, demo: false });
});

test("selection changes never overwrite the identified total", () => {
  const candidates = discovery.normalize(rows, cert, []);
  const scanned = { ...cert, discoverySummary: discovery.summarizeDiscovery(candidates, cert.id, "live") };
  let id = 0;
  const first = discovery.applySelection(candidates, [scanned], [], { createId: () => "app-" + ++id });
  assert.deepEqual(discovery.selectionCounts(first.certs[0], first.apps), { identified: 3, selected: 2, demo: false });
  const edit = discovery.normalize(rows, first.certs[0], first.apps);
  edit.forEach(c => { c.selected = false; });
  const next = discovery.applySelection(edit, first.certs, first.apps, { createId: () => "unused" });
  assert.deepEqual(discovery.selectionCounts(next.certs[0], next.apps), { identified: 3, selected: 0, demo: false });
});

test("counts stay certificate-scoped", () => {
  const other = { ...cert, id: "other", thumb: "B".repeat(40) };
  const candidates = discovery.normalize(rows, cert, []).concat(discovery.normalize(rows, other, []));
  const scanned = { ...cert, discoverySummary: discovery.summarizeDiscovery(candidates, cert.id, "live") };
  const apps = [{ id: "ours", certId: cert.id }, { id: "theirs", certId: other.id }];
  assert.deepEqual(discovery.selectionCounts(scanned, apps), { identified: 3, selected: 1, demo: false });
});

test("older records derive known totals from saved choices, never from the app count alone", () => {
  const apps = [{ id: "reader", certId: cert.id, discoveryKey: "p:c:/apps/reader.exe" }];
  assert.equal(discovery.selectionCounts(cert, apps).identified, null);
  const saved = { ...cert, appSelections: { "p:C:\\Apps\\Reader.exe": true, "p:c:/apps/updater.exe": false } };
  assert.deepEqual(discovery.selectionCounts(saved, apps), { identified: 2, selected: 1, demo: false });
});

test("zero discovery totals and demo totals are explicit", () => {
  assert.deepEqual(discovery.selectionCounts({ ...cert, discoverySummary: discovery.summarizeDiscovery([], cert.id, "live") }, []),
    { identified: 0, selected: 0, demo: false });
  assert.deepEqual(discovery.selectionCounts({ ...cert, discoverySummary: discovery.summarizeDiscovery(discovery.normalize(rows, cert, []), cert.id, "demo") }, []),
    { identified: 3, selected: 0, demo: true });
});

const source = fs.readFileSync(path.join(__dirname, "..", "portal.js"), "utf8");
function definition(name, next) {
  const start = source.indexOf("  function " + name + "("), end = source.indexOf("  function " + next + "(", start);
  assert.ok(start >= 0 && end > start);
  return source.slice(start, end);
}
function renderer(certificate, apps) {
  const context = vm.createContext({ discovery, state: { certs: [certificate], apps }, scanning: false, scanningCertId: null,
    certDiscoveryActive: false, STORE: true, esc: value => String(value).replace(/[&<>\"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])),
    trustPill: () => "Valid", fmtThumb: () => "AAAA", storeCertRowHTML: () => "<tr></tr>", appRowHTML: () => "<tr></tr>" });
  context.certById = id => context.state.certs.find(c => c.id === id);
  vm.runInContext(definition("canEditCertificateApps", "certRowHTML") + definition("certGroupHTML", "appsTabsHTML"), context);
  return context;
}

test("both surfaces expose one explicitly labeled action for the same certificate", () => {
  const ctx = renderer({ ...cert, discoverySummary: { identified: 3, source: "live" } }, [{ id: "a", certId: cert.id }]);
  const stats = ctx.certSelectionStatsHTML(ctx.state.certs[0]);
  assert.match(stats, /3 apps &amp; processes identified/);
  assert.match(stats, /<strong>1<\/strong> selected as an app/);
  const tableAction = ctx.certSelectionActionHTML(ctx.state.certs[0]);
  const group = ctx.certGroupsHTML(ctx.state.apps);
  for (const html of [tableAction, group]) {
    assert.match(html, /data-certreview="summary-cert"/);
    assert.match(html, /aria-haspopup="dialog"/);
    assert.match(html, />Edit app selection<\/fluent-button>/);
    assert.equal((html.match(/data-certreview=/g) || []).length, 1);
  }
});

test("clearing a certificate's app selection keeps its edit action on Apps", () => {
  const ctx = renderer({ ...cert, discoverySummary: { identified: 3, source: "live" } }, []);
  const html = ctx.certGroupsHTML([]);
  assert.match(html, /No non-Store apps selected/);
  assert.match(html, /<strong>0<\/strong> selected as apps/);
  assert.match(html, /data-certreview="summary-cert"/);
});

test("demo counts are never labeled as real identified software", () => {
  const ctx = renderer({ ...cert, discoverySummary: { identified: 12, source: "demo" } }, []);
  const html = ctx.certSelectionStatsHTML(ctx.state.certs[0]);
  assert.match(html, /12 items in demo list/);
  assert.doesNotMatch(html, /apps &amp; processes identified/);
});
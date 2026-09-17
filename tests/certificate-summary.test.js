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
    storeLocked: () => false, analyticsPending: discovery.isAnalyticsPending,
    canSubmitWin32Package: () => false,
    trustPill: () => "Valid", fmtThumb: () => "AAAA", storeCertRowHTML: () => "<tr></tr>", appRowHTML: () => "<tr></tr>" });
  context.certById = id => context.state.certs.find(c => c.id === id);
  vm.runInContext(source.slice(source.indexOf("  var ANA_TABS = ["), source.indexOf("  function lockedAnalyticsHTML(")), context);
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
    assert.doesNotMatch(html, /aria-haspopup="dialog"/);
    assert.match(html, />Edit app selection<\/fluent-button>/);
    assert.equal((html.match(/data-certreview=/g) || []).length, 1);
  }
});

test("clearing a certificate's app selection keeps its edit action on Apps", () => {
  const ctx = renderer({ ...cert, appSelectionReviewed: true, discoverySummary: { identified: 3, source: "live" } }, []);
  const html = ctx.certGroupsHTML([]);
  assert.match(html, /No non-Store apps selected/);
  assert.match(html, /class="signed-cert-count"><strong>0<\/strong> apps/);
  assert.match(html, /data-certreview="summary-cert"/);
});

test("the non-Store certificate header shows identity and count with the fingerprint on demand", () => {
  const ctx = renderer({ ...cert, trackingSelections: {}, discoverySummary: { identified: 1, source: 'live' } }, [{ id: 'app', certId: cert.id }]);
  const html = ctx.certGroupsHTML(ctx.state.apps);
  assert.match(html, /class="certcard signed-cert-header"/);
  assert.match(html, /aria-label="Signing certificate: Example Publisher"/);
  assert.match(html, /class="signed-cert-count"><strong>1<\/strong> app/);
  assert.match(html, /title="Certificate thumbprint: A{40}"/);
  assert.match(html, /aria-description="Certificate thumbprint: A{40}"/);
  assert.match(html, /class="signed-cert-identity">[\s\S]*signed-cert-count/);
  assert.doesNotMatch(html, /class="cert-ico|class="certfact|0 analytics only|signed-cert-fingerprint|>Active<|signed-cert-context/);
  assert.match(html, /data-certreview="summary-cert"/);
});

test("simplified certificate headers still display trust warnings", () => {
  const ctx = renderer({ ...cert, trust: 'Expired' }, [{ id: 'app', certId: cert.id }]);
  ctx.trustPill = trust => '<span class="pill pill--warn">' + trust + '</span>';
  assert.match(ctx.certGroupsHTML(ctx.state.apps), /class="signed-cert-context"><span class="pill pill--warn">Expired<\/span>/);
});

test("demo counts are never labeled as real identified software", () => {
  const ctx = renderer({ ...cert, discoverySummary: { identified: 12, source: "demo" } }, []);
  const html = ctx.certSelectionStatsHTML(ctx.state.certs[0]);
  assert.match(html, /12 items in demo list/);
  assert.doesNotMatch(html, /apps &amp; processes identified/);
});

test("compact certificate counts combine selected and identified with a full accessible description", () => {
  const ctx = renderer({ ...cert, discoverySummary: { identified: 6, source: "live" } },
    Array.from({ length: 6 }, (_, i) => ({ id: "app-" + i, certId: cert.id })));
  const html = ctx.certSelectionStatsHTML(ctx.state.certs[0], true);
  assert.match(html, /<strong>6<\/strong> <span class="cert-selection__identified">of 6<\/span> selected/);
  assert.match(html, /aria-label="6 apps selected\. 6 apps &amp; processes identified"/);
  assert.match(html, /role="group"/);
  assert.match(html, /aria-hidden="true"/);
  assert.doesNotMatch(html, /selected as apps|cert-selection__pending/);
  const action = ctx.certSelectionActionHTML(ctx.state.certs[0], "transparent", true);
  assert.match(action, /aria-label="Edit app selection for Example Publisher"/);
  assert.match(action, /data-certreview="summary-cert"/);
  assert.match(action, />Edit<\/fluent-button>/);
});

test("compact unfinished selection keeps Select apps without a redundant status line", () => {
  const ctx = renderer({ ...cert, discoverySummary: { identified: 6, source: "live" } }, []);
  assert.match(ctx.certSelectionStatsHTML(ctx.state.certs[0], true), /<strong>0<\/strong>.*of 6/);
  assert.doesNotMatch(ctx.certSelectionStatsHTML(ctx.state.certs[0], true), /Selection needed/);
  assert.match(ctx.certSelectionActionHTML(ctx.state.certs[0], "transparent", true), />Select apps<\/fluent-button>/);
});

test("compact counts never invent a denominator for unknown or stale totals", () => {
  const apps = [{ id: "app", certId: cert.id }];
  for (const saved of [cert, { ...cert, discoverySummary: { identified: 0, source: "live" } }]) {
    const ctx = renderer(saved, apps), html = ctx.certSelectionStatsHTML(saved, true);
    assert.match(html, /<strong>1<\/strong> selected/);
    assert.doesNotMatch(html, />of \d/);
  }
});

test("compact empty scans stay distinct from intentionally cleared selections", () => {
  const none = { ...cert, discoverySummary: { identified: 0, source: "live" } };
  const empty = renderer(none, []);
  assert.match(empty.certSelectionStatsHTML(none, true), />No apps found<\/span>/);
  assert.match(empty.certSelectionActionHTML(none, "transparent", true), />Check for apps<\/fluent-button>/);
  const cleared = { ...cert, appSelectionReviewed: true, discoverySummary: { identified: 6, source: "live" } };
  const ctx = renderer(cleared, []);
  assert.match(ctx.certSelectionStatsHTML(cleared, true), /<strong>0<\/strong>.*of 6/);
  assert.match(ctx.certSelectionActionHTML(cleared, "transparent", true), />Edit<\/fluent-button>/);
});

test("compact discovery progress keeps the action disabled", () => {
  const ctx = renderer(cert, []);
  ctx.scanning = true; ctx.scanningCertId = cert.id; ctx.certDiscoveryActive = true;
  assert.match(ctx.certSelectionStatsHTML(cert, true), />Finding apps…<\/span>/);
  assert.match(ctx.certSelectionActionHTML(cert, "transparent", true), /aria-label="Select apps for Example Publisher" disabled/);
});

test("compact demo counts keep the source explicit", () => {
  const saved = { ...cert, discoverySummary: { identified: 12, source: "demo" } };
  const ctx = renderer(saved, []), html = ctx.certSelectionStatsHTML(saved, true);
  assert.match(html, /of 12<\/span> selected/);
  assert.match(html, /\(demo\)/);
  assert.match(html, /12 items in demo list/);
  assert.doesNotMatch(html, /apps &amp; processes identified/);
});

test("analytics-only tracking has accurate totals and a direct link from its empty Apps group", () => {
  const items = discovery.normalize([{ name: "Sync Service", file: "Sync.exe", kind: "helper" }], cert, []);
  const saved = discovery.applyTrackingSelection(items, [cert], [], { createId: () => "sync-target" });
  const ctx = renderer(saved.certs[0], saved.apps);
  const stats = ctx.certSelectionStatsHTML(saved.certs[0], true), group = ctx.certGroupsHTML(saved.apps);
  assert.match(stats, /<strong>0<\/strong> apps \/ <strong>1<\/strong> analytics only/);
  assert.match(group, /1 background executable is tracked/);
  assert.match(group, /data-background-cert="summary-cert"/);
  assert.doesNotMatch(group, /<tr>/);
});
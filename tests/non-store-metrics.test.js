"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const discovery = require("../certificate-discovery.js");

const source = fs.readFileSync(path.join(__dirname, "..", "portal.js"), "utf8");
const start = source.indexOf("  function storeCertRowHTML(");
const end = source.indexOf("  // Store-developer app row", start);
assert.ok(start >= 0 && end > start);
const cert = { id: "cert", label: "Publisher", thumb: "A", trust: "Valid", signed: true };
const context = vm.createContext({
  STORE: true, discovery, state: { apps: [], certs: [cert] },
  certById: () => cert, fmtThumb: () => "AAAA", certificateSelectionState: () => "reviewed",
  canEditCertificateApps: () => false,
  certSelectionStatsHTML: () => "", certSelectionActionHTML: () => '<fluent-button data-certreview="cert">Edit tracking</fluent-button>',
  appIcoImg: () => "",
  storeLocked: app => !!app.locked,
  inStorePipeline: app => !!app.store || !!app.storeStatus,
  appTypeMeta: () => ({ key: "win32", label: "EXE / MSI" }),
  analyticsPending: discovery.isAnalyticsPending,
  anaData: app => {
    assert.equal(discovery.isAnalyticsPending(app), false, "Pending apps must not read crash figures");
    return { crashRate: 1.25 };
  },
  acqData: () => assert.fail("Non-Store rows must not read real install data"),
  ratingsData: () => assert.fail("Non-Store rows must not read real rating data"),
  fmtCompact: value => String(value),
  esc: value => String(value)
});
vm.runInContext(source.slice(source.indexOf("  var ANA_TABS = ["), source.indexOf("  function lockedAnalyticsHTML(")), context);
vm.runInContext(source.slice(source.indexOf('  function pkgFromFile('), source.indexOf('  // App "type" =', source.indexOf('  function pkgFromFile('))), context);
vm.runInContext(source.slice(source.indexOf('  function canSubmitWin32Package('), source.indexOf('  function validatePackageSubmission(')), context);
vm.runInContext(source.slice(start, end), context);
vm.runInContext(source.slice(source.indexOf("  function certGroupHTML("), source.indexOf("  function appsTabsHTML(")), context);

function cells(app) {
  return [...context.storeCertRowHTML(app).matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/g)].map(match => match[1]);
}

function group(apps) {
  context.state.apps = apps;
  return context.certGroupHTML({ certId: cert.id, apps });
}

test("non-Store rows use primary publishing and secondary package buttons with analytics access", () => {
  const app = { id: "pending", name: "Pending app", file: 'Pending.exe', discovered: true, discoveredAt: Date.now(), store: false };
  const row = cells(app);
  assert.equal(row.length, 5);
  assert.match(row[0], /data-analytics="pending"/);
  assert.match(row[0], /View crash analytics for Pending app/);
  assert.match(row[0], /EXE \/ MSI/);
  assert.match(row[1], /class="metric-locked"/);
  assert.match(row[1], /Installs for Pending app unlock when you publish to the Microsoft Store/);
  assert.match(row[1], /fluent:lock-closed-16-regular/);
  assert.match(row[2], /aria-label="Data not available yet"/);
  assert.match(row[3], /data-submit-package="pending"/);
  assert.match(row[3], /appearance="outline"/);
  assert.match(row[3], /Submit package/);
  assert.match(row[4], /appearance="primary"[^>]*data-store="pending"/);
  assert.doesNotMatch(row.join(""), /Preparing data|Not in Store|metric-teaser|1\.25%/);
  assert.doesNotMatch(row.join(""), /size="small"/);
  assert.match(context.storeCertRowHTML(app), /^<tr class="approw--open" data-analytics="pending" title="View crash analytics">/);
});

test("ready apps retain accessible crash rates without install or rating teasers", () => {
  const app = { id: "ready", name: "Ready app", discovered: true, discoveredAt: Date.now() - 2 * discovery.ANALYTICS_DELAY_MS, store: false };
  const row = cells(app);
  assert.equal(row.length, 5);
  assert.match(row[1], /class="metric-locked"/);
  assert.match(row[2], /1\.25%/);
  assert.match(row[2], /<fluent-button[^>]*data-analytics="ready"/);
  assert.doesNotMatch(row.join(""), /metric-teaser|Preparing data/);
});

test("pending rows always reserve an accessible analytics cell without reporting zero", () => {
  const row = cells({ id: "pending", name: "Pending app", discovered: true, discoveredAt: Date.now() });
  assert.match(row[2], /aria-label="Data not available yet"/);
  assert.match(row[2], /title="Data not available yet"/);
  assert.match(row[2], /&mdash;/);
  assert.doesNotMatch(row[2], /0(?:\.00)?%|Preparing data/);
});

test("all-pending groups keep the Crash analytics column with dashes and no header preparation line", () => {
  const html = group(["one", "two"].map(id => ({ id, name: id, discovered: true, discoveredAt: Date.now() })));
  assert.doesNotMatch(html, /Preparing crash analytics|24 hours|signed-cert-context/);
  assert.match(html, /<thead><tr><th>App<\/th><th class="signed-app-installs">Installs<\/th><th class="signed-app-crash">Crash analytics<\/th><th class="signed-app-package">SmartScreen review<\/th><th class="col-store">Store<\/th><\/tr><\/thead>/);
  assert.equal((html.match(/<td class="signed-app-crash">/g) || []).length, 2);
  assert.equal((html.match(/<td class="signed-app-installs">/g) || []).length, 2);
  assert.equal((html.match(/class="metric-locked"/g) || []).length, 2);
  assert.equal((html.match(/aria-label="Data not available yet"/g) || []).length, 2);
  assert.doesNotMatch(html, /<th[^>]*>Crash rate|Preparing data|metric-teaser|>Status<|>Type<|>Rating</);
  assert.equal((html.match(/class="signed-app-name"/g) || []).length, 2);
});

test("mixed groups show ready rates and accessible dashes without a header preparation line", () => {
  const html = group([
    { id: "pending", name: "New app", discovered: true, discoveredAt: Date.now() },
    { id: "ready", name: "Reporting app", discovered: true, discoveredAt: Date.now() - 2 * discovery.ANALYTICS_DELAY_MS }
  ]);
  assert.match(html, /<th class="signed-app-crash">Crash analytics<\/th>/);
  assert.doesNotMatch(html, /Preparing crash analytics/);
  assert.match(html, /1\.25%/);
  assert.match(html, /Data not available yet/);
});

test("fully reporting groups have no preparation message", () => {
  const html = group([{ id: "ready", name: "Reporting app" }]);
  assert.match(html, /<th class="signed-app-crash">Crash analytics<\/th>/);
  assert.match(html, /1\.25%/);
  assert.doesNotMatch(html, /Preparing crash analytics|24 hours/);
});

test("unverified groups keep ownership recovery without exposing analytics or publishing", () => {
  const app = { id: "locked", name: "Locked app", locked: true, store: false };
  const html = group([app]);
  assert.match(html, /Verify certificate ownership/);
  assert.match(html, /data-openmodal>Verify ownership/);
  assert.match(html, /<th class="signed-app-crash">Crash analytics<\/th>/);
  assert.doesNotMatch(context.storeCertRowHTML(app), /data-analytics|data-store|1\.25%/);
  assert.doesNotMatch(html, /Preparing crash analytics|24 hours/);
});

test("non-Store groups show blurred Installs teasers and one SmartScreen note without a Store banner", () => {
  const apps = [
    { id: "first", name: "First app", file: 'First.exe', certId: "first-cert", discovered: true, discoveredAt: Date.now() },
    { id: "second", name: "Second app", file: 'Second.exe', certId: "second-cert", discovered: true, discoveredAt: Date.now() }
  ];
  context.state.apps = apps;
  const html = context.certGroupsHTML(apps);
  assert.doesNotMatch(html, /store-insights|fluent-message-bar|Reach more customers with Microsoft Store|Explore Store benefits/);
  assert.equal((html.match(/class="certgroup certgroup--signed"/g) || []).length, 2);
  assert.equal((html.match(/<th class="signed-app-installs">Installs<\/th>/g) || []).length, 2);
  assert.equal((html.match(/class="metric-locked"/g) || []).length, 2);
  assert.match(html, /Installs for First app unlock when you publish to the Microsoft Store/);
  assert.match(html, /Installs for Second app unlock when you publish to the Microsoft Store/);
  assert.equal((html.match(/data-store=/g) || []).length, apps.length);
  assert.equal((html.match(/data-submit-package=/g) || []).length, apps.length);
  assert.equal((html.match(/<th class="signed-app-package">SmartScreen review<\/th>/g) || []).length, 2);
  assert.doesNotMatch(html, /package-review-note|No Store listing required/);
  assert.equal((html.match(/class="smartscreen-note"/g) || []).length, 1);
  assert.match(html, /Build SmartScreen reputation\./);
  assert.match(html, /Submit your signed package so we can scan it/);
});

test("empty app selections do not show a publishing upsell or SmartScreen note", () => {
  context.state.apps = [];
  assert.doesNotMatch(context.certGroupsHTML([]), /store-insights|smartscreen-note/);
});

function packageSubmissionHarness() {
  const account = { email: 'publisher@example.test' };
  const app = { id: 'win32', name: 'Reader', file: 'Reader.exe', certId: cert.id, discoveredAt: 123, sources: [{ id: 'source', url: 'https://example.test/download', status: 'allow' }] };
  const scope = vm.createContext({
    URL, state: { signedIn: true, account, apps: [app], certs: [cert] },
    discoveryOwner: () => 'publisher@example.test', inStorePipeline: value => !!value.store || !!value.storeStatus,
    storeLocked: value => !!value.locked, appTypeMeta: value => ({ key: value.pkgType || 'win32' }),
    canEditCertificateApps: value => value.trust === 'Valid', save: () => true
  });
  scope.appById = id => scope.state.apps.find(value => value.id === id);
  vm.runInContext(source.slice(source.indexOf('  function pkgFromFile('), source.indexOf('  // App "type" =', source.indexOf('  function pkgFromFile('))), scope);
  vm.runInContext(source.slice(source.indexOf('  function canSubmitWin32Package('), source.indexOf('  /* ---------------- Download sources modal', source.indexOf('  function validatePackageSubmission('))), scope);
  return { scope, app, context: { appId: app.id, account, owner: 'publisher@example.test' }, values: { appName: 'Reader', url: 'https://example.test/Reader.exe?version=2', certId: cert.id } };
}

test("package submission validates name, HTTPS URL, and an available certificate", () => {
  const { scope, values } = packageSubmissionHarness();
  assert.equal(Object.keys(scope.validatePackageSubmission(values, [cert]).errors).length, 0);
  assert.equal(scope.validatePackageSubmission({ ...values, appName: '  Reader  ' }, [cert]).appName, 'Reader');
  for (const url of ['', 'invalid', 'http://example.test/app.exe', 'file:///app.exe', 'https://user:password@example.test/app.exe', 'https://example.test/app.exe#fragment']) {
    assert.ok(scope.validatePackageSubmission({ ...values, url }, [cert]).errors.url);
  }
  assert.ok(scope.validatePackageSubmission({ ...values, appName: ' ' }, [cert]).errors.appName);
  assert.ok(scope.validatePackageSubmission({ ...values, appName: 'A'.repeat(257) }, [cert]).errors.appName);
  assert.ok(scope.validatePackageSubmission({ ...values, certId: 'missing' }, [cert]).errors.certId);
});

test("saving a package submission preserves app identity, analytics, trust, and Store state", () => {
  const { scope, app, context: submissionContext, values } = packageSubmissionHarness();
  const result = scope.savePackageSubmission(submissionContext, values);
  const saved = scope.state.apps[0];
  assert.equal(result.submission.status, 'saved');
  assert.equal(result.submission.source, 'prototype');
  assert.equal(result.submission.url, values.url);
  assert.equal(result.submission.certId, cert.id);
  assert.equal(saved.id, app.id);
  assert.equal(saved.certId, app.certId);
  assert.equal(saved.discoveredAt, app.discoveredAt);
  assert.equal(saved.sources, app.sources);
  assert.equal(saved.store, undefined);
  assert.equal(saved.storeStatus, undefined);
  assert.equal(scope.state.certs[0], cert);
  assert.equal(app.packageSubmission, undefined);
});

test("package submission rolls back persistence failures and rejects stale context", () => {
  const { scope, context: submissionContext, values } = packageSubmissionHarness();
  const previous = scope.state.apps;
  scope.save = () => false;
  assert.match(scope.savePackageSubmission(submissionContext, values).error, /could not save/);
  assert.equal(scope.state.apps, previous);
  scope.state.account = { email: 'other@example.test' };
  assert.match(scope.savePackageSubmission(submissionContext, values).error, /account changed/);
  scope.state.account = submissionContext.account;
  scope.state.apps = [{ ...previous[0], storeStatus: 'in-progress' }];
  assert.match(scope.savePackageSubmission(submissionContext, values).error, /no longer available/);
  scope.state.apps = [{ ...previous[0], pkgType: 'pwa' }];
  assert.match(scope.savePackageSubmission(submissionContext, values).error, /no longer available/);
});

test("package defaults use the app's certificate and preserve a saved submission's explicit choice", () => {
  const { scope, app } = packageSubmissionHarness();
  const other = { ...cert, id: 'other', label: 'Other publisher' };
  const defaults = scope.packageSubmissionDefaults(app, [other, cert]);
  assert.equal(defaults.appName, app.name);
  assert.equal(defaults.url, '');
  assert.equal(defaults.certId, app.certId);
  const saved = { ...app, packageSubmission: { appName: 'Reader Installer', url: 'https://example.test/installer.exe', certId: other.id } };
  assert.equal(scope.packageSubmissionDefaults(saved, [cert, other]).certId, other.id);
  assert.equal(scope.packageSubmissionDefaults(saved, [cert, other]).url, saved.packageSubmission.url);
  assert.equal(scope.packageSubmissionDefaults(saved, [cert]).certId, '');
  assert.equal(scope.packageSubmissionDefaults({ ...app, certId: null }, [cert]).certId, cert.id);
  assert.equal(scope.packageSubmissionDefaults({ ...app, certId: null }, [cert, other]).certId, '');
});

test("only eligible Win32 packages offer submission and saved submissions can be reopened", () => {
  const { scope, app } = packageSubmissionHarness();
  assert.equal(scope.canSubmitWin32Package({ ...app, type: 'game' }), true);
  assert.equal(scope.canSubmitWin32Package({ ...app, locked: true }), false);
  assert.equal(scope.canSubmitWin32Package({ ...app, packageType: 'msix' }), false);
  assert.equal(scope.canSubmitWin32Package({ ...app, store: true }), false);
  assert.equal(scope.canSubmitWin32Package({ ...app, file: 'Unknown.dll' }), false);
  const html = context.storeCertRowHTML({ ...app, packageSubmission: { status: 'saved' } });
  assert.match(html, /Saved locally/);
  assert.match(html, /data-submit-package="win32"/);
  assert.match(html, /View submission/);
  assert.doesNotMatch(context.storeCertRowHTML({ ...app, packageType: 'pwa' }), /data-submit-package/);
});

test("Escape uses native popover state and does not close the package dialog with its certificate menu", () => {
  const { scope } = packageSubmissionHarness();
  const listeners = {};
  let created = false, popupOpen = true, closes = 0;
  const dialog = {
    setAttribute() {}, hide() { closes++; },
    addEventListener(name, listener, capture) { listeners[name] = { listener, capture }; },
    querySelector: selector => selector === 'fluent-listbox:popover-open' && popupOpen ? {} : null
  };
  scope.$ = () => created ? dialog : null;
  scope.document = { createElement: () => dialog, body: { appendChild() { created = true; } } };
  scope.ensurePackageSubmissionDialog();
  assert.equal(listeners.keydown.capture, true);
  let prevented = false, stopped = false;
  const event = { key: 'Escape', preventDefault() { prevented = true; }, stopPropagation() { stopped = true; } };
  listeners.keydown.listener(event);
  assert.equal(prevented, true);
  assert.equal(stopped, false);
  assert.equal(closes, 0);
  popupOpen = false;
  listeners.keydown.listener(event);
  assert.equal(stopped, true);
  assert.equal(closes, 1);
});
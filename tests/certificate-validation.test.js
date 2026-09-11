"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const validation = require("../certificate-validation.js");

const valid = { kind: "authenticode", status: "Valid", signerThumbprint: "A".repeat(40),
  signerSubject: "CN=Example Publisher", issuer: "CN=Example Code Signing CA", notAfter: "2027-09-11" };
function resultCheck(result, id) { return result.checks.find(check => check.id === id); }
function reportRun(infos, options = {}) {
  const items = infos.map((info, i) => ({ file: { name: "signed-" + i + ".exe" }, info, result: validation.evaluate(info) }));
  return { phase: "done", activeIndex: 0, items, savedCerts: items.filter(item => item.result.accepted).map((_, i) => ({ id: "cert-" + i })), ...options };
}

test("current verifier results pass signature and issuer checks but never invent an original-binary match", () => {
  const result = validation.evaluate(valid);
  assert.equal(result.accepted, true);
  assert.equal(result.verified, true);
  assert.equal(result.complete, false);
  assert.equal(resultCheck(result, "binary").status, "not-checked");
  assert.deepEqual(result.checks.slice(1).map(c => c.status), ["passed", "passed", "passed"]);
  assert.equal(validation.summary(reportRun([valid])).title, "Certificate verified");
});

test("only explicit backend match evidence can complete the original-binary check", () => {
  for (const binaryMatch of [undefined, null, "true", 1]) {
    assert.equal(resultCheck(validation.evaluate({ ...valid, binaryMatch }), "binary").status, "not-checked");
  }
  const matched = validation.evaluate({ ...valid, binaryMatch: true });
  assert.equal(matched.complete, true);
  assert.ok(matched.checks.every(c => c.status === "passed"));
  assert.equal(validation.summary(reportRun([{ ...valid, binaryMatch: true }])).title, "Validation successful");
});

test("an explicit original-binary mismatch blocks acceptance even with a valid signature", () => {
  const result = validation.evaluate({ ...valid, binaryMatch: false });
  assert.equal(result.accepted, false);
  assert.equal(result.verified, false);
  assert.equal(resultCheck(result, "binary").status, "failed");
  assert.match(result.message, /not the verification binary/);
});

test("self-issued certificates remain rejected even when locally trusted", () => {
  for (const status of ["Valid", "NotTrusted"]) {
    const result = validation.evaluate({ ...valid, status, issuer: "  cn=EXAMPLE PUBLISHER  " });
    assert.equal(result.accepted, false);
    assert.equal(resultCheck(result, "issuer").status, "failed");
    assert.match(result.message, /Self-signed/);
  }
});

test("unsigned binaries and bare certificates are not certificate ownership proof", () => {
  for (const info of [{ kind: "authenticode", status: "NotSigned" }, { ...valid, kind: "certificate", status: "Imported" }, {}]) {
    const result = validation.evaluate(info);
    assert.equal(result.accepted, false);
    assert.equal(resultCheck(result, "signature").status, "failed");
    assert.equal(resultCheck(result, "issuer").status, "skipped");
    assert.equal(resultCheck(result, "trust").status, "skipped");
  }
});

test("tampered and untrusted signatures keep specific actionable failure states", () => {
  const tampered = validation.evaluate({ ...valid, status: "HashMismatch" });
  assert.equal(tampered.accepted, false);
  assert.match(resultCheck(tampered, "trust").detail, /changed after it was signed/);
  for (const status of ["NotTrusted", "UnknownError", "NotSupportedFileFormat", "NotSigned"]) {
    assert.equal(validation.evaluate({ ...valid, status }).accepted, false);
  }
});

test("unknown issuer is not a passed check and a valid timestamp is not mistaken for unexpired certificate evidence", () => {
  const result = validation.evaluate({ ...valid, issuer: null, notAfter: "2020-01-01", timeStamped: true });
  assert.equal(resultCheck(result, "issuer").status, "not-checked");
  assert.equal(resultCheck(result, "trust").status, "passed");
  assert.doesNotMatch(JSON.stringify(result.checks), /unexpired|expiration passed|expiry passed/i);
});

test("offline fingerprints never display successful signature validation", () => {
  const info = { offline: true, status: "Offline", fileSha256: "fingerprint" };
  const result = validation.evaluate(info);
  assert.equal(result.accepted, true);
  assert.equal(result.verified, false);
  assert.equal(result.complete, false);
  assert.ok(result.checks.every(c => c.status === "not-checked"));
  const summary = validation.summary(reportRun([info]));
  assert.equal(summary.tone, "warning");
  assert.doesNotMatch(summary.title, /successful|verified/i);
  assert.match(summary.detail, /fingerprints only/);
});

test("unavailable verification, missing fingerprints, and cancellation cannot be accepted", () => {
  for (const info of [{ error: "403" }, { offline: true }, { offline: true, cancelled: true, fileSha256: "fingerprint" }, { offline: true, error: "403", fileSha256: "fingerprint" }, null]) {
    assert.equal(validation.evaluate(info).accepted, false);
  }
});

test("progress has explicit waiting/checking states rather than fabricated completed checks", () => {
  assert.deepEqual(validation.waiting(true).map(c => c.status), ["not-checked", "running", "waiting", "waiting"]);
  assert.ok(validation.waiting(false).every(c => c.status !== "passed"));
  const summary = validation.summary({ phase: "checking", items: [{ result: validation.evaluate(valid) }, {}] });
  assert.match(summary.detail, /2 of 2/);
  assert.equal(summary.tone, "running");
});

test("mixed batches and storage failures never receive an all-success summary", () => {
  const mixed = validation.summary(reportRun([valid, { kind: "authenticode", status: "NotSigned" }]));
  assert.equal(mixed.tone, "warning");
  assert.match(mixed.detail, /1 certificate is saved/);
  const failedSave = validation.summary(reportRun([valid], { savedCerts: [], saveError: true }));
  assert.equal(failedSave.tone, "error");
  assert.match(failedSave.detail, /files and validation results are still here/);
});

const source = fs.readFileSync(path.join(__dirname, "..", "portal.js"), "utf8");
const helperStart = source.indexOf("  function certValidationIconHTML("), flowStart = source.indexOf("  function wireFlow(", helperStart);
const flowEnd = source.indexOf("  // Certs auto-populate", flowStart);
const creationStart = source.indexOf("  function getOrCreateCert("), creationEnd = source.indexOf("  // Static-host fallback", creationStart);
assert.ok(helperStart >= 0 && flowStart > helperStart && flowEnd > flowStart && creationEnd > creationStart);
const helpers = vm.createContext({ certificateValidation: validation, esc: value => String(value).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])) });
vm.runInContext(source.slice(helperStart, flowStart), helpers);

test("report markup escapes filenames and uses explicit statuses alongside Fluent icons", () => {
  const run = reportRun([valid]); run.items[0].file.name = '<img onerror="bad()">.exe';
  const html = helpers.certValidationResultsHTML(run);
  assert.match(html, /&lt;img onerror=&quot;bad\(\)&quot;&gt;/);
  assert.doesNotMatch(html, /<img /);
  assert.equal((html.match(/data-validation-check=/g) || []).length, 4);
  assert.match(html, /data-validation-status="not-checked"/);
  assert.match(html, />Passed<\/span>/);
  assert.match(html, /aria-hidden="true"/);
});

test("report actions gate app selection on saved certificates and keep a non-forced exit", () => {
  const ready = helpers.certValidationActionsHTML(reportRun([valid]));
  assert.match(ready, /data-certvalidation="close">Close/);
  assert.match(ready, /appearance="primary" data-certvalidation="apps">Select apps/);
  for (const run of [reportRun([valid], { phase: "checking" }), reportRun([valid], { saveError: true, savedCerts: [] }), reportRun([{ status: "NotSigned" }])]) {
    assert.doesNotMatch(helpers.certValidationActionsHTML(run), /data-certvalidation="apps"/);
  }
  assert.match(helpers.certValidationActionsHTML(reportRun([valid], { saveError: true, savedCerts: [] })), /data-certvalidation="save">Try saving again/);
});

test("progress includes a static Fluent alternative for reduced motion", () => {
  const html = helpers.certValidationIconHTML("running", true);
  assert.match(html, /<fluent-spinner class="certval-spinner"/);
  assert.match(html, /class="certval-static" icon="fluent:clock-20-regular"/);
  assert.match(html, /aria-hidden="true"/);
});

function harness(options = {}) {
  let scope, nextId = 0;
  const events = [], requests = [], saved = [], created = [];
  function element(name) {
    const attrs = new Map(), classes = new Set();
    const el = { tagName: name, isConnected: true, hidden: false, children: [], listeners: {}, innerHTML: "", value: "",
      setAttribute(k, v) { attrs.set(k, String(v)); }, getAttribute(k) { return attrs.get(k) ?? null; },
      hasAttribute(k) { return attrs.has(k); }, toggleAttribute(k, on) { if (on) attrs.set(k, ""); else attrs.delete(k); },
      appendChild(child) { this.children.push(child); child.parentElement = this; return child; },
      addEventListener(type, fn) { this.listeners[type] = fn; },
      focus() { scope.document.activeElement = el; }, getClientRects() { return this.hidden ? [] : [{}]; },
      remove() { this.isConnected = false; }, closest() { return null; }, querySelector() { return null; },
      classList: { add: c => classes.add(c), remove: c => classes.delete(c), contains: c => classes.has(c) }
    };
    return el;
  }
  const root = element("DIV"), parent = element("FLUENT-DIALOG-BODY"), modal = element("FLUENT-DIALOG");
  modal.dialog = { open: true };
  const input = element("INPUT"), zone = element("DIV"), list = element("UL"), submit = element("FLUENT-BUTTON"), download = element("FLUENT-BUTTON"), form = element("DIV");
  const parts = { ".js-fileinput": input, ".js-dropzone": zone, ".js-filelist": list, ".js-submit": submit, ".js-download": download, ".cert-upload": form };
  const title = element("H3"); title.classList.add("certval-title");
  root.parentElement = parent; root.querySelector = selector => parts[selector]; root.closest = () => modal;
  const account = { email: "owner@example.test" };
  scope = vm.createContext({
    state: { signedIn: true, account, verified: false, certs: [], apps: [] }, certificateValidation: validation,
    certDiscoveryActive: false, backendOffline: false, AbortController, setTimeout, clearTimeout,
    document: { activeElement: element("BUTTON"), querySelector: () => ({ id: "certificates" }), createElement(tag) {
      const el = element(tag.toUpperCase());
      if (tag === "section") {
        const summary = element("DIV"), results = element("DIV");
        el.querySelector = selector => ({ ".certval-summary": summary, ".certval-results": results, ".certval-title": title }[selector]);
      }
      created.push(el); return el;
    } },
    discoveryOwner: () => scope.state.account?.email || "", fmtSize: () => "1 KB", uid: () => "cert-" + ++nextId,
    today: () => "Sep 11, 2026", cnOf: subject => subject?.replace(/^CN=/, "") || null,
    esc: helpers.esc, renderAll: () => events.push("render"),
    inspectFile: (file, signal) => { requests.push({ file, signal }); return options.inspect ? options.inspect(file, signal) : Promise.resolve(valid); },
    save: () => { events.push("save"); if (options.failSave) return false; saved.push(JSON.stringify(scope.state)); return true; },
    closeModal: () => { events.push("close"); modal.dialog.open = false; root.cancelCertificateValidation(); },
    discoverCertApps: (certs, settings) => events.push({ discover: certs.map(c => c.id), settings }),
    certById: id => scope.state.certs.find(c => c.id === id)
  });
  vm.runInContext(source.slice(helperStart, flowEnd) + source.slice(creationStart, creationEnd), scope);
  scope.wireFlow(root);
  const report = created[0], actions = created[1];
  function stage(files = [{ name: "signed.exe", size: 1024 }]) { input.files = files; input.listeners.change(); }
  function action(name) {
    const button = element("FLUENT-BUTTON"); button.setAttribute("data-certvalidation", name);
    actions.listeners.click({ target: { closest: () => button } });
  }
  return { scope, root, modal, form, report, actions, submit, input, download, list, requests, events, saved, options,
    stage, start: () => submit.listeners.click(), action };
}

test("Submit shows a busy validation report, then saved success without auto-opening apps", async () => {
  let resolve;
  const h = harness({ inspect: () => new Promise(done => { resolve = done; }) });
  h.stage();
  const submitted = h.start();
  assert.equal(h.form.hidden, true);
  assert.equal(h.report.hidden, false);
  assert.equal(h.submit.hasAttribute("disabled"), true);
  assert.equal(h.input.disabled, true);
  assert.equal(h.download.hasAttribute("disabled"), true);
  assert.equal(h.scope.document.activeElement.classList.contains("certval-title"), true);
  assert.match(h.actions.innerHTML, /Cancel validation/);
  assert.equal(h.requests.length, 1);
  await h.start();
  assert.equal(h.requests.length, 1);
  resolve(valid); await submitted;
  assert.equal(h.scope.state.certs.length, 1);
  assert.equal(h.scope.state.apps.length, 0);
  assert.equal(h.saved.length, 1);
  assert.match(h.report.querySelector(".certval-summary").innerHTML, /Certificate verified/);
  assert.ok(!h.events.some(event => typeof event === "object" && event.discover));
  h.action("apps"); h.action("apps");
  assert.equal(h.events.filter(event => typeof event === "object" && event.discover).length, 1);
  assert.ok(h.events.indexOf("save") < h.events.indexOf("close"));
});

test("closing saved validation keeps the certificate but never adds apps or confirms selection", async () => {
  const h = harness(); h.stage(); await h.start(); h.action("close");
  assert.equal(h.scope.state.certs.length, 1);
  assert.equal(h.scope.state.certs[0].appSelectionReviewed, undefined);
  assert.equal(h.scope.state.apps.length, 0);
  assert.ok(!h.events.some(event => typeof event === "object"));
});

test("cancel aborts the in-flight request and a late valid result cannot save or navigate", async () => {
  let resolve;
  const h = harness({ inspect: () => new Promise(done => { resolve = done; }) });
  h.stage(); const submitted = h.start(); h.action("close");
  assert.equal(h.requests[0].signal.aborted, true);
  resolve(valid); await submitted;
  assert.equal(h.scope.state.certs.length, 0);
  assert.equal(h.saved.length, 0);
  assert.ok(!h.events.includes("save"));
});

test("account replacement, sign-out and detached forms discard late validation results", async () => {
  for (const change of [h => { h.scope.state.account = { email: "other@example.test" }; },
    h => { h.scope.state.account = { email: "owner@example.test" }; },
    h => { h.scope.state.signedIn = false; }, h => { h.root.isConnected = false; }, h => { h.modal.dialog.open = false; }]) {
    let resolve;
    const h = harness({ inspect: () => new Promise(done => { resolve = done; }) });
    h.stage(); const submitted = h.start(); change(h); resolve(valid); await submitted;
    assert.equal(h.saved.length, 0);
    assert.equal(h.scope.state.certs.length, 0);
  }
});

test("storage failure rolls back certificate state and retries saving without repeating validation", async () => {
  const h = harness({ failSave: true }); h.stage(); await h.start();
  assert.equal(h.scope.state.certs.length, 0);
  assert.equal(h.scope.state.verified, false);
  assert.match(h.actions.innerHTML, /Try saving again/);
  assert.doesNotMatch(h.actions.innerHTML, /data-certvalidation="apps"/);
  h.options.failSave = false; h.action("save");
  assert.equal(h.requests.length, 1);
  assert.equal(h.scope.state.certs.length, 1);
  assert.equal(h.saved.length, 1);
  assert.match(h.actions.innerHTML, /Select apps/);
});

test("mixed batch saves only accepted certificates and retains rejected files for correction", async () => {
  const h = harness({ inspect: file => Promise.resolve(file.name === "valid.exe" ? valid : { kind: "authenticode", status: "NotSigned" }) });
  h.stage([{ name: "valid.exe", size: 1 }, { name: "unsigned.exe", size: 2 }]); await h.start();
  assert.equal(h.scope.state.certs.length, 1);
  assert.match(h.report.querySelector(".certval-summary").innerHTML, /Some files need attention/);
  assert.match(h.actions.innerHTML, /Change files/);
  h.action("files");
  assert.equal(h.form.hidden, false);
  assert.match(h.list.innerHTML, /unsigned\.exe/);
  assert.doesNotMatch(h.list.innerHTML, /valid\.exe/);
});

test("rejected uploads remain staged and cannot open discovery", async () => {
  const h = harness({ inspect: () => Promise.resolve({ ...valid, issuer: valid.signerSubject }) });
  h.stage(); await h.start();
  assert.equal(h.scope.state.certs.length, 0);
  assert.doesNotMatch(h.actions.innerHTML, /data-certvalidation="apps"/);
  h.action("apps"); h.action("files");
  assert.match(h.list.innerHTML, /signed\.exe/);
  assert.ok(!h.events.some(event => typeof event === "object"));
});

test("an unexpected request failure leaves an actionable result, not an endless checking state", async () => {
  const h = harness({ inspect: () => Promise.reject(new Error("Network failure")) });
  h.stage(); await h.start();
  assert.equal(h.scope.state.certs.length, 0);
  assert.equal(h.report.querySelector(".certval-results").getAttribute("aria-busy"), "false");
  assert.match(h.actions.innerHTML, /Try again/);
});

test("same-certificate batch uploads save one certificate without changing existing app selections", async () => {
  const h = harness();
  h.scope.state.certs = [{ id: "existing", label: "Example Publisher", thumb: valid.signerThumbprint,
    appSelectionReviewed: true, appSelections: { previous: false }, trust: "Valid", verified: true }];
  h.stage([{ name: "one.exe", size: 1 }, { name: "two.exe", size: 2 }]); await h.start();
  assert.equal(h.scope.state.certs.length, 1);
  assert.equal(h.scope.state.certs[0].appSelections.previous, false);
  assert.equal(h.scope.state.certs[0].appSelectionReviewed, true);
  h.action("apps");
  const invocation = h.events.find(event => typeof event === "object");
  assert.deepEqual(Array.from(invocation.discover), ["existing"]);
});

test("an aborted inspection never becomes an offline fingerprint success", async () => {
  const start = source.indexOf("  async function inspectFile("), end = source.indexOf("  /* ---------------- Toast", start);
  assert.ok(start >= 0 && end > start);
  const scope = vm.createContext({ AbortSignal, discovery: { requestJson: async () => ({ offline: true }) },
    sha256: () => { throw new Error("Cancelled files must not be fingerprinted"); } });
  vm.runInContext(source.slice(start, end), scope);
  const controller = new AbortController(); controller.abort();
  const result = await scope.inspectFile({ name: "cancelled.exe" }, controller.signal);
  assert.equal(result.cancelled, true);
  assert.equal(result.fileSha256, undefined);
});
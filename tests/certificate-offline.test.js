"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const discovery = require("../certificate-discovery.js");

test("connection failures and timeouts use the labeled demo fallback", async () => {
  for (const error of [new TypeError("Failed to fetch"), new DOMException("Timed out", "AbortError")]) {
    const reply = await discovery.requestJson("/api/test", {}, async () => { throw error; });
    assert.equal(reply.offline, true);
    assert.equal(reply.data, undefined);
  }
});

test("missing API routes and unavailable services use the fallback", async () => {
  for (const status of [404, 405, 500, 502, 503, 504]) {
    const reply = await discovery.requestJson("/api/test", {}, async () => new Response("", { status }));
    assert.equal(reply.offline, true);
  }
});

test("a static host's HTML fallback is not mistaken for real discovery data", async () => {
  const reply = await discovery.requestJson("/api/test", {}, async () => new Response("<!doctype html><title>Portal</title>", {
    status: 200, headers: { "content-type": "text/html; charset=utf-8" }
  }));
  assert.equal(reply.offline, true);
});

test("authorization and validation failures are not masked with demo data", async () => {
  for (const status of [400, 401, 403]) {
    await assert.rejects(discovery.requestJson("/api/test", {}, async () => new Response("", { status })), /Request failed/);
  }
});

test("working backends retain both valid and invalid signature results", async () => {
  for (const status of ["Valid", "NotSigned", "NotTrusted", "HashMismatch"]) {
    const data = { kind: "authenticode", status };
    const reply = await discovery.requestJson("/api/verify-signature", {}, async () => Response.json(data));
    assert.equal(reply.offline, false);
    assert.deepEqual(reply.data, data);
  }
});

test("a malformed JSON response from a working backend remains an error", async () => {
  await assert.rejects(discovery.requestJson("/api/test", {}, async () => new Response("invalid", {
    headers: { "content-type": "application/json" }
  })));
});

test("offline verification uses a file fingerprint and never claims a valid signature", async () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "portal.js"), "utf8");
  const start = source.indexOf("  async function inspectFile("), end = source.indexOf("  /* ---------------- Toast", start);
  assert.ok(start >= 0 && end > start);
  const context = vm.createContext({
    discovery: { requestJson: async () => ({ offline: true }) }, AbortSignal,
    sha256: async () => "file-fingerprint"
  });
  vm.runInContext(source.slice(start, end), context);
  const result = await context.inspectFile({ name: "sample.exe" });
  assert.equal(result.offline, true);
  assert.equal(result.status, "Offline");
  assert.equal(result.fileSha256, "file-fingerprint");
  assert.equal(result.signerThumbprint, undefined);
});

test("the actual demo list mixes apps and processes and preselects only recommendations", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "portal.js"), "utf8");
  const start = source.indexOf("  function demoDiscoveredApps() {"), end = source.indexOf("  function analyticsPending", start);
  assert.ok(start >= 0 && end > start);
  const context = vm.createContext({});
  vm.runInContext(source.slice(start, end), context);
  const items = discovery.normalize(context.demoDiscoveredApps(), { id: "demo", thumb: "file-fingerprint", label: "Demo" }, []);
  assert.equal(items.length, 12);
  assert.equal(items.filter(c => c.recommended).length, 5);
  assert.equal(items.filter(c => !c.recommended).length, 7);
  assert.ok(items.every(c => c.selected === c.recommended));
});
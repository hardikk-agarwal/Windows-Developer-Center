"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { spawnSync } = require("node:child_process");

test("local Windows discovery script executes without starting the HTTP server", { skip: process.platform !== "win32", timeout: 65000 }, () => {
  const root = path.resolve(__dirname, "..");
  const source = fs.readFileSync(path.join(root, "server.js"), "utf8");
  const end = source.indexOf("var appsByCertCache");
  assert.ok(end > 0);
  const script = vm.runInNewContext(source.slice(0, end) + "\nPS_APPS;", {
    require, process, console, __dirname: root
  });
  assert.equal(typeof script, "string");
  assert.ok(script.includes("Get-CimInstance Win32_Process"));
  assert.ok(script.includes("hasStartMenuEntry"));
  const result = spawnSync("pwsh", ["-NoProfile", "-NonInteractive", "-Command", script], {
    env: { ...process.env, TDP_THUMB: "A".repeat(40) }, encoding: "utf8", timeout: 60000, maxBuffer: 8 << 20
  });
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout.trim() || "[]"), []);
});
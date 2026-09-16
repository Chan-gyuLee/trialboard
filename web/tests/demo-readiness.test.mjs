import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { checkDemoReadiness, elapsedSeconds, interruptionMessage, readDemoCapability } from "../src/demo-readiness.ts";

const caps = { enabled: true, provider: "CODEX_CHATGPT", transport: "LOOPBACK_ONLY", persisted: false, clinical_approval: false, max_seconds: 120, concurrent_runs: 1, case_limits: { public: { max_calls: 2, max_repairs: 0 }, synthetic: { max_calls: 4, max_repairs: 1 } } };
const local = { hostname: "127.0.0.1", port: "5173", protocol: "http:" };
const publicRecord = readFileSync(new URL("../public/data/agent/public-record.json", import.meta.url), "utf8");
const repair = readFileSync(new URL("../public/data/agent/synthetic-repair.json", import.meta.url), "utf8");
test("capabilities expose known per-case limits without claiming login", () => {
  assert.equal(readDemoCapability(caps).case_limits.public.max_calls, 2);
  assert.equal(readDemoCapability({ ...caps, enabled: false }).enabled, false);
});
for (const [name, patch] of [
  ["old server", { case_limits: undefined }], ["different provider", { provider: "OTHER" }],
  ["hosted", { transport: "HOSTED" }], ["persistent", { persisted: true }],
  ["clinical approval", { clinical_approval: true }], ["unknown limit", { max_seconds: 600 }],
  ["not boolean", { enabled: "true" }], ["parallel", { concurrent_runs: 2 }],
]) test(`rejects ${name} readiness`, () => assert.throws(() => readDemoCapability({ ...caps, ...patch })));
test("ready checks are GET-only and validate saved records; no model endpoint", async t => {
  const calls = [];
  t.mock.method(globalThis, "fetch", async (url, options) => {
    calls.push([url, options]);
    return new Response(url.includes("capabilities") ? JSON.stringify(caps) : url.includes("public-record") ? publicRecord : repair);
  });
  const rows = await checkDemoReadiness(new AbortController().signal, local);
  assert.equal(rows.length, 3); assert.ok(rows.every(r => r.ok));
  assert.ok(rows[0].detail.includes("미검증"));
  assert.ok(calls.every(([url, o]) => !url.endsWith("/run") && !o.method && !o.body));
});
test("nonlocal origin never probes local API but can check replay files", async t => {
  const urls = [];
  t.mock.method(globalThis, "fetch", async url => { urls.push(url); return new Response(url.includes("public-record") ? publicRecord : repair); });
  const rows = await checkDemoReadiness(new AbortController().signal, { ...local, hostname: "example.com" });
  assert.equal(rows[0].ok, false); assert.equal(urls.length, 2); assert.ok(urls.every(url => url.startsWith("/data/")));
});
test("corrupt or swapped fixture is not rehearsal ready", async t => {
  t.mock.method(globalThis, "fetch", async url => new Response(url.includes("capabilities") ? JSON.stringify(caps) : url.includes("public-record") ? repair : "{}"));
  const rows = await checkDemoReadiness(new AbortController().signal, local);
  assert.deepEqual(rows.map(r => r.ok), [true, false, false]);
});
test("aborted and disconnected checks are not successful and hide raw diagnostics", async t => {
  t.mock.method(globalThis, "fetch", async () => { throw Error("SECRET_DIAGNOSTIC"); });
  const rows = await checkDemoReadiness(AbortSignal.abort(), local);
  assert.ok(rows.every(r => !r.ok)); assert.ok(!JSON.stringify(rows).includes("SECRET"));
});
test("HTTP failure cannot become readiness", async t => {
  t.mock.method(globalThis, "fetch", async () => new Response("{}", { status: 503 }));
  assert.ok((await checkDemoReadiness(new AbortController().signal, local)).every(r => !r.ok));
});
test("interruption text distinguishes explicit stop from timeout", () => {
  assert.match(interruptionMessage("USER"), /사용자/);
  assert.match(interruptionMessage("TIMEOUT"), /135초/);
  assert.notEqual(interruptionMessage("USER"), interruptionMessage("TIMEOUT"));
});
test("wall timer counts elapsed seconds and never forecasts progress", () => {
  assert.equal(elapsedSeconds(1000, 46999), 45);
  assert.equal(elapsedSeconds(1000, 0), 0);
});

import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { draftFrom, makeInput, validateDraft, executeReview, delta } from "../src/review.ts";

const report = JSON.parse(await readFile(new URL("../public/data/normal.json", import.meta.url)));
const sims = report.simulations.filter(s => s.scenario.id === "plateau");
const initial = draftFrom(sims);

test("saved result becomes editable percentages without changing probabilities", () => {
  assert.equal(initial.responseA, "30");
  assert.equal(initial.aeB, "25");
  assert.deepEqual(validateDraft(initial), {});
  const input = makeInput(initial, sims[0].scenario, "normal");
  assert.deepEqual(input.per_arm, [30, 60]);
  assert.deepEqual(input.scenarios[0].response, [0.3, 0.32]);
  assert.equal(input.scenarios[0].rationale, sims[0].scenario.rationale);
  assert.equal(input.scenarios[0].arms, undefined);
  assert.equal(input.scenarios[0].provenance, undefined);
});
for (const [field, value] of [
  ["responseA", ""], ["responseA", " "], ["responseB", "101"], ["aeB", "-1"],
  ["responseA", "NaN"], ["aeA", "Infinity"], ["responseA", "0x10"],
  ["small", "1"], ["small", "20.5"], ["larger", "30"], ["larger", "501"],
  ["seed", "-1"], ["seed", "4294967296"], ["repetitions", "99"],
  ["repetitions", "100001"], ["penalty", "11"], ["limit", "101"],
]) test(`invalid ${field}=${JSON.stringify(value)} is blocked before submission`, () => {
  const draft = { ...initial, [field]: value };
  assert.ok(validateDraft(draft)[field]);
  assert.throws(() => makeInput(draft, sims[0].scenario, "normal"));
});
test("edits create new input while keeping the reference immutable", () => {
  const input = makeInput({ ...initial, responseB: "70", small: "24", larger: "72" }, sims[0].scenario, "missing-evidence");
  assert.equal(input.mode, "missing-evidence");
  assert.deepEqual(input.per_arm, [24, 72]);
  assert.deepEqual(input.scenarios[0].response, [0.3, 0.7]);
  assert.deepEqual(sims[0].scenario.response, [0.3, 0.32]);
  assert.equal(delta(0.123), "+12.3%p");
});
test("API sends edited JSON and only accepts live-compute response", async t => {
  const input = makeInput(initial, sims[0].scenario, "denominator-error");
  t.mock.method(globalThis, "fetch", async (url, options) => {
    assert.equal(url, "/api/reviews"); assert.equal(options.method, "POST");
    assert.deepEqual(JSON.parse(options.body), input);
    return Response.json({ execution_mode: "LIVE_COMPUTE_SYNTHETIC", report });
  });
  assert.equal((await executeReview(input, new AbortController().signal)).report.status, report.status);
});
for (const status of [422, 429, 500, 502]) test(`HTTP ${status} is a visible error, never a saved fallback`, async t => {
  t.mock.method(globalThis, "fetch", async () => new Response("error", { status }));
  await assert.rejects(executeReview(makeInput(initial, sims[0].scenario, "normal"), new AbortController().signal));
});
test("invalid response and disconnected network do not become successful executions", async t => {
  const input = makeInput(initial, sims[0].scenario, "normal");
  t.mock.method(globalThis, "fetch", async () => Response.json({ report }));
  await assert.rejects(executeReview(input, new AbortController().signal), /응답 형식/);
  t.mock.method(globalThis, "fetch", async () => { throw new TypeError("Failed to fetch"); });
  await assert.rejects(executeReview(input, new AbortController().signal), /기존 결과는 유지/);
});

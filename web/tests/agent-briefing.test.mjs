import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { readAgentRecord, changedFields, briefingMarkdown, recordStepFromKey } from "../src/agent-briefing.ts";
import { canonical, digest } from "../src/field-review.ts";

const fixture = async (name = "public-record") => JSON.parse(await readFile(new URL(`../public/data/agent/${name}.json`, import.meta.url), "utf8"));
const read = r => readAgentRecord(JSON.stringify(r));

test("presentation keyboard navigation is bounded and ignores unrelated keys", () => {
  assert.equal(recordStepFromKey("ArrowRight", 0, 4), 1);
  assert.equal(recordStepFromKey("ArrowRight", 3, 4), 3);
  assert.equal(recordStepFromKey("ArrowLeft", 0, 4), 0);
  assert.equal(recordStepFromKey("End", 0, 4), 3);
  assert.equal(recordStepFromKey("Home", 3, 4), 0);
  assert.equal(recordStepFromKey("Enter", 0, 4), null);
  assert.equal(recordStepFromKey("ArrowRight", 0, 0), null);
});

test("real public recording preserves reported percentages, missing dose and comparison concerns", async () => {
  const r = await read(await fixture());
  assert.equal(r.execution_mode, "CODEX_CHATGPT");
  assert.equal(r.status, "PARTIAL_ABSTENTION");
  assert.deepEqual(r.accepted.map(o => o.fields.reported_rate.value), ["85%", "96%"]);
  assert.ok(r.accepted.every(o => o.fields.events.value === null && o.fields.dose.value === null));
  assert.equal(r.attempts[0].critique.concerns.length, 3);
  assert.equal(r.attempts[0].critique.next_questions.length, 3);
});
test("scripted repair replays actual engine events and derives the 200 to 20 difference", async () => {
  const r = await read(await fixture("synthetic-repair"));
  assert.equal(r.execution_mode, "SCRIPTED_TEST_DOUBLE");
  assert.equal(r.status, "DRAFT_FOR_EXPERT_REVIEW");
  assert.equal(r.accepted.length, 4);
  assert.equal(r.events.filter(e => e.stage === "REVISE").length, 1);
  const changes = changedFields(r, 1);
  assert.equal(changes.length, 1);
  assert.equal(changes[0].field, "denominator");
  assert.equal(changes[0].before.value, "200");
  assert.equal(changes[0].after.value, "20");
  assert.deepEqual(changedFields(r, 0), []);
});
for (const [name, mutate] of [
  ["unknown engine", r => r.engine_version = "unknown"],
  ["unknown provider", r => r.execution_mode = "REAL_AI"],
  ["unknown provenance", r => r.input.provenance = "trusted"],
  ["changed source without digest update", r => r.input.spans[0].text = "changed"],
  ["missing observation field", r => delete r.attempts[0].extraction.observations[0].fields.dose],
  ["invalid citation value", r => r.attempts[0].extraction.observations[0].fields.dose.value = {}],
  ["accepted observation not in final attempt", r => r.accepted[0].fields.denominator.value = "65"],
  ["failed run with adopted observations", r => { r.status = "FAILED"; r.events.at(-1).stage = "FAILED"; }],
  ["missing final event", r => r.events.pop()],
  ["terminal event inside execution", r => r.events[0].stage = "FAILED"],
  ["unknown stage", r => r.events[0].stage = "THINK"],
  ["missing call backing model event", r => r.calls = []],
  ["nonsequential attempt", r => r.attempts[0].number = 2],
  ["negative token count", r => r.calls[0].input_tokens = -1],
  ["invalid date", r => r.started_at = "not-a-date"],
  ["duplicate observation IDs", r => r.accepted.push(r.accepted[0])],
]) test(`rejects ${name}`, async () => { const r = await fixture(); mutate(r); await assert.rejects(read(r)); });

test("duplicate source IDs are rejected even with recomputed input digest", async () => {
  const r = await fixture(); r.input.spans[1].id = r.input.spans[0].id;
  r.input_digest = await digest(canonical(r.input)); await assert.rejects(read(r));
});
test("duplicate JSON keys, prototype keys and oversized files are rejected", async () => {
  for (const raw of ['{"status":1,"status":2}', '{"__proto__":{}}', ' '.repeat(2_000_001)]) await assert.rejects(readAgentRecord(raw));
});
test("failed execution without extraction can be inspected but never supplies accepted values", async () => {
  const r = await fixture(); r.attempts = []; r.accepted = []; r.status = "FAILED";
  r.calls = [{ stage: "EXTRACT", attempt: 0, outcome: "FAILED_OR_CANCELLED", input_tokens: null, output_tokens: null }];
  r.events = [{stage:"EXTRACT", attempt:0, codes:[]}, {stage:"FAILED", attempt:0, codes:["RUN_TIMEOUT"]}];
  assert.equal((await read(r)).status, "FAILED");
});
test("export labels replay and scripted mode, retaining unresolved questions", async () => {
  const actual = briefingMarkdown(await read(await fixture()));
  assert.match(actual, /저장 실행 기록/); assert.match(actual, /새 모델 호출 없음/);
  assert.match(actual, /CODEX/); assert.match(actual, /코호트별 실제 투여량/);
  const scripted = briefingMarkdown(await read(await fixture("synthetic-repair")));
  assert.match(scripted, /SCRIPTED/); assert.match(scripted, /임상 승인 아님/);
});

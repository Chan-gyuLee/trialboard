import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { canonical, decide, digest, exportReview } from "../src/field-review.ts";
import { restoreReview } from "../src/field-review-restore.ts";
import { concernSpans, isRecritiqueCurrent, readRecritique } from "../src/recritique-result.ts";
import { RESULT_BYTES } from "../src/revalidation-result.ts";

// Exercise the actual Python producer, but only with synthetic bytes/text and a scripted provider.
const root = fileURLToPath(new URL("../../", import.meta.url));
const produced = JSON.parse(execFileSync("uv", ["run", "python", "-c", `
import asyncio, json, sys
sys.path.insert(0, 'tests')
from test_field_revalidation import sample, encode, revise
from trialboard.agent.recritique import recritique
from trialboard.agent.example import ScriptedProvider
from trialboard.agent.provider import Reply, ModelError
from trialboard.agent.engine import Limits
f = sample(imported=True)
revise(f['review']['rows'][0]['fields']['reported_rate'], decision='held')
class Opinions(ScriptedProvider):
    async def complete(self, **kwargs):
        return Reply({'concerns': [
          {'scope': 'observation_error', 'observation_ids': ['obs-1'], 'span_ids': ['p1-i1'], 'reason': 'Synthetic observation concern'},
          {'scope': 'comparison_limitation', 'observation_ids': ['obs-2','obs-3'], 'span_ids': ['p1-i2','p1-i3'], 'reason': 'Synthetic comparison limitation'}],
          'next_questions': ['Synthetic question?']}, 'scripted-response', 10, 5)
class Failing(ScriptedProvider):
    async def complete(self, **kwargs):
        raise ModelError('MODEL_HTTP_ERROR')
def run(provider, limits=None):
    return asyncio.run(recritique(encode(f['review']), encode(f['source']), f['pdf'], provider, agent_raw=f['agent'], limits=limits))
outputs = {'complete': run(Opinions()), 'empty_concerns': run(ScriptedProvider()), 'failed': run(Failing()),
 'budget': run(ScriptedProvider(), Limits(max_calls=1,max_repairs=0,max_total_tokens=1000))}
for row in f['review']['rows']:
    revise(row['fields']['dose'], decision='held')
outputs['no_candidates'] = run(ScriptedProvider())
print(json.dumps({'source':f['source']['source'], 'outputs':outputs}, ensure_ascii=False))
`], { cwd: root, encoding: "utf8", timeout: 30000, maxBuffer: 4_000_000 }));
const source = produced.source;
function fixture(name = "complete") {
  const report = structuredClone(produced.outputs[name]);
  const review = restoreReview(JSON.stringify(report.revalidation.review), source);
  return { report, review };
}
const read = (r, review, src = source) => readRecritique(JSON.stringify(r), review, src);
test("Python output binds current review, keeps user holds and separates error from comparison", async () => {
  const { report, review } = fixture(), original = structuredClone(review);
  const r = await read(report, review);
  assert.equal(r.mode, "SCRIPTED_TEST_DOUBLE"); assert.equal(r.status, "COMPLETED");
  assert.deepEqual(r.withheldIds, ["obs-1"]); assert.deepEqual(r.remainingIds, ["obs-2", "obs-3"]);
  assert.deepEqual(r.rules.excludedIds, ["obs-0"]); assert.equal(r.questions.length, 1);
  assert.equal(r.inputTokens, 10); assert.equal(r.outputTokens, 5);
  assert.ok(isRecritiqueCurrent(r, review, source)); assert.deepEqual(review, original);
});
for (const [name, status] of [["failed", "FAILED"], ["budget", "BUDGET_EXCEEDED"], ["no_candidates", "NO_CANDIDATES"]]) {
  test(`Python ${name} displays no successful AI opinion`, async () => {
    const { report, review } = fixture(name), r = await read(report, review);
    assert.equal(r.status, status); assert.deepEqual(r.concerns, []); assert.deepEqual(r.remainingIds, []);
    assert.equal(r.callCount, name === "failed" ? 1 : 0);
  });
}
test("no new model concerns remains a draft, not an approval field", async () => {
  const { report, review } = fixture("empty_concerns"), r = await read(report, review);
  assert.equal(r.concerns.length, 0); assert.equal(r.remainingIds.length, 3);
  assert.equal("approved" in r, false);
});
test("draft edits and even same-value confirmations make past opinions stale", async () => {
  const { report, review } = fixture(), r = await read(report, review);
  assert.equal(isRecritiqueCurrent(r, review, source, true), false);
  const next = decide(review, source, "obs-1", "dose", "confirmed", review.rows[1].fields.dose.current, "Again", 1, true);
  assert.equal(isRecritiqueCurrent(r, next, source), false); await assert.rejects(read(report, next));
  await assert.rejects(read(report, review, { ...source, sha256: "0".repeat(64) }));
});
test("backup restoration and renamed PDF retain exact review identity", async () => {
  const { report, review } = fixture(), renamed = { ...source, name: "renamed.pdf" };
  const restored = restoreReview(JSON.stringify(exportReview(review, source)), renamed);
  assert.ok(isRecritiqueCurrent(await read(report, restored, renamed), restored, renamed));
});
test("concern navigation returns original whole spans, not fabricated field citations", async () => {
  const { report, review } = fixture(), r = await read(report, review);
  assert.deepEqual(concernSpans(r.concerns[1], source).map(s => s.id), ["p1-i2", "p1-i3"]);
  assert.equal(concernSpans(r.concerns[0], source)[0], source.pages[0].spans[1]);
  assert.equal(concernSpans({ ...r.concerns[0], span_ids: ["p1-i1", "p1-i1"] }, source).length, 1);
});
const mutations = {
  schema: r => r.schema_version = "field-revalidation/1",
  promptVersion: r => r.prompt_version = "future",
  modeArray: r => r.execution_mode = ["CODEX_CHATGPT"],
  unsupportedMode: r => r.execution_mode = "OPENAI_RESPONSES",
  approval: r => r.clinical_approval = true,
  falseString: r => r.user_values_modified = "false",
  comparison: r => r.comparison_status = "APPROVED",
  reviewer: r => r.reviewer_identity = "EXPERT",
  source: r => r.source_digest = "0".repeat(64),
  rawReviewDigest: r => r.review_digest = "0".repeat(64),
  contentDigest: r => r.review_content_digest = "0".repeat(64),
  requestDigest: r => r.request_digest = "0".repeat(64),
  promptDigest: r => r.prompt_digest = "bad",
  nestedReview: r => r.revalidation.review.rows[1].fields.dose.current.value = "bad",
  nestedSource: r => r.revalidation.input.spans[0].text = "bad",
  nestedRules: r => r.revalidation.clinical_approval = true,
  nestedExclusions: r => r.revalidation.excluded_observation_ids = [],
  candidateOmitted: r => r.candidate_ids.pop(),
  candidateDuplicate: r => r.candidate_ids.push(r.candidate_ids[0]),
  heldReintroduced: r => r.candidate_ids.push("obs-0"),
  unsupportedStatus: r => r.status = "APPROVED",
  noCalls: r => r.calls = [],
  twoCalls: r => r.calls.push(r.calls[0]),
  wrongCallStage: r => r.calls[0].stage = "EXTRACT",
  unknownUsage: r => r.calls[0].input_tokens = null,
  negativeUsage: r => r.calls[0].input_tokens = -1,
  booleanUsage: r => r.calls[0].input_tokens = true,
  excessiveUsage: r => r.calls[0].input_tokens = 300001,
  failedCallCompleted: r => r.calls[0].outcome = "FAILED_OR_CANCELLED",
  reserveViolation: r => r.budgets.max_total_tokens = 1000,
  twoCallsBudget: r => r.budgets.max_calls = 2,
  repairs: r => r.budgets.max_repairs = 1,
  timeout: r => r.budgets.seconds = 0,
  withErrors: r => r.errors = ["MODEL_REQUEST_FAILED"],
  missingCritique: r => r.critique = null,
  replacementValues: r => r.critique.values = [],
  approvalScope: r => r.critique.concerns[0].scope = "APPROVED",
  unknownRow: r => r.critique.concerns[0].observation_ids = ["unknown"],
  heldRowConcern: r => r.critique.concerns[0].observation_ids = ["obs-0"],
  unknownSpan: r => r.critique.concerns[0].span_ids = ["unknown"],
  noSpan: r => r.critique.concerns[0].span_ids = [],
  noRows: r => r.critique.concerns[0].observation_ids = [],
  extraField: r => r.critique.concerns[0].field = "dose",
  tooManyQuestions: r => r.critique.next_questions = Array(9).fill("x"),
  blankQuestion: r => r.critique.next_questions = [""],
  findingsMismatch: r => r.model_findings = [],
  wrongWithheld: r => r.withheld_by_model_ids = [],
  duplicateRemaining: r => r.remaining_draft_ids.push(r.remaining_draft_ids[0]),
  comparisonRowWithheld: r => r.withheld_by_model_ids.push("obs-2"),
};
for (const [name, mutate] of Object.entries(mutations)) test(`reject inconsistent AI result: ${name}`, async () => {
  const { report, review } = fixture(); mutate(report); await assert.rejects(read(report, review));
});
test("failure and budget claims cannot carry fabricated completed opinions", async () => {
  for (const name of ["failed", "budget", "no_candidates"]) {
    const { report, review } = fixture(name); report.critique = { concerns: [], next_questions: [] };
    await assert.rejects(read(report, review));
  }
});
test("post-call budget exceeded report preserves known usage without opinions", async () => {
  const { report, review } = fixture("failed"); report.status = "BUDGET_EXCEEDED";
  report.errors = ["REPORTED_TOKEN_BUDGET_EXCEEDED"];
  Object.assign(report.calls[0], { outcome: "RECEIVED", response_id: "test", input_tokens: 210000, output_tokens: 1 });
  const r = await read(report, review); assert.equal(r.inputTokens, 210000); assert.equal(r.concerns.length, 0);
});
test("request digest binds exact candidate extraction and rules payload", async () => {
  const { report, review } = fixture(); report.revalidation.input.question = "Different question";
  await assert.rejects(read(report, review));
  // A consistently rewritten file cannot be authenticated: only consistency is promised.
  report.request_digest = await digest(canonical({ source: report.revalidation.input, extraction: { observations: report.revalidation.accepted }, deterministic_findings: report.revalidation.findings }));
  assert.equal((await read(report, review)).rules.question, "Different question");
});
test("malformed, duplicate-key, prototype and oversized input is refused", async () => {
  const { review } = fixture();
  for (const raw of ['{"x":1,"x":2}', '{"__proto__":{}}', '[1,]', ' '.repeat(RESULT_BYTES + 1)]) await assert.rejects(readRecritique(raw, review, source));
});

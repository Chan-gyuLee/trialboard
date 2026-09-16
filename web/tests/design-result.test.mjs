import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { canonical, decide, digest } from "../src/field-review.ts";
import { restoreReview } from "../src/field-review-restore.ts";
import { bindBrief, draftFromBrief, briefFromDraft, draftNumber, newDraft, readBrief, validateBrief } from "../src/design-brief.ts";
import { isDesignCurrent, readDesignResult } from "../src/design-result.ts";
import { draftBackup, restoreDesignInput } from "../src/design-draft.ts";

const root = fileURLToPath(new URL("../../", import.meta.url));
const produced = JSON.parse(execFileSync("uv", ["run", "python", "-c", `
import json, sys
sys.path.insert(0, 'tests')
from test_design_compare import brief_for, run, ai_result, prior_limited_sample
from test_field_revalidation import sample, revise, encode
f = sample()
normal = run(f)
b = brief_for(f)
b['scenarios'][0]['response'] = [0.0, 1e-7]
b['scenarios'][0]['adverse_event_penalty'] = 0.0
edge = run(f, b)
ai = run(f, ai=encode(ai_result(f)))
concern = {'scope':'comparison_limitation', 'observation_ids':['obs-0'], 'span_ids':['p1-i0'], 'reason':'Synthetic limitation'}
limited = run(f, ai=encode(ai_result(f, [concern])))
revise(f['review']['rows'][0]['fields']['reported_rate'], decision='held')
blocked = run(f)
print(json.dumps({'source':f['source']['source'], 'normal':normal, 'edge':edge, 'ai':ai, 'limited':limited, 'blocked':blocked, 'prior':run(prior_limited_sample())}, ensure_ascii=False))
`], { cwd: root, encoding: "utf8", timeout: 30000, maxBuffer: 8_000_000 }));
export const source = produced.source;
export function fixture(name = "normal") {
  const raw = structuredClone(produced[name]), review = restoreReview(JSON.stringify(raw.revalidation.review), source);
  return { raw, review };
}
const read = (raw, review, brief) => readDesignResult(JSON.stringify(raw), review, source, brief);
test('original model limitation stays blocked after field confirmation and cannot be deleted',async()=>{
 const {raw,review}=fixture('prior');const r=await read(raw,review);assert.equal(r.simulations.length,0);
 raw.blockers=raw.blockers.filter(b=>b.code!=='PREVIOUS_AI_LIMITATION_UNRESOLVED');await assert.rejects(read(raw,review));
});
test("editor restore accepts existing calculation brief without changing its numeric values", async () => {
  const { raw, review } = fixture("edge");
  const restored = await restoreDesignInput(JSON.stringify(raw.brief), review, source);
  assert.equal(restored.incomplete, false);
  assert.deepEqual(await briefFromDraft(restored.draft, review, source), raw.brief);
});
test("linked partial draft preserves missing observations and refuses unrelated row IDs", async () => {
  const { raw, review } = fixture();
  const d = draftFromBrief(raw.brief); d.arms[0].observation_ids = []; d.scenarios[0].response[0] = "";
  const backup = await draftBackup(d, review, source);
  assert.deepEqual((await restoreDesignInput(backup, review, source)).draft, d);
  await assert.rejects(briefFromDraft(d, review, source));
  const changed = JSON.parse(backup); changed.draft.arms[0].observation_ids = ["missing-row"];
  await assert.rejects(restoreDesignInput(JSON.stringify(changed), review, source));
  d.arms[0].observation_ids = raw.brief.arms[1].observation_ids;
  await assert.rejects(draftBackup(d, review, source));
});
for (const name of ["normal", "edge", "ai", "limited", "blocked"]) test(`Python ${name} design output is internally consistent`, async () => {
  const { raw, review } = fixture(name), before = structuredClone(review), r = await read(raw, review, raw.brief);
  assert.equal(r.simulations.length, ["limited", "blocked"].includes(name) ? 0 : 4);
  assert.equal(r.questions.length, raw.kol_questions.length); assert.deepEqual(review, before);
  assert.equal(r.ai?.mode ?? null, ["ai", "limited"].includes(name) ? "SCRIPTED_TEST_DOUBLE" : null);
  assert.ok(isDesignCurrent(r, review, source, raw.brief)); assert.equal(isDesignCurrent(r, review, source, raw.brief, true), false);
});
test("blank form has no probabilities or sample-size recommendations", () => {
  const d = newDraft(); assert.deepEqual(d.arms, []); assert.ok(d.plans.every(p => p.per_arm === ""));
  assert.equal(d.scenarios[0].maximum_adverse_event_rate, "");
});
test("brief editor roundtrips through exact review binding", async () => {
  const { raw, review } = fixture();
  assert.deepEqual(await briefFromDraft(draftFromBrief(raw.brief), review, source), raw.brief);
  assert.deepEqual(await readBrief(JSON.stringify(raw.brief), review, source), raw.brief);
  const next = decide(review, source, "obs-0", "dose", "confirmed", review.rows[0].fields.dose.current, "New review", 1, true);
  await assert.rejects(bindBrief(raw.brief, next, source)); await assert.rejects(read(raw, next));
});
for (const value of ["", " ", "-1", "1e3", "NaN", "0x10", "1,000", ".5", "01"]) test(`numeric draft rejects ${JSON.stringify(value)}`, () => assert.throws(() => draftNumber(value)));
for (const [value, expected] of [["0", 0], ["1", 1], ["0.35", .35], ["1000", 1000]]) test(`numeric draft accepts ${value}`, () => assert.equal(draftNumber(value), expected));
const mutations = {
  approval: r => r.clinical_approval = true,
  recommended: r => r.recommended_plan_id = "small",
  modelCalls: r => r.model_calls = 1,
  schema: r => r.schema_version = "design-comparison/99",
  status: r => r.status = "APPROVED",
  briefHash: r => r.brief_digest = "0".repeat(64),
  canonical: r => r.brief_canonical = "{}",
  reviewHash: r => r.review_content_digest = "0".repeat(64),
  source: r => r.brief.source_digest = "0".repeat(64),
  unknownRow: r => r.brief.arms[0].observation_ids[0] = "unknown",
  evidence: r => r.evidence_rows[0].fields.events.value = "19",
  evidenceOmitted: r => r.evidence_rows.pop(),
  planTotal: r => r.plans[0].total_sample_size = 999,
  planAllocation: r => r.plans[0].allocation = "ADAPTIVE",
  assumedResponse: r => r.simulations[0].scenario.response[0] = .99,
  perArm: r => r.simulations[0].design.per_arm = 999,
  seed: r => r.simulations[0].seed = 0,
  repetitions: r => r.simulations[0].repetitions = 10000,
  duplicateRun: r => r.simulations[1] = r.simulations[0],
  missingRun: r => r.simulations.pop(),
  missingRate: r => delete r.simulations[0].selection_probability['arm-a'],
  sum: r => r.simulations[0].no_selection_probability = 1,
  negative: r => r.simulations[0].selects_true_unsafe_probability = -.1,
  nanString: r => r.simulations[0].selects_true_unsafe_probability = "NaN",
  notCounts: r => r.simulations[0].selection_probability['arm-a'] = .1234567,
  error: r => r.simulations[0].monte_carlo_se.true_utility_best = .2,
  wrongBest: r => r.simulations[0].true_utility_best_arms = [],
  delta: r => r.tradeoffs[0].correct_selection_or_abstention_delta += .1,
  deltaSe: r => r.tradeoffs[0].delta_monte_carlo_se.true_utility_best += .1,
  missingDelta: r => r.tradeoffs.pop(),
  participantDelta: r => r.tradeoffs[0].additional_participants = 999,
  answeredByExpert: r => r.kol_questions[0].answer_status = "EXPERT_APPROVED",
  questionDuplicate: r => r.kol_questions[1].id = r.kol_questions[0].id,
  missingQuestion: r => r.kol_questions.pop(),
  questionTrigger: r => r.kol_questions.at(-1).trigger.additional_participants = 999,
  aiStatus: r => r.ai_status = "COMPLETED",
};
for (const [name, mutate] of Object.entries(mutations)) test(`reject inconsistent design report: ${name}`, async () => {
  const { raw, review } = fixture(); mutate(raw); await assert.rejects(read(raw, review));
});
const briefMutations = {
  extra: b => b.auto_recommend = true,
  duplicateArm: b => b.arms[1].id = b.arms[0].id,
  duplicateDose: b => b.arms[1].source_dose = b.arms[0].source_dose,
  duplicateRef: b => b.arms[1].observation_ids.push(b.arms[0].observation_ids[0]),
  duplicatePlanSize: b => b.plans[1].per_arm = b.plans[0].per_arm,
  nonintegerSize: b => b.plans[0].per_arm = 3.5,
  countMismatch: b => b.scenarios[0].response.pop(),
  aboveOne: b => b.scenarios[0].response[0] = 1.1,
  boolean: b => b.scenarios[0].response[0] = true,
  provenance: b => b.scenarios[0].provenance = "evidence_estimate",
  noRationale: b => b.scenarios[0].rationale = " ",
  negativeSeed: b => b.seed = -1,
  budget: b => { b.scenarios = Array.from({length:6}, (_, i) => ({...b.scenarios[0], id:`s-${i}`})); b.repetitions = 20000; b.plans.push({...b.plans[0],id:'p3',per_arm:70}); b.plans.push({...b.plans[0],id:'p4',per_arm:80}); b.arms.push({...b.arms[0],id:'c',source_dose:'C',observation_ids:['c']}); b.scenarios.forEach(s => {s.response=[.1,.2,.3];s.adverse_event=[.1,.2,.3];}); },
};
for (const [name, mutate] of Object.entries(briefMutations)) test(`reject invalid brief: ${name}`, () => {
  const { raw } = fixture(); mutate(raw.brief); assert.throws(() => validateBrief(raw.brief));
});
test("changed scenario cannot be displayed as current input", async () => {
  const { raw, review } = fixture(), b = structuredClone(raw.brief); b.scenarios[0].response[0] = .7;
  await assert.rejects(read(raw, review, b));
});
test("removing a hold blocker cannot restore simulations", async () => {
  const { raw, review } = fixture("blocked"); raw.blockers = []; raw.status = "HYPOTHETICAL_COMPARISON_ONLY";
  await assert.rejects(read(raw, review));
});
test("AI comparison concerns cannot silently disappear from the report", async () => {
  const { raw, review } = fixture("limited"); raw.blockers = []; raw.status = "HYPOTHETICAL_COMPARISON_ONLY";
  await assert.rejects(read(raw, review));
});
test("hash material supports Python float serialization without weakening structural matching", async () => {
  const { raw, review } = fixture("edge"); assert.notEqual(await digest(canonical(raw.brief)), raw.brief_digest);
  assert.deepEqual(await briefFromDraft(draftFromBrief(raw.brief), review, source), raw.brief);
  await read(raw, review);
  raw.brief_canonical = raw.brief_canonical.replace('0.0', '0.1'); raw.brief_digest = await digest(raw.brief_canonical);
  await assert.rejects(read(raw, review));
});

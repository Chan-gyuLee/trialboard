import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { BASELINE, INITIAL_STRESS, bindStressResult, stressDelta, stressError, stressInput, stressMarkdown, stressQuestions } from "../src/scenario-briefing.ts";

const inputs = [INITIAL_STRESS, { aeA: "12", aeB: "45" }, { aeA: "0", aeB: "0" }, { aeA: "35", aeB: "35" }].map(stressInput);
test("tiny changes are not rendered as negative zero", () => {
  assert.equal(stressDelta(-0.0001), "0.1%p 미만 감소");
  assert.equal(stressDelta(0), "0.0%p");
  assert.equal(stressDelta(.01), "+1.0%p");
});
const results = JSON.parse(execFileSync("uv", ["run", "python", "-c", `
import json, sys
from fastapi.testclient import TestClient
from trialboard.api.app import create_app
with TestClient(create_app(), base_url='http://127.0.0.1') as client:
    outputs = []
    for item in json.load(sys.stdin):
        response = client.post('/api/reviews', json=item, headers={'origin': 'http://127.0.0.1:5173'})
        assert response.status_code == 200, response.text
        outputs.append(response.json())
    print(json.dumps(outputs))
`], { cwd: fileURLToPath(new URL("../../", import.meta.url)), input: JSON.stringify(inputs), encoding: "utf8", timeout: 30000 }));

test("fixed synthetic bridge never imports clinical rates and copies baseline", () => {
  const input = stressInput(INITIAL_STRESS);
  assert.deepEqual(input.scenarios[0].response, [.3, .32]);
  assert.deepEqual(input.per_arm, [30, 60]);
  input.scenarios[0].response[0] = .85;
  assert.equal(BASELINE.response[0], .3);
});
for (const value of ["", " ", "NaN", "Infinity", "1e2", "-1", "101", "3%", ".5"]) test(`invalid assumption ${JSON.stringify(value)} blocks submission`, () => {
  assert.ok(stressError({ aeA: value, aeB: "65" }));
  assert.throws(() => stressInput({ aeA: "55", aeB: value }));
});
test("unchanged scenario is not presented as a stress test", () => assert.throws(() => stressInput({ aeA: "12.0", aeB: "25" })));
for (const [i, raw] of results.entries()) test(`actual Python output binds for boundary case ${i}`, () => {
  const result = bindStressResult(raw, inputs[i]);
  assert.equal(result.plans.length, 2);
  assert.equal(result.plans[1].after.total_sample_size, 120);
  assert.equal(stressQuestions(result).length, 3);
});
test("questions change with toxicity threshold crossing rather than scripted outcome", () => {
  const both = stressQuestions(bindStressResult(results[0], inputs[0]));
  const one = stressQuestions(bindStressResult(results[1], inputs[1]));
  const equal = stressQuestions(bindStressResult(results[3], inputs[3]));
  assert.match(both[1].text, /두 군/);
  assert.match(one[1].text, /한계 초과 군은 B/);
  assert.match(equal[1].text, /한계 초과 군은 없음/);
  assert.notEqual(both[2].text, one[2].text);
});
for (const [name, edit] of [
  ["different input", r => r.input.scenarios[1].adverse_event[0] = .2],
  ["missing combination", r => r.report.simulations.pop()],
  ["duplicated combination", r => r.report.simulations[0] = r.report.simulations[1]],
  ["different sample size", r => r.report.simulations[0].design.per_arm = 100],
  ["different seed", r => r.report.simulations[0].seed++],
  ["different repetitions", r => r.report.simulations[0].repetitions++],
  ["different scenario", r => r.report.simulations[0].scenario.response[0] = .85],
  ["nonfinite rate", r => r.report.simulations[0].no_selection_probability = NaN],
  ["negative rate", r => r.report.simulations[0].selects_true_unsafe_probability = -1],
  ["probability sum", r => r.report.simulations[0].selection_probability.dose_a = 1],
  ["MC mismatch", r => r.report.simulations[0].monte_carlo_se.no_selection = .5],
  ["gate issue", r => r.report.issues.push({ code: "MISSING" })],
  ["different mode", r => r.execution_mode = "STORED"],
  ["persistent result", r => r.persisted = true],
]) test(`rejects ${name} before showing result or questions`, () => {
  const raw = structuredClone(results[0]); edit(raw);
  assert.throws(() => bindStressResult(raw, inputs[0]));
});
test("response order does not change design pairing", () => {
  const raw = structuredClone(results[0]); raw.report.simulations.reverse();
  assert.deepEqual(bindStressResult(raw, inputs[0]).plans, bindStressResult(results[0], inputs[0]).plans);
});
test("meeting export includes actual conditions, execution and non-AI limits", () => {
  const md = stressMarkdown(bindStressResult(results[1], inputs[1]));
  for (const text of [results[1].execution_id, "12.0% / 45.0%", "규칙 기반", "새 AI 호출 없음", "Monte Carlo", "공개 임상 근거에서 도출하지 않음"]) assert.ok(md.includes(text), text);
});

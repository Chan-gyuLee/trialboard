import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { readAgentRecord } from "../src/agent-briefing.ts";
import { bindStressResult, INITIAL_STRESS, stressInput } from "../src/scenario-briefing.ts";
import { repairEvidence, currentDecision, decisionInsight, decisionMarkdown, decisionSessionJson, restoreDecisionSession } from "../src/decision-briefing.ts";

const record = await readAgentRecord(readFileSync(new URL("../public/data/agent/synthetic-repair.json",import.meta.url),"utf8"));
const drafts = [INITIAL_STRESS,{aeA:"12",aeB:"45"},{aeA:"0",aeB:"0"}];
const inputs = drafts.map(stressInput);
const executions = JSON.parse(execFileSync("uv",["run","python","-c",`
import json,sys
from fastapi.testclient import TestClient
from trialboard.api.app import create_app
with TestClient(create_app(),base_url='http://127.0.0.1') as c:
 result=[]
 for item in json.load(sys.stdin):
  r=c.post('/api/reviews',json=item,headers={'origin':'http://127.0.0.1:5173'})
  assert r.status_code==200,r.text
  result.append(r.json())
 print(json.dumps(result))
`],{cwd:fileURLToPath(new URL("../../",import.meta.url)),input:JSON.stringify(inputs),encoding:"utf8",timeout:30000}));
const results = executions.map((e,i) => bindStressResult(e,inputs[i]));
const session = {record,history:results.slice(0,2),draft:drafts[1],notes:{[executions[0].execution_id]:{owner:"MOC 가상 담당자",action:"이전 가정 검토"},[executions[1].execution_id]:{owner:"",action:""}}};

test("repair proof derives 7/200 to 7/20 from linked record, not hard-coded screen values", () => {
  const p=repairEvidence(record); assert.equal(p.before,200); assert.equal(p.after,20); assert.equal(p.events,7); assert.equal(p.beforeRate,.035); assert.equal(p.afterRate,.35);
  assert.ok(p.span.text.includes(p.change.after.quote));
});
for (const [name,edit] of [
  ["live mode",r=>r.execution_mode="CODEX_CHATGPT"],
  ["real provenance",r=>r.input.provenance="curated_public_excerpt"],
  ["missing source",r=>r.input.spans=[]],
  ["missing finding",r=>r.attempts[0].findings=[]],
  ["unlinked final denominator",r=>r.accepted=structuredClone(r.accepted).map(o=>o.id==="obs-1"?{...o,fields:{...o.fields,denominator:{...o.fields.denominator,value:"19"}}}:o)],
  ["unlinked final events",r=>r.accepted=structuredClone(r.accepted).map(o=>o.id==="obs-1"?{...o,fields:{...o.fields,events:{...o.fields.events,value:"8"}}}:o)],
]) test(`reject unsupported evidence: ${name}`,()=>{const r=structuredClone(record);edit(r);assert.throws(()=>repairEvidence(r));});
test("current result requires matching numeric inputs; empty/changed input is stale",()=>{
  assert.equal(currentDecision(null,drafts[0]),false); assert.equal(currentDecision(results[0],drafts[0]),true);
  assert.equal(currentDecision(results[0],{aeA:"55.0",aeB:"65"}),true);
  assert.equal(currentDecision(results[0],drafts[1]),false); assert.equal(currentDecision(results[0],{aeA:"",aeB:"65"}),false);
});
test("decision question responds to computed scenario thresholds",()=>{
  assert.match(decisionInsight(results[0]).title,/증원만으로/); assert.match(decisionInsight(results[1]).title,/위험 군/); assert.match(decisionInsight(results[2]).title,/안정성/);
  assert.equal(decisionInsight(results[0]).added,60);
});
test("stale briefing export is blocked and output explains MOC boundaries",()=>{
  assert.throws(()=>decisionMarkdown(record,results[0],drafts[1],{owner:"",action:""}),/가정이 바뀌/);
  const md=decisionMarkdown(record,results[0],drafts[0],{owner:"MOC",action:"다음 자료 확인"});
  for(const s of ["MOC","새 AI 실행 없음","두 단계는 별도 예제","규칙 기반",executions[0].execution_id,"단순 사건 비율 3.5% → 35.0%","다음 자료 확인"]) assert.ok(md.includes(s),s);
});
test("session roundtrip retains separate execution-bound notes, with no calculations",async()=>{
  const restored=await restoreDecisionSession(decisionSessionJson(session));
  // strictJson deliberately strips prototypes; compare all persisted values, not prototypes.
  assert.deepEqual(JSON.parse(JSON.stringify(restored)),JSON.parse(JSON.stringify(session)));assert.equal(restored.history.length,2);
  assert.equal(restored.notes[executions[1].execution_id].owner,"");
});
test("unfinished assumption survives checkpoint but not meeting export",async()=>{
  const s={...session,draft:{aeA:"",aeB:"-"}}; const restored=await restoreDecisionSession(decisionSessionJson(s));
  assert.deepEqual({...restored.draft},s.draft);assert.equal(currentDecision(restored.history.at(-1),restored.draft),false);
});
test("empty calculation history can be backed up without creating a result",async()=>{
  const s={record,history:[],draft:drafts[0],notes:{}};assert.deepEqual(JSON.parse(JSON.stringify(await restoreDecisionSession(decisionSessionJson(s)))),JSON.parse(JSON.stringify(s)));
});
for (const [name,edit] of [
  ["unknown schema",r=>r.schema="decision-session/2"], ["approval",r=>r.clinicalApproval=true], ["identity",r=>r.identity="EXPERT"],
  ["unknown field",r=>r.signed=true], ["too many runs",r=>r.executions=Array(5).fill(r.executions[0])],
  ["duplicate runs",r=>r.executions[1]=r.executions[0]], ["foreign note",r=>r.notes.foreign={owner:"",action:""}],
  ["long note",r=>r.notes[r.executions[0].execution_id].owner="x".repeat(201)], ["draft type",r=>r.draft.aeA=55],
  ["draft too long",r=>r.draft.aeA="5".repeat(13)], ["corrupted result",r=>r.executions[0].report.simulations.pop()],
  ["altered baseline",r=>r.executions[0].input.scenarios[0].response=[.9,.9]], ["tampered record",r=>r.record.input.asset="OTHER"],
]) test(`reject corrupt session: ${name}`,async()=>{const r=JSON.parse(decisionSessionJson(session));edit(r);await assert.rejects(restoreDecisionSession(JSON.stringify(r)));});
test("invalid JSON does not partially restore",async()=>{await assert.rejects(restoreDecisionSession("{}"));await assert.rejects(restoreDecisionSession("{"));});

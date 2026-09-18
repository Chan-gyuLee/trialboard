import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {DEMO_CASE,readDecisionCase,inspectDecisionCase,caseRunInput,bindCaseExecution,caseQuestions,caseConclusion,decisionCaseMarkdown} from '../src/decision-case.ts';

const copy=()=>structuredClone(DEMO_CASE);
test('case source survives JSON roundtrip; discrepancy is calculated, not scripted',()=>{
 const c=readDecisionCase(JSON.stringify(copy()));const a=inspectDecisionCase(c);
 assert.equal(a.discrepancies.length,1);assert.equal(a.discrepancies[0].row.id,'T2-R2');assert.deepEqual(a.blockers,[]);
 c.summary[3].denominator=40;assert.equal(inspectDecisionCase(c).discrepancies.length,0);
 c.summary[0].events=14;assert.equal(inspectDecisionCase(c).discrepancies[0].row.id,'T1-R1');
});
test('source proportions, not wrong summary, bind into synthetic calculation after confirmation',()=>{
 assert.throws(()=>caseRunInput(copy(),false),/확인/);
 const input=caseRunInput(copy(),true);assert.deepEqual(input.scenarios[0].adverse_event,[.12,.25]);assert.deepEqual(input.scenarios[0].response,[.3,.32]);assert.deepEqual(input.scenarios[1].adverse_event,[.55,.65]);
 const c=copy();c.rows[3].events=8;assert.equal(caseRunInput(c,true).scenarios[0].adverse_event[1],.2);
 input.scenarios[1].adverse_event[0]=0;assert.equal(DEMO_CASE.sensitivity.adverseEvent[0],.55);
});
for(const [name,edit] of [
 ['real data',c=>c.dataKind='REAL'],['zero denominator',c=>c.rows[0].denominator=0],['too many events',c=>c.rows[0].events=999],['fractional count',c=>c.rows[0].events=1.5],['unknown metric',c=>c.rows[0].metric='survival'],['duplicate source ID',c=>c.rows[1].id=c.rows[0].id],['duplicate arm metric',c=>c.rows[1].arm='A'],['missing row',c=>c.rows.pop()],['missing claim',c=>c.summary.pop()],['unknown claim reference',c=>c.summary[0].sourceId='missing'],['duplicate claim',c=>c.summary[1].sourceId=c.summary[0].sourceId],['invalid stress probability',c=>c.sensitivity.adverseEvent[0]=2],['infinite penalty',c=>c.sensitivity.penalty=Infinity],['no sample increase',c=>c.protocol.alternativePerArm=30],['large sample',c=>c.protocol.alternativePerArm=501],['missing context',c=>c.rows[0].timepoint=''],
 ])test(`rejects ${name}`,()=>{const c=copy();edit(c);assert.throws(()=>readDecisionCase(JSON.stringify(c)));});
for(const field of ['population','timepoint','definition'])test(`context mismatch ${field} blocks even confirmed calculation`,()=>{const c=copy();c.rows[1][field]='different';assert.equal(inspectDecisionCase(c).blockers.length,1);assert.throws(()=>caseRunInput(c,true),/다릅니다/);});
test('matched claims do not require discrepancy confirmation',()=>{const c=copy();c.summary[3].denominator=40;assert.equal(caseRunInput(c,false).per_arm[0],30);});
const input=caseRunInput(copy(),true);
const raw=JSON.parse(execFileSync('uv',['run','python','-c',`
import json,sys
from fastapi.testclient import TestClient
from trialboard.api.app import create_app
with TestClient(create_app(),base_url='http://127.0.0.1') as client:
 r=client.post('/api/reviews',json=json.load(sys.stdin),headers={'origin':'http://127.0.0.1:5173'})
 assert r.status_code==200,r.text
 print(r.text)
`],{input:JSON.stringify(input),encoding:'utf8',timeout:30000}));
test('actual Python output binds and drives meeting export',()=>{
 const result=bindCaseExecution(copy(),true,raw);
 assert.equal(result.plans[1].after.total_sample_size,120);assert.equal(caseQuestions(copy(),result).length,3);
 assert.ok(result.plans[1].after.no_selection_probability>.9);
 const md=decisionCaseMarkdown(copy(),result);for(const s of ['MOC','10/40','10/50','T2-R2',raw.execution_id,'규칙 기반','모수 불확실성','55.0% / 65.0%'])assert.ok(md.includes(s),s);
 assert.match(caseConclusion(copy(),result),/용량 범위/);
});
test('source modification invalidates previous computation',()=>{const c=copy();c.rows[0].events++;assert.throws(()=>bindCaseExecution(c,true,raw));});
test('sample modification invalidates previous computation',()=>{const c=copy();c.protocol.alternativePerArm=70;assert.throws(()=>bindCaseExecution(c,true,raw));});
test('malformed calculation cannot produce a decision',()=>{const r=structuredClone(raw);r.report.simulations.pop();assert.throws(()=>bindCaseExecution(copy(),true,r));});

import test from 'node:test';
import assert from 'node:assert/strict';
import {decisionView} from '../src/decision-view.ts';
const base=()=>({result:{collection:{status:'COMPLETE',review:{conclusion:'NEEDS_EXPERT_REVIEW'}}},registryResults:{limited:false,readiness:{responseCandidate:true,safetyCandidate:true,questions:['MOC question']}}});
test('both structural candidates lead to expert review, never approval',()=>{
 const view=decisionView(base());assert.equal(view.state,'candidate');assert.match(view.title,/전문가/);assert.match(view.reason,/최종 용량은 전문가/);
});
test('incomplete collection dominates otherwise positive readiness',()=>{
 const d=base();d.result.collection.status='PARTIAL';assert.equal(decisionView(d).state,'incomplete');
 d.result.collection.status='COMPLETE';d.result.collection.review=null;assert.equal(decisionView(d).state,'incomplete');
});
test('missing or failed readiness does not imply negative clinical outcomes',()=>{
 const d=base();d.registryError='error';assert.equal(decisionView(d).state,'unknown');assert.ok(decisionView(d).checks.every(x=>x.value===undefined));
 delete d.registryResults;assert.match(decisionView(d).reason,/효과가 없다는 뜻은 아닙니다/);
});
test('limited tables or insufficient AI evidence cannot produce a candidate headline',()=>{
 const d=base();d.registryResults.limited=true;assert.equal(decisionView(d).state,'limited');
 d.registryResults.limited=false;d.result.collection.review.conclusion='INSUFFICIENT_EVIDENCE';assert.equal(decisionView(d).state,'gap');assert.match(decisionView(d).reason,/구조 검사만으로/);
});
test('efficacy and safety gaps are explained separately without manufacturing a plan',()=>{
 const d=base();d.registryResults.readiness.responseCandidate=false;assert.match(decisionView(d).reason,/효과를 비교할 근거/);
 d.registryResults.readiness.responseCandidate=true;d.registryResults.readiness.safetyCandidate=false;assert.match(decisionView(d).reason,/부작용을 비교할 근거/);
 d.registryResults.readiness.responseCandidate=false;assert.match(decisionView(d).reason,/효과와 부작용/);assert.equal(decisionView(d).hasSimulation,false);
});
test('failed simulation restore never advertises an available simulation',()=>{
 const d=base();d.exploration={};assert.equal(decisionView(d).hasSimulation,true);d.explorationError='failed';assert.equal(decisionView(d).hasSimulation,false);
});

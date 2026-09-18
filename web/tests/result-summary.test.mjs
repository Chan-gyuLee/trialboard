import test from 'node:test';
import assert from 'node:assert/strict';
import {resultSummary,explorationDeltas} from '../src/result-summary.ts';
import {explorationFixture} from './exploration-fixture.mjs';
const base=()=>({result:{collection:{status:'COMPLETE',review:{questions:['MOC']}}},registryResults:{limited:false,readiness:{responseCandidate:false,safetyCandidate:true,questions:['MOC gap','MOC gap']}}});
test('state summary distinguishes a missing response from safety candidate and MOC',()=>{
 const d=base();d.exploration=explorationFixture();const s=resultSummary(d);
 assert.match(s.headline,/효능 근거/);assert.deepEqual(s.cards.map(c=>c.state),['gap','candidate','moc']);assert.deepEqual(s.next,['MOC gap']);
 assert.match(s.explanation,/승인한 결론은 아닙니다/);
});
test('missing results are unknown rather than negative clinical evidence',()=>{
 const d=base();delete d.registryResults;const s=resultSummary(d);assert.deepEqual(s.cards.map(c=>c.state),['unknown','unknown','unknown']);assert.match(s.next[0],/결과가 없다는 뜻이 아닙니다/);
});
test('failed restore must not promote retained results to confirmed status',()=>{
 const d=base();d.registryError='MOC failure';d.exploration=explorationFixture();d.explorationError='MOC failure';
 assert.deepEqual(resultSummary(d).cards.map(c=>c.state),['unknown','unknown','unknown']);
});
test('partial research and missing AI review remain visibly incomplete',()=>{
 for(const change of [d=>d.result.collection.status='PARTIAL',d=>d.result.collection.review=null]){const d=base();change(d);assert.equal(resultSummary(d).reviewIncomplete,true);}
});
test('both candidates never become clinical approval; partial tables have priority',()=>{
 const d=base();d.registryResults.readiness.responseCandidate=true;assert.match(resultSummary(d).headline,/적용 범위 확인/);
 d.registryResults.limited=true;assert.match(resultSummary(d).headline,/일부 결과/);
});
test('safety gaps and both missing have different summaries',()=>{
 const d=base();d.registryResults.readiness.safetyCandidate=false;assert.match(resultSummary(d).headline,/효능·안전성/);
 d.registryResults.readiness.responseCandidate=true;assert.match(resultSummary(d).headline,/안전성 근거/);
});
test('reference changes reverse deltas with equal uncertainty, no recommendations',()=>{
 const p=explorationFixture(),before=JSON.stringify(p);
 const a=explorationDeltas(p,'tradeoff','n20').find(d=>d.planId==='n60');
 const b=explorationDeltas(p,'tradeoff','n60').find(d=>d.planId==='n20');
 assert.equal(a.participants,80);assert.equal(b.participants,-80);assert.equal(a.correctPp,-b.correctPp);assert.equal(a.unsafePp+b.unsafePp,0);assert.equal(a.deltaSePp,b.deltaSePp);
 assert.equal(JSON.stringify(p),before);assert.equal('recommendedPlanId' in a,false);
});
test('same result as reference has zero difference and zero difference error',()=>{
 const p=explorationFixture();for(const s of p.scenarios){const d=explorationDeltas(p,s.id,'n40').find(d=>d.reference);assert.equal(d.participants,0);assert.equal(d.correctPp,0);assert.equal(d.deltaSePp,0);}
});
test('Monte Carlo difference error uses independent streams, not sum or confidence',()=>{
 const p=explorationFixture(),s=p.simulations.filter(s=>s.scenario.id==='unsafe');
 const d=explorationDeltas(p,'unsafe','n20')[1];assert.equal(d.deltaSePp,100*Math.hypot(s[0].monte_carlo_se.true_utility_best,s[1].monte_carlo_se.true_utility_best));
 assert.throws(()=>explorationDeltas(p,'missing','n20'));assert.throws(()=>explorationDeltas(p,'equal','missing'));
});

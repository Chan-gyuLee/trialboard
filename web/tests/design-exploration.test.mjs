import test from 'node:test';
import assert from 'node:assert/strict';
import {readExploration,requestExploration} from '../src/design-exploration.ts';
import {autoPacketMarkdown} from '../src/auto-packet.ts';
import {explorationFixture} from './exploration-fixture.mjs';
const result={collection:{id:'00000000-0000-4000-8000-000000000002',request:{nct_id:'NCT00000001',asset:'MOCdrug',indication:'MOC tumor'},sources:[],status:'COMPLETE',created_at:'2026-09-16',coverage:[],notices:[]}};
test('real Python simulation output is read as separate synthetic exploration, not evidence',()=>{
 const p=readExploration(JSON.stringify(explorationFixture()),result);
 assert.equal(p.simulations.length,9);assert.equal(p.modelCalls,0);assert.equal(p.evidenceUsedAsParameters,false);assert.equal(p.clinicalApproved,false);
 const md=autoPacketMarkdown({result,exploration:p});assert.ok(md.includes('MOC · 별도 가상 설계 탐색'));assert.ok(md.includes('RULE_LIBRARY_HYPOTHETICAL'));assert.ok(md.includes('검정력'));assert.ok(md.includes('seed 42'));
});
for(const [name,change] of [
 ['run',p=>p.runId='other'],['asset',p=>p.asset='other'],['snapshot',p=>p.snapshotDigest='a'.repeat(64)],
 ['clinical approval',p=>p.clinicalApproved=true],['user approval',p=>p.userApproved=true],['recommendation',p=>p.recommendedPlanId='n40'],
 ['model claim',p=>p.provenance='AI_PROPOSED'],['parameters from evidence',p=>p.evidenceUsedAsParameters=true],['dose mapping',p=>p.armMapping='240mg_960mg'],
 ['modified probability',p=>p.scenarios[0].response[0]=.5],['modified count',p=>p.plans[0].per_arm=50],
 ['duplicate cell',p=>p.simulations[1]=p.simulations[0]],['incomplete grid',p=>p.simulations.pop()],
 ['frequency sum',p=>p.simulations[0].selection_probability.A=.99],['Monte Carlo SE',p=>p.simulations[0].monte_carlo_se.true_utility_best=.5],
 ['mismatched simulation input',p=>p.simulations[0].scenario.response[0]=.9],['false sample size',p=>p.simulations[0].total_sample_size=100],
 ['wrong truth',p=>p.simulations[0].true_utility_best_arms=['A']],['wrong repetition',p=>p.simulations[0].repetitions=20],
])test(`MOC exploration rejects ${name}`,()=>{const p=explorationFixture();change(p);assert.throws(()=>readExploration(JSON.stringify(p),result));});
test('GET restores without POST and no-record stays absent, POST is opt-in',async()=>{
 const calls=[],signal=new AbortController().signal;
 const fetcher=async(path,options)=>{calls.push({path,...options});return Response.json(explorationFixture());};
 await requestExploration(result,signal,fetcher);await requestExploration(result,signal,fetcher,true);
 assert.equal(calls[0].method,undefined);assert.equal(calls[1].method,'POST');assert.deepEqual(JSON.parse(calls[1].body),{consent:true});
 assert.equal(await requestExploration(result,signal,async()=>new Response('',{status:404})),null);
 await assert.rejects(requestExploration(result,signal,async()=>Response.json(null),true));
 const c=new AbortController();c.abort();await assert.rejects(requestExploration(result,c.signal,fetcher,true));assert.equal(calls.length,2);
});

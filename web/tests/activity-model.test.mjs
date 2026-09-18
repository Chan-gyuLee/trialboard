import test from 'node:test';
import assert from 'node:assert/strict';
import {activityArtifacts,replayEvents,replayDelay,workRoles} from '../src/activity-model.ts';
const id='00000000-0000-4000-8000-000000000001';
const event=(stage,sequence,patch={})=>({run_id:id,stage,sequence,elapsed_ms:sequence*1000,message:'MOC '+stage,...patch});
test('roles cover all eight existing stages exactly once, without new agents',()=>{
 assert.deepEqual(workRoles.flatMap(r=>r.stages),[0,1,2,3,4,5,6,7]);
});
test('artifact feed has only delivered content, deduplicates source IDs, and does not mutate input',()=>{
 const events=[{stage:'RESEARCH',research:{sources:[{id:'a',title:'first'}]}},{stage:'RESEARCH',research:{sources:[{id:'a',title:'updated'},{id:'b',title:'second'}],plan:{missing_evidence:['MOC gap']}}}];
 const before=JSON.stringify(events),a=activityArtifacts(events);
 assert.equal(a.sources.length,2);assert.equal(a.sources[0].title,'updated');assert.equal(a.review,undefined);assert.equal(a.items.length,0);assert.equal(JSON.stringify(events),before);
 assert.deepEqual(activityArtifacts([]).sources,[]);
});
test('replay preserves source-stage messages and timing but strips unvalidated structured payloads',()=>{
 const c={id,events:[event('STARTED',1),event('SOURCE',2,{sources:[{id:'forged'}]}),event('AI_PLAN_READY',3,{plan:{}}),event('REVIEW_READY',4,{review:{}}),event('COMPLETE',5)]};
 const before=JSON.stringify(c),out=replayEvents(c);
 assert.equal(out.length,5);assert.equal(out[1].research.stage,'SOURCE');assert.equal(out[1].research.sources,undefined);
 assert.equal(out[2].research.plan,undefined);assert.equal(out[3].research.review,undefined);assert.equal(out[4].research.elapsed_ms,5000);assert.equal(JSON.stringify(c),before);
});
test('replay rejects foreign IDs, reverse order, negative clocks, unsupported reasoning and malformed events',()=>{
 const events=[null,event('STARTED',1),event('SEARCH',2,{run_id:'foreign'}),event('SOURCE',2,{elapsed_ms:-1}),event('HIDDEN_REASONING',2),event('SOURCE',2,{message:{}}),event('SOURCE',2,{message:'a'.repeat(4001)}),event('SOURCE',2),event('SEARCH',1),event('SEARCH',3,{elapsed_ms:1}),event('COMPLETE',4)];
 assert.deepEqual(replayEvents({id,events}).map(e=>e.research.sequence),[1,2,4]);
});
test('display delay is bounded, without changing recorded durations',()=>{
 const a={research:{elapsed_ms:0}},b={research:{elapsed_ms:50000}},c={research:{elapsed_ms:100}};
 assert.equal(replayDelay(a,b),2500);assert.equal(replayDelay(a,c),650);assert.equal(b.research.elapsed_ms,50000);
});

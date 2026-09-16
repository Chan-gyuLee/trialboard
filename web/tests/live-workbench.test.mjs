import test from 'node:test';
import assert from 'node:assert/strict';
import {liveWorkbench} from '../src/live-workbench.ts';
test('no event means no invented phase or output',()=>{
 const w=liveWorkbench([],true,'',null);assert.match(w.title,/시작 응답/);assert.equal(w.task,undefined);assert.deepEqual(w.outputs,[]);
});
test('actual source and output events stay separate and ordered',()=>{
 const e=[{stage:'EXTRACT',attempt:0,state:'STARTED',elapsed_ms:0,items:[{kind:'source',id:'p1',text:'source',span_ids:['p1']}]},{stage:'EXTRACT',attempt:0,state:'COMPLETED',elapsed_ms:2500,items:[{kind:'observation',id:'obs1',text:'value',span_ids:['p1']}]},{stage:'CRITIQUE',attempt:0,state:'STARTED',elapsed_ms:2600}];
 const w=liveWorkbench(e,true,'',null);assert.equal(w.sources.length,1);assert.equal(w.outputs.length,1);assert.equal(w.outputs[0].elapsed_ms,2500);assert.match(w.title,/반론/);assert.match(w.task.next,/참조/);
});
test('error takes precedence over previous successful stages',()=>{const w=liveWorkbench([{stage:'VERIFY',state:'COMPLETED',attempt:0,elapsed_ms:1}],false,'failed',null);assert.equal(w.status,'중단/오류');assert.match(w.title,/못했습니다/);});
test('complete means handoff, not clinical approval',()=>{assert.equal(liveWorkbench([],false,'','PARTIAL_ABSTENTION').title,'이번 실행을 검토자에게 인계합니다');});

import test from 'node:test';
import assert from 'node:assert/strict';
import {agentScene,stageLabels} from '../src/agent-scene.ts';

test('initial running scene shows search only; not a percentage or inferred success',()=>{
 const scene=agentScene([],null,true);
 assert.equal(scene.active,0);
 assert.equal(scene.stages.filter(s=>s.state==='running').length,1);
 assert.equal(scene.stages.filter(s=>s.state==='done').length,0);
 assert.equal(scene.stages.length,stageLabels.length);
});
test('later events retire previous active work without falsely completing it',()=>{
 const events=[{stage:'DOCUMENT',message:'prepare'},{stage:'EXTRACTION',message:'extract'},{stage:'ASSESSMENT',message:'check'}];
 const scene=agentScene(events,null,true);
 assert.equal(scene.active,6);
 assert.equal(scene.stages[4].state,'passed');
 assert.equal(scene.stages[5].state,'passed');
 assert.equal(scene.stages.filter(s=>s.state==='running').length,1);
});
test('abort cannot leave a spinner or mark interrupted extraction complete',()=>{
 const scene=agentScene([{stage:'EXTRACTION',message:'extract'}],null,false);
 assert.equal(scene.active,-1);
 assert.equal(scene.stages[5].state,'partial');
 assert.ok(scene.stages.every(s=>s.state!=='running'));
});
test('scope prompt is a paused decision, not failed retrieval',()=>{
 const scene=agentScene([{stage:'SCOPE',message:'select'}],{kind:'scope',receipt:{},candidates:[]},false);
 assert.equal(scene.active,-1);assert.equal(scene.stages[0].state,'done');
});
test('saved outcome reports available artifacts independently, no replayed running state',()=>{
 const outcome={kind:'result',result:{collection:{coverage:[],review:null,plan:null}},document:{status:'NO_DOCUMENT'},automationError:'failed',explorationError:'failed'};
 const scene=agentScene([],outcome,false);
 assert.equal(scene.stages[4].state,'partial');assert.equal(scene.stages[5].state,'partial');
 assert.equal(scene.stages[6].state,'waiting');assert.equal(scene.stages[7].state,'partial');
 assert.ok(scene.stages.every(s=>s.state!=='running'));
});

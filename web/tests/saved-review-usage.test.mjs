import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {readSavedReviewUsage} from '../src/saved-review-usage.ts';
const run='12345678-1234-4234-8234-123456789012';
const empty={observed_model_calls:0,observed_input_tokens:0,observed_output_tokens:0,input_unknown_attempts:0,output_unknown_attempts:0};
const packet={schema:'research-saved-review-usage/1',scope:'SAVED_REVIEW_ONLY',run_id:run,as_of:'2026-10-01T00:00:00+00:00',attempts_total:3,completed_attempts:1,failed_attempts:1,cancelled_attempts:0,unfinished_attempts:1,usage_by_mode:{DACON_RESPONSES:{...empty,observed_model_calls:1,input_unknown_attempts:1,output_unknown_attempts:1},SCRIPTED_TEST_DOUBLE:{...empty,observed_model_calls:1,observed_input_tokens:10,observed_output_tokens:20},COLLECTORS_ONLY:{...empty}}};
test('usage separates real/test observed tokens and unfinished calls',()=>{
 const result=readSavedReviewUsage(packet,run);
 assert.equal(result.usage_by_mode.DACON_RESPONSES.observed_input_tokens,0);
 assert.equal(result.usage_by_mode.DACON_RESPONSES.input_unknown_attempts,1);
 assert.equal(result.usage_by_mode.SCRIPTED_TEST_DOUBLE.observed_input_tokens,10);
 assert.equal(result.unfinished_attempts,1);
});
test('usage rejects wrong targets, extra content, guessed quota and inconsistent status totals',()=>{
 for(const change of [{run_id:'foreign'},{scope:'ALL_PRODUCT'},{schema:'other'},{as_of:'2026-10-01T09:00:00+09:00'},{quote:'private'},{remaining_quota:1},{attempts_total:2},{unfinished_attempts:true},{failed_attempts:-1},{attempts_total:10001}])assert.throws(()=>readSavedReviewUsage({...packet,...change},run));
});
test('usage rejects mixed providers, unknown counts exceeding calls, unsafe or malformed numbers',()=>{
 for(const change of [{observed_model_calls:true},{observed_model_calls:0},{input_unknown_attempts:2},{observed_input_tokens:1.5},{observed_output_tokens:Number.MAX_SAFE_INTEGER+1},{observed_model_calls:3},{response_id:'private'}]){
  assert.throws(()=>readSavedReviewUsage({...packet,usage_by_mode:{...packet.usage_by_mode,DACON_RESPONSES:{...packet.usage_by_mode.DACON_RESPONSES,...change}}},run));
 }
 assert.throws(()=>readSavedReviewUsage({...packet,usage_by_mode:{...packet.usage_by_mode,OTHER:empty}},run));
 assert.throws(()=>readSavedReviewUsage({...packet,usage_by_mode:{...packet.usage_by_mode,COLLECTORS_ONLY:{...empty,observed_input_tokens:1}}},run));
});
test('all unknown observations cannot simultaneously claim known tokens',()=>{
 for(const direction of ['input','output'])assert.throws(()=>readSavedReviewUsage({...packet,usage_by_mode:{...packet.usage_by_mode,DACON_RESPONSES:{...packet.usage_by_mode.DACON_RESPONSES,[`observed_${direction}_tokens`]:1}}},run));
 const group={...empty,observed_model_calls:2,observed_input_tokens:12,input_unknown_attempts:1,output_unknown_attempts:2};
 assert.equal(readSavedReviewUsage({...packet,attempts_total:4,failed_attempts:2,usage_by_mode:{...packet.usage_by_mode,DACON_RESPONSES:group}},run).usage_by_mode.DACON_RESPONSES.observed_input_tokens,12);
});
test('record limit counts both start and terminal rather than attempts alone',()=>{
 const counts={...packet,attempts_total:6000,completed_attempts:0,failed_attempts:6000,unfinished_attempts:0,usage_by_mode:{DACON_RESPONSES:empty,SCRIPTED_TEST_DOUBLE:empty,COLLECTORS_ONLY:empty}};
 assert.throws(()=>readSavedReviewUsage(counts,run));
 assert.equal(readSavedReviewUsage({...counts,attempts_total:5000,failed_attempts:5000},run).attempts_total,5000);
});
test('actual TEAM fake review usage passes strict browser reader without counting a Dacon request',()=>{
 const result=spawnSync('.venv/bin/python',['-c',`
import json, tempfile
from pathlib import Path
from pytest import MonkeyPatch
from test_saved_research_review import scenario
from test_project_acl import headers
with tempfile.TemporaryDirectory(prefix='trialboard-review-usage-contract-') as directory:
    with MonkeyPatch.context() as patch:
        generator=scenario.__wrapped__(Path(directory),patch)
        client,run,database,identity,base,request,state,allow=next(generator)
        try:
            allow()
            assert client.post(base+'/review-saved',json=request,headers=headers(client)).status_code==200
            result=client.get(base+'/review-usage')
            assert result.status_code==200,result.text
            assert state['calls']==state['factories']==1
            print(json.dumps({'run':run.id,'usage':result.json()}))
        finally:
            try: next(generator)
            except StopIteration: pass
`],{env:{...process.env,PYTHONPATH:'tests:.'},encoding:'utf8',timeout:30000,maxBuffer:1000000});
 assert.equal(result.status,0,result.stderr);const value=JSON.parse(result.stdout),usage=readSavedReviewUsage(value.usage,value.run);
 assert.equal(usage.attempts_total,1);assert.equal(usage.usage_by_mode.DACON_RESPONSES.observed_model_calls,0);
 assert.equal(usage.usage_by_mode.SCRIPTED_TEST_DOUBLE.observed_model_calls,1);
 assert.equal(usage.usage_by_mode.SCRIPTED_TEST_DOUBLE.observed_input_tokens,4);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {readSavedArtifact,readSavedAttempts,readSavedStream,savedBindings} from '../src/saved-research-review.ts';
const run='12345678-1234-4234-8234-123456789012',attempt='22345678-1234-4234-8234-123456789012',digest='a'.repeat(64);
const binding={source_id:'paper:synthetic',source_digest:digest,policy_revision:1};
const summary={run_id:run,attempt_id:attempt,status:'COMPLETED',created_at:'2026-10-01T00:00:00Z',completed_at:'2026-10-01T00:00:01Z',model_calls:1};
const quote='합성😀원문';
const artifact={...summary,schema:'research-saved-review/1',mode:'SAVED_REVIEW_ONLY',asserted_by:run,context:{asset:'Synthetic drug',indication:'Synthetic condition',nct_id:'NCT00000001'},source_bindings:[binding],sources:[{source_id:binding.source_id,source_digest:digest,title:'Synthetic source'}],collector_calls:0,plan_calls:0,execution_mode:'SCRIPTED_TEST_DOUBLE',model:'fake',response_id:'synthetic',input_tokens:10,output_tokens:20,review:{findings:[{source_id:binding.source_id,quote,interpretation:'합성 해석'}],questions:['근거를 확인했나요?'],conclusion:'NEEDS_EXPERT_REVIEW'},citation_bindings:[{anchor_id:'synthetic-anchor',source_id:binding.source_id,source_digest:digest,start:0,end:Array.from(quote).length,offset_unit:'UNICODE_CODE_POINTS'}],error_code:null,notices:['합성 자료만 사용했습니다.']};
test('saved review artifact binds request target, source and policy revision',()=>{
 assert.equal(readSavedArtifact(artifact,run,attempt,[binding]).review.findings[0].quote,quote);
 for(const value of [{...artifact,run_id:attempt},{...artifact,attempt_id:run},{...artifact,body:'secret'},{...artifact,model_calls:2},{...artifact,collector_calls:1},{...artifact,plan_calls:1},{...artifact,source_bindings:[{...binding,policy_revision:true}]},{...artifact,source_bindings:[{...binding,policy_revision:2}]},{...artifact,sources:[{...artifact.sources[0],source_digest:'b'.repeat(64)}]}])assert.throws(()=>readSavedArtifact(value,run,attempt,[binding]));
});
test('citation identity and unicode offsets are bound without pretending body validation',()=>{
 for(const patch of [{end:quote.length},{source_digest:'b'.repeat(64)},{source_id:'wrong'},{offset_unit:'UTF16'},{start:-1}])assert.throws(()=>readSavedArtifact({...artifact,citation_bindings:[{...artifact.citation_bindings[0],...patch}]},run,attempt));
 assert.throws(()=>readSavedArtifact({...artifact,review:{...artifact.review,findings:[{...artifact.review.findings[0],source_id:'foreign'}]}},run,attempt));
});
test('failed artifacts cannot publish a review and summaries exclude content',()=>{
 const failed={...artifact,status:'FAILED',error_code:'MODEL_POLICY_DENIED',review:null,citation_bindings:[]};
 assert.equal(readSavedArtifact(failed,run,attempt).status,'FAILED');
 assert.throws(()=>readSavedArtifact({...failed,review:artifact.review},run,attempt));
 assert.throws(()=>readSavedArtifact({...failed,error_code:'raw secret provider body'},run,attempt));
 assert.equal(readSavedAttempts({run_id:run,attempts:[summary]},run).length,1);
 for(const items of [[{...summary,review:artifact.review}],[summary,summary],Array(31).fill(summary)])assert.throws(()=>readSavedAttempts({run_id:run,attempts:items},run));
});
test('selection requires both permissions, exact bindings and at most eight sources',()=>{
 const source={source_id:binding.source_id,source_digest:digest,title:'synthetic',usage_policy:{original_storage:'ALLOW',external_ai:'ALLOW',policy_revision:1}};
 assert.deepEqual(savedBindings([source],[source.source_id]),[binding]);
 for(const p of [{original_storage:'UNKNOWN'},{external_ai:'DENY'},{policy_revision:0}])assert.throws(()=>savedBindings([{...source,usage_policy:{...source.usage_policy,...p}}],[source.source_id]));
 for(const ids of [[],['foreign'],[source.source_id,source.source_id],Array(9).fill(source.source_id)])assert.throws(()=>savedBindings([source],ids));
});
const event=(sequence,type,extra={})=>({schema:'research-saved-review-event/1',run_id:run,attempt_id:attempt,sequence,type,message:'합성 실행 상태',...extra});
const stream=(items)=>new Response(items.map(e=>`data: ${JSON.stringify(e)}\n\n`).join(''),{headers:{'Content-Type':'text/event-stream'}});
test('metadata-only saved stream has exact sequence and target with no quote payload',async()=>{
 const started=[];
 assert.equal(await readSavedStream(stream([event(1,'STARTED'),event(2,'COMPLETE')]),run,id=>started.push(id)),attempt);
 assert.deepEqual(started,[attempt]);
 assert.equal(await readSavedStream(stream([event(1,'STARTED'),event(2,'FAILED')]),run,()=>{}),attempt);
 for(const items of [[event(1,'COMPLETE')],[event(1,'STARTED'),event(3,'COMPLETE')],[event(1,'STARTED',{quote:'secret'})],[event(1,'STARTED'),event(2,'COMPLETE',{attempt_id:run})],[event(1,'STARTED')]])await assert.rejects(readSavedStream(stream(items),run,()=>{}));
 const duplicate=JSON.stringify(event(1,'STARTED')).replace('"sequence":1','"sequence":2,"sequence":1');
 await assert.rejects(readSavedStream(new Response(`data: ${duplicate}\n\n`,{headers:{'Content-Type':'text/event-stream'}}),run,()=>{}));
});

test('real TEAM server artifact and SSE round-trip through strict browser readers',async()=>{
 const python=spawnSync('.venv/bin/python',['-c',`
import json, tempfile
from pathlib import Path
from pytest import MonkeyPatch
from test_saved_research_review import scenario, post
with tempfile.TemporaryDirectory(prefix='trialboard-saved-contract-') as directory:
    with MonkeyPatch.context() as monkeypatch:
        generator=scenario.__wrapped__(Path(directory), monkeypatch)
        value=next(generator)
        try:
            client, run, database, identity, base, request, state, allow=value
            allow()
            response=post(value)
            assert response.status_code==200, response.text
            events=[json.loads(line[6:]) for line in response.text.splitlines() if line.startswith('data: ')]
            aid=events[0]['attempt_id']
            artifact=client.get(f'{base}/review-attempts/{aid}')
            assert artifact.status_code==200, artifact.text
            assert state['calls']==1 and state['factories']==1
            print(json.dumps({'run':run.id,'attempt':aid,'bindings':request['source_bindings'],'artifact':artifact.json(),'attempts':client.get(f'{base}/review-attempts').json(),'sse':response.text}))
        finally:
            generator.close()
`],{env:{...process.env,PYTHONPATH:'tests:.'},encoding:'utf8',timeout:30000,maxBuffer:1000000});
 assert.equal(python.status,0,python.stderr);
 const value=JSON.parse(python.stdout);
 assert.equal(readSavedArtifact(value.artifact,value.run,value.attempt,value.bindings).model_calls,1);
 assert.equal(readSavedAttempts(value.attempts,value.run).length,1);
 assert.equal(await readSavedStream(new Response(value.sse,{headers:{'Content-Type':'text/event-stream'}}),value.run,()=>{}),value.attempt);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {readServerPdfPreparation} from '../src/server-pdf-preparation.ts';
import {canonical,digest} from '../src/field-review.ts';
import {readPdfReviewArtifact,readPdfReviewAttempts,readPdfReviewStream,readPdfReviewUsage} from '../src/prepared-pdf-review.ts';
const run='12345678-1234-4234-8234-123456789012',pid='22345678-1234-4234-8234-123456789012',aid='32345678-1234-4234-8234-123456789012';
const prepared={run_id:run,preparation_id:pid,preparation_digest:'a'.repeat(64),source_id:'paper:synthetic',source_digest:'b'.repeat(64),pdf_sha256:'c'.repeat(64),policy_revision:1,pages:[{page:1,text:'🧪 합성 PDF 원문입니다.'}]};
const summary={attempt_id:aid,run_id:run,status:'COMPLETED',created_at:'2026-10-01T00:00:00Z',completed_at:'2026-10-01T00:00:01Z',model_calls:1};
async function artifact(){
 const page=1,start=0,end=Array.from(prepared.pages[0].text).length;
 const finding={anchor_id:await digest(canonical({preparation_digest:prepared.preparation_digest,page,start,end})),page,start,end,quote:prepared.pages[0].text,interpretation:'합성 자료의 제한된 관찰입니다.'};
 return {...summary,schema:'research-pdf-review/1',mode:'PREPARED_PDF_REVIEW_ONLY',asserted_by:run,preparation_id:pid,preparation_digest:prepared.preparation_digest,source_id:prepared.source_id,source_digest:prepared.source_digest,pdf_sha256:prepared.pdf_sha256,policy_revision:2,execution_mode:'SCRIPTED_TEST_DOUBLE',model:'synthetic',response_id:'fake',input_tokens:10,output_tokens:20,review:{findings:[finding],questions:['추가 근거를 확인할까요?'],conclusion:'NEEDS_EXPERT_REVIEW'},error_code:null,notices:['합성 시험 결과이며 임상 검증이 아닙니다.']};
}
test('PDF review is bound to selected preparation and current outgoing policy, with Unicode-grounded quotes',async()=>{
 const value=await artifact();assert.deepEqual(await readPdfReviewArtifact(value,prepared,aid,2),value);
 await assert.rejects(readPdfReviewArtifact(value,prepared,aid,1));
 await assert.rejects(readPdfReviewArtifact(value,{...prepared,preparation_id:run},aid));
 await assert.rejects(readPdfReviewArtifact({...value,source_digest:'f'.repeat(64)},prepared,aid));
});
test('PDF review cannot invent quote, page, UTF16 offsets, anchor ID, coordinates or duplicate findings',async()=>{
 const value=await artifact(),f=value.review.findings[0];
 for(const change of [{quote:'invented'},{page:2},{start:1},{end:f.quote.length},{anchor_id:'f'.repeat(64)},{box:[0,0,1,1]},{interpretation:' '},{page:true}])await assert.rejects(readPdfReviewArtifact({...value,review:{...value.review,findings:[{...f,...change}]}},prepared,aid));
 await assert.rejects(readPdfReviewArtifact({...value,review:{...value.review,findings:[f,f]}},prepared,aid));
 await assert.rejects(readPdfReviewArtifact({...value,schema:'research-saved-review/1'},prepared,aid));
});
test('PDF review terminal and unconfirmed records cannot misstate zero calls or completed findings',async()=>{
 const value=await artifact(),pending={...value,status:'RUNNING',completed_at:null,model_calls:0,execution_mode:'COLLECTORS_ONLY',model:null,response_id:null,input_tokens:null,output_tokens:null,review:null};
 assert.equal((await readPdfReviewArtifact(pending,prepared,aid)).status,'RUNNING');
 for(const change of [{model_calls:false},{model_calls:1},{input_tokens:0},{model:'claimed'},{review:value.review},{error_code:'MODEL_FAILED'}])await assert.rejects(readPdfReviewArtifact({...pending,...change},prepared,aid));
 const failed={...value,status:'FAILED',review:null,error_code:'MODEL_POLICY_DENIED'};
 assert.equal((await readPdfReviewArtifact(failed,prepared,aid)).model_calls,1);
 await assert.rejects(readPdfReviewArtifact({...failed,error_code:null},prepared,aid));
});
test('PDF attempts must be scoped to the exact preparation without extra metadata',()=>{
 const value={run_id:run,preparation_id:pid,attempts:[summary]};assert.equal(readPdfReviewAttempts(value,run,pid).length,1);
 for(const change of [{preparation_id:run},{attempts:[summary,summary]},{quote:'private'}])assert.throws(()=>readPdfReviewAttempts({...value,...change},run,pid));
});
test('PDF metadata SSE cannot accept SOURCE_TEXT events or leak body fields',async()=>{
 function response(schema='research-pdf-review-event/1',extra={}){
  const events=[{schema,run_id:run,attempt_id:aid,sequence:1,type:'STARTED',message:'시작'},{schema,run_id:run,attempt_id:aid,sequence:2,type:'COMPLETE',message:'완료',...extra}];
  return new Response(events.map(e=>`data: ${JSON.stringify(e)}\n\n`).join(''),{headers:{'Content-Type':'text/event-stream'}});
 }
 assert.equal(await readPdfReviewStream(response(),run,()=>{}),aid);
 await assert.rejects(readPdfReviewStream(response('research-saved-review-event/1'),run,()=>{}));
 await assert.rejects(readPdfReviewStream(response(undefined,{quote:'private'}),run,()=>{}));
});
test('PDF usage explicitly excludes SOURCE_TEXT counters and account quota fields',()=>{
 const empty={observed_model_calls:0,observed_input_tokens:0,observed_output_tokens:0,input_unknown_attempts:0,output_unknown_attempts:0};
 const value={schema:'research-pdf-review-usage/1',scope:'PREPARED_PDF_REVIEW_ONLY',run_id:run,as_of:'2026-10-01T00:00:00Z',attempts_total:0,completed_attempts:0,failed_attempts:0,cancelled_attempts:0,unfinished_attempts:0,usage_by_mode:{DACON_RESPONSES:empty,SCRIPTED_TEST_DOUBLE:empty,COLLECTORS_ONLY:empty}};
 assert.equal(readPdfReviewUsage(value,run).scope,'PREPARED_PDF_REVIEW_ONLY');
 for(const change of [{schema:'research-saved-review-usage/1'},{scope:'SAVED_REVIEW_ONLY'},{remaining_tokens:30000000}])assert.throws(()=>readPdfReviewUsage({...value,...change},run));
});
test('actual TEAM prepared-PDF API roundtrips strict preparation, SSE, review, scoped history and separated usage',async()=>{
 const result=spawnSync('.venv/bin/python',['-c',`
import json,tempfile
from pathlib import Path
from pytest import MonkeyPatch
from test_pdf_preparation import scenario
from test_prepared_pdf_review_api import api_case,post
with tempfile.TemporaryDirectory(prefix='trialboard-pdf-review-contract-') as directory:
 with MonkeyPatch.context() as patch:
  original=scenario.__wrapped__(Path(directory),patch)
  fixture=next(original)
  generator=api_case.__wrapped__(fixture,patch)
  case=next(generator)
  try:
   client,value,_,_,prepared,_,state=case
   response=post(case)
   assert response.status_code==200,response.text
   events=[json.loads(line[6:]) for line in response.text.splitlines() if line.startswith('data: ')]
   aid=events[0]['attempt_id']
   reviewed=client.get(value[4]+'/pdf-review-attempts/'+aid)
   listing=client.get(value[4]+'/pdf-review-attempts',params={'preparation_id':prepared['preparation_id']})
   usage=client.get(value[4]+'/pdf-review-usage')
   assert reviewed.status_code==listing.status_code==usage.status_code==200
   assert state['calls']==state['factories']==1
   assert client.get(value[4]+'/review-usage').json()['attempts_total']==0
   print(json.dumps({'prepared':prepared,'sse':response.text,'review':reviewed.json(),'list':listing.json(),'usage':usage.json()}))
  finally:
   for item in (generator,original):
    try: next(item)
    except StopIteration: pass
`],{env:{...process.env,PYTHONPATH:'tests:.'},encoding:'utf8',timeout:30000,maxBuffer:1000000});
 assert.equal(result.status,0,result.stderr);const data=JSON.parse(result.stdout),p=data.prepared;
 const prepared=await readServerPdfPreparation(p,{runId:p.run_id,sourceId:p.source_id,sourceDigest:p.source_digest,pdfSha:p.pdf_sha256});
 const aid=await readPdfReviewStream(new Response(data.sse,{headers:{'Content-Type':'text/event-stream'}}),p.run_id,()=>{});
 assert.equal((await readPdfReviewArtifact(data.review,prepared,aid,2)).review.findings[0].quote,p.pages[0].text);
 assert.equal(readPdfReviewAttempts(data.list,p.run_id,p.preparation_id)[0].attempt_id,aid);
 assert.equal(readPdfReviewUsage(data.usage,p.run_id).usage_by_mode.SCRIPTED_TEST_DOUBLE.observed_model_calls,1);
});

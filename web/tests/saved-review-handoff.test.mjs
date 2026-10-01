import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {canonical,digest} from '../src/field-review.ts';
import {readReviewHandoff,loadReviewHandoff,reviewIntakeContext,savedReviewMeetingMarkdown} from '../src/saved-review-handoff.ts';

let fixture;
function actualPacket(){
 if(fixture)return structuredClone(fixture);
 const result=spawnSync('.venv/bin/python',['-c',`
import json,tempfile
from pathlib import Path
from pytest import MonkeyPatch
from test_saved_review_handoff import scenario,completed
from test_research_source_policy import synthetic_run
with tempfile.TemporaryDirectory(prefix='trialboard-handoff-contract-') as directory:
    with MonkeyPatch.context() as patch:
        def browser_run():
            run=synthetic_run()
            return run.model_copy(update={'sources':[
                source.model_copy(update={'url':f'https://pubmed.ncbi.nlm.nih.gov/{index+1}/'})
                for index,source in enumerate(run.sources)
            ]})
        patch.setattr('test_saved_research_review.synthetic_run',browser_run)
        generator=scenario.__wrapped__(Path(directory),patch)
        value=next(generator)
        try:
            aid,url,artifact=completed(value)
            client,run,database,identity,base,request,state,allow=value
            assert client.get(base).status_code==403
            before=database.read_bytes()
            result=client.get(url)
            assert result.status_code==200,result.text
            assert database.read_bytes()==before
            assert state['calls']==state['factories']==1
            assert result.json()['artifact']==artifact
            print(result.text)
        finally:
            try: next(generator)
            except StopIteration: pass
`],{env:{...process.env,PYTHONPATH:'tests:.'},encoding:'utf8',timeout:30000,maxBuffer:1000000});
 assert.equal(result.status,0,result.stderr);fixture=JSON.parse(result.stdout);return structuredClone(fixture);
}
const read=p=>readReviewHandoff(p,p.run_id,p.attempt_id);

test('actual TEAM selected-source handoff passes canonical Unicode digest and strict browser contract',async()=>{
 const p=actualPacket(),value=await read(p);
 assert.deepEqual(value,p);
 assert.equal(await digest(canonical(value.artifact)),p.artifact_digest);
 assert.equal(p.artifact.execution_mode,'SCRIPTED_TEST_DOUBLE');
 assert.equal(p.artifact.model_calls,1);
 assert.match(p.artifact.review.findings[0].interpretation,/합성/);
 assert.equal(p.sources.length,1);assert.equal(p.clinical_verified,false);
});

test('handoff rejects changed artifact, source identity, context, unsafe URL and extra body',async()=>{
 const base=actualPacket();
 const mutations=[
  p=>p.artifact.review.findings[0].quote+=' forged',
  p=>p.artifact_digest='0'.repeat(64),
  p=>p.context.asset='foreign asset',
  p=>p.context.search_id='not-a-uuid',
  p=>p.sources[0].source_digest='0'.repeat(64),
  p=>p.sources[0].source_id='foreign',
  p=>p.sources[0].title+=' forged',
  p=>p.sources[0].url='javascript:alert(1)',
  p=>p.sources[0].pdf_url='data:application/pdf;base64,AAAA',
  p=>p.sources[0].content_level='RAW_BODY',
  p=>p.sources.push(structuredClone(p.sources[0])),
  p=>p.private_body='must not be accepted',
  p=>p.sources[0].text='unselected original',
  p=>p.clinical_verified=true,
 ];
 for(const mutate of mutations){const p=structuredClone(base);mutate(p);await assert.rejects(()=>read(p));}
 await assert.rejects(()=>readReviewHandoff(base,'different-run',base.attempt_id));
 await assert.rejects(()=>readReviewHandoff(base,base.run_id,'different-attempt'));
 const changed=structuredClone(base);changed.artifact.review.questions[0]+=' changed';
 changed.artifact_digest=await digest(canonical(changed.artifact));
 await assert.rejects(()=>readReviewHandoff(changed,base.run_id,base.attempt_id,base.artifact));
});

test('handoff load performs one no-store GET only and rejects denied, duplicate-key and late-abort replies',async()=>{
 const p=actualPacket(),controller=new AbortController(),calls=[];
 const request=async(url,options)=>{calls.push({url,options});return new Response(JSON.stringify(p));};
 assert.equal(canonical(await loadReviewHandoff(p.artifact,controller.signal,request)),canonical(p));
 assert.equal(calls.length,1);
 assert.equal(calls[0].url,`/api/research/runs/${p.run_id}/review-attempts/${p.attempt_id}/handoff`);
 assert.equal(calls[0].options.method??'GET','GET');assert.equal(calls[0].options.body,undefined);
 assert.equal(calls[0].options.cache,'no-store');assert.equal(calls[0].options.signal,controller.signal);
 for(const status of [401,403,409,422])await assert.rejects(()=>loadReviewHandoff(p.artifact,controller.signal,async()=>new Response('{}',{status})));
 const duplicate=JSON.stringify(p).replace('{','{"schema":"forged",');
 await assert.rejects(()=>loadReviewHandoff(p.artifact,controller.signal,async()=>new Response(duplicate)));
 const late=new AbortController();
 await assert.rejects(()=>loadReviewHandoff(p.artifact,late.signal,async()=>({ok:true,text:async()=>{late.abort();return JSON.stringify(p);}})));
 const aborted=new AbortController();aborted.abort();let fetched=0;
 await assert.rejects(()=>loadReviewHandoff(p.artifact,aborted.signal,async()=>{fetched++;return new Response('{}');}));
 assert.equal(fetched,0);
});

test('intake context preserves exact receipt and selected document without inventing numeric observations',async()=>{
 const p=await read(actualPacket()),s=p.sources[0],context=reviewIntakeContext(p,s.source_id);
 assert.deepEqual(context,{asset:p.context.asset,indication:p.context.indication,study:p.context.nct_id,receiptId:p.context.search_id,question:p.artifact.review.questions[0]});
 assert.throws(()=>reviewIntakeContext(p,'unselected-source'));
 // Synthetic metadata variation: PDF location is not a PDF permission assertion.
 const pdf=structuredClone(p);pdf.sources[0].pdf_url='https://cdn.clinicaltrials.gov/large-docs/01/NCT00000001/synthetic.pdf';
 assert.deepEqual(reviewIntakeContext(pdf,s.source_id).document,{runId:p.run_id,sourceId:s.source_id,title:s.title});
 assert.equal('source_digest' in reviewIntakeContext(pdf,s.source_id).document,false);
 assert.equal('observations' in context,false);assert.equal('model_consent' in context,false);
});

test('meeting markdown preserves exact source citations, qualitative questions and synthetic clinical disclaimers',async()=>{
 const p=await read(actualPacket()),text=savedReviewMeetingMarkdown(p,'  사람의 회의 메모  '),f=p.artifact.review.findings[0];
 for(const value of [p.run_id,p.attempt_id,p.artifact_digest,p.sources[0].url,p.sources[0].source_digest,f.interpretation,p.artifact.review.questions[0],'사람의 회의 메모'])assert.ok(text.includes(value),value);
 for(const line of f.quote.split('\n'))assert.ok(text.includes(`> ${line}`));
 assert.match(text,/임상 승인·최적 용량 추천·수치 검증 결과가 아닙니다/);
 assert.match(text,/합성 테스트 모델 기록/);assert.match(text,/임상 수치로 자동 변환하지 않았습니다/);
 assert.match(savedReviewMeetingMarkdown(p,''),/아직 작성하지 않았습니다/);
});

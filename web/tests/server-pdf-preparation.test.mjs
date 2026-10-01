import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {canonical,digest} from '../src/field-review.ts';
import {readPreparationCapabilities,readPreparationList,readServerPdfPreparation,serverPdfLimits} from '../src/server-pdf-preparation.ts';
const id='12345678-1234-4234-8234-123456789012';
const key={runId:id,sourceId:'paper:synthetic',sourceDigest:'a'.repeat(64),pdfSha:'b'.repeat(64)};
const base={schema:'research-pdf-preparation/1',mode:'SERVER_PDF_TEXT_ONLY',preparation_id:id,run_id:id,source_id:key.sourceId,source_digest:key.sourceDigest,pdf_sha256:key.pdfSha,policy_revision:1,asserted_by:id,created_at:'2026-10-01T00:00:00+00:00',extractor:'pdfplumber/synthetic',pages:[{page:1,text:'합성 문서 🧪 테스트'},{page:2,text:''}],limits:serverPdfLimits,model_calls:0,verification:'SERVER_EXTRACTED_NOT_CLINICALLY_VERIFIED',notices:['실제 외부 호출 없는 합성 준비본']};
async function signed(value=base){return {...value,preparation_digest:await digest(canonical(value))};}
test('server PDF preparation verifies canonical hash, exact binding and genuine Unicode text',async()=>{
 const value=await signed();assert.deepEqual(await readServerPdfPreparation(value,key,{id,digest:value.preparation_digest}),value);
 await assert.rejects(readServerPdfPreparation({...value,pages:[{page:1,text:'changed'}]},key));
 await assert.rejects(readServerPdfPreparation(value,{...key,pdfSha:'c'.repeat(64)}));
 await assert.rejects(readServerPdfPreparation(value,key,{id,digest:'c'.repeat(64)}));
});
test('even a matching checksum cannot relax preparation provenance, limits or field contracts',async()=>{
 for(const change of [{model_calls:1},{model_calls:false},{verification:'CLINICALLY_APPROVED'},{policy_revision:true},{pages:[{page:true,text:'x'}]},{pages:[{page:2,text:'x'}]},{pages:[{page:1,text:' '}]},{pages:[{page:1,text:'x'.repeat(30001)}]},{pages:[{page:1,text:'\ud800'}]},{pages:[{page:1,text:'x',box:[0,0,1,1]}]},{limits:{...serverPdfLimits,memory_bytes:0}},{quote:'injected'},{created_at:'2026-10-01T09:00:00+09:00'}])await assert.rejects(readServerPdfPreparation(await signed({...base,...change}),key));
});
test('capabilities never imply success and metadata lists bind exact PDF without carrying body',()=>{
 const caps={schema:'research-pdf-preparation-capabilities/1',status:'UNSUPPORTED_SANDBOX',limits:serverPdfLimits};
 assert.equal(readPreparationCapabilities(caps).status,'UNSUPPORTED_SANDBOX');
 for(const change of [{status:'SUPPORTED'},{status:true},{model_calls:0},{limits:{...serverPdfLimits,max_pdf_bytes:5242880}}])assert.throws(()=>readPreparationCapabilities({...caps,...change}));
 const item={preparation_id:id,preparation_digest:'c'.repeat(64),created_at:base.created_at,page_count:2};
 const list={schema:'research-pdf-preparation-list/1',run_id:key.runId,source_id:key.sourceId,source_digest:key.sourceDigest,pdf_sha256:key.pdfSha,preparations:[item]};
 assert.equal(readPreparationList(list,key).preparations.length,1);
 for(const change of [{pdf_sha256:'c'.repeat(64)},{preparations:[item,item]},{preparations:[{...item,text:'private'}]},{preparations:[{...item,page_count:true}]},{preparations:[{...item,page_count:11}]},{source_digest:'bad'}])assert.throws(()=>readPreparationList({...list,...change},key));
});
test('actual TEAM synthetic server preparation matches browser canonical SHA and strict contract',async()=>{
 const result=spawnSync('.venv/bin/python',['-c',`
import json, tempfile
from pathlib import Path
from pytest import MonkeyPatch
from test_pdf_preparation import scenario,post
with tempfile.TemporaryDirectory(prefix='trialboard-preparation-contract-') as directory:
    with MonkeyPatch.context() as patch:
        generator=scenario.__wrapped__(Path(directory),patch)
        fixture=next(generator)
        try:
            response=post(fixture)
            assert response.status_code==200,response.text
            artifact=response.json()
            value=fixture[0][0]
            assert value[6]['calls']==value[6]['factories']==0
            caps=value[0].get('/api/research/pdf-preparation-capabilities')
            listing=value[0].get(f"{value[4]}/documents/{artifact['source_id']}/pdf-preparations",params={'source_digest':artifact['source_digest'],'pdf_sha256':artifact['pdf_sha256']})
            assert caps.status_code==listing.status_code==200
            print(json.dumps({'artifact':artifact,'capabilities':caps.json(),'list':listing.json()}))
        finally:
            try: next(generator)
            except StopIteration: pass
`],{env:{...process.env,PYTHONPATH:'tests:.'},encoding:'utf8',timeout:30000,maxBuffer:1000000});
 assert.equal(result.status,0,result.stderr);const response=JSON.parse(result.stdout),value=response.artifact;
 const target={runId:value.run_id,sourceId:value.source_id,sourceDigest:value.source_digest,pdfSha:value.pdf_sha256};
 const got=await readServerPdfPreparation(value,target);
 assert.equal(readPreparationCapabilities(response.capabilities).schema,'research-pdf-preparation-capabilities/1');
 assert.equal(readPreparationList(response.list,target).preparations[0].preparation_id,value.preparation_id);
 assert.equal(got.model_calls,0);assert.equal(got.pages[0].text,'Synthetic server-extracted text.');
});

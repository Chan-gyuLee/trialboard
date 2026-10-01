import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {readPdfMetadata,readPdfHistory,verifiedPdfBytes} from '../src/research-pdf-policy.ts';
const run='12345678-1234-4234-8234-123456789012',sid='paper:synthetic',digest='a'.repeat(64),sha='b'.repeat(64);
const unknown={resource_kind:'PDF_BYTES',run_id:run,source_id:sid,source_digest:digest,pdf_sha256:sha,policy_revision:0,original_storage:'UNKNOWN',internal_search:'UNKNOWN',external_ai:'UNKNOWN',training:'UNKNOWN',evidence_reference:null,reason:null,asserted_by:null,created_at:null,verification:'UNVERIFIED'};
const known={...unknown,policy_revision:1,original_storage:'ALLOW',evidence_reference:'Synthetic license',reason:'Synthetic assertion',asserted_by:run,created_at:'2026-10-01T00:00:00Z',verification:'USER_ATTESTED_UNVERIFIED'};
const version={pdf_sha256:sha,byte_length:100,binding_status:'LEGACY_UNBOUND',usage_policy:unknown};
const source={source_id:sid,source_digest:digest,title:'Synthetic PDF source',download_available:true,cached_versions:[version]};
const meta={run_id:run,resource_kind:'PDF_BYTES',can_manage:true,sources:[source]};
test('exact cached PDF verifies requested version, MIME, bytes and abort before publication',async()=>{
 const bytes=new TextEncoder().encode('%PDF-1.4\nSynthetic bounded bytes');
 const sha=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),n=>n.toString(16).padStart(2,'0')).join('');
 const response=(body=bytes,head=sha,type='application/pdf')=>new Response(body,{headers:{'Content-Type':type,'X-Source-Sha256':head}});
 const control=new AbortController();assert.deepEqual(new Uint8Array(await verifiedPdfBytes(response(),control.signal,sha)),bytes);
 await assert.rejects(verifiedPdfBytes(response(),control.signal,'f'.repeat(64)),/선택한 PDF/);
 await assert.rejects(verifiedPdfBytes(response(bytes,'f'.repeat(64)),control.signal),/수신한 PDF/);
 await assert.rejects(verifiedPdfBytes(response(bytes,sha,'text/html'),control.signal),/응답 형식/);
 await assert.rejects(verifiedPdfBytes(response(new TextEncoder().encode('not a PDF')),control.signal),/PDF 형식/);
 let cancelled=false;
 const delayed=response(new ReadableStream({cancel(){cancelled=true;}}));
 const waiting=verifiedPdfBytes(delayed,control.signal,sha);control.abort();
 await assert.rejects(waiting,{name:'AbortError'});
 assert.equal(cancelled,true);
});
test('PDF reader bounds streamed bytes without trusting Content-Length and cancels overflow',async()=>{
 let cancelled=false,pulls=0;
 const stream=new ReadableStream({pull(c){pulls++;c.enqueue(new Uint8Array(1_000_000));},cancel(){cancelled=true;}},{highWaterMark:0});
 const response=new Response(stream,{headers:{'Content-Type':'application/pdf','X-Source-Sha256':'a'.repeat(64),'Content-Length':'5'}});
 await assert.rejects(verifiedPdfBytes(response,new AbortController().signal),/크기/);
 assert.equal(cancelled,true);assert.equal(pulls,6);
});
test('PDF reader accepts multiple chunks and propagates interrupted transport without publication',async()=>{
 const bytes=new TextEncoder().encode('%PDF-1.4\nSynthetic chunks');
 const sha=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),n=>n.toString(16).padStart(2,'0')).join('');
 const headers={'Content-Type':'application/pdf','X-Source-Sha256':sha};
 const stream=new ReadableStream({start(c){c.enqueue(bytes.slice(0,3));c.enqueue(bytes.slice(3));c.close();}});
 assert.deepEqual(new Uint8Array(await verifiedPdfBytes(new Response(stream,{headers}),new AbortController().signal,sha)),bytes);
 const broken=new ReadableStream({start(c){c.error(Error('synthetic transport failure'));}});
 await assert.rejects(verifiedPdfBytes(new Response(broken,{headers}),new AbortController().signal),/synthetic transport/);
});
test('PDF metadata is body-free and strictly binds source version and PDF bytes',()=>{
 assert.equal(readPdfMetadata(meta,run).sources[0].cached_versions[0].usage_policy.original_storage,'UNKNOWN');
 for(const value of [{...meta,run_id:'foreign'},{...meta,resource_kind:'SOURCE_TEXT'},{...meta,can_manage:1},{...meta,body:'bytes'},{...meta,sources:[source,source]},{...meta,sources:[{...source,pdf_url:'https://example.org'}]},{...meta,sources:[{...source,download_available:1}]},{...meta,sources:[{...source,cached_versions:[version,version]}]}])assert.throws(()=>readPdfMetadata(value,run));
});
test('unbound PDF never inherits SOURCE_TEXT permission or a positive revision',()=>{
 for(const policy of [{...unknown,resource_kind:'SOURCE_TEXT'},{...unknown,pdf_sha256:digest},{...unknown,original_storage:'ALLOW'},known])assert.throws(()=>readPdfMetadata({...meta,sources:[{...source,cached_versions:[{...version,usage_policy:policy}]}]},run));
 assert.equal(readPdfMetadata({...meta,sources:[{...source,cached_versions:[{...version,binding_status:'EXACT',usage_policy:known}]}]},run).sources[0].cached_versions[0].usage_policy.policy_revision,1);
});
test('PDF policy history enforces exact binding, contiguous CAS revisions and current head',()=>{
 const response={current:known,history:[known],can_manage:true};assert.equal(readPdfHistory(response,run,sid,digest,sha).history.length,1);
 for(const value of [{...response,history:[]},{...response,history:[{...known,reason:'other'}]},{...response,current:{...known,policy_revision:true}},{...response,current:{...known,source_digest:sha}},{...response,current:{...known,created_at:'2026-10-01T09:00:00+09:00'}},{...response,can_manage:'true'}])assert.throws(()=>readPdfHistory(value,run,sid,digest,sha));
 assert.throws(()=>readPdfHistory(response,run,sid,sha,sha));
});
test('actual TEAM fake-download metadata and history pass browser strict readers',()=>{
 const result=spawnSync('.venv/bin/python',['-c',`
import json, tempfile
from pathlib import Path
from pytest import MonkeyPatch
from test_research_pdf_policy import scenario, download, SHA
with tempfile.TemporaryDirectory(prefix='trialboard-pdf-contract-') as directory:
    with MonkeyPatch.context() as patch:
        generator=scenario.__wrapped__(Path(directory),patch)
        fixture=next(generator)
        try:
            value,url,body=fixture
            client,run,database,identity,base,request,state,allow=value
            response=download(fixture)
            assert response.status_code==200,response.text
            assert state['fetches']==1 and state['calls']==0
            meta=client.get(f'{base}/pdf-metadata')
            policy=client.get(f'{url}/usage-policy',params={'source_digest':body['source_digest'],'pdf_sha256':SHA})
            assert meta.status_code==policy.status_code==200
            print(json.dumps({'run':run.id,'source_id':run.sources[0].id,'source_digest':body['source_digest'],'sha':SHA,'metadata':meta.json(),'policy':policy.json()}))
        finally:
            try: next(generator)
            except StopIteration: pass
`],{env:{...process.env,PYTHONPATH:'tests:.'},encoding:'utf8',timeout:30000,maxBuffer:1000000});
 assert.equal(result.status,0,result.stderr);const v=JSON.parse(result.stdout);
 const metadata=readPdfMetadata(v.metadata,v.run),policy=readPdfHistory(v.policy,v.run,v.source_id,v.source_digest,v.sha);
 assert.equal(metadata.sources[0].cached_versions[0].binding_status,'EXACT');assert.equal(policy.current.original_storage,'ALLOW');assert.equal(policy.current.external_ai,'UNKNOWN');
});

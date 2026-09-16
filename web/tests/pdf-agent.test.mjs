import test from 'node:test';
import assert from 'node:assert/strict';
import {pdfAgentInput,executePdfAgent} from '../src/pdf-agent.ts';
import {attestSpan} from '../src/pdf-contract.ts';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const box={x:0,y:0,width:.2,height:.1};
const source={schemaVersion:'pdf-evidence/1',name:'MOC.pdf',sha256:'a'.repeat(64),byteLength:10,extractor:'test',status:'TEXT_EXTRACTED',coordinateSystem:'normalized_top_left_rotated_viewport',pages:[{number:1,width:100,height:100,rotation:0,status:'TEXT_EXTRACTED',spans:Array.from({length:10},(_,i)=>({id:`p1-i${i}`,item:i,page:1,text:`MOC source ${i}`,box}))}]};
const notes=[attestSpan(source,'p1-i4','MOC question','MOC UI test only',true)];
const context={asset:'MOC',indication:'invented',study:'MOC-STUDY',question:'MOC question'};
const loc={hostname:'127.0.0.1',port:'5173',protocol:'http:'};
test('only selected spans plus two neighbors; no user comments/PDF bytes/other text sent',()=>{
 const input=pdfAgentInput(source,notes,context);assert.deepEqual(input.spans.map(s=>s.id),['p1-i2','p1-i3','p1-i4','p1-i5','p1-i6']);assert.equal(input.provenance,'user_pdf_export_unverified');
 const raw=JSON.stringify(input);assert.ok(!raw.includes('MOC UI test only'));assert.ok(!raw.includes('MOC source 9'));assert.ok(!raw.includes('byteLength'));
});
test('overlapping selections deduplicate without changing source order',()=>{const input=pdfAgentInput(source,[...notes,attestSpan(source,'p1-i5','q','',true)],context);assert.equal(input.spans.length,6);assert.equal(new Set(input.spans.map(s=>s.id)).size,6);});
for(const [name,change] of [['other source',n=>n.sourceDigest='b'.repeat(64)],['quote mismatch',n=>n.quote='other'],['false attestation',n=>n.locationStatus='UNCONFIRMED'],['box mismatch',n=>n.box={...box,x:.2}],['wrong page',n=>n.page=2]]) test(`reject ${name}`,()=>{const n=structuredClone(notes[0]);change(n);assert.throws(()=>pdfAgentInput(source,[n],context));});
test('no notes or incomplete context blocks execution input',()=>{assert.throws(()=>pdfAgentInput(source,[],context));assert.throws(()=>pdfAgentInput(source,notes,{...context,asset:''}));});
test('unconsented or remote execution rejected before fetch',async()=>{const fail=()=>{throw new Error('FETCH MUST NOT RUN');};await assert.rejects(executePdfAgent(pdfAgentInput(source,notes,context),false,new AbortController().signal,()=>{},loc,fail),/동의/);await assert.rejects(executePdfAgent(pdfAgentInput(source,notes,context),true,new AbortController().signal,()=>{},{...loc,hostname:'remote.invalid'},fail),/동의/);});
test('disabled capability never posts source text',async()=>{const calls=[];await assert.rejects(executePdfAgent(pdfAgentInput(source,notes,context),true,new AbortController().signal,()=>{},loc,async(url,options)=>{calls.push({url,options});return Response.json({pdf_enabled:false,provider:'CODEX_CHATGPT',persisted:false,transport:'LOOPBACK_ONLY'});}),/아직 자료를 전송하지/);assert.equal(calls.length,1);assert.equal(calls[0].options.body,undefined);});
test('request-byte budget rejects before capability or model calls',async()=>{const input=pdfAgentInput(source,notes,context);input.question='가'.repeat(12000);let fetched=false;await assert.rejects(executePdfAgent(input,true,new AbortController().signal,()=>{},loc,async()=>{fetched=true;throw Error('unexpected');}),/32 KiB/);assert.equal(fetched,false);});
test('Python-normalized PDF input roundtrips through final stream without hash mismatch',async()=>{
 const f=JSON.parse(execFileSync('uv',['run','python','-c',`import json,sys
sys.path.insert(0,'tests')
from test_field_revalidation import sample
f=sample(imported=True)
print(json.dumps({'packet':f['source'],'report':json.loads(f['agent'])}))`],{cwd:fileURLToPath(new URL('../../',import.meta.url)),encoding:'utf8',timeout:30000}));
 const input=pdfAgentInput(f.packet.source,f.packet.notes,{asset:f.report.input.asset,indication:f.report.input.indication,study:f.report.input.study,question:f.report.input.question});
 assert.deepEqual(input,f.report.input);
 // Transport-only synthetic stub: no model call or authenticated provider claim.
 f.report.execution_mode='CODEX_CHATGPT';
 const fetcher=async(url)=>url.includes('capabilities')?Response.json({pdf_enabled:true,provider:'CODEX_CHATGPT',persisted:false,transport:'LOOPBACK_ONLY'}):new Response([
 {type:'started',sequence:1,run_id:'transport-test',elapsed_ms:0,case:'pdf',execution_mode:'CODEX_CHATGPT'},
 {type:'result',sequence:2,run_id:'transport-test',elapsed_ms:1,report:f.report},
 ].map(e=>`data: ${JSON.stringify(e)}\n\n`).join(''),{headers:{'content-type':'text/event-stream'}});
 const raw=await executePdfAgent(input,true,new AbortController().signal,()=>{},loc,fetcher);assert.equal(JSON.parse(raw).input_digest,f.report.input_digest);
 await assert.rejects(executePdfAgent({...input,question:'Different question'},true,new AbortController().signal,()=>{},loc,fetcher),/질문과 실행 결과/);
});

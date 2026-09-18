import test from 'node:test';
import assert from 'node:assert/strict';
import {extractAutomatically,loadAutoSaved,readAutoSaved} from '../src/auto-extraction.ts';
import {canonical,digest} from '../src/field-review.ts';
const id='00000000-0000-4000-8000-000000000001',hash='a'.repeat(64);
const context={asset:'MOC drug',indication:'MOC tumor',nct_id:'NCT00000001'};
const result={collection:{id,request:context,sources:[{id:'doc_1'}]}};
const input={asset:context.asset,indication:context.indication,study:context.nct_id,question:'MOC question',provenance:'user_pdf_export_unverified',spans:[{id:'p42-i0',text:'MOC 10 mg',page:42,source_digest:hash,locator:null}]};
const document={status:'READY',sourceId:'doc_1',source:{schemaVersion:'pdf-evidence-window/1',sha256:hash},coverage:{clinicalReview:'NOT_PERFORMED',retainedPages:[42]},input,candidates:[]};
const binding={input,coverage:document.coverage,sourceId:'doc_1',sourceDigest:hash};
const report={run_id:'MOC-agent',started_at:'2026-09-16T00:00:00Z',input_digest:await digest(canonical(input)),input,engine_version:'bounded-evidence-agent/3.2',execution_mode:'DACON_RESPONSES',model:'gpt-5.6-terra',status:'PARTIAL_ABSTENTION',accepted:[],attempts:[{number:0,extraction:{observations:[]},findings:[],critique:null}],calls:[{stage:'EXTRACT',attempt:0,outcome:'RECEIVED',input_tokens:1,output_tokens:1}],events:[{stage:'EXTRACT',attempt:0,codes:[]},{stage:'VERIFY',attempt:0,codes:[]},{stage:'PARTIAL_ABSTENTION',attempt:0,codes:[]}],limitations:['MOC synthetic test, not actual model execution']};
const prepared={schema:'research-automation/1',runId:id,digest:await digest(canonical(binding)),status:'PREPARED',document,report:null,decision:null,events:[],textVerifiedAgainstPdf:false};
const finished={...prepared,status:'NEEDS_EVIDENCE',report,decision:{status:'NEEDS_EVIDENCE',clinicalApproved:false,simulationExecuted:false,acceptedDrafts:0,findingCodes:[],questions:['MOC missing evidence?'],reason:'MOC rule'},events:[]};
const signal=()=>new AbortController().signal;
function stream(){return new Response([
 {type:'started',sequence:1,run_id:'MOC-stream',elapsed_ms:0,case:'pdf',execution_mode:'DACON_RESPONSES'},
 {type:'progress',sequence:2,run_id:'MOC-stream',elapsed_ms:1,stage:'EXTRACT',attempt:0,state:'STARTED'},
 {type:'result',sequence:3,run_id:'MOC-stream',elapsed_ms:2,report},
].map(e=>'data: '+JSON.stringify(e)+'\n\n').join(''),{headers:{'content-type':'text/event-stream'}});}
test('MOC prepare → stream → persisted result connects once with sparse source page',async()=>{
 const calls=[],events=[];
 const out=await extractAutomatically(result,document,true,signal(),e=>events.push(e),async(path,options)=>{calls.push({path,...options});return path.endsWith('/run')?stream():Response.json(options.method==='POST'?prepared:finished);});
 assert.equal(out.status,'NEEDS_EVIDENCE');assert.equal(out.report.input.spans[0].page,42);
 assert.deepEqual(calls.map(c=>c.method??'GET'),['POST','POST','GET']);assert.equal(events.length,1);
 assert.equal(out.decision.simulationExecuted,false);
});
test('MOC repeated preparation returns prior result without another model POST',async()=>{
 let calls=0;const out=await extractAutomatically(result,document,true,signal(),()=>{},async()=>{calls++;return Response.json(finished);});
 assert.equal(calls,1);assert.equal(out.status,'NEEDS_EVIDENCE');
});
test('MOC posted-results routing preserves plan PDF and does not start extraction model',async()=>{
 const resultWithTables=structuredClone(result);
 resultWithTables.collection.sources.push({id:'registry_results_NCT00000001',kind:'REGISTRY',link_basis:['REGISTRY_RESULTS'],raw_snapshots:[hash]});
 const routed={...prepared,status:'PLAN_DOCUMENT_SAVED',route:{policy:'posted-results-first/1',snapshotDigest:hash,resultSourceIds:['registry_results_NCT00000001'],reason:'MOC already reviewed results'}};
 let calls=0;
 const out=await extractAutomatically(resultWithTables,document,true,signal(),()=>assert.fail('no model progress'),async(path,o)=>{calls++;assert.ok(!path.endsWith('/run'));assert.equal(o.method,'POST');return Response.json(routed);});
 assert.equal(calls,1);assert.equal(out.status,'PLAN_DOCUMENT_SAVED');assert.equal(out.report,null);
 await assert.rejects(readAutoSaved(JSON.stringify({...routed,report}),resultWithTables));
 await assert.rejects(readAutoSaved(JSON.stringify({...routed,route:{...routed.route,snapshotDigest:'b'.repeat(64)}}),resultWithTables));
});
test('MOC consent and cancel fail before network',async()=>{
 let calls=0;const request=async()=>{calls++;throw Error('unexpected');};const c=new AbortController();c.abort();
 await assert.rejects(extractAutomatically(result,document,false,signal(),()=>{},request));
 await assert.rejects(extractAutomatically(result,document,true,c.signal,()=>{},request));assert.equal(calls,0);
});
test('MOC preparation storage rejection prevents paid extraction',async()=>{
 let calls=0;await assert.rejects(extractAutomatically(result,document,true,signal(),()=>{},async()=>{calls++;return new Response('',{status:422});}));assert.equal(calls,1);
});
test('MOC stream interruption never triggers automatic retries',async()=>{
 let calls=0;await assert.rejects(extractAutomatically(result,document,true,signal(),()=>{},async()=>{calls++;return calls===1?Response.json(prepared):new Response('',{headers:{'content-type':'text/event-stream'}});}));assert.equal(calls,2);
});
test('MOC record re-open is only GET, no PDF download or model run',async()=>{
 const out=await loadAutoSaved(result,signal(),async(path,o)=>{assert.equal(o.method,undefined);assert.ok(path.endsWith('/automation'));return Response.json(finished);});assert.equal(out.status,'NEEDS_EVIDENCE');
});
for(const [label,change] of [
 ['wrong run',v=>v.runId='other'],['wrong digest',v=>v.digest='b'.repeat(64)],
 ['false clinical approval',v=>v.decision.clinicalApproved=true],
 ['fabricated simulation',v=>v.decision.simulationExecuted=true],
 ['personal fallback',v=>v.report.execution_mode='CODEX_CHATGPT'],
 ['wrong source context',v=>v.document.input.study='NCT00000002'],
 ['missing final report',v=>v.report=null],
])test(`MOC restoration rejects ${label}`,async()=>{const value=structuredClone(finished);change(value);await assert.rejects(readAutoSaved(JSON.stringify(value),result));});

// Deliberately synthetic provider contract, never an actual DACON execution.
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {canonical,digest} from '../src/field-review.ts';
export async function handoffFixture(){
 const bytes=readFileSync(new URL('../public/data/moc/SYNTHETIC-DEMO-NOT-CLINICAL.pdf',import.meta.url));
 const report=JSON.parse(readFileSync(new URL('../public/data/moc/original-agent.json',import.meta.url),'utf8'));
 report.execution_mode='DACON_RESPONSES';report.input.study='NCT00000001';report.input_digest=await digest(canonical(report.input));
 report.limitations.push('MOC mocked provider contract; no actual API call.');
 const source={schemaVersion:'pdf-evidence/1',name:'doc_1.pdf',sha256:report.input.spans[0].source_digest,byteLength:bytes.length,extractor:'test-only',status:'TEXT_EXTRACTED',coordinateSystem:'normalized_top_left_rotated_viewport',pages:[{number:1,width:100,height:100,rotation:0,status:'TEXT_EXTRACTED',spans:report.input.spans.map((s,i)=>({id:s.id,page:s.page,item:i,text:s.text,box:{x:.1,y:.1,width:.5,height:.1}}))}]};
 const id='00000000-0000-4000-8000-000000000001',search='00000000-0000-4000-8000-000000000002';
 const document={status:'READY',sourceId:'doc_1',source:{...source,schemaVersion:'pdf-evidence-window/1'},coverage:{policy:'lexical-pages/1',totalPages:1,scannedPages:[1],retainedPages:[1],omittedPages:[],noTextPages:[],clinicalReview:'NOT_PERFORMED',selection:[]},input:report.input,candidates:[],attempts:[{sourceId:'doc_1',status:'READY'}]};
 const automation={schema:'research-automation/1',runId:id,digest:await digest(canonical({input:document.input,coverage:document.coverage,sourceId:document.sourceId,sourceDigest:source.sha256})),status:'REVIEW_REQUIRED',document,report,decision:{status:'REVIEW_REQUIRED',clinicalApproved:false,simulationExecuted:false,acceptedDrafts:report.accepted.length,findingCodes:[],questions:['MOC fields need review'],reason:'Synthetic only'},events:[],textVerifiedAgainstPdf:false};
 const result={collection:{id,project_id:'moc',created_at:'2026-09-22T00:00:00Z',status:'COMPLETE',execution_mode:'SCRIPTED_TEST_DOUBLE',request:{search_id:search,nct_id:'NCT00000001',asset:report.input.asset,indication:report.input.indication,model_consent:true},sources:[{id:'doc_1',kind:'PROTOCOL',title:'MOC · 연결 검증용 합성 PDF',url:'https://cdn.clinicaltrials.gov/large-docs/01/NCT00000001/Prot_000.pdf',pdf_url:'https://cdn.clinicaltrials.gov/large-docs/01/NCT00000001/Prot_000.pdf',text:'Synthetic only',content_level:'PDF_AVAILABLE',link_basis:['REGISTRY_DOCUMENT'],identifiers:{nct:'NCT00000001'},published:null,fetched_at:'2026-09-22T00:00:00Z',digest:'a'.repeat(64),raw_snapshots:[]}],coverage:[],events:[],plan:null,review:null,calls:[],notices:['MOC synthetic fixture']},changes:{previous_id:null,added:['doc_1'],changed:[],not_retrieved:[]}};
 const study={nct_id:'NCT00000001',title:'MOC 연결 검증',url:'https://clinicaltrials.gov/study/NCT00000001',conditions:[report.input.indication],phases:[],status:'UNKNOWN',updated:null,sponsor:null,enrollment:null,interventions:[{name:report.input.asset,type:'DRUG'}],arms:[],primary_outcomes:[],results_available:false,documents:[]};
 const receipt={id:search,query:report.input.asset,created_at:'2026-09-22T00:00:00Z',digest:'a'.repeat(64),total_count:1,fetched_count:1,truncated:false,studies:[study],mode:'LIVE_PUBLIC',clinical_verified:false};
 return {bytes,source,done:{kind:'result',result,document,automation,receipt,candidate:{study,asset:report.input.asset,indication:report.input.indication,score:0,reason:'MOC synthetic fixture'}}};
}

/** Contract fixture. Pass a genuine 80-page PDF for browser QA; no real provider call. */
export async function selectedHandoffFixture(pdfBytes){
 const original=await handoffFixture(),bytes=pdfBytes??original.bytes;
 const hash=createHash('sha256').update(bytes).digest('hex'),oldHash=original.source.sha256;
 const remap=(key,value)=>typeof value==='string'?(value===oldHash?hash:value.replace(/^p1-i/,'p48-i')):((key==='page'||key==='number')&&value===1?48:value);
 const done=JSON.parse(JSON.stringify(original.done,remap)),source=JSON.parse(JSON.stringify(original.source,remap));
 source.schemaVersion='pdf-evidence-selected/1';source.totalPages=80;source.byteLength=bytes.length;
 source.pages.push({number:73,width:100,height:100,rotation:0,status:'NO_TEXT',spans:[]});source.status='PARTIAL_NO_TEXT';
 const document=done.automation.document;
 document.source={...source,schemaVersion:'pdf-evidence-window/1'};delete document.source.totalPages;
 document.coverage={policy:'lexical-pages/1',totalPages:80,scannedPages:Array.from({length:80},(_,i)=>i+1),retainedPages:[48,73],omittedPages:Array.from({length:80},(_,i)=>i+1).filter(p=>p!==48&&p!==73),noTextPages:[73],clinicalReview:'NOT_PERFORMED',selection:[]};
 done.automation.report.input_digest=await digest(canonical(done.automation.report.input));
 done.automation.digest=await digest(canonical({input:document.input,coverage:document.coverage,sourceId:document.sourceId,sourceDigest:hash}));
 done.document=document;
 return {bytes,source,done};
}

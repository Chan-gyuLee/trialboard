import test from 'node:test';
import assert from 'node:assert/strict';
import {autoWorkStates,chooseCandidate,researchCandidates,runAutoReview,openAutoRecord} from '../src/auto-review.ts';
import {explorationFixture} from './exploration-fixture.mjs';
const id='00000000-0000-4000-8000-000000000001',runId='00000000-0000-4000-8000-000000000002';
const location={hostname:'127.0.0.1',protocol:'http:',port:'5173'};
const study=(patch={})=>({nct_id:'NCT00000001',title:'MOC trial',url:'https://clinicaltrials.gov/study/NCT00000001',conditions:['MOC tumor'],phases:['PHASE2'],status:'COMPLETED',updated:null,sponsor:null,enrollment:null,interventions:[{name:'MOCdrug',type:'DRUG'}],arms:[],primary_outcomes:[],results_available:true,documents:[],...patch});
const receipt=(studies=[study()],query='MOCdrug')=>({id,query,created_at:'2026-09-16T00:00:00Z',digest:'a'.repeat(64),total_count:studies.length,fetched_count:studies.length,truncated:false,studies,mode:'LIVE_PUBLIC',clinical_verified:false});
const research=()=>({collection:{id:runId,project_id:'b'.repeat(64),created_at:'2026-09-16T00:00:00Z',status:'COMPLETE',execution_mode:'DACON_RESPONSES',request:{search_id:id,nct_id:'NCT00000001',asset:'MOCdrug',indication:'MOC tumor',public_consent:true,model_consent:true},sources:[{id:'paper_123',title:'MOC paper',url:'https://pubmed.ncbi.nlm.nih.gov/123/',kind:'PAPER',text:'MOC exact text.',content_level:'ABSTRACT',link_basis:['DRUG_SEARCH'],identifiers:{PMID:'123'},published:null,fetched_at:'2026-09-16T00:00:00Z',digest:'c'.repeat(64),pdf_url:null,raw_snapshots:[]}],coverage:[],events:[],notices:[],calls:[{stage:'AI_PLAN',status:'RECEIVED'},{stage:'AI_REVIEW',status:'RECEIVED'}],plan:{followup_terms:[],priorities:[],missing_evidence:[]},review:{findings:[{source_id:'paper_123',quote:'MOC exact text.',interpretation:'MOC interpretation'}],questions:['MOC question'],conclusion:'NEEDS_EXPERT_REVIEW'}},changes:{previous_id:null,added:[],changed:[],not_retrieved:[]}});
function backend({r=receipt(),result=research(),caps={enabled:true,provider:'DACON_RESPONSES',configured:true,model:'gpt-5.6-terra',automation_enabled:true},failRun=false,cut=false}={}){
 const requests=[];
 const fetcher=async(path,options={})=>{
  requests.push({path,...options});options.signal?.throwIfAborted();
  if(path==='/api/agent-demo/capabilities')return Response.json(caps);
  if(path==='/api/evidence-scout/search')return new Response(['SEARCHING','COLLECTED','SAVING','COMPLETE'].map(stage=>JSON.stringify({stage,...(stage==='COMPLETE'?{receipt:r}:{message:'MOC search'})})+'\n').join(''));
  if(path==='/api/research/run')return failRun?new Response('',{status:429}):new Response((cut?['STARTED']:['STARTED','SEARCH','COMPLETE']).map((stage,i)=>'data: '+JSON.stringify({run_id:runId,sequence:i+1,elapsed_ms:i*100,stage,message:'MOC event'})+'\n\n').join(''),{headers:{'content-type':'text/event-stream'}});
  if(path===`/api/research/runs/${runId}`)return Response.json(result);
  if(path===`/api/research/runs/${runId}/automation`)return Response.json(null);
  if(path===`/api/research/runs/${runId}/result-tables`)return Response.json(null);
  if(path===`/api/research/runs/${runId}/exploration`)return Response.json(caps.exploration_enabled?explorationFixture():null);
  if(path===`/api/evidence-scout/searches/${id}`)return Response.json(r);
  throw Error('Unexpected route '+path);
 };
 return {fetcher,requests};
}
const options=b=>({query:'MOCdrug',consent:true,signal:new AbortController().signal,onEvent:()=>{},location,fetcher:b.fetcher});
test('MOC orchestration automatically calculates separate exploration after review and restores GET only',async()=>{
 const caps={enabled:true,provider:'DACON_RESPONSES',configured:true,model:'gpt-5.6-terra',automation_enabled:true,exploration_enabled:true},b=backend({caps}),events=[];
 const out=await runAutoReview({...options(b),onEvent:e=>events.push(e)});
 assert.equal(out.exploration.simulations.length,9);assert.equal(out.exploration.evidenceUsedAsParameters,false);
 assert.equal(b.requests.filter(r=>r.path.endsWith('/exploration')&&r.method==='POST').length,1);
 assert.equal(events.filter(e=>e.stage==='EXPLORATION').length,2);
 const n=b.requests.length;const restored=await openAutoRecord(runId,new AbortController().signal,b.fetcher);
 assert.deepEqual(restored.exploration,out.exploration);assert.ok(b.requests.slice(n).every(r=>!r.method));
});
test('MOC exploration failure preserves briefing and cancellation prevents compute POST',async()=>{
 const caps={enabled:true,provider:'DACON_RESPONSES',configured:true,model:'gpt-5.6-terra',automation_enabled:true,exploration_enabled:true},b=backend({caps});let calls=0;
 const out=await runAutoReview({...options(b),fetcher:async(path,o)=>{if(path.endsWith('/exploration')){calls++;return new Response('',{status:429});}return b.fetcher(path,o);}});
 assert.ok(out.result.collection.review);assert.ok(out.explorationError);assert.equal(out.exploration,null);assert.equal(calls,1);
 const c=new AbortController();await assert.rejects(runAutoReview({...options(b),signal:c.signal,onEvent:e=>{if(e.stage==='EXPLORATION')c.abort();}}));
 assert.equal(b.requests.filter(r=>r.path.endsWith('/exploration')).length,0);
 const partial=research();partial.collection.review=null;partial.collection.status='PARTIAL';
 const no=backend({caps,result:partial});await runAutoReview(options(no));assert.equal(no.requests.filter(r=>r.path.endsWith('/exploration')).length,0);
});
test('one start automatically connects search, provisional trial, model investigation and stored brief',async()=>{
 const b=backend(),seen=[];const out=await runAutoReview({...options(b),onEvent:e=>seen.push(e)});
 assert.equal(out.kind,'result');assert.equal(out.result.collection.review.questions.length,1);
 assert.deepEqual(b.requests.filter(r=>r.method==='POST').map(r=>r.path),['/api/evidence-scout/search','/api/research/run']);
 const body=JSON.parse(b.requests.find(r=>r.path==='/api/research/run').body);
 assert.equal(body.model_consent,true);assert.equal(body.nct_id,'NCT00000001');assert.equal(body.indication,'MOC tumor');
 assert.ok(seen.some(e=>e.stage==='SELECTED'));assert.equal(seen.at(-1).stage,'RESULT');
 assert.equal(out.receipt.clinical_verified,false);
});
test('multiple indications ask one scope question before any model request; continue never reruns search',async()=>{
 const r=receipt([study({conditions:['MOC tumor','Other tumor']})]),b=backend({r});
 const paused=await runAutoReview(options(b));assert.equal(paused.kind,'scope');assert.equal(b.requests.filter(r=>r.path==='/api/research/run').length,0);
 const out=await runAutoReview({...options(b),receipt:paused.receipt,scope:{asset:'MOCdrug',indication:'MOC tumor'}});
 assert.equal(out.kind,'result');assert.equal(b.requests.filter(r=>r.path==='/api/evidence-scout/search').length,1);
 assert.equal(b.requests.filter(r=>r.path==='/api/research/run').length,1);
});
test('exact names only: alias and combination cannot silently become a different target drug',()=>{
 assert.equal(chooseCandidate(receipt([study({interventions:[{name:'Other drug',type:'DRUG'}]})])),undefined);
 assert.equal(chooseCandidate(receipt([study({interventions:[{name:'Drug A',type:'DRUG'},{name:'Drug B',type:'DRUG'}]})],'NCT00000001')),undefined);
 const r=receipt([study({interventions:[{name:'MOCdrug',type:'DRUG'},{name:'Other drug',type:'DRUG'}]})]);assert.equal(chooseCandidate(r).asset,'MOCdrug');
 assert.equal(chooseCandidate(receipt([study()],'NCT00000001')).asset,'MOCdrug');
 assert.equal(chooseCandidate(receipt([study()],'NCT99999999')),undefined);
});
test('one scope with multiple trials uses disclosed access priority, not a clinical recommendation',()=>{
 const first=study({results_available:false,nct_id:'NCT00000002',url:'https://clinicaltrials.gov/study/NCT00000002'});
 const chosen=chooseCandidate(receipt([first,study()]));assert.equal(chosen.study.nct_id,'NCT00000001');assert.match(chosen.reason,/임상적 우선순위가 아닙니다/);
 assert.equal(researchCandidates(receipt([study({conditions:[]})])).length,0);
});
test('dose-first selection reaches actual investigation request with no extra step or request',async()=>{
 const dose=study({nct_id:'NCT00000002',url:'https://clinicaltrials.gov/study/NCT00000002',results_available:false,arms:[{label:'MOCdrug 10 mg'},{label:'MOCdrug 20 mg'}]});
 const r=receipt([study(),dose]),result=research();result.collection.request.nct_id=dose.nct_id;
 const b=backend({r,result}),seen=[];
 const out=await runAutoReview({...options(b),onEvent:e=>seen.push(e)});
 assert.equal(out.kind,'result');assert.equal(out.candidate.study.nct_id,dose.nct_id);
 assert.equal(JSON.parse(b.requests.find(r=>r.path==='/api/research/run').body).nct_id,dose.nct_id);
 assert.equal(b.requests.filter(r=>r.method==='POST').length,2);
 assert.match(seen.find(e=>e.stage==='SELECTED').message,/서로 다른 시험군/);
});
test('no consent or remote site causes zero requests',async()=>{
 for(const override of [{consent:false},{consent:1},{query:''},{location:{...location,hostname:'example.com'}}]){
  const b=backend();await assert.rejects(runAutoReview({...options(b),...override}));assert.equal(b.requests.length,0);
 }
});
test('missing team key, different provider or unknown model blocks before any public or model POST',async()=>{
 for(const patch of [{configured:false},{provider:'CODEX_CHATGPT'},{model:'invented'},{enabled:false}]){
  const b=backend({caps:{enabled:true,provider:'DACON_RESPONSES',configured:true,model:'gpt-5.6-terra',...patch}});
  await assert.rejects(runAutoReview(options(b)));assert.equal(b.requests.filter(r=>r.method==='POST').length,0);
 }
});
test('stale scope/search cannot trigger an investigation',async()=>{
 for(const override of [{receipt:receipt([], 'different')},{receipt:receipt(),scope:{asset:'MOCdrug',indication:'invented'}}]){
  const b=backend();await assert.rejects(runAutoReview({...options(b),...override}));assert.equal(b.requests.filter(r=>r.method==='POST').length,0);
 }
});
test('aborting at the handoff stops before the model POST',async()=>{
 const b=backend(),c=new AbortController();
 await assert.rejects(runAutoReview({...options(b),signal:c.signal,onEvent:e=>{if(e.stage==='SELECTED')c.abort();}}));
 assert.equal(b.requests.filter(r=>r.path==='/api/research/run').length,0);
});
test('provider/context/run mismatches are rejected rather than labelled as current live results',async()=>{
 for(const mutate of [c=>c.execution_mode='SCRIPTED_TEST_DOUBLE',c=>c.request.asset='other',c=>c.request.model_consent=false,c=>c.id=id,c=>c.request.search_id=runId,c=>c.status='RUNNING']){
  const result=research();mutate(result.collection);const b=backend({result});await assert.rejects(runAutoReview(options(b)));
 }
});
test('model failure and stream disconnect never retry or substitute a demo',async()=>{
 for(const setup of [{failRun:true},{cut:true}]){const b=backend(setup);await assert.rejects(runAutoReview(options(b)));assert.equal(b.requests.filter(r=>r.path==='/api/research/run').length,1);}
});
test('partial collection without a brief is returned as partial, not invented questions',async()=>{
 const result=research();result.collection.status='PARTIAL';result.collection.review=null;
 const out=await runAutoReview(options(backend({result})));assert.equal(out.kind,'result');assert.equal(out.result.collection.review,null);assert.equal(out.result.collection.status,'PARTIAL');
});
test('reopen performs only five GETs including extraction/results/exploration and preserves previous provider identity',async()=>{
 const result=research();result.collection.execution_mode='CODEX_CHATGPT';const b=backend({result});
 const out=await openAutoRecord(runId,new AbortController().signal,b.fetcher);assert.equal(out.result.collection.execution_mode,'CODEX_CHATGPT');assert.equal(b.requests.length,5);assert.ok(b.requests.every(r=>!r.method));
});
test('document preparation failure preserves completed briefing without retrying model',async()=>{
 const result=research();result.collection.sources.push({id:'doc_1',title:'MOC SAP',kind:'SAP',content_level:'PDF_AVAILABLE',url:'https://cdn.clinicaltrials.gov/large-docs/01/NCT00000001/SAP_001.pdf',pdf_url:'https://cdn.clinicaltrials.gov/large-docs/01/NCT00000001/SAP_001.pdf',identifiers:{nct:'NCT00000001'},link_basis:['REGISTRY_DOCUMENT'],text:'MOC',digest:'d'.repeat(64),raw_snapshots:[],published:null,fetched_at:'2026-09-16T00:00:00Z'});
 const b=backend({result}),seen=[];let downloads=0;
 const fetcher=async(path,options)=>{if(path.endsWith('/documents/doc_1')){downloads++;return new Response('',{status:422});}return b.fetcher(path,options);};
 const out=await runAutoReview({...options(b),fetcher,onEvent:e=>seen.push(e)});
 assert.equal(downloads,1);assert.equal(out.result.collection.status,'COMPLETE');assert.ok(out.result.collection.review);
 assert.equal(out.document.status,'UNAVAILABLE');assert.ok(seen.some(e=>e.stage==='DOCUMENT'));
 assert.equal(b.requests.filter(r=>r.path==='/api/research/run').length,1);
});
test('reopen refuses unrelated original search or indication',async()=>{
 for(const r of [{...receipt(),id:runId},receipt([study({conditions:['wrong scope']})])]){
  const b=backend({r});await assert.rejects(openAutoRecord(runId,new AbortController().signal,b.fetcher));
 }
});
test('exact submitted drug excludes unrelated co-medications from the scope question',()=>{
 const r=receipt([study(),study({nct_id:'NCT00000002',interventions:[{name:'Other drug',type:'DRUG'}]})]);
 assert.deepEqual([...new Set(researchCandidates(r).map(c=>c.asset))],['MOCdrug']);
});
test('rejected plan never paints additional investigation and briefing as completed',()=>{
 const events=[{stage:'SEARCH',message:'MOC'},{stage:'RESEARCH',message:'MOC',research:{stage:'AI_PLAN'}}];
 const result=research();result.collection.status='PARTIAL';result.collection.plan=null;result.collection.review=null;
 const states=autoWorkStates(events,{kind:'result',receipt:receipt(),result},false);
 assert.deepEqual(states,['done','done','partial','waiting']);
});
test('scope pause shows search done; skipped followup and failed review remain distinct',()=>{
 assert.deepEqual(autoWorkStates([],{kind:'scope',receipt:receipt(),candidates:[]},false),['done','waiting','waiting','waiting']);
 const result=research();result.collection.review=null;result.collection.status='PARTIAL';
 assert.deepEqual(autoWorkStates([{stage:'RESEARCH',research:{stage:'AI_REVIEW'}}],{kind:'result',receipt:receipt(),result},false),['done','done','skipped','partial']);
});

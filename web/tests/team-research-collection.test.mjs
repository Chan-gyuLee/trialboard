import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {runTeamCollection,readTeamCollectionStream} from '../src/team-research-collection.ts';
import {readResearchResult,readResearchStream} from '../src/research.ts';
import {readSourceMetadata} from '../src/research-source-policy.ts';
import {readRawMetadata} from '../src/research-raw-policy.ts';
import {emptyRawStorageDrafts,permissionsFromDrafts,readRawStoragePermissions} from '../src/raw-storage-consent.ts';
const id='00000000-0000-4000-8000-000000000001',run='00000000-0000-4000-8000-000000000002';
const location={hostname:'127.0.0.1',protocol:'http:',port:'5173'};
const permission={collector:'REGISTRY',original_storage:'ALLOW',evidence_reference:'합성 허가 근거',reason:'합성 저장 시험'};
const study={nct_id:'NCT00000001',title:'Synthetic trial',url:'https://clinicaltrials.gov/study/NCT00000001',conditions:['Synthetic tumor'],phases:['PHASE2'],status:'COMPLETED',updated:null,sponsor:null,enrollment:null,interventions:[{name:'SyntheticDrug',type:'DRUG'}],arms:[],primary_outcomes:[],results_available:true,documents:[]};
const receipt={id,query:'SyntheticDrug',created_at:'2026-10-01T00:00:00Z',digest:'a'.repeat(64),total_count:1,fetched_count:1,truncated:false,studies:[study],mode:'LIVE_PUBLIC',clinical_verified:false};
function backend({stages=['STARTED','SEARCH','COMPLETE'],receiptValue=receipt,failMetadata=false,failRun=false}={}){
 const requests=[];
 const fetcher=async(path,options={})=>{
  requests.push({path,...options});options.signal?.throwIfAborted();
  if(path==='/api/evidence-scout/capabilities')return Response.json({enabled:true,persisted:true,model_calls:0});
  if(path==='/api/evidence-scout/search')return new Response(['SEARCHING','COLLECTED','SAVING','COMPLETE'].map(stage=>JSON.stringify({stage,...(stage==='COMPLETE'?{receipt:receiptValue}:{message:'Synthetic search'})})+'\n').join(''));
  if(path==='/api/research/run')return failRun?new Response('',{status:403}):new Response(stages.map((stage,i)=>'data: '+JSON.stringify({run_id:run,sequence:i+1,elapsed_ms:i*100,stage,message:'Synthetic event'})+'\n\n').join(''),{headers:{'Content-Type':'text/event-stream'}});
  if(path===`/api/research/runs/${run}/source-metadata`)return failMetadata?new Response('',{status:403}):Response.json({run_id:run,resource_kind:'SOURCE_TEXT',can_manage:true,sources:[]});
  if(path===`/api/research/runs/${run}/raw-metadata`)return Response.json({run_id:run,resource_kind:'RAW_SNAPSHOT',can_manage:true,sources:[]});
  throw Error('Unexpected route '+path);
 };
 return {requests,fetcher};
}
const options=b=>({query:'SyntheticDrug',consent:true,permissions:[permission],signal:new AbortController().signal,onEvent:()=>{},location,fetcher:b.fetcher});
test('explicit selected collector storage rights never become model/search/training permission',()=>{
 const drafts=emptyRawStorageDrafts();assert.deepEqual(permissionsFromDrafts(drafts),[]);
 drafts.REGISTRY={selected:true,evidence_reference:'  합성 원본 허가  ',reason:'합성 확인'};
 assert.deepEqual(permissionsFromDrafts(drafts),[{...permission,evidence_reference:'합성 원본 허가',reason:'합성 확인'}]);
 for(const value of [[permission,permission],[{...permission,collector:'ANY'}],[{...permission,original_storage:'UNKNOWN'}],[{...permission,external_ai:'ALLOW'}],[{...permission,reason:' '}],[{...permission,evidence_reference:'x'.repeat(2001)}]])assert.throws(()=>readRawStoragePermissions(value));
});
test('TEAM collection needs no model configuration and only reads metadata after one collection request',async()=>{
 const b=backend(),out=await runTeamCollection(options(b));assert.equal(out.kind,'collected');assert.equal(out.runId,run);
 const writes=b.requests.filter(r=>r.method==='POST');assert.deepEqual(writes.map(r=>r.path),['/api/evidence-scout/search','/api/research/run']);
 const body=JSON.parse(writes[1].body);assert.equal(body.model_consent,false);assert.deepEqual(body.raw_storage_permissions,[permission]);
 assert.equal(b.requests.filter(r=>r.path.includes('agent-demo')||r.path.includes('automation')||r.path.includes('documents')||r.path.endsWith(run)).length,0);
});
test('no explicit scope permission/public consent/valid location means zero requests',async()=>{
 for(const change of [{permissions:[]},{permissions:[{...permission,external_ai:'ALLOW'}]},{consent:false},{consent:1},{query:''},{location:{...location,hostname:'example.com'}}]){const b=backend();await assert.rejects(runTeamCollection({...options(b),...change}));assert.equal(b.requests.length,0);}
});
test('TEAM scope choice reuses search receipt without silently changing drug or resending search',async()=>{
 const b=backend({receiptValue:{...receipt,studies:[{...study,conditions:['Synthetic tumor','Other tumor']}]}});
 const paused=await runTeamCollection(options(b));assert.equal(paused.kind,'scope');assert.equal(b.requests.filter(r=>r.path==='/api/research/run').length,0);
 const done=await runTeamCollection({...options(b),receipt:paused.receipt,scope:{asset:'SyntheticDrug',indication:'Other tumor'}});assert.equal(done.kind,'collected');
 assert.equal(b.requests.filter(r=>r.path==='/api/evidence-scout/search').length,1);assert.equal(JSON.parse(b.requests.find(r=>r.path==='/api/research/run').body).indication,'Other tumor');
});
test('TEAM collection aborts before write at handoff and never retries blocked or missing metadata',async()=>{
 const b=backend(),controller=new AbortController();await assert.rejects(runTeamCollection({...options(b),signal:controller.signal,onEvent:e=>{if(e.stage==='SELECTED')controller.abort();}}));assert.equal(b.requests.filter(r=>r.path==='/api/research/run').length,0);
 for(const setup of [{failRun:true},{failMetadata:true},{stages:['STARTED']}]){const backendValue=backend(setup);await assert.rejects(runTeamCollection(options(backendValue)));assert.equal(backendValue.requests.filter(r=>r.path==='/api/research/run').length,1);}
});
test('unexpected model stage cannot be labelled as collection-only success',async()=>{
 const b=backend({stages:['STARTED','AI_PLAN','COMPLETE']});await assert.rejects(runTeamCollection(options(b)));assert.equal(b.requests.filter(r=>r.path.endsWith('source-metadata')).length,0);
});
test('shared manual and automatic stream guard rejects buffered completion after cancellation',async()=>{
 const stages=['STARTED','COMPLETE'];
 const response=()=>new Response(stages.map((stage,i)=>'data: '+JSON.stringify({run_id:run,sequence:i+1,elapsed_ms:i,stage,message:'Synthetic'})+'\n\n').join(''),{headers:{'Content-Type':'text/event-stream'}});
 for(const stopAt of ['BEFORE','STARTED','COMPLETE']){
  const controller=new AbortController(),events=[];if(stopAt==='BEFORE')controller.abort();
  await assert.rejects(readTeamCollectionStream(response(),controller.signal,e=>{events.push(e.stage);if(e.stage===stopAt)controller.abort();}),{name:'AbortError'});
  if(stopAt!=='COMPLETE')assert(!events.includes('COMPLETE'));
 }
 for(const stage of ['AI_PLAN','AI_REVIEW','CITATIONS_READY']){
  const response=await backend({stages:['STARTED',stage,'COMPLETE']}).fetcher('/api/research/run');
  await assert.rejects(readTeamCollectionStream(response,new AbortController().signal,()=>{}),/예상하지 않은 AI/);
 }
});
test('Python ResearchRequest and browser permission contracts agree without model or network calls',()=>{
 const request={search_id:id,nct_id:study.nct_id,asset:'SyntheticDrug',indication:study.conditions[0],public_consent:true,model_consent:false,raw_storage_permissions:[permission]};
 const result=spawnSync('.venv/bin/python',['-c',`
import json,sys
from trialboard.research.models import ResearchRequest
value=json.load(sys.stdin)
request=ResearchRequest.model_validate(value)
legacy=ResearchRequest.model_validate({k:v for k,v in value.items() if k!='raw_storage_permissions'})
assert legacy.raw_storage_permissions==[]
for patch in ({'raw_storage_permissions':value['raw_storage_permissions']*2},{'raw_storage_permissions':[{**value['raw_storage_permissions'][0],'external_ai':'ALLOW'}]}):
 try: ResearchRequest.model_validate({**value,**patch})
 except ValueError: pass
 else: raise AssertionError('invalid permission accepted')
print(request.model_dump_json())
`],{input:JSON.stringify(request),encoding:'utf8',timeout:10000,maxBuffer:100000});
 assert.equal(result.status,0,result.stderr);const value=JSON.parse(result.stdout);assert.equal(value.model_consent,false);assert.deepEqual(readRawStoragePermissions(value.raw_storage_permissions),[permission]);
});
test('real TEAM collection SSE, exact RAW rights and repeated-run source bodies roundtrip to browser readers',async()=>{
 const result=spawnSync('.venv/bin/python',['-c',`
import json,tempfile
from pathlib import Path
from pytest import MonkeyPatch
from test_research_raw_capture import scenario,execute,PERMISSIONS
from test_research_source_policy import assertion
from test_project_acl import headers
with tempfile.TemporaryDirectory(prefix='trialboard-capture-contract-') as directory:
 with MonkeyPatch.context() as patch:
  generator=scenario.__wrapped__(Path(directory),patch)
  case=next(generator)
  try:
   records=[]
   for permissions in (PERMISSIONS,PERMISSIONS,PERMISSIONS[:1]):
    response,run,calls=execute(case,permissions)
    assert run.status=='COMPLETE',response.text
    client=case[0][0]
    base='/api/research/runs/'+run.id
    source=client.get(base+'/source-metadata')
    raw=client.get(base+'/raw-metadata')
    assert source.status_code==raw.status_code==200
    assert client.get(base).status_code==403
    assert 'Private synthetic abstract' not in response.text+source.text+raw.text
    for item in run.sources:
     written=client.post(base+'/sources/'+item.id+'/usage-policy',json=assertion(item.digest).model_dump(),headers=headers(client))
     assert written.status_code==200,written.text
    full=client.get(base)
    assert full.status_code==200,full.text
    records.append({'sse':response.text,'source':source.json(),'raw':raw.json(),'full':full.text})
   assert case[0][6]['calls']==case[0][6]['factories']==0
   print(json.dumps(records))
  finally:
   try: next(generator)
   except StopIteration: pass
`],{env:{...process.env,PYTHONPATH:'tests:.'},encoding:'utf8',timeout:30000,maxBuffer:3000000});
 assert.equal(result.status,0,result.stderr);
 const records=JSON.parse(result.stdout),collections=[];
 for(const record of records){
  const events=[],run=await readResearchStream(new Response(record.sse,{headers:{'Content-Type':'text/event-stream'}}),e=>events.push(e));
  const source=readSourceMetadata(record.source,run),raw=readRawMetadata(record.raw,run),full=readResearchResult(record.full);
  assert.equal(full.collection.id,run);assert.equal(full.collection.execution_mode,'COLLECTORS_ONLY');assert.equal(full.collection.request.model_consent,false);
  assert.equal(source.sources.length,raw.sources.length);assert(source.sources.every(s=>s.usage_policy.original_storage==='UNKNOWN'));
  assert(raw.sources.every(s=>s.snapshots.every(p=>p.usage_policy.original_storage==='ALLOW'&&p.usage_policy.external_ai==='UNKNOWN'&&p.usage_policy.internal_search==='UNKNOWN'&&p.usage_policy.training==='UNKNOWN')));
  assert(full.collection.sources.some(s=>s.id.startsWith('registry_results_')));assert(events.some(e=>e.stage==='COMPLETE'));
  collections.push(full.collection);
 }
 const first=collections[0].sources.find(s=>s.id==='paper_1234'),second=collections[1].sources.find(s=>s.id==='paper_1234');
 assert.equal(first.digest,second.digest);assert.notEqual(first.fetched_at,second.fetched_at);assert(first.raw_snapshots.length>=2);
 assert(collections[2].coverage.some(c=>c.status==='SKIPPED'));assert(!collections[2].sources.some(s=>s.id==='paper_1234'));
});

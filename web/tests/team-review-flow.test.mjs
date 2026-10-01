import test from 'node:test';
import assert from 'node:assert/strict';
import {approveFlowSelection,loadFlowMetadata,reviewReadiness,FlowApprovalError} from '../src/team-review-flow.ts';
const run='00000000-0000-4000-8000-000000000001',sid='source_1',source='a'.repeat(64),snapshot='b'.repeat(64);
const base={resource_kind:'SOURCE_TEXT',run_id:run,source_id:sid,source_digest:source,policy_revision:0,original_storage:'UNKNOWN',internal_search:'UNKNOWN',external_ai:'UNKNOWN',training:'UNKNOWN',evidence_reference:null,reason:null,asserted_by:null,created_at:null,verification:'UNVERIFIED'};
function fixture(){const metadata={sources:{run_id:run,resource_kind:'SOURCE_TEXT',can_manage:true,sources:[{source_id:sid,source_digest:source,title:'합성 출처',usage_policy:{...base}}]},raw:{run_id:run,resource_kind:'RAW_SNAPSHOT',can_manage:true,sources:[{source_id:sid,source_digest:source,title:'합성 출처',snapshots:[{snapshot_digest:snapshot,byte_length:2,usage_policy:{...base,resource_kind:'RAW_SNAPSHOT',snapshot_digest:snapshot}}]}]}};return metadata;}
function backend(metadata,{fail=0}={}){const writes=[];const request=async(path,options={})=>{
 if(options.method!=='POST')return Response.json(path.endsWith('raw-metadata')?metadata.raw:metadata.sources);
 const body=JSON.parse(options.body);writes.push({path,body});if(writes.length===fail)return new Response('',{status:409});
 const raw=path.endsWith('raw-usage-policy'),holder=raw?metadata.raw.sources[0].snapshots[0]:metadata.sources.sources[0],previous=holder.usage_policy;
 const {expected_policy_revision,...values}=body;const current={...previous,...values,policy_revision:expected_policy_revision+1,created_at:'2026-10-01T00:00:00Z',asserted_by:run,verification:'USER_ATTESTED_UNVERIFIED'};
 holder.usage_policy=current;return Response.json({current,history:[current,...(previous.policy_revision?[previous]:[])],can_manage:true});
 };return {request,writes};}
const options=(metadata,b)=>({runId:run,metadata,selected:[sid],evidence:'합성 허가',reason:'공개 합성자료 검토',textConfirmed:true,rawConfirmed:true,signal:new AbortController().signal,request:b.request});
test('flow only reads metadata, requires exact source versions, and exposes both readiness gates',async()=>{
 const metadata=fixture(),b=backend(metadata);const loaded=await loadFlowMetadata(run,new AbortController().signal,b.request);assert.equal(b.writes.length,0);assert.equal(reviewReadiness(loaded,sid).ready,false);
 metadata.raw.sources[0].source_digest='c'.repeat(64);await assert.rejects(loadFlowMetadata(run,new AbortController().signal,b.request));
});
test('explicit shared confirmation records text and raw separately without model/PDF or changing other purposes',async()=>{
 const metadata=fixture(),b=backend(metadata);assert.equal(await approveFlowSelection(options(metadata,b)),2);
 assert.equal(b.writes.length,2);assert(b.writes[0].path.endsWith('/usage-policy'));assert(b.writes[1].path.endsWith('/raw-usage-policy'));
 for(const w of b.writes){assert.equal(w.body.original_storage,'ALLOW');assert.equal(w.body.external_ai,'ALLOW');assert.equal(w.body.training,'UNKNOWN');assert.equal(w.body.internal_search,'UNKNOWN');}
 assert.equal(reviewReadiness(metadata,sid).ready,true);assert.equal(await approveFlowSelection(options(metadata,b)),0);assert.equal(b.writes.length,2);
});
test('missing consent, invalid selection, missing management authority or evidence sends no writes',async()=>{
 for(const patch of [{textConfirmed:false},{rawConfirmed:false},{evidence:' '},{reason:''},{selected:[]},{selected:[sid,sid]},{selected:['other']},{runId:'wrong'}]){const m=fixture(),b=backend(m);await assert.rejects(approveFlowSelection({...options(m,b),...patch}));assert.equal(b.writes.length,0);}
 const m=fixture(),b=backend(m);m.raw.can_manage=false;await assert.rejects(approveFlowSelection(options(m,b)));assert.equal(b.writes.length,0);
});
test('conflict preserves successful assertions, reports partial progress and never retries or calls AI',async()=>{
 const m=fixture(),b=backend(m,{fail:2});await assert.rejects(approveFlowSelection(options(m,b)),e=>e instanceof FlowApprovalError&&e.completed===1&&/자동/.test(e.message));
 assert.equal(b.writes.length,2);assert.equal(m.sources.sources[0].usage_policy.external_ai,'ALLOW');assert.equal(m.raw.sources[0].snapshots[0].usage_policy.external_ai,'UNKNOWN');
});
test('cancellation between assertions stops subsequent writes and reports unknown last response safely',async()=>{
 const m=fixture(),b=backend(m),c=new AbortController();await assert.rejects(approveFlowSelection({...options(m,b),signal:c.signal,onProgress:()=>c.abort()}),e=>e.completed===1);assert.equal(b.writes.length,1);
});

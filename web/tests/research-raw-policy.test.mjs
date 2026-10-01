import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {readRawPolicy,readRawHistory,readRawMetadata,rawDraft} from '../src/research-raw-policy.ts';
const run='12345678-1234-4234-8234-123456789012',sid='registry:NCT00000001',source='a'.repeat(64),snapshot='b'.repeat(64);
const key={runId:run,sourceId:sid,sourceDigest:source,snapshotDigest:snapshot};
const empty={resource_kind:'RAW_SNAPSHOT',run_id:run,source_id:sid,source_digest:source,snapshot_digest:snapshot,policy_revision:0,original_storage:'UNKNOWN',internal_search:'UNKNOWN',external_ai:'UNKNOWN',training:'UNKNOWN',evidence_reference:null,reason:null,asserted_by:null,created_at:null,verification:'UNVERIFIED'};
const allowed={...empty,policy_revision:1,original_storage:'ALLOW',evidence_reference:'합성 이용 허가',reason:'합성 테스트',asserted_by:run,created_at:'2026-10-01T00:00:00Z',verification:'USER_ATTESTED_UNVERIFIED'};
test('RAW policy binds all identities and never borrows SOURCE_TEXT or PDF permission',()=>{
 assert.deepEqual(readRawPolicy(empty,key),empty);assert.equal(rawDraft(empty).evidence_reference,'');assert.equal(readRawPolicy(allowed,key).external_ai,'UNKNOWN');
 for(const change of [{resource_kind:'SOURCE_TEXT'},{resource_kind:'PDF_BYTES'},{run_id:sid},{source_digest:snapshot},{snapshot_digest:source},{source_id:'other'},{policy_revision:true},{original_storage:'ALLOW'},{verification:'VERIFIED'},{raw:{private:'body'}}])assert.throws(()=>readRawPolicy({...empty,...change},key));
 assert.equal(readRawPolicy({...allowed,evidence_reference:'🧪'.repeat(2000)},key).evidence_reference.length,4000);
 for(const change of [{created_at:'2026-10-01T09:00:00+09:00'},{reason:' '},{evidence_reference:'\ud800'},{policy_revision:101}])assert.throws(()=>readRawPolicy({...allowed,...change},key));
});
test('RAW history must be contiguous newest first and exactly match current',()=>{
 assert.deepEqual(readRawHistory({current:empty,history:[],can_manage:false},key).history,[]);
 const value={current:allowed,history:[allowed],can_manage:true};assert.equal(readRawHistory(value,key).history.length,1);
 for(const change of [{history:[]},{history:[allowed,allowed]},{history:[{...allowed,reason:'changed'}]},{can_manage:1}])assert.throws(()=>readRawHistory({...value,...change},key));
});
test('RAW metadata has bounded unique source/snapshot bindings and no body or inferred missing bytes',()=>{
 const item={snapshot_digest:snapshot,byte_length:2,usage_policy:empty};
 const sourceRow={source_id:sid,source_digest:source,title:'합성 원본',snapshots:[item]};
 const value={run_id:run,resource_kind:'RAW_SNAPSHOT',can_manage:true,sources:[sourceRow]};
 assert.equal(readRawMetadata(value,run).sources[0].snapshots[0].byte_length,2);
 for(const change of [{byte_length:0},{byte_length:true},{byte_length:5000001},{raw:'body'},{snapshot_digest:source}])assert.throws(()=>readRawMetadata({...value,sources:[{...sourceRow,snapshots:[{...item,...change}]}]},run));
 assert.throws(()=>readRawMetadata({...value,sources:[sourceRow,sourceRow]},run));
 assert.throws(()=>readRawMetadata({...value,sources:[{...sourceRow,snapshots:[item,item]}]},run));
 assert.throws(()=>readRawMetadata({...value,url:'private'},run));
});
test('actual TEAM raw metadata and append-only assertions roundtrip with shared-hash permission isolation',()=>{
 const result=spawnSync('.venv/bin/python',['-c',`
import json,tempfile
from pathlib import Path
from pytest import MonkeyPatch
from test_research_raw_policy import scenario,post,DATA
with tempfile.TemporaryDirectory(prefix='trialboard-raw-contract-') as directory:
 with MonkeyPatch.context() as patch:
  generator=scenario.__wrapped__(Path(directory),patch)
  case=next(generator)
  try:
   value,url,body=case
   before=value[0].get(value[4]+'/raw-metadata')
   assert before.status_code==200,before.text
   written=post(case)
   assert written.status_code==200,written.text
   after=value[0].get(value[4]+'/raw-metadata')
   assert after.status_code==200,after.text
   assert DATA['synthetic'] not in before.text+written.text+after.text
   assert value[6]['calls']==value[6]['factories']==0
   print(json.dumps({'before':before.json(),'policy':written.json(),'after':after.json(),'sourceId':value[1].sources[0].id,'key':body}))
  finally:
   try: next(generator)
   except StopIteration: pass
`],{env:{...process.env,PYTHONPATH:'tests:.'},encoding:'utf8',timeout:30000,maxBuffer:1000000});
 assert.equal(result.status,0,result.stderr);const data=JSON.parse(result.stdout),run=data.before.run_id;
 const before=readRawMetadata(data.before,run),after=readRawMetadata(data.after,run);
 const policy=readRawHistory(data.policy,{runId:run,sourceId:data.sourceId,sourceDigest:data.key.source_digest,snapshotDigest:data.key.snapshot_digest});
 assert.equal(policy.current.original_storage,'ALLOW');assert(before.sources.every(s=>s.snapshots.every(p=>p.usage_policy.original_storage==='UNKNOWN')));
 const a=after.sources.find(s=>s.source_id===data.sourceId),b=after.sources.find(s=>s.source_id!==data.sourceId);
 assert.equal(a.snapshots[0].snapshot_digest,b.snapshots[0].snapshot_digest);assert.equal(a.snapshots[0].usage_policy.original_storage,'ALLOW');assert.equal(b.snapshots[0].usage_policy.original_storage,'UNKNOWN');
});

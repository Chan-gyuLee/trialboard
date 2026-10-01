import test from "node:test";
import assert from "node:assert/strict";
import {readSourceMetadata,readSourcePolicyHistory,sourcePolicyRequest,SourcePolicyRequestError} from "../src/research-source-policy.ts";

const run="12345678-1234-4234-8234-123456789012",other="22345678-1234-4234-8234-123456789012",sid="paper:synthetic",digest="a".repeat(64);
const unknown={resource_kind:"SOURCE_TEXT",run_id:run,source_id:sid,source_digest:digest,policy_revision:0,original_storage:"UNKNOWN",internal_search:"UNKNOWN",external_ai:"UNKNOWN",training:"UNKNOWN",evidence_reference:null,reason:null,asserted_by:null,created_at:null,verification:"UNVERIFIED"};
const known={...unknown,policy_revision:1,original_storage:"ALLOW",evidence_reference:"Synthetic license fixture",reason:"Synthetic permission",asserted_by:other,created_at:"2026-10-01T00:00:00Z",verification:"USER_ATTESTED_UNVERIFIED"};
const entry={source_id:sid,source_digest:digest,title:"Synthetic public source",usage_policy:unknown};
const metadata={run_id:run,resource_kind:"SOURCE_TEXT",can_manage:true,sources:[entry]};

test("metadata is exact run/source/digest bound and excludes body fields",()=>{
  assert.equal(readSourceMetadata(metadata,run).sources[0].usage_policy.policy_revision,0);
  for(const value of [
    {...metadata,run_id:other},{...metadata,can_manage:1},{...metadata,text:"secret"},
    {...metadata,sources:[entry,entry]},
    {...metadata,sources:[{...entry,source_digest:"b".repeat(64)}]},
    {...metadata,sources:[{...entry,source_id:"another"}]},
    {...metadata,sources:[{...entry,usage_policy:{...unknown,run_id:other}}]},
    {...metadata,sources:[{...entry,text:"secret"}]},
    {...metadata,sources:Array(501).fill(entry)},
  ])assert.throws(()=>readSourceMetadata(value,run));
});

test("unknown policy cannot assert permission, authorship, or verification",()=>{
  for(const changes of [{original_storage:"ALLOW"},{asserted_by:other},{evidence_reference:"claimed"},{verification:"USER_ATTESTED_UNVERIFIED"},{internal_search:["UNKNOWN"]},{policy_revision:true}]){
    assert.throws(()=>readSourceMetadata({...metadata,sources:[{...entry,usage_policy:{...unknown,...changes}}]},run));
  }
});

test("history has exact target, bounded consecutive revisions and exact current head",()=>{
  assert.equal(readSourcePolicyHistory({current:unknown,history:[],can_manage:false},run,sid,digest).history.length,0);
  const second={...known,policy_revision:2,original_storage:"DENY"};
  const packet={current:second,history:[second,known],can_manage:true};
  assert.equal(readSourcePolicyHistory(packet,run,sid,digest).history.length,2);
  for(const value of [{...packet,current:{...second,run_id:other}}, {...packet,history:[known,second]}, {...packet,history:[second]}, {...packet,history:[{...second,reason:"different"},known]}, {...packet,can_manage:"true"}, {...packet,history:[second,{...known,asserted_by:"anonymous"}]}, {...packet,history:[second,{...known,reason:" "}]}, {...packet,history:[second,{...known,created_at:"not-a-date"}]}])assert.throws(()=>readSourcePolicyHistory(value,run,sid,digest));
});

test("requests preserve exact revision/digest and never retry conflict or auth failures",async()=>{
  for(const status of [401,403,404,409,422]){
    let calls=0;
    await assert.rejects(sourcePolicyRequest("/api/research/runs/test",{source_digest:digest,expected_policy_revision:3},undefined,async(path,init)=>{
      calls++;assert.equal(init.method,"POST");assert.deepEqual(JSON.parse(init.body),{source_digest:digest,expected_policy_revision:3});return new Response("{}",{status});
    }),e=>e instanceof SourcePolicyRequestError&&e.status===status);
    assert.equal(calls,1);
  }
});

test("metadata GET does not initialize policy with an implicit POST",async()=>{
  const value=await sourcePolicyRequest("/api/research/runs/test/source-metadata",undefined,undefined,async(path,init)=>{
    assert.equal(init.method,"GET");assert.equal(init.body,undefined);assert.equal(init.cache,"no-store");return Response.json(metadata);
  });
  assert.deepEqual(readSourceMetadata(value,run),metadata);
});

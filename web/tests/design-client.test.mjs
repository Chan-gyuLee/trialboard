import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { restoreReview } from "../src/field-review-restore.ts";
import { executeLocalDesign, localDesignOrigin } from "../src/design-client.ts";
const root = fileURLToPath(new URL("../../", import.meta.url));
const produce = code => JSON.parse(execFileSync("uv", ["run", "python", "-c", code], {cwd:root,encoding:"utf8",timeout:30000,maxBuffer:4_000_000}));
const fixtures = produce(`
import json, sys, base64
sys.path.insert(0,'tests')
from test_design_compare import brief_for
from test_field_revalidation import sample
results=[]
for imported in (False, True):
 f=sample(imported=imported)
 results.append({'source':f['source']['source'],'review':f['review'],'brief':brief_for(f),'pdf':base64.b64encode(f['pdf']).decode(),'agent':f['agent'].decode() if f['agent'] else None,'context':f['context']})
print(json.dumps(results))
`);
const caps = {enabled:true,persisted:false,model_calls:0,transport:"LOOPBACK_ONLY",clinical_approval:false};
const response = (value, status=200) => new Response(JSON.stringify(value), {status,headers:{'Content-Type':'application/json'}});
function args(index=0) {
  const f=structuredClone(fixtures[index]);
  return { origin:"http://127.0.0.1:5173", consent:true, brief:f.brief, source:f.source, review:restoreReview(JSON.stringify(f.review),f.source), pdf:new Blob([Buffer.from(f.pdf,'base64')]), attachments:{agentRaw:f.agent,aiRaw:null,context:f.context}, signal:new AbortController().signal };
}
for (const index of [0,1]) test(`web request → actual Python calculation → web validation (${index ? 'imported' : 'manual'})`, async () => {
  const calls=[];
  const r=await executeLocalDesign({...args(index),fetcher:async(url,options)=>{
    calls.push({url,options});
    assert.equal(options.credentials,'omit'); assert.equal(options.redirect,'error'); assert.equal(options.cache,'no-store');
    if(url.endsWith('capabilities')) {assert.equal(options.body,undefined); return response(caps);}
    const output=execFileSync('uv',['run','python','-c',`import sys,json
from trialboard.api.designs import execute_design
print(json.dumps(execute_design(sys.stdin.buffer.read()),ensure_ascii=False))`],{cwd:root,input:options.body,encoding:'utf8',timeout:30000,maxBuffer:4_000_000});
    return new Response(output,{headers:{'Content-Type':'application/json'}});
  }});
  assert.equal(calls.length,2); assert.equal(calls[1].url,'/api/design-comparisons'); assert.equal(calls[1].options.method,'POST');
  const body=JSON.parse(calls[1].options.body); assert.equal('api_key' in body,false); assert.equal('Authorization' in calls[1].options.headers,false);
  assert.equal(r.simulations.length,4); assert.equal(r.raw.model_calls,0); assert.equal(r.raw.clinical_approval,false);
});
for(const origin of ['https://example.com','https://localhost:5173','http://evil.localhost:5173','http://127.0.0.1:9999']) test(`never transmit from ${origin}`,async()=>{
  assert.equal(localDesignOrigin(origin),false);
  await assert.rejects(executeLocalDesign({...args(),origin,fetcher:()=>assert.fail('must not fetch')}));
});
test('no consent means no network request',async()=>{ await assert.rejects(executeLocalDesign({...args(),consent:false,fetcher:()=>assert.fail('must not fetch')})); });
test('missing original imported report fails before contacting service',async()=>{
  const a=args(1);a.attachments.agentRaw=null;await assert.rejects(executeLocalDesign({...a,fetcher:()=>assert.fail('must not fetch')}));
});
for(const mutate of [c=>c.enabled=false,c=>c.model_calls=1,c=>c.persisted=true,c=>c.transport='EXTERNAL',c=>c.clinical_approval=true]) test('capability mismatch prevents PDF submission',async()=>{
  const c={...caps};mutate(c);let calls=0;await assert.rejects(executeLocalDesign({...args(),fetcher:async()=>{calls++;return response(c);}}));assert.equal(calls,1);
});
test('wrong PDF hash cannot be submitted after successful capability check',async()=>{
  const a=args(); const buffer=new Uint8Array(await a.pdf.arrayBuffer());buffer[buffer.length-1]^=1;a.pdf=new Blob([buffer]);
  let calls=0;await assert.rejects(executeLocalDesign({...a,fetcher:async()=>{calls++;return response(caps);}}));assert.equal(calls,1);
});
for(const status of [403,413,422,429,500]) test(`HTTP ${status} is not retried or echoed`,async()=>{
  let calls=0;await assert.rejects(executeLocalDesign({...args(),fetcher:async()=>++calls===1?response(caps):response({private:'DO_NOT_ECHO'},status)}), e=>!e.message.includes('DO_NOT_ECHO'));assert.equal(calls,2);
});
test('oversize capability response rejected before PDF submission',async()=>{
  let calls=0;await assert.rejects(executeLocalDesign({...args(),fetcher:async()=>{calls++;return response({data:'x'.repeat(2001)});}}));assert.equal(calls,1);
});
test('aborted requests propagate and are never retried',async()=>{
  const controller=new AbortController();controller.abort();let calls=0;
  await assert.rejects(executeLocalDesign({...args(),signal:controller.signal,fetcher:async(_,o)=>{calls++;o.signal.throwIfAborted();}}));assert.equal(calls,1);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {readScoutReceipt,readScoutStream} from '../src/evidence-scout.ts';
const study={nct_id:'NCT00000001',title:'MOC transport fixture',url:'https://clinicaltrials.gov/study/NCT00000001',conditions:['MOC'],phases:[],status:'UNKNOWN',updated:null,sponsor:null,enrollment:null,interventions:[],arms:[],primary_outcomes:[],results_available:false,documents:[]};
const receipt={id:'00000000-0000-4000-8000-000000000001',query:'MOC',created_at:'2026-09-15T00:00:00Z',digest:'a'.repeat(64),total_count:1,fetched_count:1,truncated:false,studies:[study],mode:'LIVE_PUBLIC',clinical_verified:false};
const events=()=>[{stage:'SEARCHING'},{stage:'COLLECTED'},{stage:'SAVING'},{stage:'COMPLETE',receipt}];
const response=es=>new Response(es.map(e=>JSON.stringify(e)+'\n').join(''));
test('strict transport accepts expected sequence and public receipt; no model',async()=>{const seen=[];assert.deepEqual(JSON.parse(JSON.stringify(await readScoutStream(response(events()),'MOC',e=>seen.push(e.stage)))),receipt);assert.equal(seen.length,4);});
test('chunked multibyte stream is reassembled',async()=>{const r=structuredClone(receipt);r.studies[0].title='합성 시험';const es=events();es[3].receipt=r;const bytes=new TextEncoder().encode(es.map(e=>JSON.stringify(e)+'\n').join(''));const res=new Response(new ReadableStream({start(c){for(const b of bytes)c.enqueue(Uint8Array.of(b));c.close();}}));assert.equal((await readScoutStream(res,'MOC',()=>{})).studies[0].title,'합성 시험');});
for(const [label,mutate] of [
 ['unsafe source link',r=>r.studies[0].url='https://evil.invalid'],
 ['invented verification',r=>r.clinical_verified=true],
 ['wrong count',r=>r.fetched_count=2],
 ['hidden truncation',r=>r.total_count=20],
 ['malformed condition',r=>r.studies[0].conditions=[{}]],
 ['malformed date',r=>r.created_at='unknown'],
 ['negative enrollment',r=>r.studies[0].enrollment={count:-1,type:'ACTUAL'}],
 ['duplicate studies',r=>{r.studies.push({...r.studies[0]});r.fetched_count=2;r.total_count=2;}],
]) test(`reject ${label}`,()=>{const r=structuredClone(receipt);mutate(r);assert.throws(()=>readScoutReceipt(r));});
test('empty genuine result is allowed',()=>{assert.equal(readScoutReceipt({...receipt,studies:[],total_count:0,fetched_count:0}).studies.length,0);});
test('partial/duplicate/out-of-order/failure/trailing streams reject',async()=>{for(const es of [events().slice(0,2),[events()[0],...events()],events().reverse(),[{stage:'ERROR',message:'secret'}]])await assert.rejects(readScoutStream(response(es),'MOC',()=>{}));await assert.rejects(readScoutStream(new Response(events().map(e=>JSON.stringify(e)+'\n').join('')+'bad'),'MOC',()=>{}));});
test('receipt from another query rejects',async()=>{await assert.rejects(readScoutStream(response(events()),'different',()=>{}),/검색어/);});
test('total transport size bounded even with no newlines',async()=>{await assert.rejects(readScoutStream(new Response('x'.repeat(5_000_001)),'MOC',()=>{}),/너무 큽니다/);});
test('exact NCT query cannot silently bind a different study; lowercase and genuine empty are valid',()=>{
 assert.equal(readScoutReceipt({...receipt,query:'nct00000001'}).studies[0].nct_id,'NCT00000001');
 assert.throws(()=>readScoutReceipt({...receipt,query:'NCT00000002'}));
 assert.equal(readScoutReceipt({...receipt,query:'NCT00000002',studies:[],total_count:0,fetched_count:0}).studies.length,0);
});
test('scout stream rejects duplicate keys, prototype keys and nonfinite numbers before exposing events',async()=>{
 for(const raw of ['{"stage":"ERROR","stage":"SEARCHING"}','{"stage":"SEARCHING","__proto__":{}}','{"stage":"SEARCHING","count":1e400}']){
  const seen=[];await assert.rejects(readScoutStream(new Response(raw+'\n'),'MOC',e=>seen.push(e)));assert.equal(seen.length,0);
 }
});
test('actual TEAM scout stream and saved receipt roundtrip with synthetic public response and zero models',async()=>{
 const result=spawnSync('.venv/bin/python',['-c',`
import json,tempfile
from pathlib import Path
from pytest import MonkeyPatch
from fastapi.testclient import TestClient
from test_evidence_scout import data
from test_team_auth import make_team_app,login,ORIGIN
from test_project_acl import headers
payload=data.__wrapped__()
payload['totalCount']=1
payload.pop('nextPageToken')
calls=[]
async def fetch(query):
 calls.append(query)
 return payload
with tempfile.TemporaryDirectory(prefix='trialboard-scout-contract-') as directory:
 with MonkeyPatch.context() as patch:
  patch.setattr('trialboard.api.scout.fetch_registry',fetch)
  app,_,_=make_team_app(Path(directory),enable_evidence_scout=True)
  with TestClient(app,base_url=ORIGIN) as client:
   login(client)
   stream=client.post('/api/evidence-scout/search',json={'query':'NCT00000001','public_query_confirmed':True},headers=headers(client))
   assert stream.status_code==200,stream.text
   receipt=json.loads(stream.text.splitlines()[-1])['receipt']
   saved=client.get('/api/evidence-scout/searches/'+receipt['id'])
   assert saved.status_code==200,saved.text
   assert calls==['NCT00000001']
   print(json.dumps({'stream':stream.text,'saved':saved.json()}))
`],{env:{...process.env,PYTHONPATH:'tests:.'},encoding:'utf8',timeout:30000,maxBuffer:1000000});
 assert.equal(result.status,0,result.stderr);const data=JSON.parse(result.stdout),seen=[];
 const streamed=await readScoutStream(new Response(data.stream),'NCT00000001',e=>seen.push(e.stage)),saved=readScoutReceipt(data.saved);
 assert.deepEqual(JSON.parse(JSON.stringify(streamed)),saved);assert.deepEqual(seen,['SEARCHING','COLLECTED','SAVING','COMPLETE']);
 assert.equal(saved.studies[0].nct_id,'NCT00000001');assert.equal(saved.clinical_verified,false);
});

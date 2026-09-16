import test from 'node:test';
import assert from 'node:assert/strict';
import {readScoutReceipt,readScoutStream} from '../src/evidence-scout.ts';
const study={nct_id:'NCT00000001',title:'MOC transport fixture',url:'https://clinicaltrials.gov/study/NCT00000001',conditions:['MOC'],phases:[],status:'UNKNOWN',updated:null,sponsor:null,enrollment:null,interventions:[],arms:[],primary_outcomes:[],results_available:false,documents:[]};
const receipt={id:'00000000-0000-4000-8000-000000000001',query:'MOC',created_at:'2026-09-15T00:00:00Z',digest:'a'.repeat(64),total_count:1,fetched_count:1,truncated:false,studies:[study],mode:'LIVE_PUBLIC',clinical_verified:false};
const events=()=>[{stage:'SEARCHING'},{stage:'COLLECTED'},{stage:'SAVING'},{stage:'COMPLETE',receipt}];
const response=es=>new Response(es.map(e=>JSON.stringify(e)+'\n').join(''));
test('strict transport accepts expected sequence and public receipt; no model',async()=>{const seen=[];assert.deepEqual(await readScoutStream(response(events()),'MOC',e=>seen.push(e.stage)),receipt);assert.equal(seen.length,4);});
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

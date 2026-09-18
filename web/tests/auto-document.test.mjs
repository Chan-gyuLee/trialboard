import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync,existsSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {prepareAutoDocument,autoDocumentCandidates} from '../src/auto-document.ts';
import {openPdfSession} from '../src/pdf-session.ts';
const bytes=new TextEncoder().encode('%PDF-1.7\nMOC synthetic parser input');
const hash=createHash('sha256').update(bytes).digest('hex');
const source=(patch={})=>({id:'doc_1',kind:'SAP',content_level:'PDF_AVAILABLE',url:'https://cdn.clinicaltrials.gov/large-docs/01/NCT00000001/SAP_001.pdf',pdf_url:'https://cdn.clinicaltrials.gov/large-docs/01/NCT00000001/SAP_001.pdf',identifiers:{nct:'NCT00000001'},link_basis:['REGISTRY_DOCUMENT'],published:'2020-01-01',...patch});
const result=(sources=[source()])=>({collection:{id:'00000000-0000-4000-8000-000000000001',request:{asset:'MOCdrug',nct_id:'NCT00000001',indication:'MOC tumor'},sources}});
const response=()=>new Response(bytes,{headers:{'Content-Type':'application/pdf','X-Source-Sha256':hash}});
const pdfSource=()=>({schemaVersion:'pdf-evidence/1',name:'MOC.pdf',byteLength:bytes.length,sha256:hash,extractor:'MOC',coordinateSystem:'normalized_top_left_rotated_viewport',status:'TEXT_EXTRACTED',pages:[{number:1,width:100,height:100,rotation:0,status:'TEXT_EXTRACTED',spans:[{id:'p1-i0',page:1,item:0,text:'MOCdrug 10 mg synthetic dose',box:{x:0,y:0,width:.5,height:.1}},{id:'p1-i1',page:1,item:1,text:'MOC adverse events',box:{x:0,y:.1,width:.5,height:.1}}]}]});
function fake(){const calls=[],events=[];let destroyed=0;return {calls,events,get destroyed(){return destroyed;},fetch:async(path,options)=>{calls.push({path,...options});return response();},loader:async(file,signal,progress)=>{signal.throwIfAborted();progress(1);assert.equal(file.size,bytes.length);return {source:pdfSource(),destroy:async()=>{destroyed++;}};}};}
const signal=()=>new AbortController().signal;
test('MOC document is downloaded once, hash checked, prepared without model calls or attestations',async()=>{
 const f=fake(),r=await prepareAutoDocument(result(),true,signal(),m=>f.events.push(m),f.fetch,f.loader);
 assert.equal(r.status,'READY');assert.equal(f.calls.length,1);assert.match(f.calls[0].path,/documents\/doc_1$/);
 assert.equal(r.source.sha256,hash);assert.equal(r.input.asset,'MOCdrug');assert.equal(r.input.study,'NCT00000001');
 assert.ok(r.input.spans.every(s=>s.source_digest===hash&&s.locator===null));assert.equal(f.destroyed,1);
 assert.equal(r.input.provenance,'user_pdf_export_unverified');assert.ok(!JSON.stringify(r).includes('USER_ATTESTED'));
 assert.ok(f.events.some(m=>m.includes('추가 AI 요청')));
});
for(const [label,patch] of [
 ['other trial',{identifiers:{nct:'NCT00000002'}}],['regulatory',{kind:'REGULATORY'}],
 ['unlinked',{link_basis:['DRUG_SEARCH']}],['metadata',{content_level:'METADATA'}],
 ['arbitrary URL',{url:'https://evil.invalid/a.pdf',pdf_url:'https://evil.invalid/a.pdf'}],
 ['wrong path',{url:'https://cdn.clinicaltrials.gov/large-docs/02/NCT00000002/SAP_001.pdf',pdf_url:'https://cdn.clinicaltrials.gov/large-docs/02/NCT00000002/SAP_001.pdf'}],
])test(`MOC ${label} is not silently substituted`,async()=>{
 const f=fake(),r=await prepareAutoDocument(result([source(patch)]),true,signal(),()=>{},f.fetch,f.loader);
 assert.equal(r.status,'NO_DOCUMENT');assert.equal(f.calls.length,0);
});
test('MOC no consent or pre-cancel means no download',async()=>{
 const f=fake(),c=new AbortController();c.abort();
 await assert.rejects(prepareAutoDocument(result(),false,signal(),()=>{},f.fetch,f.loader));
 await assert.rejects(prepareAutoDocument(result(),true,c.signal,()=>{},f.fetch,f.loader));assert.equal(f.calls.length,0);
});
test('MOC failures try at most two distinct candidates, prefer SAP, and never retry the same one',async()=>{
 const docs=[source({id:'p',kind:'PROTOCOL'}),source({id:'s2'}),source({id:'s1'})];
 const f=fake();assert.deepEqual(autoDocumentCandidates(result(docs)).map(s=>s.id),['s1','s2']);
 const r=await prepareAutoDocument(result(docs),true,signal(),()=>{},async(...a)=>{f.calls.push(a);return new Response('',{status:422});},f.loader);
 assert.equal(r.status,'UNAVAILABLE');assert.equal(f.calls.length,2);assert.equal(r.attempts.length,2);assert.equal(f.destroyed,0);
});
test('MOC missing/mismatched hash and over-limit bytes never reach parser',async()=>{
 for(const res of [()=>new Response(bytes,{headers:{'Content-Type':'application/pdf'}}),()=>new Response(new Uint8Array(5_000_001),{headers:{'Content-Type':'application/pdf'}})]){
  const r=await prepareAutoDocument(result(),true,signal(),()=>{},async()=>res(),async()=>assert.fail('parser must not run'));
  assert.equal(r.status,'UNAVAILABLE');
 }
});
test('MOC no text candidates is not clinical extraction success and releases parser',async()=>{
 const f=fake(),r=await prepareAutoDocument(result(),true,signal(),()=>{},f.fetch,async()=>({source:{...pdfSource(),pages:[]},destroy:async()=>f.events.push('destroy')}));
 assert.equal(r.status,'UNAVAILABLE');assert.equal(r.attempts[0].status,'NO_CANDIDATES');assert.deepEqual(f.events,['destroy']);
});
test('MOC parser rejection reports unreadable without leaking error content',async()=>{
 const f=fake(),r=await prepareAutoDocument(result(),true,signal(),m=>f.events.push(m),f.fetch,async()=>{throw Error('private document contents');});
 assert.equal(r.attempts[0].status,'UNREADABLE');assert.ok(!JSON.stringify([r,f.events]).includes('private'));
});
test('MOC cancellation during parsing releases worker and prevents fallback or result',async()=>{
 const f=fake(),c=new AbortController();
 await assert.rejects(prepareAutoDocument(result([source(),source({id:'doc_2'})]),true,c.signal,()=>{},f.fetch,async(...args)=>{const out=await f.loader(...args);c.abort();return out;}));
 assert.equal(f.calls.length,1);assert.equal(f.destroyed,1);
});
test('MOC page limit is distinguished from generic parsing failure',async()=>{
 const f=fake(),r=await prepareAutoDocument(result(),true,signal(),()=>{},f.fetch,async()=>{throw Error('40페이지 이하 PDF만 지원합니다. 필요한 문서 범위를 별도로 준비해 주세요.');});
 assert.equal(r.attempts[0].status,'PAGE_LIMIT');
});
const pinned=new URL('../../data/snapshots/2a8afcae85c9e37576979af49571a1f87a2baa00aff6c4f43270b00ec20da9d9.pdf',import.meta.url);
test('MOC route with pinned real PDF exercises download-to-parser-to-input, not clinical linkage',{skip:!existsSync(pinned)},async()=>{
 const {getDocument,version}=await import('pdfjs-dist/legacy/build/pdf.mjs');
 const raw=readFileSync(pinned),digest=createHash('sha256').update(raw).digest('hex');
 const loader=(file,s,p)=>openPdfSession(file,s,p,opts=>getDocument({...opts,standardFontDataUrl:fileURLToPath(new URL('../node_modules/pdfjs-dist/standard_fonts/',import.meta.url))}),version);
 const out=await prepareAutoDocument(result(),true,signal(),()=>{},async()=>new Response(raw,{headers:{'Content-Type':'application/pdf','X-Source-Sha256':digest}}),loader);
 assert.equal(out.status,'READY');assert.equal(out.source.sha256,digest);assert.ok(out.candidates.length<=3&&out.candidates.length>0);
 assert.ok(out.input.spans.length<=40);assert.ok(out.input.spans.every(s=>s.source_digest===digest));
});

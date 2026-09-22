import test from 'node:test';
import assert from 'node:assert/strict';
import {parsePageRange} from '../src/pdf-page-range.ts';
import {openPdfSession} from '../src/pdf-session.ts';
test('explicit page ranges sort and deduplicate without changing original page numbers',()=>{
 assert.deepEqual(parsePageRange(' 35, 19-22, 33, 20 ',51),{totalPages:51,pageNumbers:[19,20,21,22,33,35]});
});
for(const raw of ['', ' ', '0','52','-1','35-33','33.5','33;35','1-200','1,','all','33–35','1e2','a'.repeat(501)])test(`invalid page range is never silently repaired: ${JSON.stringify(raw).slice(0,30)}`,()=>assert.throws(()=>parsePageRange(raw,51)));
test('invalid total pages rejected and exact 40-page boundary supported',()=>{
 assert.throws(()=>parsePageRange('1',201));assert.equal(parsePageRange('1-40',200).pageNumbers.length,40);
});
function parser(numPages){
 const read=[];let destroyed=0;const task={destroy:async()=>{destroyed++;}};
 task.promise=Promise.resolve({numPages,loadingTask:task,getPage:async n=>{read.push(n);return {getViewport:()=>({width:100,height:100,rotation:0,transform:[1,0,0,-1,0,100]}),getTextContent:async()=>({items:[],styles:{}}),cleanup(){}};}});
 return {read,create:()=>task,destroyed:()=>destroyed};
}
test('review loader retains legacy short-PDF source contract',async()=>{
 const p=parser(2),loaded=await openPdfSession(new File(['%PDF-test'],'MOC.pdf'),new AbortController().signal,()=>{},p.create,'test',1000,'review');
 assert.equal(loaded.source.schemaVersion,'pdf-evidence/1');assert.equal(loaded.coverage,undefined);assert.equal(loaded.source.status,'NO_TEXT');await loaded.destroy();
});
test('long review scans actual pages, discloses no-text pages and keeps bounded original numbers',async()=>{
 const p=parser(51),loaded=await openPdfSession(new File(['%PDF-test'],'MOC.pdf'),new AbortController().signal,()=>{},p.create,'test',1000,'review');
 assert.equal(loaded.source.schemaVersion,'pdf-evidence-selected/1');assert.equal(loaded.source.totalPages,51);assert.equal(loaded.source.pages.length,40);
 assert.equal(p.read.length,51);assert.equal(loaded.coverage.noTextPages.length,51);assert.equal(loaded.coverage.clinicalReview,'NOT_PERFORMED');assert.equal(loaded.source.status,'NO_TEXT');await loaded.destroy();
});
test('overlong review is rejected before page extraction and worker is released',async()=>{
 const p=parser(201);await assert.rejects(openPdfSession(new File(['%PDF-test'],'MOC.pdf'),new AbortController().signal,()=>{},p.create,'test',1000,'review'),/200쪽/);
 assert.deepEqual(p.read,[]);assert.equal(p.destroyed(),1);
});
test('long review cancellation does not publish a partially scanned source',async()=>{
 const p=parser(51),c=new AbortController();await assert.rejects(openPdfSession(new File(['%PDF-test'],'MOC.pdf'),c.signal,n=>{if(n===12)c.abort();},p.create,'test',1000,'review'),{name:'AbortError'});
 assert.ok(p.destroyed()>=1);
});

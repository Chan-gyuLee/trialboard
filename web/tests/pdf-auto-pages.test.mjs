import test from 'node:test';
import assert from 'node:assert/strict';
import {extractAutoPages} from '../src/pdf-auto-pages.ts';
import {extractPages} from '../src/pdf-extract.ts';
import {openPdfSession} from '../src/pdf-session.ts';
const signal=()=>new AbortController().signal;
function fixture(total,content=n=>n===total?'Dose 240 mg safety objective response population statistical':'MOC background'){
 const read=[],cleaned=[];
 const pdf={numPages:total,getPage:async n=>{read.push(n);return {
  getViewport:()=>({width:100,height:100,rotation:0,transform:[1,0,0,-1,0,100]}),
  getTextContent:async()=>({items:content(n)===null?[]:[{str:content(n),fontName:'f',dir:'ltr',width:50,transform:[10,0,0,10,10,50]}],styles:{f:{ascent:.8}}}),
  cleanup:()=>cleaned.push(n),
 };}};return {pdf,read,cleaned};
}
test('MOC 123-page scan selects late relevant page without renumbering or claiming review',async()=>{
 const f=fixture(123),progress=[],r=await extractAutoPages(f.pdf,n=>progress.push(n),signal());
 assert.equal(r.pages.length,40);assert.ok(r.pages.some(p=>p.number===123));
 assert.equal(r.pages.at(-1).spans[0].id,'p123-i0');assert.equal(r.pages.at(-1).spans[0].page,123);
 assert.equal(r.coverage.totalPages,123);assert.equal(r.coverage.scannedPages.length,123);
 assert.equal(r.coverage.omittedPages.length,83);assert.equal(r.coverage.clinicalReview,'NOT_PERFORMED');
 assert.equal(r.coverage.selection.at(-1).score,5);assert.deepEqual(f.read,progress);assert.deepEqual(f.read,f.cleaned);
 assert.deepEqual([...r.coverage.retainedPages,...r.coverage.omittedPages].sort((a,b)=>a-b),f.read);
});
test('MOC short document keeps original pages, including explicit empty text coverage',async()=>{
 const f=fixture(3,n=>n===2?null:'MOC dose'),r=await extractAutoPages(f.pdf,()=>{},signal());
 assert.deepEqual(r.coverage.retainedPages,[1,2,3]);assert.deepEqual(r.coverage.noTextPages,[2]);assert.deepEqual(r.coverage.omittedPages,[]);
});
test('MOC manual path still rejects long documents; selected path validates identity',async()=>{
 const f=fixture(43);await assert.rejects(extractPages(f.pdf),/40페이지/);
 for(const pages of [[0],[44],[2,1],[1,1],[1.5],[],Array.from({length:41},(_,i)=>i+1)])await assert.rejects(extractPages(f.pdf,()=>{},signal(),pages));
 assert.equal(f.read.length,0);
 const r=await extractPages(f.pdf,()=>{},signal(),[42,43]);assert.deepEqual(r.map(p=>p.number),[42,43]);
});
test('MOC invalid/over-200-page PDFs rejected before reading; 200 is supported',async()=>{
 for(const count of [0,201,NaN,1.5]){const f=fixture(count);await assert.rejects(extractAutoPages(f.pdf,()=>{},signal()),/AUTO_PDF_PAGE_LIMIT/);assert.equal(f.read.length,0);}
 const r=await extractAutoPages(fixture(200).pdf,()=>{},signal());assert.equal(r.coverage.scannedPages.length,200);
});
test('MOC cancellation stops before next page and cleans current page',async()=>{
 const f=fixture(123),c=new AbortController();
 await assert.rejects(extractAutoPages(f.pdf,n=>{if(n===2)c.abort();},c.signal),{name:'AbortError'});
 assert.deepEqual(f.read,[1,2]);assert.deepEqual(f.cleaned,[1,2]);
});
test('MOC cumulative text budget rejects instead of publishing partial success',async()=>{
 const f=fixture(100,()=> 'x'.repeat(15000));
 await assert.rejects(extractAutoPages(f.pdf,()=>{},signal()),/AUTO_PDF_SCAN_LIMIT/);
 assert.equal(f.read.length,70);assert.deepEqual(f.read,f.cleaned);
});
test('MOC retained text obeys prior 250k budget and omitted coverage is explicit',async()=>{
 const r=await extractAutoPages(fixture(43,()=> 'x'.repeat(15000)).pdf,()=>{},signal());
 assert.equal(r.pages.length,16);assert.equal(r.coverage.omittedPages.length,27);
 assert.ok(r.pages.flatMap(p=>p.spans).reduce((n,s)=>n+s.text.length,0)<=250000);
});
test('MOC page cleanup also happens when page extraction fails',async()=>{
 const f=fixture(1,()=> 'x'.repeat(250001));await assert.rejects(extractAutoPages(f.pdf,()=>{},signal()));
 assert.deepEqual(f.cleaned,[1]);
});
test('MOC session auto mode carries coverage and exact original byte hash',async()=>{
 const f=fixture(43);let destroyed=0;
 const task={promise:Promise.resolve(f.pdf),destroy:async()=>{destroyed++;}};f.pdf.loadingTask=task;
 const r=await openPdfSession(new File(['%PDF-1.7\nMOC'],'MOC.pdf'),signal(),()=>{},()=>task,'MOC',20000,'auto');
 assert.equal(r.source.schemaVersion,'pdf-evidence-window/1');
 assert.equal(r.coverage.totalPages,43);assert.equal(r.source.pages.at(-1).number,43);assert.match(r.source.sha256,/^[a-f0-9]{64}$/);
 await r.destroy();assert.equal(destroyed,1);
});

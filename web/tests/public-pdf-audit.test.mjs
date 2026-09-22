/** Optional pinned public file integration. No download, model call, or answer injection. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {extractAutoPages} from '../src/pdf-auto-pages.ts';
import {extractPages} from '../src/pdf-extract.ts';
import {pdfCandidates} from '../src/pdf-candidates.ts';
const manifest=JSON.parse(readFileSync(new URL('../../tests/fixtures/fda-codebreak200-audit.json',import.meta.url),'utf8'));
const file=process.env.TRIALBOARD_PUBLIC_AUDIT_PDF;
test('pinned FDA file: visible result tables without a text layer cannot become invented observations',{skip:!file},async()=>{
 const bytes=readFileSync(file);assert.equal(createHash('sha256').update(bytes).digest('hex'),manifest.sha256);
 assert.equal(bytes.length,manifest.bytes);
 const {getDocument}=await import('pdfjs-dist/legacy/build/pdf.mjs');
 const task=getDocument({data:new Uint8Array(bytes),verbosity:0,useSystemFonts:false});
 const pdf=await task.promise;
 try{
  assert.equal(pdf.numPages,51);
  const pages=await extractPages(pdf,()=>{},new AbortController().signal,[33,35]);
  assert.deepEqual(pages.map(p=>({number:p.number,status:p.status,count:p.spans.length})),[{number:33,status:'NO_TEXT',count:0},{number:35,status:'NO_TEXT',count:0}]);
  assert.deepEqual(pdfCandidates({pages},{asset:'sotorasib',study:'CodeBreaK 200',indication:'NSCLC',question:'dose comparison'}),[]);
  const scan=await extractAutoPages(pdf,()=>{},new AbortController().signal);
  assert.ok(scan.coverage.noTextPages.includes(33));assert.ok(scan.coverage.noTextPages.includes(35));
  assert.equal(scan.coverage.clinicalReview,'NOT_PERFORMED');assert.ok(scan.pages.length<=40);
 }finally{await task.destroy();}
});

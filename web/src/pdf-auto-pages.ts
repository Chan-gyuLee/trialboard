/** Bounded lexical scan, never an assertion that a document was clinically reviewed. */
import type {PDFDocumentProxy} from 'pdfjs-dist';
import {extractPages} from './pdf-extract.ts';
import {PDF_LIMITS, type PdfPage} from './pdf-contract.ts';

export type PdfCoverage = {
 policy:'lexical-pages/1'; totalPages:number; scannedPages:number[]; retainedPages:number[];
 omittedPages:number[]; noTextPages:number[]; clinicalReview:'NOT_PERFORMED';
 selection:{page:number;score:number;signals:string[]}[];
};
const rules:[string,RegExp][]=[
 ['용량·투여',/\b(?:\d+(?:\.\d+)?\s*mg|dose|dosage)\b|용량|투여량/i],
 ['안전성',/\b(?:safety|adverse events?|toxicity)\b|이상반응|독성/i],
 ['반응 평가',/\b(?:response rate|objective response|ORR|RECIST)\b|반응률/i],
 ['분석 집단',/\b(?:population|cohort|randomi[sz]|subgroup|analysis set)/i],
 ['통계 분석',/\b(?:statistical|sample size|confidence interval|estimand)\b/i],
];
export function pageSignals(page:PdfPage){
 const text=page.spans.map(s=>s.text).join(' ');
 const signals=rules.filter(([,re])=>re.test(text)).map(([label])=>label);
 // Presence, not repetitions: boilerplate must not win just by repeated keywords.
 return {page:page.number,score:signals.length,signals};
}
export async function extractAutoPages(pdf:PDFDocumentProxy,onProgress:(page:number)=>void,signal:AbortSignal){
 if(!Number.isInteger(pdf.numPages)||pdf.numPages<1||pdf.numPages>200)throw Error('AUTO_PDF_PAGE_LIMIT');
 let retained:PdfPage[]=[];const scannedPages:number[]=[],noTextPages:number[]=[];
 let items=0,characters=0;
 for(let start=1;start<=pdf.numPages;start+=10){
  signal.throwIfAborted();
  const numbers=Array.from({length:Math.min(10,pdf.numPages-start+1)},(_,i)=>start+i);
  const batch=await extractPages(pdf,onProgress,signal,numbers);
  signal.throwIfAborted();
  for(const page of batch){
   scannedPages.push(page.number);if(page.status==='NO_TEXT')noTextPages.push(page.number);
   items+=page.spans.length;characters+=page.spans.reduce((n,s)=>n+s.text.length,0);
  }
  if(items>80000||characters>1000000)throw Error('AUTO_PDF_SCAN_LIMIT');
  const ranked=[...retained,...batch].sort((a,b)=>pageSignals(b).score-pageSignals(a).score||a.number-b.number);
  let keptItems=0,keptCharacters=0;retained=[];
  for(const page of ranked){
   const count=page.spans.length,length=page.spans.reduce((n,s)=>n+s.text.length,0);
   if(retained.length>=PDF_LIMITS.pages||keptItems+count>PDF_LIMITS.items||keptCharacters+length>PDF_LIMITS.characters)continue;
   retained.push(page);keptItems+=count;keptCharacters+=length;
  }
 }
 retained.sort((a,b)=>a.number-b.number);
 const retainedPages=retained.map(p=>p.number),kept=new Set(retainedPages);
 const coverage:PdfCoverage={policy:'lexical-pages/1',totalPages:pdf.numPages,scannedPages,retainedPages,
  omittedPages:scannedPages.filter(p=>!kept.has(p)),noTextPages,clinicalReview:'NOT_PERFORMED',selection:retained.map(pageSignals)};
 return {pages:retained,coverage};
}

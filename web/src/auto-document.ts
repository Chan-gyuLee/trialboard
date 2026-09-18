/** Bounded public-document preparation. No model calls, claims, or human attestations. */
import {safeSourceUrl,type ResearchResult,type ResearchSource} from './research.ts';
import {validatePdfBytes,type PdfSource,type PdfWindowSource} from './pdf-contract.ts';
import {pdfCandidates,type PdfCandidate} from './pdf-candidates.ts';
import {pdfCandidateInput} from './pdf-agent.ts';
import type {LoadedPdf,LoadedWindowPdf} from './pdf-session.ts';
import type {PdfCoverage} from './pdf-auto-pages.ts';
export type DocumentAttempt={sourceId:string;status:'READY'|'UNAVAILABLE'|'UNREADABLE'|'PAGE_LIMIT'|'NO_CANDIDATES'};
export const documentAttemptLabel=(status:DocumentAttempt['status'])=>({READY:'추출 후보 준비',UNAVAILABLE:'다운로드·지문 확인 실패',UNREADABLE:'본문 읽기 실패·처리 한도 초과',PAGE_LIMIT:'PDF 페이지 처리 한도 초과',NO_CANDIDATES:'추출 후보 미확보'})[status];
export type AutoDocument={status:'READY'|'UNAVAILABLE'|'NO_DOCUMENT';attempts:DocumentAttempt[];sourceId?:string;source?:PdfSource|PdfWindowSource;coverage?:PdfCoverage;candidates?:PdfCandidate[];input?:ReturnType<typeof pdfCandidateInput>};
type Loader=(file:File,signal:AbortSignal,progress:(page:number)=>void)=>Promise<LoadedPdf|LoadedWindowPdf>;
const browserLoader:Loader=async(...args)=>(await import('./pdf-loader')).openAutoPdf(...args);
export function autoDocumentCandidates(result:ResearchResult):ResearchSource[]{
 const c=result.collection,nct=c.request.nct_id;
 return c.sources.filter(s=>['PROTOCOL','SAP'].includes(s.kind)&&s.content_level==='PDF_AVAILABLE'
  &&s.identifiers.nct===nct&&s.link_basis.includes('REGISTRY_DOCUMENT')&&s.pdf_url===s.url&&safeSourceUrl(s.url)
  &&new URL(s.url).hostname==='cdn.clinicaltrials.gov'&&new URL(s.url).pathname.startsWith(`/large-docs/${nct.slice(-2)}/${nct}/`))
  .sort((a,b)=>Number(b.kind==='SAP')-Number(a.kind==='SAP')||(b.published??'').localeCompare(a.published??'')||a.id.localeCompare(b.id)).slice(0,2);
}
async function readBytes(response:Response,signal:AbortSignal){
 if(!response.ok||!response.headers.get('content-type')?.startsWith('application/pdf')||!response.body)throw Error('DOCUMENT_UNAVAILABLE');
 const reader=response.body.getReader(),chunks:Uint8Array[]=[];let size=0;
 try{while(true){signal.throwIfAborted();const next=await reader.read();if(next.done)break;size+=next.value.length;if(size>5_000_000)throw Error('DOCUMENT_OVER_LIMIT');chunks.push(next.value);}}
 finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
 const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
 validatePdfBytes(bytes);
 const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');
 if(hash!==response.headers.get('X-Source-Sha256'))throw Error('DOCUMENT_HASH_MISMATCH');
 return {bytes,hash};
}
export async function prepareAutoDocument(result:ResearchResult,consent:boolean,signal:AbortSignal,onProgress:(message:string)=>void,fetcher:typeof fetch=fetch,loader:Loader=browserLoader):Promise<AutoDocument>{
 signal.throwIfAborted();if(consent!==true)throw Error('DOCUMENT_CONSENT_REQUIRED');
 const selected=autoDocumentCandidates(result),attempts:DocumentAttempt[]=[];
 if(!selected.length)return {status:'NO_DOCUMENT',attempts};
 const c=result.collection;
 for(const item of selected){
  signal.throwIfAborted();let loaded:LoadedPdf|LoadedWindowPdf|undefined,reading=false;
  const timeout=AbortSignal.timeout(55000),bounded=AbortSignal.any([signal,timeout]);
  onProgress(`${item.kind==='SAP'?'통계분석계획':'프로토콜'} 원문을 확보합니다. 최대 2개 문서 · 문서당 5MB/200페이지 탐색 · 최대 40페이지 보관.`);
  try{
   const response=await fetcher(`/api/research/runs/${encodeURIComponent(c.id)}/documents/${encodeURIComponent(item.id)}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({consent:true}),signal:bounded,credentials:'omit',redirect:'error'});
   const {bytes,hash}=await readBytes(response,bounded);bounded.throwIfAborted();reading=true;
   loaded=await loader(new File([bytes],`${item.id}.pdf`,{type:'application/pdf'}),bounded,page=>onProgress(`원문 ${page}페이지 텍스트 확인 중 · 임상 수치 검증 아님`));
   bounded.throwIfAborted();if(loaded.source.sha256!==hash)throw Error('PARSED_DOCUMENT_MISMATCH');
   const context={asset:c.request.asset,indication:c.request.indication,study:c.request.nct_id,question:'용량별 반응과 이상반응을 같은 조건에서 비교할 수 있는가?'};
   const candidates=pdfCandidates(loaded.source,context);
   let input:ReturnType<typeof pdfCandidateInput>|undefined;const ids:string[]=[];
   for(const candidate of candidates){
    try{const next=pdfCandidateInput(loaded.source,[...ids,candidate.spanId],context,2);ids.push(candidate.spanId);input=next;}catch{/* Keep bounded exact text; no synthetic replacement. */}
    if(ids.length===3)break;
   }
   if(!input){attempts.push({sourceId:item.id,status:'NO_CANDIDATES'});onProgress('읽을 수 있는 추출 후보가 없습니다. 확보한 원문과 조사 기록은 유지합니다.');continue;}
   attempts.push({sourceId:item.id,status:'READY'});
   onProgress(`원문 ${loaded.coverage?.totalPages??loaded.source.pages.length}페이지 중 ${loaded.source.pages.length}페이지 보관 · 추출 후보 ${ids.length}개 준비. 추가 AI 요청·임상 필드 추출은 아직 실행하지 않았습니다.`);
   return {status:'READY',attempts,sourceId:item.id,source:loaded.source,coverage:loaded.coverage,candidates:candidates.filter(x=>ids.includes(x.spanId)),input};
  }catch(error){
   signal.throwIfAborted();const status=reading&&error instanceof Error&&(error.message==='AUTO_PDF_PAGE_LIMIT'||error.message.startsWith('40페이지 이하 PDF만 지원합니다.'))?'PAGE_LIMIT':reading?'UNREADABLE':'UNAVAILABLE';
   attempts.push({sourceId:item.id,status});onProgress(`${documentAttemptLabel(status)} · 조사 기록은 보존하며 성공으로 처리하지 않습니다.`);
  }finally{await loaded?.destroy().catch(()=>{});}
 }
 return {status:'UNAVAILABLE',attempts};
}

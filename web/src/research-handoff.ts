/** Read-only handoff: saved report + exact cached PDF → unreviewed fields. */
import type {AutoResult} from './auto-review.ts';
import {loadAutoSaved,readAutoSaved} from './auto-extraction.ts';
import {canonical,importAgentReport,REVIEW_LIMITS} from './field-review.ts';
import {newDraft} from './design-brief.ts';
import {validatePdfBytes,validatePageSelection,PDF_LIMITS,type PdfPageSelection} from './pdf-contract.ts';
import type {LoadedPdf} from './pdf-session.ts';
import type {ScoutContext} from './evidence-scout.ts';
import type {RestoredProject} from './project-checkpoint.ts';

export type ResearchHandoff={token:string;done:AutoResult};
export function handoffAvailability(done:AutoResult):{ready:boolean;reason:string;observations:number}{
 const saved=done.automation,report=saved?.report;
 const observations=report?.attempts.at(-1)?.extraction?.observations.length??0;
 const no=(reason:string)=>({ready:false,reason,observations});
 if(!saved)return no('저장된 PDF 추출 결과가 없습니다. 공개 근거 목록에서 원문과 필요한 결과 자료를 확인하세요.');
 if(saved.status==='PLAN_DOCUMENT_SAVED')return no('계획 PDF만 저장했고 등록 결과표로 검토했습니다. 설계 제안에는 별도로 검토한 관측 근거가 필요합니다.');
 if(!report||!['REVIEW_REQUIRED','NEEDS_EVIDENCE'].includes(saved.status))return no('완료된 원문 추출 기록이 없습니다. 진행·실패 상태를 원문 처리 기록에서 확인하세요.');
 if(!observations)return no('PDF에서 검토 가능한 관측값을 추출하지 못했습니다. 결과표가 있는 원문을 추가로 확보하세요.');
 const pages=saved.document.coverage?.totalPages;
 if(!Number.isSafeInteger(pages)||!pages||pages<1)return no('원문 페이지 범위를 확인하지 못했습니다. 기록을 다시 확인하세요.');
 if(pages>PDF_LIMITS.documentPages)return no('원문 최대 200페이지 범위를 넘었습니다. 추출 기록은 유지되지만 직접 연결은 지원하지 않습니다.');
 if(pages>PDF_LIMITS.pages){try{
  const selected=saved.document.source!.pages.map(p=>p.number);
  validatePageSelection({totalPages:pages,pageNumbers:selected});
  if(canonical(selected)!==canonical(saved.document.coverage!.retainedPages))throw Error('범위 불일치');
 }catch{return no('저장된 선택 페이지 범위를 확인하지 못했습니다. 원문 처리 기록을 확인하세요.');}}
 if(!done.result.collection.sources.some(s=>s.id===saved.document.sourceId&&s.pdf_url))return no('추출 기록에 연결된 공개 PDF 출처를 찾지 못했습니다.');
 return {ready:true,observations,reason:(pages>PDF_LIMITS.pages?`전체 ${pages}쪽 중 저장된 ${saved.document.source!.pages.length}쪽을 원래 쪽수로 연결합니다. `:'저장된 원문과 추출값을 대조 화면으로 연결합니다. ')+'모든 필드는 미확인으로 시작하며 AI를 다시 호출하지 않습니다.'};
}
type Loader=(file:File,signal:AbortSignal,progress:(page:number)=>void,selection?:PdfPageSelection)=>Promise<LoadedPdf>;
export async function loadResearchHandoff(done:AutoResult,signal:AbortSignal,onProgress:(message:string)=>void,
 request:typeof fetch=fetch,loader:Loader=async(file,signal,progress,selection)=>{const m=await import('./pdf-loader');return selection?m.openSelectedPdf(file,signal,progress,selection):m.openPdf(file,signal,progress);}):
 Promise<{loaded:LoadedPdf;file:File;project:RestoredProject;context:ScoutContext}>{
 signal.throwIfAborted();
 const available=handoffAvailability(done);if(!available.ready)throw Error(available.reason);
 if(!/^[a-f\d-]{36}$/.test(done.result.collection.id))throw Error('조사 기록 식별자가 올바르지 않습니다.');
 onProgress('저장된 조사·추출 기록의 연결을 확인하고 있습니다.');
 const expected=await readAutoSaved(JSON.stringify(done.automation),done.result);
 const saved=await loadAutoSaved(done.result,signal,request);
 if(!saved||!expected||saved.digest!==expected.digest||saved.report?.run_id!==expected.report?.run_id||
   canonical(saved.report)!==canonical(expected.report))throw Error('저장된 추출 기록이 바뀌었습니다. 조사 결과를 다시 연 뒤 연결하세요.');
 const availableNow=handoffAvailability({...done,automation:saved});if(!availableNow.ready)throw Error(availableNow.reason);
 const document=saved.document,hash=document.source!.sha256,c=done.result.collection;
 if(!/^[a-f0-9]{64}$/.test(hash))throw Error('원문 지문을 확인하지 못했습니다.');
 signal.throwIfAborted();onProgress('이미 저장된 PDF를 읽고 파일 지문을 대조하고 있습니다.');
 const response=await request(`/api/research/runs/${encodeURIComponent(c.id)}/documents/${encodeURIComponent(document.sourceId!)}/cached?sha256=${hash}`,{signal,cache:'no-store',credentials:'omit',redirect:'error'});
 if(!response.ok||!response.body||!response.headers.get('content-type')?.startsWith('application/pdf'))throw Error('저장된 PDF를 읽지 못했습니다. 새 다운로드·AI 재실행은 하지 않았습니다.');
 const reader=response.body.getReader(),chunks:Uint8Array[]=[];let size=0;
 try{while(true){signal.throwIfAborted();const part=await reader.read();if(part.done)break;size+=part.value.length;if(size>5_000_000)throw Error('원문 크기 한도 초과');chunks.push(part.value);}}
 finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
 const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
 validatePdfBytes(bytes);
 const actual=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');
 if(actual!==hash||response.headers.get('X-Source-Sha256')!==hash||size!==document.source!.byteLength)throw Error('추출 기록과 저장된 PDF 버전이 다릅니다. 기존 검토는 유지됩니다.');
 const file=new File([bytes],`${document.sourceId}.pdf`,{type:'application/pdf'});let loaded:LoadedPdf|null=null;
 try{
  const totalPages=document.coverage!.totalPages;
  const selection=totalPages>PDF_LIMITS.pages?{totalPages,pageNumbers:document.source!.pages.map(p=>p.number)}:undefined;
  signal.throwIfAborted();loaded=await loader(file,signal,page=>onProgress(`저장 PDF 원문 ${page}/${totalPages}쪽의 문구를 다시 읽고 있습니다. AI 요청 없음.`),selection);
  signal.throwIfAborted();if(loaded.source.sha256!==hash)throw Error('열린 PDF 지문이 다릅니다.');
  if(selection&&(loaded.source.schemaVersion!=='pdf-evidence-selected/1'||loaded.source.totalPages!==totalPages||canonical(loaded.source.pages.map(p=>p.number))!==canonical(selection.pageNumbers)))throw Error('열린 PDF와 저장된 선택 페이지가 다릅니다.');
  onProgress('추출값의 원문 문구·페이지를 대조하고 미확인 검토를 준비합니다.');
  const agentRaw=JSON.stringify(saved.report);
  if(new TextEncoder().encode(agentRaw).length>REVIEW_LIMITS.bytes)throw Error('추출 기록이 검토 입력 한도를 초과합니다.');
  const review=await importAgentReport(agentRaw,loaded.source);
  signal.throwIfAborted();
  const draft=newDraft();draft.question=saved.report!.input.question;
  const context:ScoutContext={asset:c.request.asset,indication:c.request.indication,study:c.request.nct_id,question:draft.question,receiptId:c.request.search_id,
   document:{runId:c.id,sourceId:document.sourceId!,title:c.sources.find(s=>s.id===document.sourceId)!.title}};
  return {loaded,file,project:{review,draft,session:null,agentRaw},context};
 }catch(error){await loaded?.destroy().catch(()=>{});throw error;}
}

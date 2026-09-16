import { canonical, digest } from "./field-review.ts";
import { consumeAgentStream, isLocalDemo, type LiveProgress } from "./agent-live.ts";
import type { PdfSource, EvidenceNote } from "./pdf-contract.ts";
export type PdfAgentContext={asset:string;indication:string;study:string;question:string};
/** User selects text candidates without asserting a visual/clinical review. Never invent notes. */
export function pdfCandidateInput(source:PdfSource,spanIds:string[],context:PdfAgentContext,contextRadius:2|6=2){
 if(contextRadius!==2&&contextRadius!==6)throw Error("지원하지 않는 문맥 범위입니다.");
 if(Object.values(context).some(v=>!v.trim()||v.length>2000))throw Error("약물·적응증·시험·검토 질문을 입력하세요.");
 if(!spanIds.length||new Set(spanIds).size!==spanIds.length)throw Error("중복 없이 후보 문구를 선택하세요.");
 const selected=new Set<string>();
 for(const id of spanIds){
  const page=source.pages.find(p=>p.spans.some(s=>s.id===id)),i=page?.spans.findIndex(s=>s.id===id)??-1;
  if(!page||i<0||!page.spans[i].box)throw Error("현재 PDF에 없는 후보 문구입니다.");
  page.spans.slice(Math.max(0,i-contextRadius),i+contextRadius+1).forEach(s=>selected.add(s.id));
 }
 const spans=source.pages.flatMap(p=>p.spans).filter(s=>selected.has(s.id)).map(s=>({id:s.id,source_digest:source.sha256,page:s.page,text:s.text,locator:null}));
 if(!spans.length||spans.length>40||spans.some(s=>s.text.length>2000)||new TextEncoder().encode(spans.map(s=>s.text).join('')).length>24000)throw Error("선택 후보와 주변 문맥이 한도를 넘습니다. 후보를 줄여 주세요.");
 return {...context,spans,provenance:"user_pdf_export_unverified"};
}
export function pdfAgentInput(source:PdfSource,notes:EvidenceNote[],context:PdfAgentContext) {
 if(Object.values(context).some(v=>!v.trim() || v.length>2000)) throw new Error("약물·적응증·시험·검토 질문을 입력하세요.");
 if(!notes.length) throw new Error("먼저 원문에서 문구를 확인하고 메모를 남기세요.");
 const selected=new Set<string>();
 for(const note of notes) {
  const page=source.pages[note.page-1],i=page?.spans.findIndex(s=>s.id===note.spanId)??-1,span=page?.spans[i];
  if(!span || note.sourceDigest!==source.sha256 || note.quote!==span.text || canonical(note.box)!==canonical(span.box) || !span.box || note.locationStatus!=="USER_ATTESTED_VISUAL_MATCH" || note.meaningStatus!=="NOT_ASSESSED") throw new Error("원문 메모와 PDF 문구가 일치하지 않습니다.");
  page.spans.slice(Math.max(0,i-2),i+3).forEach(s=>selected.add(s.id));
 }
 const spans=source.pages.flatMap(p=>p.spans).filter(s=>selected.has(s.id)).map(s=>({id:s.id,source_digest:source.sha256,page:s.page,text:s.text,locator:null}));
 if(!spans.length || spans.length>40 || spans.some(s=>s.text.length>2000) || new TextEncoder().encode(spans.map(s=>s.text).join('')).length>24000) throw new Error("선택 문구와 앞뒤 문맥이 한도를 넘습니다. 원문 메모 범위를 줄여 주세요.");
 return {...context,spans,provenance:"user_pdf_export_unverified"};
}
export async function executePdfAgent(input:ReturnType<typeof pdfAgentInput>,consent:boolean,signal:AbortSignal,onProgress:(p:LiveProgress)=>void,location:Pick<Location,"hostname"|"port"|"protocol">=window.location,fetcher:typeof fetch=fetch) {
 if(!consent || !isLocalDemo(location)) throw new Error("로컬 화면에서 선택 문구의 모델 전송에 동의해야 합니다.");
 const body=JSON.stringify({input,consent:true});if(new TextEncoder().encode(body).length>32768) throw new Error("전송 요청이 32 KiB를 넘습니다. 문구 또는 질문 범위를 줄여 주세요.");
 const expected=await digest(canonical(input));
 const caps=await fetcher('/api/agent-demo/capabilities',{signal,cache:'no-store',credentials:'omit',redirect:'error'});
 if(!caps.ok) throw new Error("로컬 실행 설정을 확인하지 못했습니다.");
 const c=await caps.json();if(c.pdf_enabled!==true || c.provider!=="CODEX_CHATGPT" || c.persisted!==false || c.transport!=="LOOPBACK_ONLY") throw new Error("PDF 에이전트는 --enable-pdf-agent 옵션으로 별도 활성화해야 합니다. 아직 자료를 전송하지 않았습니다.");
 const response=await fetcher('/api/pdf-agent/run',{method:'POST',headers:{'Content-Type':'application/json'},body,signal,credentials:'omit',redirect:'error'});
 const report=await consumeAgentStream(response,'pdf',onProgress);
 if(report.input_digest!==expected) throw new Error("요청한 PDF 문구·질문과 실행 결과가 다릅니다.");
 return JSON.stringify(report,null,2);
}

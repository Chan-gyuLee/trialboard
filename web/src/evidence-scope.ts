/** Literal, review-bound scope audit. No clinical equivalence or probability inference. */
import {canonical,digest,exportReview,locate,type FieldReview,type FieldName,type Decision,type Citation} from './field-review.ts';
import type {PdfSource} from './pdf-contract.ts';
import type {ScoutContext} from './evidence-scout.ts';

export const SCOPE_FIELDS = ['study','indication','cohort','population','window','dose','metric','denominator','definition'] as const;
export const SCOPE_STATUS = {MISSING:'미보고',HELD:'사용자 보류',UNREVIEWED:'확인 전',INVALID_CITATION:'원문 연결 오류',RECORDED:'사용자 기록 있음'} as const;
export type ScopeCell={field:FieldName;value:string|null;decision:Decision;citation:Citation|null;status:keyof typeof SCOPE_STATUS};
export type ScopeRow={id:string;cells:ScopeCell[];ncts:string[];trialSignal:'NO_TARGET'|'NO_MENTION'|'SELECTED_MENTION'|'OTHER_MENTION'|'MULTIPLE_MENTIONS'};
/** Display-only selection for incomplete/restoring drafts; does not repair the draft. */
export function scopeSelection(review:FieldReview,selectedIds?:string[]){
 const known=new Set(review.rows.map(r=>r.id));
 return {ids:selectedIds===undefined?undefined:[...new Set(selectedIds)].filter(id=>known.has(id)),missingLinks:selectedIds?.filter(id=>!known.has(id)).length??0};
}
export function evidenceScope(review:FieldReview,source:PdfSource,context?:ScoutContext,selectedIds?:string[]){
  if(review.sourceDigest!==source.sha256)throw Error('적용 범위와 현재 PDF가 다릅니다.');
  const ids=selectedIds===undefined?review.rows.map(r=>r.id):selectedIds;
  if(new Set(ids).size!==ids.length||ids.some(id=>!review.rows.some(r=>r.id===id)))throw Error('적용 범위에 알 수 없거나 중복된 관측값이 있습니다.');
  const rows:ScopeRow[]=ids.map(id=>{
    const r=review.rows.find(r=>r.id===id)!;
    const cells:ScopeCell[]=SCOPE_FIELDS.map(field=>{
      const f=r.fields[field],{value,citation}=f.current;
      const status=f.decision==='held'?'HELD':!value?.trim()?'MISSING':!locate(source,citation)?.box||!citation?.quote.includes(value)?'INVALID_CITATION':f.decision==='unreviewed'?'UNREVIEWED':'RECORDED';
      return {field,value,decision:f.decision,citation:citation?{...citation}:null,status};
    });
    const study=cells[0];
    // Never use the search query, URL or unrelated PDF text to assert this observation's trial.
    const ncts=study.status==='INVALID_CITATION'?[]:[...new Set((study.value?.match(/(?<![A-Za-z0-9_])NCT\d{8}(?![A-Za-z0-9_])/gi)??[]).map(n=>n.toUpperCase()))].sort();
    const trialSignal=!context?'NO_TARGET':!ncts.length?'NO_MENTION':ncts.length>1?'MULTIPLE_MENTIONS':ncts[0]===context.study?'SELECTED_MENTION':'OTHER_MENTION';
    return {id,cells,ncts,trialSignal};
  });
  const differences=(['study','indication','cohort','population','window','definition'] as const).flatMap(field=>{
    const groups=new Map<string,string[]>();
    for(const row of rows){const cell=row.cells.find(c=>c.field===field)!;if(cell.value!==null){const key=cell.value;groups.set(key,[...(groups.get(key)??[]),row.id]);}}
    return groups.size>1?[{field,groups:[...groups].map(([value,observationIds])=>({value,observationIds}))}]:[];
  });
  return {schema:'evidence-scope-audit/1' as const,sourceDigest:source.sha256,context:context?structuredClone(context):null,clinicalApproval:false as const,method:'LITERAL_REVIEW_SCOPE/1' as const,rows,differences,
    unresolvedCells:rows.flatMap(r=>r.cells).filter(c=>c.status!=='RECORDED').length,
    questions:['같은 시험 번호라도 암종·치료 차수·용량 코호트와 실제 분석 대상이 일치하는가?',
      '평가 기간과 자료마감일은 같은 개념이 아니다. 각 결과의 자료마감일·추적기간은 원문에서 확인했는가?',
      '반응과 안전성의 분모·분석집단 차이가 의도된 것인가? 통합 분석의 환자 중복은 없는가?',
      '표현이 다른 이유가 동의어인지 실제 집단·시점 차이인지 원문과 임상·통계 검토로 확인했는가?']};
}
export type EvidenceScope=ReturnType<typeof evidenceScope>;
export async function scopePacket(review:FieldReview,source:PdfSource,context?:ScoutContext,selectedIds?:string[]){
  return {...evidenceScope(review,source,context,selectedIds),reviewDigest:await digest(canonical(exportReview(review,source))),sourceName:source.name};
}
const escape=(s:string)=>s.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replace(/([\\`*_{}\[\]()#+.!|~-])/g,'\\$1').replace(/[\r\n]+/g,' ');
export function scopeMarkdown(a:EvidenceScope):string{
  return ['## 관측값 적용 범위 대조','문구·사용자 기록의 대조이며 임상적 동등성 판정이 아닙니다. 확인되지 않은 항목을 자동 보완하거나 계산 차단을 해제하지 않습니다.',
    `PDF SHA-256: ${a.sourceDigest}`,a.context?`수집에서 선택한 시험: ${escape(a.context.study)} / 약물: ${escape(a.context.asset)} / 수집 ID: ${escape(a.context.receiptId)}`:'수집 맥락 미연결 · 수동 PDF',
    ...(a.context?.document?[`수집 문서: ${escape(a.context.document.title)} / 조사 ID: ${escape(a.context.document.runId)} / 출처 ID: ${escape(a.context.document.sourceId)}`]:[]),
    ...a.rows.flatMap(r=>[`### ${escape(r.id)}`,...r.cells.map(c=>`- ${c.field}: ${escape(c.value??'미보고')} · ${SCOPE_STATUS[c.status]}${c.citation?` · p.${c.citation.page} · ${escape(c.citation.spanId)} · “${escape(c.citation.quote)}”`:''}`)]),
    '### 관측값 간 다른 표현 · 불일치 확정 아님',...a.differences.map(d=>`- ${d.field}: ${d.groups.map(g=>`${escape(g.value)} [${g.observationIds.map(escape).join(', ')}]`).join(' / ')}`),
    '### 추가 확인 질문',...a.questions.map(q=>`- ${q}`)].join('\n\n');
}

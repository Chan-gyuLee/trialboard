import {useMemo,useState} from 'react';
import {Alert,Button,Chip} from '@mui/material';
import {FIELD_LABELS,type FieldReview,type FieldName} from './field-review';
import type {PdfSource} from './pdf-contract';
import type {ScoutContext} from './evidence-scout';
import {evidenceScope,scopePacket,scopeMarkdown,scopeSelection,SCOPE_FIELDS,SCOPE_STATUS} from './evidence-scope';
import {downloadText} from './review';
import './evidence-scope.css';

export default function EvidenceScopePanel({review,source,context,selectedIds,disabled,onSelect}:{review:FieldReview;source:PdfSource;context?:ScoutContext;selectedIds?:string[];disabled:boolean;onSelect:(row:string,field:FieldName)=>void}){
  // A restored/partially edited draft can briefly point at rows not yet installed.
  // Show valid current links only; never crash the entire PDF workspace.
  const {ids:selected,missingLinks}=useMemo(()=>scopeSelection(review,selectedIds),[selectedIds,review]);
  const audit=useMemo(()=>review.sourceDigest===source.sha256?evidenceScope(review,source,context,selected):null,[review,source,context,selected]);
  const [error,setError]=useState('');
  async function save(){try{const packet=await scopePacket(review,source,context,selected);downloadText('trialboard-evidence-scope.json',JSON.stringify(packet,null,2),'application/json');}catch(e){setError(e instanceof Error?e.message:'저장하지 못했습니다.');}}
  if(!audit)return <Alert severity="info">현재 PDF의 필드 검토를 연결하고 있습니다. 대조표는 같은 원문 지문의 기록만 표시합니다.</Alert>;
  return <section className="evidence-scope" aria-label="관측값 적용 범위 대조">
    <div className="scope-heading"><div><span className="document-kicker">EVIDENCE SCOPE</span><h3>같은 조건의 결과를 비교하고 있나요?</h3><p>시험 · 환자군 · 분석집단 · 시점을 가로로 대조하세요. 값을 누르면 해당 원문 필드로 돌아갑니다.</p></div><Button disabled={disabled} onClick={()=>void save()}>적용 범위 JSON</Button></div>
    {context&&<p>수집에서 선택한 시험: <strong>{context.study}</strong> · {context.asset}. 아래 원문 값과 자동으로 동일시하지 않습니다.</p>}
    {selectedIds!==undefined&&<p>설계에 연결한 관측값만 표시합니다. 미선택·알 수 없는 연결 {missingLinks}개는 제외되어 있으며 설계 입력에서 확인하세요.</p>}
    <div className="scope-summary"><Chip variant="outlined" label={`관측값 ${audit.rows.length}개`}/><Chip variant="outlined" label={`미보고·확인 필요 ${audit.unresolvedCells}항목`}/><Chip variant="outlined" label={`표현 차이 ${audit.differences.length}항목`}/></div>
    <Alert severity="info">표현이 같아도 동일 코호트가 보장되지 않고, 달라도 임상적 불일치로 확정하지 않습니다. 치료 차수·자료마감일은 별도 원문 확인이 필요합니다. 사용자 기록은 전문가 승인이 아닙니다.</Alert>
    {!audit.rows.length?<p>관측값을 추출하거나 설계에 연결하면 대조표가 표시됩니다.</p>:<div className="scope-table" tabIndex={0} aria-label="가로로 이동 가능한 적용 범위 표"><table><caption>현재 필드 검토 기준 · 계산 승인표 아님</caption><thead><tr><th>적용 범위</th>{audit.rows.map(r=><th key={r.id}>{r.id}<span>{r.cells.find(c=>c.field==='dose')?.value??'용량 미보고'}</span>{['OTHER_MENTION','MULTIPLE_MENTIONS'].includes(r.trialSignal)&&<span className="scope-warning">다른/여러 NCT 언급 · 확인 필요</span>}</th>)}</tr></thead><tbody>{SCOPE_FIELDS.map(field=><tr key={field}><th>{FIELD_LABELS[field]}{audit.differences.some(d=>d.field===field)&&<span className="scope-warning">표현 차이 있음</span>}</th>{audit.rows.map(r=>{const c=r.cells.find(c=>c.field===field)!;return <td key={r.id}><Button disabled={disabled} onClick={()=>onSelect(r.id,field)} aria-label={`${r.id} ${FIELD_LABELS[field]} 원문 검토`}><strong>{c.value??'미보고'}</strong><span>{SCOPE_STATUS[c.status]}{c.citation?` · p.${c.citation.page}`:''}</span></Button></td>;})}</tr>)}</tbody></table></div>}
    <details><summary>비교 전 확인할 질문</summary><ul>{audit.questions.map(q=><li key={q}>{q}</li>)}</ul><Button disabled={disabled} onClick={()=>downloadText('trialboard-evidence-scope.md',scopeMarkdown(audit),'text/markdown;charset=utf-8')}>대조표·확인 질문 저장</Button></details>
    {error&&<Alert severity="error">{error}</Alert>}
  </section>;
}

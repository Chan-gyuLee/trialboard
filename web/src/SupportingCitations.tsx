import {useState} from 'react';
import {Alert,Button,MenuItem,TextField} from '@mui/material';
import {attachSupporting,locate,SUPPORT_ROLES,type SupportingCitation,type Value} from './field-review';
import type {PdfSource,PdfSpan} from './pdf-contract';

export default function SupportingCitations({source,value,selected,disabled,onChange,onChoose,onText}:{source:PdfSource;value:Value;selected:PdfSpan|null;disabled:boolean;onChange:(value:Value)=>void;onChoose:(span:PdfSpan)=>void;onText:()=>void}){
 const [role,setRole]=useState<SupportingCitation['role']>('header'),[error,setError]=useState('');
 const links=value.supporting??[];
 const attach=()=>{try{if(!selected)return;onChange(attachSupporting(source,value,selected,role));setError('');}catch(e){setError(e instanceof Error?e.message:'보조 근거를 연결하지 못했습니다.');}};
 return <section className="supporting-citations" aria-label="필드 보조 근거">
  <div><h4>한 줄로 부족한 근거를 함께 연결하세요</h4><p>기본 인용의 값을 유지하고 같은 페이지의 표 머리글·단위·각주를 최대 4개 연결합니다. 문구 관계는 사용자가 확인하며, 숫자에 단위를 자동으로 붙이지 않습니다.</p></div>
  {links.map((c,i)=><article key={c.spanId}><div className="field-toolbar"><strong>{SUPPORT_ROLES[c.role]} · PDF p.{c.page}</strong><Button disabled={disabled} onClick={()=>{const s=locate(source,c);if(s)onChoose(s);}}>{SUPPORT_ROLES[c.role]} 원문 보기</Button><Button disabled={disabled} onClick={()=>{const next={...value},remaining=links.filter((_,n)=>n!==i);if(remaining.length)next.supporting=remaining;else delete next.supporting;onChange(next);setError('');}}>{SUPPORT_ROLES[c.role]} 연결 제거</Button></div><blockquote>{c.quote}</blockquote></article>)}
  <div className="field-toolbar"><TextField select label="보조 근거 역할" value={role} disabled={disabled} onChange={e=>setRole(e.target.value as SupportingCitation['role'])}>{Object.entries(SUPPORT_ROLES).map(([key,label])=><MenuItem key={key} value={key}>{label}</MenuItem>)}</TextField><Button disabled={disabled} onClick={onText}>보조 문구 찾기</Button><Button variant="outlined" disabled={disabled||!value.citation||!value.value||!selected?.box||links.length>=4} onClick={attach}>선택 문구를 보조 근거로 추가</Button></div>
  <p>연결·제거는 아직 편집 중입니다. 기본 원문 위치로 돌아가 대조한 뒤 아래에서 사유와 함께 ‘수정값 기록’을 눌러 저장하세요.</p>
  {error&&<Alert severity="warning">{error}</Alert>}
 </section>;
}

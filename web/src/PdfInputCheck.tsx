import {useState} from 'react';
import {Alert,Button,Chip} from '@mui/material';
import {checkPdfInput,type SelectedInput} from './pdf-input-check';

export default function PdfInputCheck({input,disabled,onReveal}:{input:SelectedInput;disabled:boolean;onReveal:(id:string)=>void}){
 const check=checkPdfInput(input);const [open,setOpen]=useState(false);
 return <section className="pdf-input-check" aria-label="전송 전 원문 준비 점검">
  <div className="input-check-heading"><div><h3>전송 전에 빠진 문맥을 확인하세요</h3><p>선택한 {check.spanCount}문구 · 본문 {(check.textBytes/1024).toFixed(1)} KiB · 로컬 표현 검사</p></div><Button aria-expanded={open} onClick={()=>setOpen(v=>!v)}>{open?'점검 설명 접기':'점검 설명 보기'}</Button></div>
  <div className="input-check-chips">{check.checks.map(c=><Chip key={c.id} variant="outlined" label={`${c.label} · ${c.found?'표현 있음':'추가 확인'}`}/>)}</div>
  {check.ncts.length>1&&<Alert severity="warning">전송 문구에 여러 시험 번호가 있습니다: {check.ncts.join(', ')}. 서로 다른 시험 결과를 하나의 관측값으로 묶지 마세요.</Alert>}
  <p>문구가 있다는 표시일 뿐, 임상적 적합성이나 계산 가능성 점수가 아닙니다. 빠진 항목을 자동 생성하거나 실행을 승인하지 않습니다.</p>
  {open&&<div className="input-check-list">{check.checks.map(c=><article key={c.id}><h4>{c.label}</h4><p>{c.detail}</p>{c.spanIds.length>0&&<Button disabled={disabled} onClick={()=>onReveal(c.spanIds[0])}>{c.label} 원문 보기</Button>}</article>)}</div>}
 </section>;
}

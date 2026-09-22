import {useState} from 'react';
import {Alert,Button,TextField} from '@mui/material';
import type {PdfCoverage} from './pdf-auto-pages';
import type {PdfPageSelection,PdfSource} from './pdf-contract';
import {pdfTotalPages} from './pdf-contract';
import {parsePageRange} from './pdf-page-range';
import styles from './PdfScopeControl.module.css';

export default function PdfScopeControl({source,coverage,disabled,onSelect}:{source:PdfSource;coverage?:PdfCoverage;disabled:boolean;onSelect:(selection:PdfPageSelection)=>Promise<void>}){
 const [raw,setRaw]=useState(''),[error,setError]=useState('');
 const noText=coverage?.noTextPages??source.pages.filter(p=>p.status==='NO_TEXT').map(p=>p.number);
 const total=pdfTotalPages(source);
 async function select(){try{const selection=parsePageRange(raw,total);setError('');await onSelect(selection);}catch(e){setError(e instanceof Error?e.message:'검토 범위를 확인하세요.');}}
 return <section className={styles.scope} aria-label="원문 누락과 페이지 범위">
  {noText.length>0&&<Alert severity="warning"><strong>텍스트로 읽지 못한 {noText.length}쪽</strong><p>{coverage?'탐색한 문서':'현재 연결한 범위'}의 PDF {noText.join(', ')}쪽입니다. 빈 페이지·이미지·추출 실패일 수 있으며, 근거가 없다는 뜻은 아닙니다. OCR은 실행하지 않았습니다.</p></Alert>}
  <details><summary>다른 원문 페이지 검토하기</summary>
   <p>표·각주가 있는 페이지를 지정하세요. 새 범위로 시작하면 현재 메모·필드·설계·회의 편집을 교체합니다. 필요한 기록을 먼저 프로젝트로 저장하세요.</p>
   <div className={styles.form}><TextField size="small" label="검토할 원문 쪽수" placeholder="예: 19-22, 33, 35" value={raw} disabled={disabled} onChange={e=>{setRaw(e.target.value);setError('');}} error={!!error} helperText={error||`전체 ${total}쪽 · 한 번에 최대 40쪽 · 인쇄 쪽수와 다를 수 있음`} slotProps={{htmlInput:{maxLength:500}}}/><Button variant="outlined" disabled={disabled||!raw.trim()} onClick={()=>void select()}>새 범위로 검토 시작</Button></div>
   <small>현재 파일을 브라우저에서 다시 읽습니다. 새 다운로드·모델 전송·자동 확인은 하지 않습니다.</small>
  </details>
 </section>;
}

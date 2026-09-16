import {useState} from 'react';
import {Alert,Button,Checkbox,FormControlLabel,TextField} from '@mui/material';
import {FIELD_LABELS,FIELD_NAMES,type FieldReview} from './field-review';
import type {PdfSource} from './pdf-contract';
import {confirmRow,reviewableRow} from './row-review';
export default function RowReview({review,source,rowId,readyPage,disabled,onReview}:{review:FieldReview;source:PdfSource;rowId:string;readyPage:number|null;disabled:boolean;onReview:(r:FieldReview)=>void}){
 const [checked,setChecked]=useState(false),[reason,setReason]=useState(''),[error,setError]=useState('');
 const row=review.rows.find(r=>r.id===rowId);if(!row)return null;
 let blocked='';try{reviewableRow(review,source,rowId,readyPage);}catch(e){blocked=e instanceof Error?e.message:'개별 검토가 필요합니다.';}
 function save(){if(disabled)return;try{onReview(confirmRow(review,source,rowId,readyPage,reason,checked));setChecked(false);setReason('');setError('');}catch(e){setError(e instanceof Error?e.message:'확인하지 못했습니다.');}}
 return <details className="row-review"><summary>이 관측값 한눈에 검토 · 원문 값과 인용 대조</summary><p>오류가 있으면 아래 개별 필드에서 수정·보류하세요. 미보고 값은 채우지 않습니다.</p><div className="design-table-scroll"><table><caption>{rowId} · 사용자 확인 전 대조표</caption><thead><tr><th>항목</th><th>원문 값</th><th>연결 인용</th></tr></thead><tbody>{FIELD_NAMES.map(k=><tr key={k}><th>{FIELD_LABELS[k]}</th><td>{row.fields[k].current.value??'미보고 · 그대로 유지'}</td><td>{row.fields[k].current.citation?.quote??'인용 없음'}</td></tr>)}</tbody></table></div>
 {blocked&&<Alert severity="warning">{blocked}</Alert>}<TextField fullWidth label="관측값 확인 사유" value={reason} disabled={disabled} onChange={e=>{setReason(e.target.value);setChecked(false);}} slotProps={{htmlInput:{maxLength:2000}}}/><FormControlLabel control={<Checkbox checked={checked} disabled={disabled||!!blocked} onChange={e=>setChecked(e.target.checked)}/>} label="표의 모든 값·인용을 표시된 PDF 원문과 대조했습니다. 임상적 타당성을 승인하는 것은 아닙니다."/><Button variant="outlined" disabled={disabled||!!blocked||!checked||!reason.trim()} onClick={save}>이 관측값의 보고된 필드 확인</Button>{error&&<Alert severity="error">{error}</Alert>}</details>;
}

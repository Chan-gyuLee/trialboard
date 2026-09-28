import {Button} from '@mui/material';
import {ArrowRight} from 'lucide-react';
import {FIELD_LABELS,type FieldReview,type FieldName} from './field-review';
import type {PdfSource} from './pdf-contract';
import {reviewProgress} from './review-progress';
import styles from './ReviewProgress.module.css';
export default function ReviewProgress({review,source,disabled,onSelect,onDesign}:{review:FieldReview;source:PdfSource;disabled:boolean;onSelect:(id:string,name:FieldName)=>void;onDesign?:()=>void}){
 if(!review.rows.length)return null;
 const p=reviewProgress(review,source);
 return <section className={styles.panel} aria-label="근거 검토 진행 상황">
  <header><div><span>REVIEW CHECKPOINT</span><h3>{p.waiting?'확인할 값부터, 차례대로':p.held?'보류한 근거를 다시 확인하세요':'다음 검토 단계로 이어가세요'}</h3></div><span>{p.rows}개 관측 초안</span></header>
  <div className={styles.metrics}>{[['사용자 확인',p.checked],['미확인 값',p.waiting],['보류 필드',p.held],['미보고 필드',p.missing]].map(([label,count])=><div key={label}><span>{label}</span><strong>{count}</strong></div>)}</div>
  <details className={styles.scope}><summary>확인 기록 ≠ 임상 승인 · {p.noCitation>0?`원문 위치 확인 필요 ${p.noCitation}개`:'기록 범위 보기'}</summary><p>값이 있는 {p.reported}개 필드의 기록 상태입니다. 미보고 값은 채우지 않으며, 확인 기록이 임상 타당성이나 설계 준비 완료를 의미하지 않습니다.{p.noCitation>0?` 원문 위치 연결을 확인해야 하는 값 ${p.noCitation}개가 있습니다.`:''}</p></details>
  <div className={styles.actions}>{p.next&&<Button variant="contained" disabled={disabled} endIcon={<ArrowRight size={16}/>} onClick={()=>onSelect(p.next!.rowId,p.next!.field)}>{p.waiting?'다음 미확인 값':'보류 필드'} · {FIELD_LABELS[p.next.field]}</Button>}<Button disabled={disabled||!onDesign} onClick={onDesign}>설계 검토에서 부족한 근거 확인</Button></div>
 </section>;
}

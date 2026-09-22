import {FIELD_NAMES,locate,type FieldName,type FieldReview} from './field-review.ts';
import type {PdfSource} from './pdf-contract.ts';
/** Navigation counts only. No clinical/readiness approval and no automatic field decisions. */
export function reviewProgress(review:FieldReview,source:PdfSource){
 if(review.sourceDigest!==source.sha256)throw Error('검토와 원문이 다릅니다.');
 const items=review.rows.flatMap(row=>FIELD_NAMES.map(field=>({rowId:row.id,field,cell:row.fields[field]})));
 const reported=items.filter(i=>!!i.cell.current.value?.trim());
 const checked=reported.filter(i=>['confirmed','corrected'].includes(i.cell.decision));
 const waiting=reported.filter(i=>i.cell.decision==='unreviewed');
 const held=items.filter(i=>i.cell.decision==='held');
 const noCitation=reported.filter(i=>!locate(source,i.cell.current.citation)?.box);
 const priority:FieldName[]=['dose','denominator','events','reported_rate','population','window','definition','cohort','metric','study','asset','indication'];
 const queue=[...waiting].sort((a,b)=>priority.indexOf(a.field)-priority.indexOf(b.field)||review.rows.findIndex(r=>r.id===a.rowId)-review.rows.findIndex(r=>r.id===b.rowId));
 return {rows:review.rows.length,reported:reported.length,checked:checked.length,waiting:waiting.length,held:held.length,missing:items.length-reported.length,noCitation:noCitation.length,
  next:queue[0]?{rowId:queue[0].rowId,field:queue[0].field}:held[0]?{rowId:held[0].rowId,field:held[0].field}:null};
}

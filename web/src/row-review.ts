import {decide,FIELD_NAMES,locate,validateCheckedValue,type FieldReview,type FieldName} from './field-review.ts';
import type {PdfSource} from './pdf-contract.ts';
export function reviewableRow(review:FieldReview,source:PdfSource,rowId:string,readyPage:number|null) {
 if(review.sourceDigest!==source.sha256)throw Error('현재 PDF와 검토가 다릅니다.');
 const row=review.rows.find(r=>r.id===rowId);if(!row)throw Error('관측값을 선택하세요.');
 const fields=FIELD_NAMES.filter(k=>row.fields[k].current.value!==null);
 if(!fields.length)throw Error('확인할 원문 값이 없습니다.');
 if(fields.some(k=>row.fields[k].current.supporting?.length))throw Error('보조 근거가 연결된 관측값은 개별 필드에서 문구 관계를 확인하세요.');
 if(Object.values(row.fields).some(f=>f.decision==='held'))throw Error('보류 항목이 있습니다. 개별 필드에서 먼저 검토하세요.');
 for(const k of fields){validateCheckedValue(source,row.valueKind,k,row.fields[k].current);if(locate(source,row.fields[k].current.citation)?.page!==readyPage)throw Error('모든 인용이 표시 중인 PDF 페이지에 있을 때만 함께 확인할 수 있습니다.');}
 if(row.valueKind==='event_count') {const n=Number(row.fields.events.current.value),d=Number(row.fields.denominator.current.value);if(row.fields.events.current.value===null || row.fields.denominator.current.value===null || n>d || d<=0)throw Error('사건 수와 분모를 먼저 검토하세요.');}
 return fields;
}
export function confirmRow(review:FieldReview,source:PdfSource,rowId:string,readyPage:number|null,reason:string,attested:boolean) {
 const fields=reviewableRow(review,source,rowId,readyPage);
 let next=review;
 for(const k of fields as FieldName[])next=decide(next,source,rowId,k,'confirmed',review.rows.find(r=>r.id===rowId)!.fields[k].current,reason,readyPage,attested);
 return next;
}

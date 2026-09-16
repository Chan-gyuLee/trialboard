import {strictJson} from "./field-review.ts";

export type Curation={run_id:string;source_id:string;source_digest:string;revision:number;decision:"INCLUDE"|"CHECK"|"EXCLUDE";reason:string;reviewer_label:string;reviewer_authenticated:false;clinical_verified:false;created_at:string};
export function readCuration(raw:string,runId:string,sourceId:string,digest:string):Curation[]{
  const value=strictJson(raw) as Curation[];
  if(!Array.isArray(value)||value.length>100)throw Error("검토 이력 형식 오류");
  let previous=Infinity;
  for(const n of value){
    if(!n || n.run_id!==runId || n.source_id!==sourceId || n.source_digest!==digest || !Number.isSafeInteger(n.revision) || n.revision<1 || n.revision>=previous || !["INCLUDE","CHECK","EXCLUDE"].includes(n.decision) || typeof n.reason!=="string" || typeof n.reviewer_label!=="string" || n.reviewer_authenticated!==false || n.clinical_verified!==false || typeof n.created_at!=="string" || !Number.isFinite(Date.parse(n.created_at)))throw Error("검토 이력 출처·버전 불일치");
    previous=n.revision;
  }
  return value;
}
export const curationLabel=(value:string)=>({INCLUDE:"검토에 포함",CHECK:"추가 확인",EXCLUDE:"검토에서 제외"}[value]??value);

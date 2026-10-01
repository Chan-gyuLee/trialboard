import {canonical,digest} from './field-review.ts';
import {readSavedAttempts,readSavedStream,type AttemptSummary} from './saved-research-review.ts';
import {preparationObject,type ServerPdfPreparation} from './server-pdf-preparation.ts';
import {readSavedReviewUsage,type SavedReviewUsage} from './saved-review-usage.ts';

export type PdfReviewFinding={anchor_id:string;page:number;start:number;end:number;quote:string;interpretation:string};
export type PdfReviewArtifact=AttemptSummary&{schema:'research-pdf-review/1';mode:'PREPARED_PDF_REVIEW_ONLY';asserted_by:string;preparation_id:string;preparation_digest:string;source_id:string;source_digest:string;pdf_sha256:string;policy_revision:number;execution_mode:'COLLECTORS_ONLY'|'DACON_RESPONSES'|'SCRIPTED_TEST_DOUBLE';model:string|null;response_id:string|null;input_tokens:number|null;output_tokens:number|null;review:{findings:PdfReviewFinding[];questions:string[];conclusion:'NEEDS_EXPERT_REVIEW'|'INSUFFICIENT_EVIDENCE'}|null;error_code:string|null;notices:string[]};
export type PdfReviewUsage=Omit<SavedReviewUsage,'schema'|'scope'>&{schema:'research-pdf-review-usage/1';scope:'PREPARED_PDF_REVIEW_ONLY'};
const summaryKeys=['attempt_id','run_id','status','created_at','completed_at','model_calls'];
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const hash=/^[a-f0-9]{64}$/;
function fail():never{throw Error('PDF 검토 결과의 준비본·인용·실행 기록이 올바르지 않습니다.');}
function text(value:unknown,max:number):value is string{return typeof value==='string'&&Boolean(value.trim())&&Array.from(value).length<=max&&!/[\uD800-\uDFFF]/u.test(value);}
function integer(value:unknown,min=0,max=Number.MAX_SAFE_INTEGER):value is number{return Number.isSafeInteger(value)&&Number(value)>=min&&Number(value)<=max;}
export function readPdfReviewAttempts(value:unknown,runId:string,preparationId:string):AttemptSummary[]{
 const row=preparationObject(value,['run_id','preparation_id','attempts']);
 if(!uuid.test(preparationId)||row.preparation_id!==preparationId)return fail();
 return readSavedAttempts({run_id:row.run_id,attempts:row.attempts},runId);
}
export function readPdfReviewUsage(value:unknown,runId:string):PdfReviewUsage{
 if(!value||typeof value!=='object'||Array.isArray(value))return fail();const row=value as Record<string,unknown>;
 if(row.schema!=='research-pdf-review-usage/1'||row.scope!=='PREPARED_PDF_REVIEW_ONLY')return fail();
 readSavedReviewUsage({...row,schema:'research-saved-review-usage/1',scope:'SAVED_REVIEW_ONLY'},runId);
 return row as PdfReviewUsage;
}
export const readPdfReviewStream=(response:Response,runId:string,onStart:(id:string)=>void)=>readSavedStream(response,runId,onStart,'research-pdf-review-event/1');
export async function readPdfReviewArtifact(value:unknown,prepared:ServerPdfPreparation,attemptId:string,expectedPolicyRevision?:number):Promise<PdfReviewArtifact>{
 const row=preparationObject(value,[...summaryKeys,'schema','mode','asserted_by','preparation_id','preparation_digest','source_id','source_digest','pdf_sha256','policy_revision','execution_mode','model','response_id','input_tokens','output_tokens','review','error_code','notices']);
 readSavedAttempts({run_id:prepared.run_id,attempts:[Object.fromEntries(summaryKeys.map(key=>[key,row[key]]))]},prepared.run_id);
 if(!uuid.test(attemptId)||row.attempt_id!==attemptId||row.schema!=='research-pdf-review/1'||row.mode!=='PREPARED_PDF_REVIEW_ONLY'||typeof row.asserted_by!=='string'||!uuid.test(row.asserted_by)||!integer(row.policy_revision,1,100)||expectedPolicyRevision!==undefined&&row.policy_revision!==expectedPolicyRevision)return fail();
 for(const key of ['preparation_id','preparation_digest','source_id','source_digest','pdf_sha256'] as const)if(row[key]!==prepared[key])return fail();
 if(!['COLLECTORS_ONLY','DACON_RESPONSES','SCRIPTED_TEST_DOUBLE'].includes(String(row.execution_mode)))return fail();
 for(const key of ['model','response_id'])if(row[key]!==null&&!text(row[key],200))return fail();
 for(const key of ['input_tokens','output_tokens'])if(row[key]!==null&&!integer(row[key]))return fail();
 if(!Array.isArray(row.notices)||row.notices.length>10||row.notices.some(v=>!text(v,1000)))return fail();
 if(row.model_calls===0&&(row.execution_mode!=='COLLECTORS_ONLY'||row.model!==null||row.response_id!==null||row.input_tokens!==null||row.output_tokens!==null))return fail();
 if(row.model_calls===1&&(row.execution_mode==='COLLECTORS_ONLY'||row.model===null))return fail();
 if(row.status==='COMPLETED'){
  if(row.model_calls!==1||row.error_code!==null)return fail();
  const review=preparationObject(row.review,['findings','questions','conclusion']);
  if(!['NEEDS_EXPERT_REVIEW','INSUFFICIENT_EVIDENCE'].includes(String(review.conclusion))||!Array.isArray(review.questions)||review.questions.length>6||review.questions.some(q=>!text(q,700))||!Array.isArray(review.findings)||review.findings.length>12)return fail();
  const seen=new Set<string>();
  for(const item of review.findings){
   const f=preparationObject(item,['anchor_id','page','start','end','quote','interpretation']);
   if(typeof f.anchor_id!=='string'||!hash.test(f.anchor_id)||seen.has(f.anchor_id)||!integer(f.page,1,prepared.pages.length)||!integer(f.start,0,30000)||!integer(f.end,1,30000)||f.end<=f.start||f.end-f.start>1000||f.start%1000!==0||!text(f.quote,1000)||!text(f.interpretation,1400))return fail();
   const page=Array.from(prepared.pages[f.page-1].text);
   if(f.end!==Math.min(f.start+1000,page.length)||page.slice(f.start,f.end).join('')!==f.quote||await digest(canonical({preparation_digest:prepared.preparation_digest,page:f.page,start:f.start,end:f.end}))!==f.anchor_id)return fail();
   seen.add(f.anchor_id);
  }
 }else{
  if(row.review!==null)return fail();
  if(row.status==='RUNNING'){if(row.error_code!==null)return fail();}
  else if(row.status==='CANCELLED'){if(row.error_code!=='CANCELLED')return fail();}
  else if(!['MODEL_POLICY_DENIED','MODEL_FAILED','MODEL_RESPONSE_REJECTED'].includes(String(row.error_code)))return fail();
 }
 return row as PdfReviewArtifact;
}

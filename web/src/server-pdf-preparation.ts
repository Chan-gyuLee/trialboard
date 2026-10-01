import {canonical,digest} from './field-review.ts';

export const serverPdfLimits={max_pdf_bytes:5000000,max_pages:10,max_text_chars:30000,cpu_seconds:2,wall_seconds:5,memory_bytes:536870912,max_output_bytes:200000} as const;
export type PreparationKey={runId:string;sourceId:string;sourceDigest:string;pdfSha:string};
export type PreparationCapabilities={schema:'research-pdf-preparation-capabilities/1';status:'RUNTIME_CHECK_REQUIRED'|'UNSUPPORTED_SANDBOX';limits:typeof serverPdfLimits};
export type PreparationList={schema:'research-pdf-preparation-list/1';run_id:string;source_id:string;source_digest:string;pdf_sha256:string;preparations:{preparation_id:string;preparation_digest:string;created_at:string;page_count:number}[]};
export type ServerPdfPreparation={schema:'research-pdf-preparation/1';mode:'SERVER_PDF_TEXT_ONLY';preparation_id:string;preparation_digest:string;run_id:string;source_id:string;source_digest:string;pdf_sha256:string;policy_revision:number;asserted_by:string;created_at:string;extractor:string;pages:{page:number;text:string}[];limits:typeof serverPdfLimits;model_calls:0;verification:'SERVER_EXTRACTED_NOT_CLINICALLY_VERIFIED';notices:string[]};
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/,sha=/^[a-f0-9]{64}$/;
export function preparationError():never{throw Error('서버 PDF 준비본의 대상·내용·지문이 올바르지 않습니다.');}
export function preparationObject(value:unknown,keys:readonly string[]):Record<string,unknown>{
 if(!value||typeof value!=='object'||Array.isArray(value))return preparationError();
 const row=value as Record<string,unknown>;
 if(Object.keys(row).length!==keys.length||keys.some(key=>!Object.hasOwn(row,key)))return preparationError();return row;
}
export function validPreparationKey(key:PreparationKey):boolean{return uuid.test(key.runId)&&Boolean(key.sourceId.trim())&&key.sourceId.length<=150&&sha.test(key.sourceDigest)&&sha.test(key.pdfSha);}
export function preparationUtc(value:unknown):boolean{return typeof value==='string'&&/(Z|\+00:00)$/.test(value)&&Number.isFinite(Date.parse(value));}
export function readPreparationCapabilities(value:unknown):PreparationCapabilities{
 const row=preparationObject(value,['schema','status','limits']);
 if(row.schema!=='research-pdf-preparation-capabilities/1'||!['RUNTIME_CHECK_REQUIRED','UNSUPPORTED_SANDBOX'].includes(String(row.status)))return preparationError();
 const limits=preparationObject(row.limits,Object.keys(serverPdfLimits));
 if(Object.entries(serverPdfLimits).some(([key,value])=>limits[key]!==value))return preparationError();return row as PreparationCapabilities;
}
export function readPreparationList(value:unknown,key:PreparationKey):PreparationList{
 const row=preparationObject(value,['schema','run_id','source_id','source_digest','pdf_sha256','preparations']);
 if(!validPreparationKey(key)||row.schema!=='research-pdf-preparation-list/1'||row.run_id!==key.runId||row.source_id!==key.sourceId||row.source_digest!==key.sourceDigest||row.pdf_sha256!==key.pdfSha||!Array.isArray(row.preparations)||row.preparations.length>30)return preparationError();
 const ids=new Set<string>();
 for(const value of row.preparations){
  const item=preparationObject(value,['preparation_id','preparation_digest','created_at','page_count']);
  if(typeof item.preparation_id!=='string'||!uuid.test(item.preparation_id)||ids.has(item.preparation_id)||typeof item.preparation_digest!=='string'||!sha.test(item.preparation_digest)||!preparationUtc(item.created_at)||!Number.isSafeInteger(item.page_count)||Number(item.page_count)<1||Number(item.page_count)>10)return preparationError();ids.add(item.preparation_id);
 }
 return row as PreparationList;
}
export async function readServerPdfPreparation(value:unknown,key:PreparationKey,expected?:{id:string;digest:string}):Promise<ServerPdfPreparation>{
 const row=preparationObject(value,['schema','mode','preparation_id','preparation_digest','run_id','source_id','source_digest','pdf_sha256','policy_revision','asserted_by','created_at','extractor','pages','limits','model_calls','verification','notices']);
 if(!validPreparationKey(key)||row.schema!=='research-pdf-preparation/1'||row.mode!=='SERVER_PDF_TEXT_ONLY'||row.run_id!==key.runId||row.source_id!==key.sourceId||row.source_digest!==key.sourceDigest||row.pdf_sha256!==key.pdfSha||typeof row.preparation_id!=='string'||!uuid.test(row.preparation_id)||typeof row.preparation_digest!=='string'||!sha.test(row.preparation_digest)||typeof row.asserted_by!=='string'||!uuid.test(row.asserted_by)||!preparationUtc(row.created_at)||!Number.isSafeInteger(row.policy_revision)||Number(row.policy_revision)<1||Number(row.policy_revision)>100||typeof row.extractor!=='string'||!/^pdfplumber\/.{1,88}$/.test(row.extractor)||row.model_calls!==0||row.verification!=='SERVER_EXTRACTED_NOT_CLINICALLY_VERIFIED')return preparationError();
 if(expected&&(expected.id!==row.preparation_id||expected.digest!==row.preparation_digest))return preparationError();
 const limits=preparationObject(row.limits,Object.keys(serverPdfLimits));
 if(Object.entries(serverPdfLimits).some(([key,value])=>limits[key]!==value))return preparationError();
 if(!Array.isArray(row.pages)||row.pages.length<1||row.pages.length>10)return preparationError();
 let characters=0,hasText=false;
 for(let index=0;index<row.pages.length;index++){
  const page=preparationObject(row.pages[index],['page','text']);
  if(page.page!==index+1||typeof page.text!=='string'||/[\uD800-\uDFFF]/u.test(page.text))return preparationError();
  characters+=Array.from(page.text).length;hasText||=Boolean(page.text.trim());
 }
 if(characters>30000||!hasText||!Array.isArray(row.notices)||row.notices.length>10||row.notices.some(v=>typeof v!=='string'||!v.trim()||v.length>2000))return preparationError();
 const {preparation_digest,...content}=row;
 if(await digest(canonical(content))!==preparation_digest)return preparationError();
 return row as ServerPdfPreparation;
}

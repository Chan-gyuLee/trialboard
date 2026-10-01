import {readSourcePolicy,type SourcePolicy} from './research-source-policy.ts';
export type PdfPolicy=Omit<SourcePolicy,'resource_kind'>&{resource_kind:'PDF_BYTES';pdf_sha256:string};
export type PdfVersion={pdf_sha256:string;byte_length:number;binding_status:'EXACT'|'LEGACY_UNBOUND';usage_policy:PdfPolicy};
export type PdfSource={source_id:string;source_digest:string;title:string;download_available:boolean;cached_versions:PdfVersion[]};
export type PdfMetadata={run_id:string;resource_kind:'PDF_BYTES';can_manage:boolean;sources:PdfSource[]};
export type PdfPolicyHistory={current:PdfPolicy;history:PdfPolicy[];can_manage:boolean};
const hash=/^[a-f0-9]{64}$/,uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
function fail():never{throw Error('PDF 이용조건 응답의 대상 또는 형식이 올바르지 않습니다.');}
function obj(v:unknown,keys:string[]):Record<string,unknown>{if(!v||typeof v!=='object'||Array.isArray(v))return fail();const o=v as Record<string,unknown>;if(Object.keys(o).length!==keys.length||keys.some(k=>!Object.hasOwn(o,k)))return fail();return o;}
export function readPdfPolicy(v:unknown,runId:string,sid:string,digest:string,pdfSha:string):PdfPolicy{
 const o=obj(v,['resource_kind','run_id','source_id','source_digest','pdf_sha256','policy_revision','original_storage','internal_search','external_ai','training','evidence_reference','reason','asserted_by','created_at','verification']);
 if(o.resource_kind!=='PDF_BYTES'||o.pdf_sha256!==pdfSha||!hash.test(pdfSha))return fail();
 const {pdf_sha256,...rest}=o;void pdf_sha256;readSourcePolicy({...rest,resource_kind:'SOURCE_TEXT'},runId,sid,digest);
 if(o.created_at!==null&&(typeof o.created_at!=='string'||!/(Z|\+00:00)$/.test(o.created_at)))return fail();return o as PdfPolicy;
}
export function readPdfMetadata(v:unknown,runId:string):PdfMetadata{
 const o=obj(v,['run_id','resource_kind','can_manage','sources']);
 if(!uuid.test(runId)||o.run_id!==runId||o.resource_kind!=='PDF_BYTES'||typeof o.can_manage!=='boolean'||!Array.isArray(o.sources)||o.sources.length>500)return fail();
 const ids=new Set<string>();
 const sources=o.sources.map(v=>{
  const s=obj(v,['source_id','source_digest','title','download_available','cached_versions']);
  if(typeof s.source_id!=='string'||!s.source_id.trim()||s.source_id.length>150||ids.has(s.source_id)||typeof s.source_digest!=='string'||!hash.test(s.source_digest)||typeof s.title!=='string'||!s.title.trim()||s.title.length>20000||typeof s.download_available!=='boolean'||!Array.isArray(s.cached_versions)||s.cached_versions.length>100)return fail();
  ids.add(s.source_id);const seen=new Set<string>();
  const versions=s.cached_versions.map(v=>{
   const c=obj(v,['pdf_sha256','byte_length','binding_status','usage_policy']);
   if(typeof c.pdf_sha256!=='string'||!hash.test(c.pdf_sha256)||seen.has(c.pdf_sha256)||!Number.isSafeInteger(c.byte_length)||Number(c.byte_length)<5||Number(c.byte_length)>5_000_000||!['EXACT','LEGACY_UNBOUND'].includes(String(c.binding_status)))return fail();
   seen.add(c.pdf_sha256);const policy=readPdfPolicy(c.usage_policy,runId,s.source_id as string,s.source_digest as string,c.pdf_sha256);
   if(c.binding_status==='LEGACY_UNBOUND'&&policy.policy_revision!==0)return fail();
   return {...c,usage_policy:policy} as PdfVersion;
  });return {...s,cached_versions:versions} as PdfSource;
 });return {...o,sources} as PdfMetadata;
}
export function readPdfHistory(v:unknown,runId:string,sid:string,digest:string,pdfSha:string):PdfPolicyHistory{
 const o=obj(v,['current','history','can_manage']);if(typeof o.can_manage!=='boolean'||!Array.isArray(o.history)||o.history.length>100)return fail();
 const current=readPdfPolicy(o.current,runId,sid,digest,pdfSha),history=o.history.map(v=>readPdfPolicy(v,runId,sid,digest,pdfSha));
 if(history.length!==current.policy_revision||history.some((p,i)=>p.policy_revision!==current.policy_revision-i)||history.length&&Object.keys(current).some(k=>current[k as keyof PdfPolicy]!==history[0][k as keyof PdfPolicy]))return fail();
 return {current,history,can_manage:o.can_manage};
}

export async function verifiedPdfBytes(response:Response,signal:AbortSignal,expectedSha?:string):Promise<ArrayBuffer>{
 signal.throwIfAborted();
 if(!response.ok||response.headers.get('content-type')?.split(';')[0].trim()!=='application/pdf')throw Error('PDF 응답 형식이 올바르지 않습니다.');
 const declared=response.headers.get('X-Source-Sha256');
 if(!declared||!hash.test(declared)||expectedSha!==undefined&&declared!==expectedSha)throw Error('선택한 PDF 버전과 응답 지문이 다릅니다.');
 if(!response.body)throw Error('PDF 응답 본문이 없습니다.');
 const reader=response.body.getReader(),chunks:Uint8Array[]=[];let total=0,complete=false;
 const abort=()=>{void reader.cancel(signal.reason).catch(()=>{});};
 signal.addEventListener('abort',abort,{once:true});
 try{
  while(true){
   signal.throwIfAborted();const {done,value}=await reader.read();signal.throwIfAborted();
   if(done){complete=true;break;}
   total+=value.byteLength;
   if(total>5_000_000)throw Error('PDF 형식 또는 크기가 허용 범위를 벗어났습니다.');
   chunks.push(value);
  }
 }finally{
  signal.removeEventListener('abort',abort);
  if(!complete)void reader.cancel().catch(()=>{});
  reader.releaseLock();
 }
 const joined=new Uint8Array(total);let offset=0;
 for(const chunk of chunks){joined.set(chunk,offset);offset+=chunk.byteLength;}
 const bytes=joined.buffer;signal.throwIfAborted();
 if(bytes.byteLength<5||bytes.byteLength>5_000_000||new TextDecoder().decode(new Uint8Array(bytes,0,5))!=='%PDF-')throw Error('PDF 형식 또는 크기가 허용 범위를 벗어났습니다.');
 const actual=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),v=>v.toString(16).padStart(2,'0')).join('');
 signal.throwIfAborted();if(actual!==declared)throw Error('수신한 PDF 지문이 서버의 저장 지문과 다릅니다.');return bytes;
}

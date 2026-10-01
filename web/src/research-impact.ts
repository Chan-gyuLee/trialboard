export type ResearchImpactUse={kind:"REVIEW_FINDING"|"REVIEW_INPUT_PRIORITY";reference_count:number};
export type ResearchImpactCandidate={run_id:string;created_at:string;status:"RUNNING"|"COMPLETE"|"PARTIAL"|"CANCELLED"|"FAILED";asset:string;nct_id:string;source_title:string;uses:ResearchImpactUse[]};
export type ResearchImpact={schema:"research-source-impact/1";scope:"RECORDED_DIRECT_ONLY";anchor:{run_id:string;project_id:string;source_id:string;source_digest:string};candidate_count:number;candidates:ResearchImpactCandidate[];caveats:string[]};

const exact=(value:unknown,keys:string[])=>{if(!value||typeof value!=="object"||Array.isArray(value)||Object.keys(value).sort().join("|")!==[...keys].sort().join("|"))throw Error("영향 후보 응답 형식 오류");return value as Record<string,unknown>;};
const text=(value:unknown,max=2000)=>typeof value==="string"&&value.length>0&&value.length<=max;
const digest=(value:unknown)=>typeof value==="string"&&/^[a-f0-9]{64}$/.test(value);
const runId=(value:unknown)=>typeof value==="string"&&/^[a-f0-9-]{36}$/.test(value);

export function readResearchImpact(value:unknown,expected:{runId:string;sourceId:string;sourceDigest:string}):ResearchImpact{
 const root=exact(value,["schema","scope","anchor","candidate_count","candidates","caveats"]),anchor=exact(root.anchor,["run_id","project_id","source_id","source_digest"]);
 if(root.schema!=="research-source-impact/1"||root.scope!=="RECORDED_DIRECT_ONLY"||anchor.run_id!==expected.runId||anchor.source_id!==expected.sourceId||anchor.source_digest!==expected.sourceDigest||!digest(anchor.project_id))throw Error("영향 후보 기준 출처·버전 불일치");
 if(!Number.isSafeInteger(root.candidate_count)||Number(root.candidate_count)<0||Number(root.candidate_count)>100||!Array.isArray(root.candidates)||root.candidates.length!==root.candidate_count)throw Error("영향 후보 개수 오류");
 const seen=new Set<string>();
 const candidates=root.candidates.map(value=>{
  const row=exact(value,["run_id","created_at","status","asset","nct_id","source_title","uses"]);
  if(!runId(row.run_id)||row.run_id===expected.runId||seen.has(String(row.run_id))||!text(row.created_at,50)||!Number.isFinite(Date.parse(String(row.created_at)))||!["RUNNING","COMPLETE","PARTIAL","CANCELLED","FAILED"].includes(String(row.status))||!text(row.asset,100)||typeof row.nct_id!=="string"||!/^NCT\d{8}$/.test(row.nct_id)||!text(row.source_title)||!Array.isArray(row.uses)||row.uses.length<1||row.uses.length>2)throw Error("영향 후보 실행 형식 오류");
  seen.add(String(row.run_id));const kinds=new Set<string>();
  const uses=row.uses.map(value=>{const use=exact(value,["kind","reference_count"]);if(!["REVIEW_FINDING","REVIEW_INPUT_PRIORITY"].includes(String(use.kind))||kinds.has(String(use.kind))||!Number.isSafeInteger(use.reference_count)||Number(use.reference_count)<1||Number(use.reference_count)>8)throw Error("영향 후보 참조 형식 오류");kinds.add(String(use.kind));return use as ResearchImpactUse;});
  return {...row,uses} as ResearchImpactCandidate;
 });
 if(!Array.isArray(root.caveats)||root.caveats.length!==6||root.caveats.some(item=>!text(item,300)))throw Error("영향 후보 한계 설명 누락");
 const caveats=root.caveats as string[],required=["직접 source ID 참조","인벤토리","research_links","다운스트림","인증이나 테넌트 격리","PDF 바이트 지문"];
 if(required.some(term=>!caveats.some(item=>item.includes(term))))throw Error("영향 후보 한계 설명 누락");
 return {...root,anchor,candidates,caveats} as ResearchImpact;
}

export async function loadResearchImpact(expected:{runId:string;sourceId:string;sourceDigest:string},signal:AbortSignal,request:typeof fetch=fetch):Promise<ResearchImpact>{
 const path=`/api/research/runs/${encodeURIComponent(expected.runId)}/impact?source_id=${encodeURIComponent(expected.sourceId)}&source_digest=${encodeURIComponent(expected.sourceDigest)}`;
 const response=await request(path,{signal,cache:"no-store",credentials:"omit",redirect:"error"});
 if(!response.ok){
  const body=await response.json().catch(()=>null) as {detail?:unknown}|null;
  if(response.status===404&&body?.detail==="RESEARCH_NOT_FOUND")throw Error("기준 조사 실행을 찾지 못했습니다.");
  if(response.status===404&&body?.detail==="RESEARCH_SOURCE_NOT_FOUND")throw Error("기준 실행에 이 출처가 없습니다.");
  if(response.status===409&&body?.detail==="RESEARCH_SOURCE_VERSION_MISMATCH")throw Error("선택한 출처 버전이 기준 실행과 다릅니다.");
  throw Error("기록된 사용 후보를 확인하지 못했습니다. 기존 조사 기록은 변경되지 않았습니다.");
 }
 return readResearchImpact(await response.json(),expected);
}

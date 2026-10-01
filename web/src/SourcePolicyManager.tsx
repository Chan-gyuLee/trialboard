import {useEffect,useId,useRef,useState} from "react";
import {Alert,Button,MenuItem,TextField} from "@mui/material";
import {useTeamSession} from "./AccessShell";
import {policyDraft,purposes,readSourceMetadata,readSourcePolicyHistory,sourcePolicyRequest,SourcePolicyRequestError,type MetadataPacket,type PolicyDraft,type PolicyPacket,type Purpose,type SourceMetadata} from "./research-source-policy";
import "./source-policy.css";

const labels:Record<Purpose,string>={original_storage:"원문 저장·조회",internal_search:"내부 검색",external_ai:"외부 AI 전송",training:"학습 (기록만)"};
const decisions={ALLOW:"허용",DENY:"금지",UNKNOWN:"미확인"};
const message=(error:unknown)=>error instanceof Error?error.message:"이용조건을 확인하지 못했습니다.";

export default function SourcePolicyManager({runId,disabled=false}:{runId:string;disabled?:boolean}){
  const session=useTeamSession(),[expanded,setExpanded]=useState(false),id=useId();
  if(!session)return null;
  return <div className="source-policy-entry">
    <Button disabled={disabled} aria-expanded={expanded} aria-controls={id} onClick={()=>setExpanded(v=>!v)}>출처 이용조건</Button>
    {expanded&&<div id={id}><PolicyPanel key={runId} runId={runId} disabled={disabled}/></div>}
  </div>;
}

function PolicyPanel({runId,disabled}:{runId:string;disabled:boolean}){
  const [packet,setPacket]=useState<MetadataPacket|null>(null),[sourceId,setSourceId]=useState(""),[error,setError]=useState(""),[busy,setBusy]=useState(true),[reload,setReload]=useState(0);
  const drafts=useRef(new Map<string,PolicyDraft>());
  useEffect(()=>{
    const abort=new AbortController();setBusy(true);setError("");setPacket(null);
    void sourcePolicyRequest(`/api/research/runs/${encodeURIComponent(runId)}/source-metadata`,undefined,abort.signal)
      .then(value=>{const next=readSourceMetadata(value,runId);if(abort.signal.aborted)return;setPacket(next);setSourceId(old=>next.sources.some(s=>s.source_id===old)?old:next.sources[0]?.source_id??"");})
      .catch(e=>{if(!abort.signal.aborted)setError(message(e));}).finally(()=>{if(!abort.signal.aborted)setBusy(false);});
    return()=>abort.abort();
  },[runId,reload]);
  const source=packet?.sources.find(s=>s.source_id===sourceId);
  return <section className="source-policy-panel" aria-label="조사 출처 이용조건" aria-busy={busy}>
    <header><h3>출처 이용조건</h3><Button disabled={busy||disabled} onClick={()=>setReload(v=>v+1)}>출처 목록 새로고침</Button></header>
    <p>공개된 자료도 이용 허가를 확인해야 합니다. 원문을 열지 않고 저장된 출처와 이용조건을 확인합니다.</p>
    {error&&<Alert severity="error">{error}</Alert>}
    {busy&&<p role="status">출처 이용조건을 불러오는 중입니다.</p>}
    {packet&&!packet.sources.length&&<Alert severity="info">이 조사에 저장된 출처가 없습니다.</Alert>}
    {packet&&packet.sources.length>0&&<TextField select fullWidth label="이용조건을 확인할 출처" value={sourceId} disabled={disabled} onChange={e=>setSourceId(e.target.value)}>{packet.sources.map(s=><MenuItem key={s.source_id} value={s.source_id}>{s.title}</MenuItem>)}</TextField>}
    {source&&<PolicyEditor key={`${runId}:${source.source_id}:${source.source_digest}`} runId={runId} source={source} disabled={disabled} initialDraft={drafts.current.get(`${source.source_id}:${source.source_digest}`)} onDraft={draft=>drafts.current.set(`${source.source_id}:${source.source_digest}`,draft)} onSourcesChanged={()=>setReload(v=>v+1)}/>}
  </section>;
}

function PolicyEditor({runId,source,disabled,initialDraft,onDraft,onSourcesChanged}:{runId:string;source:SourceMetadata;disabled:boolean;initialDraft?:PolicyDraft;onDraft:(draft:PolicyDraft)=>void;onSourcesChanged:()=>void}){
  const session=useTeamSession(),[packet,setPacket]=useState<PolicyPacket|null>(null),[draft,setDraft]=useState<PolicyDraft>(initialDraft??policyDraft(source.usage_policy));
  const [busy,setBusy]=useState(true),[error,setError]=useState(""),[notice,setNotice]=useState(""),[conflict,setConflict]=useState(false),[revoked,setRevoked]=useState(false);
  const alive=useRef(true),abort=useRef(new AbortController()),generation=useRef(0);
  const url=`/api/research/runs/${encodeURIComponent(runId)}/sources/${encodeURIComponent(source.source_id)}/usage-policy`;
  const parse=(value:unknown)=>readSourcePolicyHistory(value,runId,source.source_id,source.source_digest);
  async function load(preserve=true){
    const ticket=++generation.current;setBusy(true);setError("");
    try{const next=parse(await sourcePolicyRequest(url,undefined,abort.current.signal));if(!alive.current||ticket!==generation.current)return;setPacket(next);setConflict(false);setRevoked(false);if(!preserve)setDraft(policyDraft(next.current));}
    catch(e){if(alive.current&&ticket===generation.current){setError(message(e));setRevoked(true);}}
    finally{if(alive.current&&ticket===generation.current)setBusy(false);}
  }
  useEffect(()=>{alive.current=true;abort.current=new AbortController();void load(Boolean(initialDraft));return()=>{alive.current=false;generation.current++;abort.current.abort();};},[]);
  function edit(change:Partial<PolicyDraft>){const next={...draft,...change};setDraft(next);onDraft(next);setNotice("");}
  const canWrite=Boolean(packet?.can_manage)&&(session?.role==="admin"||session?.role==="reviewer")&&!revoked;
  async function save(){
    if(!packet||!canWrite||busy||disabled||conflict)return;
    const ticket=++generation.current,revision=packet.current.policy_revision;setBusy(true);setError("");setNotice("");onDraft(draft);
    try{
      const next=parse(await sourcePolicyRequest(url,{...draft,source_digest:source.source_digest,expected_policy_revision:revision},abort.current.signal));
      if(next.current.policy_revision!==revision+1)throw Error("저장된 정책의 이력 번호가 요청과 다릅니다.");
      if(!alive.current||ticket!==generation.current)return;setPacket(next);setDraft(policyDraft(next.current));onDraft(policyDraft(next.current));setNotice("이용조건 확인 내용을 기록했습니다. 원문은 최근 조사에서 다시 열어 확인하세요.");
    }catch(e){if(!alive.current||ticket!==generation.current)return;setError(message(e));if(e instanceof SourcePolicyRequestError&&e.status===409)setConflict(true);else if(e instanceof SourcePolicyRequestError&&[401,403,404].includes(e.status))setRevoked(true);}
    finally{if(alive.current&&ticket===generation.current)setBusy(false);}
  }
  const locked=disabled||busy||!canWrite||conflict;
  return <div className="source-policy-editor" aria-busy={busy}>
    <p className="source-policy-identity">{source.source_id}<br/>출처 지문 {source.source_digest}</p>
    {error&&<Alert severity="error">{error}{conflict&&<p>작성한 내용은 유지했습니다. 최신 이력을 불러온 뒤 다시 확인하고 저장하세요. 출처 버전이 달라졌다면 출처 목록을 새로고침하세요.</p>}</Alert>}
    {(conflict||revoked)&&<div className="source-policy-actions"><Button disabled={busy} onClick={()=>void load(true)}>최신 이력 불러오기</Button><Button disabled={busy} onClick={onSourcesChanged}>출처 목록 확인</Button></div>}
    {notice&&<Alert severity="success">{notice}</Alert>}
    {packet&&<Alert severity={packet.current.original_storage==="ALLOW"?"info":"warning"}>현재 원문 조회: {decisions[packet.current.original_storage]}. 미확인·금지 출처가 있으면 전체 조사 원문을 열 수 없습니다. 내부 검색은 원문과 검색이 모두 허용된 출처만 표시합니다.</Alert>}
    {packet&&!canWrite&&<p>읽기 전용입니다. 실행 소유자 또는 팀 관리자에게 이용조건 확인을 요청하세요.</p>}
    <div className="source-policy-purpose-grid">{purposes.map(p=><TextField key={p} select fullWidth label={labels[p]} value={draft[p]} disabled={locked} onChange={e=>edit({[p]:e.target.value})}>{Object.entries(decisions).map(([value,label])=><MenuItem key={value} value={value}>{label}</MenuItem>)}</TextField>)}</div>
    <TextField fullWidth label="허가 근거" value={draft.evidence_reference} disabled={locked} onChange={e=>edit({evidence_reference:e.target.value})} helperText="라이선스, 계약 또는 허가 확인 자료의 위치" slotProps={{htmlInput:{maxLength:2000}}}/>
    <TextField fullWidth multiline minRows={2} label="확인 사유" value={draft.reason} disabled={locked} onChange={e=>edit({reason:e.target.value})} slotProps={{htmlInput:{maxLength:4000}}}/>
    <p>이 기록은 사용자의 확인 진술이며 법적 권리 인증이 아닙니다. 조사 텍스트의 AI 전송 전에는 현재 이용조건과 권한을 다시 확인합니다. 학습 기능은 없습니다. PDF 파일·자동 검토와 수집 원본의 허가는 이 텍스트 정책으로 대신하지 않습니다.</p>
    <Button variant="contained" disabled={locked||!draft.evidence_reference.trim()||!draft.reason.trim()||packet?.current.policy_revision===100} onClick={()=>void save()}>이용조건 기록</Button>
    <details><summary>이용조건 변경 이력 ({packet?.history.length??0})</summary>{packet?.history.map(p=><article key={p.policy_revision}><strong>이력 {p.policy_revision}</strong><p>{purposes.map(key=>`${labels[key]}: ${decisions[p[key]]}`).join(" / ")}</p><p>{p.reason}</p><p>근거: {p.evidence_reference}</p><small>{p.created_at&&new Date(p.created_at).toLocaleString("ko-KR")} · 기록자 {p.asserted_by}</small></article>)}</details>
  </div>;
}

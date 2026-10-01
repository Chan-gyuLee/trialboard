import {useEffect,useId,useRef,useState} from 'react';
import {Alert,Button,MenuItem,TextField} from '@mui/material';
import {useTeamSession} from './AccessShell';
import {purposes,type PolicyDraft,type Purpose} from './research-source-policy';
import {rawDraft,rawRequest,RawRequestError,readRawHistory,readRawMetadata,type RawHistory,type RawKey,type RawMetadata,type RawSnapshot,type RawSource} from './research-raw-policy';
import './source-policy.css';
const decisions={ALLOW:'허용',DENY:'금지',UNKNOWN:'미확인'};
const labels:Record<Purpose,string>={original_storage:'원본 JSON 저장·조회',internal_search:'내부 검색',external_ai:'외부 AI 전송',training:'학습 (기록만)'};
const describe=(e:unknown)=>e instanceof Error?e.message:'수집 원본 이용조건을 확인하지 못했습니다.';
const identity=(s:RawSource,p:RawSnapshot)=>JSON.stringify([s.source_id,s.source_digest,p.snapshot_digest]);
export default function ResearchRawPolicy({runId,disabled=false}:{runId:string;disabled?:boolean}){
 const session=useTeamSession(),[open,setOpen]=useState(false),id=useId();if(!session)return null;
 return <div className="source-policy-entry"><Button disabled={disabled} aria-expanded={open} aria-controls={id} onClick={()=>setOpen(v=>!v)}>수집 원본 이용조건</Button>{open&&<div id={id}><RawPanel key={runId} runId={runId} disabled={disabled}/></div>}</div>;
}
function RawPanel({runId,disabled}:{runId:string;disabled:boolean}){
 const [metadata,setMetadata]=useState<RawMetadata|null>(null),[selected,setSelected]=useState(''),[busy,setBusy]=useState(true),[error,setError]=useState(''),[revision,setRevision]=useState(0);
 const drafts=useRef(new Map<string,PolicyDraft>());
 useEffect(()=>{const controller=new AbortController();setBusy(true);setMetadata(null);setError('');
  void rawRequest(`/api/research/runs/${encodeURIComponent(runId)}/raw-metadata`,controller.signal).then(value=>{
   const next=readRawMetadata(value,runId);if(controller.signal.aborted)return;setMetadata(next);
   const items=next.sources.flatMap(s=>s.snapshots.map(p=>identity(s,p)));setSelected(old=>items.includes(old)?old:items[0]??'');
  }).catch(e=>{if(!controller.signal.aborted)setError(describe(e));}).finally(()=>{if(!controller.signal.aborted)setBusy(false);});return()=>controller.abort();
 },[runId,revision]);
 const options=metadata?.sources.flatMap(source=>source.snapshots.map(snapshot=>({source,snapshot,id:identity(source,snapshot)})))??[],chosen=options.find(v=>v.id===selected);
 return <section className="source-policy-panel" aria-label="수집 원본 이용조건" aria-busy={busy}>
  <header><h3>수집 원본 이용조건</h3><Button disabled={disabled||busy} onClick={()=>setRevision(v=>v+1)}>원본 목록 새로고침</Button></header>
  <p>수집 시 저장한 원본 JSON의 정확한 버전별로 이용조건을 기록합니다. 출처 텍스트·PDF 파일의 허가와 별개이며, 여기서는 원문 내용 없이 출처명과 지문만 확인합니다.</p>
  {busy&&<p role="status">수집 원본 목록을 확인하고 있습니다.</p>}{error&&<Alert severity="error">{error}</Alert>}
  {metadata&&options.length===0&&<p>이 조사에 연결된 수집 원본이 없습니다.</p>}
  {options.length>0&&<TextField fullWidth select label="이용조건을 확인할 수집 원본" value={selected} disabled={disabled||busy} onChange={e=>setSelected(e.target.value)}>{options.map(v=><MenuItem key={v.id} value={v.id}>{v.source.title} · {v.snapshot.snapshot_digest.slice(0,12)} · {v.snapshot.byte_length.toLocaleString('ko-KR')}바이트</MenuItem>)}</TextField>}
  {chosen&&<RawEditor key={chosen.id} target={{runId,sourceId:chosen.source.source_id,sourceDigest:chosen.source.source_digest,snapshotDigest:chosen.snapshot.snapshot_digest}} snapshot={chosen.snapshot} disabled={disabled} initialDraft={drafts.current.get(chosen.id)} onDraft={draft=>drafts.current.set(chosen.id,draft)} onRefresh={()=>setRevision(v=>v+1)}/>}
 </section>;
}
function RawEditor({target,snapshot,disabled,initialDraft,onDraft,onRefresh}:{target:RawKey;snapshot:RawSnapshot;disabled:boolean;initialDraft?:PolicyDraft;onDraft:(d:PolicyDraft)=>void;onRefresh:()=>void}){
 const session=useTeamSession(),[packet,setPacket]=useState<RawHistory|null>(null),[draft,setDraft]=useState<PolicyDraft>(initialDraft??rawDraft(snapshot.usage_policy)),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState(''),[conflict,setConflict]=useState(false),[revoked,setRevoked]=useState(false);
 const active=useRef<AbortController|null>(null);
 const path=`/api/research/runs/${encodeURIComponent(target.runId)}/sources/${encodeURIComponent(target.sourceId)}/raw-usage-policy`,query=new URLSearchParams({source_digest:target.sourceDigest,snapshot_digest:target.snapshotDigest});
 function begin(){active.current?.abort();const controller=new AbortController();active.current=controller;setBusy(true);setError('');setNotice('');return controller;}
 const alive=(c:AbortController)=>active.current===c&&!c.signal.aborted;
 async function load(preserve:boolean){const c=begin();setPacket(null);try{
  const next=readRawHistory(await rawRequest(`${path}?${query}`,c.signal),target);if(!alive(c))return;
  setPacket(next);setConflict(false);setRevoked(false);if(!preserve)setDraft(rawDraft(next.current));
 }catch(e){if(alive(c)){setError(describe(e));setRevoked(true);}}finally{if(alive(c))setBusy(false);}}
 useEffect(()=>{void load(Boolean(initialDraft));return()=>active.current?.abort();},[]);
 function edit(change:Partial<PolicyDraft>){const next={...draft,...change};setDraft(next);onDraft(next);setNotice('');}
 const canWrite=Boolean(packet?.can_manage)&&(session?.role==='admin'||session?.role==='reviewer')&&!revoked;
 async function save(){if(!packet||!canWrite||disabled||busy||conflict)return;const c=begin(),expected=packet.current.policy_revision;onDraft(draft);try{
  const next=readRawHistory(await rawRequest(path,c.signal,{...draft,source_digest:target.sourceDigest,snapshot_digest:target.snapshotDigest,expected_policy_revision:expected}),target);
  if(next.current.policy_revision!==expected+1)throw Error('저장된 원본 이용조건의 이력이 요청과 다릅니다.');if(!alive(c))return;
  setPacket(next);setDraft(rawDraft(next.current));onDraft(rawDraft(next.current));setNotice('이 수집 원본의 이용조건을 기록했습니다. 다른 원본이나 출처의 허가는 바꾸지 않았습니다.');
 }catch(e){if(alive(c)){setError(describe(e));if(e instanceof RawRequestError&&e.status===409)setConflict(true);else if(e instanceof RawRequestError&&[401,403,404].includes(e.status)){setRevoked(true);setPacket(null);}}}finally{if(alive(c))setBusy(false);}}
 const locked=disabled||busy||!canWrite||conflict;
 return <div className="source-policy-editor" aria-busy={busy}>
  <p className="source-policy-identity">{target.sourceId}<br/>출처 지문 {target.sourceDigest}<br/>원본 지문 {target.snapshotDigest}</p>
  {error&&<Alert severity="error">{error}{conflict&&<p>작성한 내용은 유지했습니다. 최신 이력을 확인한 뒤 직접 다시 저장하세요.</p>}</Alert>}
  {(conflict||revoked)&&<div className="source-policy-actions"><Button disabled={busy||disabled} onClick={()=>void load(true)}>최신 원본 이력 불러오기</Button><Button disabled={busy||disabled} onClick={onRefresh}>원본 목록 확인</Button></div>}
  {notice&&<Alert severity="success">{notice}</Alert>}
  {packet&&<p>현재 원본 이용조건: 저장·조회 {decisions[packet.current.original_storage]} · 검색 {decisions[packet.current.internal_search]} · AI 전송 {decisions[packet.current.external_ai]}</p>}
  {packet&&!canWrite&&<p>읽기 전용입니다. 실행 소유자 또는 팀 관리자에게 원본 이용조건 확인을 요청하세요.</p>}
  <div className="source-policy-purpose-grid">{purposes.map(p=><TextField key={p} fullWidth select label={labels[p]} value={draft[p]} disabled={locked} onChange={e=>edit({[p]:e.target.value})}>{Object.entries(decisions).map(([value,label])=><MenuItem key={value} value={value}>{label}</MenuItem>)}</TextField>)}</div>
  <TextField fullWidth label="원본 허가 근거" value={draft.evidence_reference} disabled={locked} onChange={e=>edit({evidence_reference:e.target.value})} helperText="이 원본 JSON에 적용되는 라이선스·계약·허가 확인 자료" slotProps={{htmlInput:{maxLength:2000}}}/>
  <TextField fullWidth multiline minRows={2} label="원본 확인 사유" value={draft.reason} disabled={locked} onChange={e=>edit({reason:e.target.value})} slotProps={{htmlInput:{maxLength:4000}}}/>
  <p>허가 여부는 사용자의 확인 진술이며 법적 권리 인증이 아닙니다. 학습 기능은 없습니다. 이 기록은 새 자료 수집 동의나 텍스트·PDF 이용조건을 대신하지 않습니다.</p>
  <Button variant="contained" disabled={locked||!draft.evidence_reference.trim()||!draft.reason.trim()||packet?.current.policy_revision===100} onClick={()=>void save()}>원본 이용조건 기록</Button>
  <details><summary>원본 이용조건 변경 이력 ({packet?.history.length??0})</summary>{packet?.history.map(p=><article key={p.policy_revision}><strong>이력 {p.policy_revision}</strong><p>{purposes.map(k=>`${labels[k]}: ${decisions[p[k]]}`).join(' / ')}</p><p>{p.reason}</p><p>근거: {p.evidence_reference}</p><small>{p.created_at&&new Date(p.created_at).toLocaleString('ko-KR')} · 기록자 {p.asserted_by}</small></article>)}</details>
 </div>;
}

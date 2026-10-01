import {useEffect,useId,useRef,useState} from 'react';
import {Alert,Button,Checkbox,FormControlLabel} from '@mui/material';
import {useTeamSession} from './AccessShell';
import {strictJson} from './field-review.ts';
import {readSourceMetadata,type MetadataPacket} from './research-source-policy';
import {readSavedArtifact,readSavedAttempts,readSavedStream,savedBindings,type AttemptSummary,type SavedArtifact,type SavedBinding} from './saved-research-review';
import './source-policy.css';
import SavedReviewUsage from './SavedReviewUsage';
import type {ScoutContext} from './evidence-scout';
import SavedReviewNextSteps from './SavedReviewNextSteps';

const labels={RUNNING:'종료 기록 없음',COMPLETED:'검토 완료',FAILED:'검토 실패',CANCELLED:'중단됨'};
const failureLabels:Record<string,string>={MODEL_POLICY_DENIED:'이용조건이나 권한이 변경되어 결과를 게시하지 않았습니다.',MODEL_FAILED:'모델 요청이 완료되지 않았습니다.',MODEL_RESPONSE_REJECTED:'응답이 인용 검증을 통과하지 못했습니다.',CANCELLED:'대기를 중단했습니다.',INTERRUPTED:'실행이 중단되었습니다.'};
const errorText=(e:unknown)=>e instanceof Error?e.message:'저장 자료 재검토를 완료하지 못했습니다.';
async function json(path:string,signal:AbortSignal){
 const r=await fetch(path,{signal,cache:'no-store'});
 if(!r.ok)throw Error(r.status===403?'현재 이용조건 또는 권한으로 이 결과를 볼 수 없습니다.':r.status===409?'자료 버전이 바뀌었습니다. 출처와 실행 기록을 새로고침하세요.':r.status===401?'로그인이 만료되었습니다.':'저장 자료 재검토 정보를 불러오지 못했습니다.');
 const raw=await r.text();if(raw.length>8_000_000)throw Error('응답이 너무 큽니다.');return strictJson(raw,8_000_000);
}

export default function SavedResearchReview({runId,disabled=false,embedded=false,initialSourceIds=[],onIntake,onBusy}:{runId:string;disabled?:boolean;embedded?:boolean;initialSourceIds?:string[];onIntake?:(context:ScoutContext)=>void;onBusy?:(busy:boolean)=>void}){
 const session=useTeamSession(),[expanded,setExpanded]=useState(false),[running,setRunning]=useState(false),id=useId();
 useEffect(()=>{onBusy?.(running);return()=>onBusy?.(false);},[running,onBusy]);
 if(!session)return null;
 if(embedded)return <SavedPanel key={runId} runId={runId} disabled={disabled} initialSourceIds={initialSourceIds} onIntake={onIntake} onBusy={setRunning}/>;
 return <div className="source-policy-entry">
  <Button disabled={disabled||running} aria-expanded={expanded} aria-controls={id} onClick={()=>setExpanded(v=>!v)}>저장 자료로 다시 검토</Button>
  {expanded&&<div id={id}><SavedPanel key={runId} runId={runId} disabled={disabled} initialSourceIds={initialSourceIds} onIntake={onIntake} onBusy={setRunning}/></div>}
 </div>;
}
function SavedPanel({runId,disabled,initialSourceIds,onIntake,onBusy}:{runId:string;disabled:boolean;initialSourceIds:string[];onIntake?:(context:ScoutContext)=>void;onBusy:(busy:boolean)=>void}){
 const session=useTeamSession(),base=`/api/research/runs/${encodeURIComponent(runId)}`;
 const [metadata,setMetadata]=useState<MetadataPacket|null>(null),[attempts,setAttempts]=useState<AttemptSummary[]>([]),[selected,setSelected]=useState<string[]>([]),[consent,setConsent]=useState(false);
 const [loading,setLoading]=useState(false),[running,setRunning]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState(''),[artifact,setArtifact]=useState<SavedArtifact|null>(null);
 const [usageRevision,setUsageRevision]=useState(0);
 useEffect(()=>{onBusy(running);return()=>onBusy(false);},[running,onBusy]);
 const operation=useRef<{controller:AbortController;generation:number}|null>(null),generation=useRef(0);
 function begin(){operation.current?.controller.abort();const next={controller:new AbortController(),generation:++generation.current};operation.current=next;return next;}
 const current=(op:{controller:AbortController;generation:number})=>generation.current===op.generation&&!op.controller.signal.aborted;
 async function refresh(){
  const op=begin();setLoading(true);setError('');setArtifact(null);setConsent(false);setNotice('');
  try{
   const [m,a]=await Promise.all([json(`${base}/source-metadata`,op.controller.signal),json(`${base}/review-attempts`,op.controller.signal)]);
   const next=readSourceMetadata(m,runId),history=readSavedAttempts(a,runId);if(!current(op))return;
   setMetadata(next);setAttempts(history);setSelected([...new Set(initialSourceIds)].filter(id=>next.sources.some(s=>s.source_id===id&&s.usage_policy.original_storage==='ALLOW'&&s.usage_policy.external_ai==='ALLOW')).slice(0,8));
  }catch(e){if(current(op)){setError(errorText(e));setMetadata(null);setAttempts([]);}}
  finally{if(current(op)){setLoading(false);setUsageRevision(v=>v+1);}}
 }
 useEffect(()=>{void refresh();return()=>{generation.current++;operation.current?.controller.abort();};},[runId]);
 async function open(id:string){
  const op=begin();setLoading(true);setArtifact(null);setError('');
  try{const value=readSavedArtifact(await json(`${base}/review-attempts/${encodeURIComponent(id)}`,op.controller.signal),runId,id);if(current(op))setArtifact(value);}
  catch(e){if(current(op))setError(errorText(e));}finally{if(current(op))setLoading(false);}
 }
 async function run(){
  if(!metadata||!consent||running||loading||disabled||!session||session.role==='viewer')return;
  let bindings:SavedBinding[];try{bindings=savedBindings(metadata.sources,selected);}catch(e){setError(errorText(e));return;}
  const op=begin();setRunning(true);setArtifact(null);setError('');setNotice('전송 조건을 확인하고 있습니다.');
  try{
   const response=await fetch(`${base}/review-saved`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({model_consent:true,source_bindings:bindings}),signal:op.controller.signal});
   if(!response.ok)throw Error(response.status===409?'출처 지문·이용조건이 바뀌었거나 다른 모델 작업이 실행 중입니다. 새로고침 후 다시 확인하세요.':response.status===403?'현재 권한 또는 이용조건으로는 전송할 수 없습니다. 출처 이용조건과 수집 원본 이용조건을 확인하세요.':response.status===401?'로그인이 만료되었습니다.':'재검토를 시작하지 못했습니다. 자동으로 재시도하지 않았습니다.');
   if(!current(op)){await response.body?.cancel();return;}
   const id=await readSavedStream(response,runId,id=>{if(current(op))setNotice(`검토 요청을 시작했습니다. 실행 ${id}`);});
   if(!current(op))return;
   const value=readSavedArtifact(await json(`${base}/review-attempts/${id}`,op.controller.signal),runId,id,bindings);
   if(!current(op))return;setArtifact(value);setConsent(false);setNotice('');
   const history=readSavedAttempts(await json(`${base}/review-attempts`,op.controller.signal),runId);if(current(op))setAttempts(history);
  }catch(e){if(current(op)){setArtifact(null);setError(errorText(e));}}
  finally{if(current(op)){setRunning(false);setUsageRevision(v=>v+1);}}
 }
 function cancel(){operation.current?.controller.abort();generation.current++;setRunning(false);setLoading(false);setConsent(false);setNotice('대기를 중단했습니다. 이미 전송한 요청의 사용량은 취소되지 않을 수 있습니다. 실행 기록을 새로고침하세요.');}
 const locked=disabled||loading||running,canRun=session?.role==='admin'||session?.role==='reviewer';
 return <section className="source-policy-panel" aria-label="저장 자료 재검토" aria-busy={loading||running}>
  <header><h3>저장 자료만 다시 검토</h3><Button disabled={locked} onClick={()=>void refresh()}>출처·실행 기록 새로고침</Button></header>
  <p>새 검색이나 PDF 다운로드 없이 선택한 출처를 한 번 검토합니다. 원래 조사 결과는 바꾸지 않고 별도 실행 기록을 남깁니다.</p>
  {error&&<Alert severity="error">{error}</Alert>}
  {notice&&<p role="status">{notice}</p>}
  {loading&&<p role="status">저장된 이용조건과 기록을 확인하고 있습니다.</p>}
  {!canRun&&<p>읽기 전용입니다. 검토 실행은 검토자 또는 팀 관리자가 할 수 있습니다.</p>}
  <fieldset disabled={locked||!canRun} className="saved-review-sources"><legend>전송할 출처 · 최대 8개</legend>
   {metadata?.sources.map(s=>{const p=s.usage_policy,allowed=p.original_storage==='ALLOW'&&p.external_ai==='ALLOW';return <div key={`${s.source_id}:${s.source_digest}`}>
    <FormControlLabel control={<Checkbox checked={selected.includes(s.source_id)} disabled={!allowed||!selected.includes(s.source_id)&&selected.length>=8} onChange={e=>{setSelected(ids=>e.target.checked?[...ids,s.source_id]:ids.filter(id=>id!==s.source_id));setConsent(false);}}/>} label={s.title}/>
    <small>{allowed?`출처 텍스트 허용 · 이력 ${p.policy_revision}. 연결된 수집 원본의 조건도 실행 전에 확인합니다.`:'원문 조회와 외부 AI 전송 허가가 필요합니다. 출처 이용조건에서 확인하세요.'}</small>
   </div>;})}
   {metadata?.sources.length===0&&<p>저장된 출처가 없습니다.</p>}
  </fieldset>
  <FormControlLabel control={<Checkbox checked={consent} disabled={locked||!canRun||selected.length===0} onChange={e=>setConsent(e.target.checked)}/>} label={`선택한 ${selected.length}개 출처와 조사 맥락을 외부 AI에 보내는 데 동의합니다.`}/>
  <p>실제 전송 직전에 서버가 현재 권한과 이용조건을 다시 확인합니다. 이 검토는 임상 승인이나 PDF 전문 검토가 아닙니다.</p>
  <div className="source-policy-actions"><Button variant="contained" disabled={locked||!canRun||!consent||selected.length===0} onClick={()=>void run()}>선택한 자료 검토 · AI 1회</Button>{running&&<Button onClick={cancel}>대기 중단</Button>}</div>
  {attempts.some(a=>a.status==='RUNNING')&&<Alert severity="info">종료 기록이 없는 요청은 아직 실행 중이거나 서버가 중단된 상태일 수 있습니다. 실제 호출 수·비용은 확정할 수 없으며 자동으로 다시 실행하지 않습니다.</Alert>}
  {usageRevision>0&&<SavedReviewUsage runId={runId} revision={usageRevision}/>}
  <details><summary>재검토 실행 기록 ({attempts.length})</summary>{attempts.map(a=><div key={a.attempt_id}><Button disabled={locked} onClick={()=>void open(a.attempt_id)}>{new Date(a.created_at).toLocaleString('ko-KR')} · {labels[a.status]} · {a.status==='RUNNING'?'호출 수 미확정':`호출 ${a.model_calls}회`}</Button></div>)}</details>
  {artifact&&<section aria-label="저장 자료 재검토 결과"><h4>{labels[artifact.status]}</h4><p>선택 출처 {artifact.sources.length}개 · 새 수집 0회 · {artifact.status==='RUNNING'?'AI 호출 수 미확정':`AI 호출 ${artifact.model_calls}회`}</p>
   {artifact.error_code&&<Alert severity="warning">{failureLabels[artifact.error_code]}</Alert>}
   {artifact.review&&<><p>{artifact.review.conclusion==='INSUFFICIENT_EVIDENCE'?'근거가 부족합니다.':'전문가 검토가 필요합니다.'}</p>{artifact.review.findings.map((f,i)=><article key={`${f.source_id}:${i}`}><h5>{artifact.sources.find(s=>s.source_id===f.source_id)?.title}</h5><blockquote>{f.quote}</blockquote><p>{f.interpretation}</p><small>원문 인용 위치 {artifact.citation_bindings[i].start}–{artifact.citation_bindings[i].end} (유니코드 문자 기준)</small></article>)}{artifact.review.questions.length>0&&<><h5>다음 검토 질문</h5><ul>{artifact.review.questions.map((q,i)=><li key={i}>{q}</li>)}</ul></>}</>}
   {artifact.notices.map((n,i)=><p key={i}>{n}</p>)}
   <SavedReviewNextSteps key={artifact.attempt_id} artifact={artifact} disabled={locked} onIntake={onIntake}/>
  </section>}
 </section>;
}

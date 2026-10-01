import {useEffect,useRef,useState} from 'react';
import {Alert,Button,Checkbox,FormControlLabel,TextField} from '@mui/material';
import {useTeamSession} from './AccessShell';
import {approveFlowSelection,loadFlowMetadata,reviewReadiness,type FlowMetadata} from './team-review-flow';
import SavedResearchReview from './SavedResearchReview';
import SourcePolicyManager from './SourcePolicyManager';
import ResearchRawPolicy from './ResearchRawPolicy';
import type {ScoutContext} from './evidence-scout';
import './team-review-flow.css';

/** Existing blue/white TrialBoard: one continuous task, not a new dashboard. */
export default function TeamReviewWorkflow({runId,disabled=false,onIntake,onBusy}:{runId:string;disabled?:boolean;onIntake?:(context:ScoutContext)=>void;onBusy?:(busy:boolean)=>void}){
 const session=useTeamSession(),[stage,setStage]=useState<'prepare'|'review'>('prepare');
 const [metadata,setMetadata]=useState<FlowMetadata|null>(null),[selected,setSelected]=useState<string[]>([]),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
 const [evidence,setEvidence]=useState(''),[reason,setReason]=useState(''),[textConfirmed,setTextConfirmed]=useState(false),[rawConfirmed,setRawConfirmed]=useState(false),[revision,setRevision]=useState(0);
 const active=useRef<AbortController|null>(null);
 const [reviewBusy,setReviewBusy]=useState(false);
 const [saving,setSaving]=useState(false);
 useEffect(()=>{onBusy?.(reviewBusy||saving);return()=>onBusy?.(false);},[reviewBusy,saving,onBusy]);
 const canManage=Boolean(session&&session.role!=='viewer'&&metadata?.sources.can_manage&&metadata?.raw.can_manage),locked=disabled||busy||reviewBusy;
 const ready=Boolean(metadata&&selected.length&&selected.every(id=>reviewReadiness(metadata,id).ready));
 function resetConsent(){setTextConfirmed(false);setRawConfirmed(false);}
 async function refresh(){active.current?.abort();const c=new AbortController();active.current=c;setBusy(true);setError('');resetConsent();
  try{const next=await loadFlowMetadata(runId,c.signal);if(c.signal.aborted)return;setMetadata(next);setSelected([]);setRevision(v=>v+1);}
  catch(e){if(!c.signal.aborted){setMetadata(null);setError(e instanceof Error?e.message:'목록을 확인하지 못했습니다.');}}
  finally{if(!c.signal.aborted)setBusy(false);}
 }
 useEffect(()=>{void refresh();return()=>active.current?.abort();},[runId]);
 async function approve(){if(!metadata||!canManage||locked)return;active.current?.abort();const c=new AbortController();active.current=c;setBusy(true);setSaving(true);setError('');setNotice('선택한 자료의 확인 기록을 저장합니다. AI는 아직 요청하지 않습니다.');
  try{await approveFlowSelection({runId,metadata,selected,evidence,reason,textConfirmed,rawConfirmed,signal:c.signal,onProgress:(n,total)=>{if(!c.signal.aborted)setNotice(`이용조건 ${n}/${total}건 기록`);}});
   const next=await loadFlowMetadata(runId,c.signal);if(c.signal.aborted)return;setMetadata(next);resetConsent();setRevision(v=>v+1);
   if(!selected.every(id=>reviewReadiness(next,id).ready))throw Error('일부 자료의 이용조건이 달라졌습니다. 다시 확인하세요.');
   setNotice('이용조건을 기록했습니다. 다음 단계에서 AI 전송에 별도로 동의하세요.');setStage('review');
  }catch(e){if(!c.signal.aborted){setError(e instanceof Error?e.message:'일부 기록을 저장하지 못했습니다.');setNotice('');}}
  finally{if(!c.signal.aborted){setBusy(false);setSaving(false);}}
 }
 if(!session)return null;
 return <section className="team-review-flow" aria-label="수집에서 검토로 이어가기" aria-busy={busy}>
  <header><div><h3>모은 자료로 검토를 이어가세요</h3><p>검토할 자료 선택 → 이용조건 확인 → AI 검토 → KOL·원문 확인</p></div><Button disabled={locked} onClick={()=>{setStage('prepare');void refresh();}}>목록 다시 확인</Button></header>
  {error&&<Alert severity="error">{error}</Alert>}{notice&&<p role="status">{notice}</p>}{busy&&<p role="status">처리 중입니다. 자동으로 AI를 실행하지 않습니다.</p>}
  {stage==='prepare'&&<>
   {!canManage&&metadata&&<Alert severity="info">자료 선택과 기존 검토 조회는 가능합니다. 이용조건 변경은 실행 소유자 또는 팀 관리자에게 요청하세요.</Alert>}
   <fieldset disabled={locked} className="team-flow-sources"><legend>검토할 자료 · 최대 8개</legend>
    {metadata?.sources.sources.map(source=>{const state=reviewReadiness(metadata,source.source_id);return <div key={source.source_id}>
     <FormControlLabel control={<Checkbox checked={selected.includes(source.source_id)} disabled={!selected.includes(source.source_id)&&selected.length>=8} onChange={e=>{setSelected(ids=>e.target.checked?[...ids,source.source_id]:ids.filter(id=>id!==source.source_id));resetConsent();}}/>} label={source.title}/>
     <small>{state.reason} · 연결 원본 {state.rawCount}개</small>
    </div>;})}
    {metadata?.sources.sources.length===0&&<p>수집된 출처가 없습니다. 검색어·수집 허가·수집 실패 기록을 확인한 뒤 새로 수집하세요.</p>}
   </fieldset>
   {selected.length>0&&!ready&&<div className="team-flow-approval"><h4>선택 자료의 이용조건 함께 확인</h4><p>선택한 텍스트와 연결된 수집 원본에 같은 허가 근거가 적용될 때 사용하세요. 각각 다른 조건이면 아래 상세 설정에서 기록하세요. 내부 검색·학습 조건과 PDF 허가는 바꾸지 않습니다.</p>
    <TextField fullWidth label="선택 자료의 허가 근거" value={evidence} disabled={locked||!canManage} onChange={e=>{setEvidence(e.target.value);resetConsent();}} slotProps={{htmlInput:{maxLength:2000}}}/>
    <TextField fullWidth label="선택 자료의 확인 사유" multiline minRows={2} value={reason} disabled={locked||!canManage} onChange={e=>{setReason(e.target.value);resetConsent();}} slotProps={{htmlInput:{maxLength:4000}}}/>
    <FormControlLabel control={<Checkbox checked={textConfirmed} disabled={locked||!canManage} onChange={e=>setTextConfirmed(e.target.checked)}/>} label="선택한 출처 텍스트의 저장·조회와 외부 AI 전송 허가를 확인했습니다."/>
    <FormControlLabel control={<Checkbox checked={rawConfirmed} disabled={locked||!canManage} onChange={e=>setRawConfirmed(e.target.checked)}/>} label="연결된 수집 원본에도 저장·조회와 외부 AI 전송 허가가 적용됨을 확인했습니다."/>
    <p>공개 자료라는 이유로 허가를 추정하지 않습니다. 기존 금지·미확인 조건을 변경하는 사용자 확인 기록이며, 이 버튼은 AI를 호출하지 않습니다.</p>
    <Button variant="contained" disabled={locked||!canManage||!textConfirmed||!rawConfirmed||!evidence.trim()||!reason.trim()} onClick={()=>void approve()}>이용조건 기록 후 검토로</Button>
   </div>}
   {ready&&<Button variant="contained" disabled={locked} onClick={()=>{setNotice('');setStage('review');}}>선택 자료 AI 검토로</Button>}
   <details className="team-flow-details"><summary>자료별 상세 이용조건·기존 검토 기록</summary><SourcePolicyManager runId={runId} disabled={locked}/><ResearchRawPolicy runId={runId} disabled={locked}/><SavedResearchReview runId={runId} disabled={disabled||busy} onIntake={onIntake} onBusy={setReviewBusy}/><p>상세 설정을 바꿨다면 ‘목록 다시 확인’을 눌러 새 조건을 반영하세요.</p></details>
  </>}
  {stage==='review'&&<><Button disabled={locked} onClick={()=>setStage('prepare')}>자료 선택으로 돌아가기</Button><SavedResearchReview key={`${runId}:${revision}:${selected.join(',')}`} runId={runId} disabled={disabled} embedded initialSourceIds={selected} onIntake={onIntake} onBusy={setReviewBusy}/></>}
 </section>;
}

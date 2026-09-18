import {useRef,useState} from 'react';
import {Button,CircularProgress,Tab,Tabs} from '@mui/material';
import {Check,ChevronRight,Pause,Radio,Square} from 'lucide-react';
import type {AutoEvent,AutoOutcome} from './auto-review';
import {agentScene} from './agent-scene';
import {activityArtifacts,taskDescriptions} from './activity-model';
import styles from './AgentActivity.module.css';
import ResearchProgress,{ResearchSummary} from './ResearchProgress';

const labels={done:'기록 확인',running:'진행 중',waiting:'대기',partial:'확인 필요',skipped:'생략',passed:'단계 이동'};
export default function AgentActivity({events,outcome,busy,seconds,query,onStop,replay=false,playing=false}:{events:AutoEvent[];outcome:AutoOutcome|null;busy:boolean;seconds:number;query:string;onStop:()=>void;replay?:boolean;playing?:boolean}){
 const [view,setView]=useState('activity');
 const lastUpdate=useRef({length:events.length,seconds});
 if(lastUpdate.current.length!==events.length)lastUpdate.current={length:events.length,seconds};
 const last=events.at(-1),terminal=replay&&['COMPLETE','ERROR','FAILED','CANCELLED'].includes(last?.research?.stage??'');
 const scene=agentScene(events,outcome,replay?!terminal:busy),artifacts=activityArtifacts(events),moving=replay?playing:busy;
 const title=terminal?(last?.research?.stage==='COMPLETE'?'저장된 조사 완료':'저장된 중단·실패 기록'):scene.title;
 const recordedOnly=replay?'기록 재생':busy?'실행 중':outcome?.kind==='scope'?'선택 대기':'실행 기록';
 return <section className={styles.console} aria-label={replay?'저장된 에이전트 작업 재생':'실제 에이전트 작업 상태'} data-moving={moving}>
  <header className={styles.header}><div><span className={styles.eyebrow}>근거 검토</span><h2>{query}</h2></div><div className={styles.controls}><span className={styles.mode}><Radio size={15}/>{recordedOnly}</span><time>{Math.floor(seconds/60)}:{String(seconds%60).padStart(2,'0')}</time>{busy&&!replay&&<Button size="small" startIcon={<Square size={14}/>} onClick={onStop}>중단</Button>}</div></header>
  <div className={styles.layout}><aside className={styles.rail}><h3>진행 단계</h3><ol>{scene.stages.map((step,i)=><li key={step.label} data-active={i===scene.active} data-state={step.state} aria-current={i===scene.active?'step':undefined}><span className={styles.stepIcon}>{i===scene.active&&moving?<CircularProgress size={15} color="inherit"/>:step.state==='done'?<Check size={15}/>:String(i+1).padStart(2,'0')}</span><div><strong>{step.label}</strong><small>{replay&&i>=4?'재생 범위 밖':replay&&i===scene.active?'선택된 기록':labels[step.state]}</small></div></li>)}</ol><p>수집 → AI 검토 → 계산의 순차 흐름입니다.</p></aside>
   <div className={styles.main}><div className={styles.current}><div className={styles.currentLabel}>{moving?<span className={styles.liveDot}/>:<Pause size={14}/>}<span>{replay?'기록에서 선택한 작업':busy?'지금 하는 일':'현재 상태'}</span></div><h3>{title}</h3><p>{scene.active>=0?taskDescriptions[scene.active]:outcome?.kind==='scope'?'검토할 약물·적응증을 선택하면 조사를 이어갑니다.':'확보한 내용과 미확인 항목은 결과에서 확인하세요.'}</p><div className={styles.message} role="status" aria-live="polite">{last?.message??'서버에 연결하고 있습니다.'}</div></div>
    {busy&&!replay&&<p className={styles.heartbeat}>최근 작업 알림 후 {Math.max(0,seconds-lastUpdate.current.seconds)}초 · {['AI_PLAN','AI_REVIEW'].includes(last?.research?.stage??'')?'모델 응답을 기다리는 중입니다.':'다음 작업 알림을 기다리는 중입니다.'}</p>}
    <ResearchSummary events={events}/>
    <Tabs value={view} onChange={(_,v)=>setView(v)} aria-label="실행 중 확인할 내용" className={styles.tabs} variant="scrollable" scrollButtons="auto"><Tab value="activity" label="조사 현황"/><Tab value="log" label={'진행 기록 '+events.length}/>{!replay&&<Tab value="artifacts" label="자료 목록"/>}</Tabs>
    {view==='activity'&&<div className={styles.feed}><ResearchProgress events={events} replay={replay}/></div>}
    {view==='log'&&<div className={styles.feed} role="region" aria-label="최근 작업 기록"><ol>{events.slice(-6).reverse().map((e,i)=><li key={events.length-i} data-latest={i===0}><span className={styles.feedIndex}>{String(events.length-i).padStart(2,'0')}</span><div><p>{e.message}</p><small>{e.research?(e.research.elapsed_ms/1000).toFixed(1)+'초 · '+e.research.stage:e.stage}</small></div></li>)}</ol>{!events.length&&<p className={styles.empty}>첫 작업 알림을 기다리고 있습니다.</p>}</div>}
    {view==='artifacts'&&!replay&&<div className={styles.feed} role="region" aria-label="수신한 자료와 검토 내용">{artifacts.sources.length>0?<ul className={styles.sources}>{artifacts.sources.slice(-6).map(s=><li key={s.id}><span>{s.kind}</span><p>{s.title}</p></li>)}</ul>:<p className={styles.empty}>자료 목록은 도착하는 대로 표시됩니다.</p>}{artifacts.review&&<><h4>AI 검토 쟁점 · 검증 전</h4>{artifacts.review.findings.slice(0,2).map((f,i)=><p key={i}>{f.interpretation}</p>)}</>}{artifacts.items.slice(0,2).map(item=><p key={item.id}>{item.text}</p>)}{artifacts.plan&&<><h4>AI 후속 조사 계획</h4><ul>{artifacts.plan.priorities.slice(0,3).map(p=><li key={p.source_id}>{p.reason}</li>)}</ul><p>{artifacts.plan.followup_terms.join(' · ')}</p></>}</div>}
    <div className={styles.next}><span>다음</span><strong>{outcome?.kind==='scope'?'검토 범위 선택':terminal?'브리핑 확인':scene.active>=0&&scene.active<7?scene.stages[scene.active+1].label:'결과·미확인 범위 확인'}</strong><ChevronRight size={16}/></div>
   </div></div>
  <footer className={styles.footer}><span>{replay?'조사·AI 검토 기록':'작업 기록'} · {events.length}개</span><details><summary>전체 기록</summary><ol>{events.map((e,i)=><li key={i}>{e.message}</li>)}</ol></details></footer>
 </section>;
}

import { Chip } from "@mui/material";
import { Check, FileSearch, ShieldCheck, MessageSquare, RefreshCw } from "lucide-react";
import type { LiveProgress } from "./agent-live";
import { liveWorkbench, findingLabel } from "./live-workbench";
const kindNames={source:"검토 자료",observation:"추출 초안 · 미확인",finding:"규칙 검사 쟁점",concern:"모델 제기 반론 · 검증 전",question:"모델 작성 확인 질문",decision:"실행 제어 결정 · 규칙 기반"};
const stages=[['EXTRACT','추출',FileSearch],['VERIFY','검사',ShieldCheck],['CRITIQUE','반론',MessageSquare],['REVISE','수정',RefreshCw]] as const;
export function LiveWorkbench({events,busy,error,complete,seconds}:{events:LiveProgress[];busy:boolean;error:string;complete:string|null;seconds:number}) {
 const state=liveWorkbench(events,busy,error,complete);
 return <section className="live-workbench" aria-label="실시간 작업 보드">
   <div className="live-workbench-heading"><div><span>AGENT ACTIVITY · 서버 이벤트 기반</span><h3 role="status">{state.title}</h3></div><Chip label={`${state.status} · ${seconds}초`} variant="outlined"/></div>
   <p>{state.task?.purpose ?? "실제 서버 응답이 오기 전에는 진행 단계를 임의로 올리지 않습니다."}</p>
   <ol className="live-stage-rail">{stages.map(([id,label,Icon])=>{const matching=events.filter(e=>e.stage===id),last=matching.at(-1);return <li key={id} className={busy && state.last?.stage===id?'active':last?.state==='COMPLETED'?'done':''}><Icon size={19}/><strong>{label}</strong><span>{last?.state==='COMPLETED'?<><Check size={14}/>응답 수신</>:last?busy?'진행 중':'완료 응답 없음':id==='REVISE'?'필요·예산에 따라':'아직 시작 안 함'}</span></li>;})}</ol>
   {state.latestObservations.length>0&&<section aria-label="최신 추출 초안"><h4>지금 찾은 관측값 · 미확인 초안</h4><p>마지막 추출/수정 응답입니다. 채택된 계산 입력이나 검토 완료 표시가 아닙니다.</p><div className="live-observation-cards">{state.latestObservations.map(item=><article key={item.id}><strong>{item.id}</strong><p>{item.text}</p><small>원문 {item.span_ids.join(', ')}</small></article>)}</div></section>}
   <div className="live-workbench-grid"><section><h4>최근 산출물 · 최대 24개 <span>{state.outputs.length}</span></h4><div className="live-output-list" role="log" aria-live="polite" aria-relevant="additions">{!state.outputs.length?<p>아직 산출물을 받지 못했습니다. 추출·검사·반론 응답이 도착하면 여기에 나타납니다.</p>:state.outputs.map((item,i)=><article key={`${item.stage}-${item.attempt}-${item.id}-${i}`}><small>{kindNames[item.kind]} · 시도 {item.attempt+1} · 서버 {(item.elapsed_ms/1000).toFixed(1)}초</small>{item.kind==='finding'&&findingLabel(item.text)&&<p><strong>{findingLabel(item.text)}</strong></p>}<p>{item.text}</p>{item.span_ids.length>0&&<span>연결 문구 {item.span_ids.join(', ')}</span>}</article>)}</div></section>
   <aside><h4>다음 단계</h4><p>{error?"자동 재시도하지 않습니다. 중단 기록을 확인하고 재실행 여부를 결정하세요.":complete?"최종 기록에서 채택/보류와 근거를 확인하세요. 아래 산출물만으로 설계를 확정하지 않습니다.":state.task?.next??"실행 시작과 현재 작업을 확인합니다."}</p><details><summary>검토 요청 문구 · 앞의 최대 6개</summary>{state.sources.map(s=><blockquote key={s.id}><strong>{s.id}</strong><p>{s.text}</p></blockquote>)}</details><small>표시 내용은 작업 상태와 명시적 산출물입니다. 내부 사고 전문이 아니며, 긴 내용은 1,000자까지 표시합니다.</small></aside></div>
 </section>;
}

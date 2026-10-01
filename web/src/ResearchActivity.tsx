import {useEffect, useRef} from "react";
import {isLegacyPlan,planFollowups,type ResearchEvent,type ResearchPlan,type ResearchSource} from "./research";

export default function ResearchActivity({busy,events,seconds,plan,sources=[],collectionOnly=false}:{
  busy:boolean; events:ResearchEvent[]; seconds:number;
  plan?:ResearchPlan|null; sources?:ResearchSource[]; collectionOnly?:boolean;
}) {
  const board=useRef<HTMLDivElement>(null);
  useEffect(()=>{if(busy)board.current?.scrollIntoView({block:"start",behavior:"smooth"});},[busy]);
  if(!busy && !events.length && !plan)return null;
  const last=events.at(-1);
  const stages=new Set(events.map(e=>e.stage));
  const active=last?.stage;
  const steps=collectionOnly?[
    {label:"허가한 공개 자료 수집",done:stages.has("COMPLETE"),active:busy},
  ]:[
    {label:"공개 자료 수집",done:stages.has("SOURCE"),active:!stages.has("AI_PLAN_READY")&&(active==="SEARCH"||active==="SOURCE")},
    {label:"AI 조사 계획",done:stages.has("AI_PLAN_READY"),active:active==="AI_PLAN"},
    {label:"후속 검색",done:events.some(e=>e.stage==="SOURCE"&&e.message.startsWith("AI 추가")),active:active==="SEARCH"&&stages.has("AI_PLAN_READY")},
    {label:"인용 연결 검토",done:stages.has("REVIEW_READY"),active:active==="AI_REVIEW"},
  ];
  return <div ref={board} className="research-run-board">
    <div className="research-activity" role="status" aria-live="polite">
      <div><strong>{busy?collectionOnly?"허가한 자료 수집 중":"AGENT WORKING · 실제 실행 중":"조사 실행 기록"}</strong><span>{seconds}초</span></div>
      <h3>{active==="AI_PLAN"?"확보한 자료에서 다음 조사 방향을 정합니다":active==="AI_REVIEW"?"인용문을 대조하고 검토 초안을 작성합니다":last?.message??"작업 준비 중"}</h3>
      <div className="research-stages">{steps.map(s=><div key={s.label} data-active={busy&&s.active}><strong>{s.label}</strong><span>{busy&&s.active?"실행 중":s.done?"결과 수신":"아직 결과 없음"}</span></div>)}</div>
      <p className="research-task-note">{collectionOnly?"이 실행은 자료 수집만 요청했습니다. AI 분석과 PDF 다운로드는 이용조건 확인 후 별도로 실행합니다.":"실제 요청·수집·산출물 상태입니다. AI 내부 사고 전문이나 임상 검증 완료율이 아닙니다."}</p>
    </div>
    {plan&&<div className="research-plan"><h3>AI의 초기 조사 계획</h3><p>첫 검색에서 만든 계획입니다. 아래의 부족한 근거는 당시 판단이며 후속 검토에서 갱신될 수 있습니다.</p>
      {plan.priorities.map(p=><p key={p.source_id}><strong>{sources.find(s=>s.id===p.source_id)?.title??p.source_id}</strong><br/>{p.reason}</p>)}
      {planFollowups(plan).length>0&&<p>{isLegacyPlan(plan)?"과거 계획 검색어 · 실행 의도 미기록":"계획한 후속 검색 의도"}: {planFollowups(plan).map(x=>`${x.intent==="CONTRARIAN"?"실패·유해·중단 신호":"근거 공백"} — ${x.term}`).join(" · ")}</p>}
      <h4>초기 단계에서 확인이 필요했던 내용</h4><ul>{plan.missing_evidence.map((g,i)=><li key={i}>{g}</li>)}</ul>
    </div>}
    <details className="research-event-log" open={busy}><summary>시간순 작업 로그 · {events.length}개 이벤트</summary><ol>{events.slice().reverse().map(e=><li key={e.sequence}><span>{(e.elapsed_ms/1000).toFixed(1)}s</span><div><strong>{e.message}</strong>{e.query&&<p>{e.query}</p>}{e.sources?.slice(0,3).map(s=><p key={s.id}>{s.title}</p>)}</div></li>)}</ol></details>
  </div>;
}

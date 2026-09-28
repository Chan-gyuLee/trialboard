import { useEffect, useRef, useState } from "react";
import { Alert, Button, Chip, MenuItem, Tab, Tabs, TextField } from "@mui/material";
import { ArrowRight, ArrowDownToLine, GitCompareArrows, Layers, ShieldAlert } from "lucide-react";
import type { DesignResult } from "./design-result";
import { changeMarkdown, compareDesignRuns, designInsight, percent, percentagePoint } from "./design-insight";
import { downloadText } from "./review";
import styles from "./DesignOutcome.module.css";

export default function DesignOutcome({result, previous, scenarioId, onScenario, onEdit, onMeeting, onSelectRow, disabled}: {
  result: DesignResult; previous: DesignResult | null; scenarioId: string; onScenario: (id:string)=>void;
  onEdit:()=>void; onMeeting:()=>void; onSelectRow:(id:string)=>void; disabled:boolean;
}) {
  const [alternativeId,setAlternativeId]=useState(result.plans[1].id);
  const headingRef=useRef<HTMLHeadingElement>(null);
  useEffect(()=>{
    headingRef.current?.focus({preventScroll:true});
    headingRef.current?.closest("section")?.scrollIntoView({block:"start",behavior:"instant"});
  },[]);
  const effectiveAlternative=result.plans.slice(1).some(p=>p.id===alternativeId)?alternativeId:result.plans[1].id;
  const insight=designInsight(result,scenarioId,effectiveAlternative), selected=insight.scenario;
  const diff=previous?compareDesignRuns(previous,result):null;
  const questions=result.questions.filter(q=>q.priority==="BEFORE_COMPARISON" || q.category==="sample_size_tradeoff" && q.trigger.scenario_id===scenarioId);
  const nextQuestions=(questions.length?questions:result.questions.filter(q=>["assumptions","decision_rule","feasibility"].includes(q.category))).slice(0,3);
  return <section className={styles.outcome} aria-label="설계 비교 브리핑">
    <header className={styles.hero} data-blocked={insight.kind==="blocked"}>
      <div className={styles.heroTitle}><span className={styles.eyebrow}>DESIGN BRIEF</span><Chip size="small" label={insight.kind==="blocked"?"근거 확인 필요":"가정 기반 계산"}/></div>
      <h3 ref={headingRef} tabIndex={-1}>{insight.kind==="blocked"?"계산보다 먼저, 근거를 확인할 차례입니다.":insight.allUnsafe?"이 가정에서는 모든 용량군이 안전 한계를 넘습니다.":"참여자 수를 바꾸면, 판단은 얼마나 달라질까요?"}</h3>
      <p>{insight.kind==="blocked"?`${result.blockers.length}개의 검토 항목이 남아 계산을 보류했습니다. 필요한 원문과 다음 질문을 아래에서 확인하세요.`:insight.allUnsafe?"아래는 지정한 가정에서 선택을 보류한 빈도입니다. 실제 약물의 안전성 판정이 아닙니다.":"같은 근거와 가정으로 설계안을 비교했습니다. 추가 인원, 선택 빈도와 보류 빈도를 함께 검토하세요."}</p>
      <div className={styles.heroFooter}><span>{result.plans.length}개 설계 · {result.brief.scenarios.length}개 가정 · {result.brief.repetitions.toLocaleString()}회 반복</span><span>임상 권고 · 검정력 계산 아님</span></div>
    </header>
    {insight.kind==="blocked" ? <div className={styles.blockers}>{result.blockers.map((b,i)=><article key={i}><ShieldAlert size={20}/><div><strong>{b.observation_id??b.arm_id??"비교 자료"}</strong><p>{b.detail||b.code}</p><small>{b.code}</small></div>{b.observation_id&&<Button disabled={disabled} onClick={()=>onSelectRow(b.observation_id!)}>원문 확인</Button>}</article>)}</div> : <>
      <div className={styles.sectionHead}><h4>가정별 설계 비교</h4><Button disabled={disabled} onClick={onEdit}>가정 수정</Button></div>
      <Tabs value={scenarioId} onChange={(_,v)=>onScenario(v)} variant="scrollable" scrollButtons="auto" aria-label="결과 가정 선택" className={styles.tabs}>{result.brief.scenarios.map((s,i)=><Tab id={`outcome-tab-${s.id}`} aria-controls="outcome-scenario-panel" key={s.id} value={s.id} label={`${String(i+1).padStart(2,"0")} ${s.label}`}/>)}</Tabs>
      <div id="outcome-scenario-panel" role="tabpanel" aria-labelledby={`outcome-tab-${scenarioId}`}>
        <div className={styles.context}><Layers size={18}/><div><details><summary>{selected.label} <span>가정 근거 보기</span></summary><p>{selected.rationale}</p></details><span>{typeof selected.provenance==="string"?"사용자 지정 가정":"AI 제안에서 시작한 가정 · 사용자 편집 가능"}</span></div></div>
        {result.plans.length>2&&<TextField select label="기준 설계와 비교할 대안" value={effectiveAlternative} onChange={e=>setAlternativeId(e.target.value)}>{result.plans.slice(1).map(p=><MenuItem key={p.id} value={p.id}>{p.label}</MenuItem>)}</TextField>}
        <div className={styles.deltas} aria-label="기준 설계 대비 차이">
          <div><span>추가 참여자</span><strong>{insight.tradeoff!.additional_participants>=0?"+":""}{insight.tradeoff!.additional_participants}<small>명</small></strong><p>{result.plans[0].label} 대비</p></div>
          <div><span>가정상 올바른 선택·보류</span><strong>{percentagePoint(insight.tradeoff!.correct_selection_or_abstention_delta)}</strong><p>차이 MC SE {(insight.tradeoff!.delta_monte_carlo_se.true_utility_best*100).toFixed(1)}%p</p></div>
          <div><span>가정상 한계 초과군 선택</span><strong>{percentagePoint(insight.tradeoff!.unsafe_selection_delta)}</strong><p>{result.plans.find(p=>p.id===effectiveAlternative)?.label} − 기준</p></div>
        </div>
        <div className={styles.plans} role="region" aria-label="설계안별 선택 빈도">{insight.rows.filter(r=>[result.plans[0].id,effectiveAlternative].includes(r.plan.id)).map((row,i)=><article className={styles.plan} key={row.plan.id}>
          <div className={styles.planHeading}><span>{i===0?"기준 설계":"비교 대안"}</span><span>군당 {row.plan.per_arm}명</span></div><div className={styles.planIdentity}><h4>{row.plan.label}</h4><div className={styles.total}>{row.simulation.total}<small>명</small></div></div>
          <details className={styles.planReason}><summary>이 설계안을 비교하는 이유</summary><p>{row.plan.rationale}</p></details>
          {([['가정상 올바른 선택·보류',row.simulation.correct,row.simulation.se.true_utility_best],['가정상 한계 초과군 선택',row.simulation.unsafe,row.simulation.se.true_unsafe],['선택 보류',row.simulation.noSelection,row.simulation.se.no_selection]] as const).map(([label,value,se],j)=><div className={styles.metric} key={label}><div><span>{label}</span><strong>{percent(value)}</strong></div><div className={styles.track} aria-hidden="true"><span data-kind={j} style={{width:`${value*100}%`}}/></div><small>MC SE ± {percent(se)}</small></div>)}
        </article>)}</div>
        <p className={styles.note}>모든 군이 가정한 안전 한계를 초과하면 ‘올바른 선택·보류’는 선택하지 않은 빈도입니다. MC SE는 반복 계산의 수치 오차이며 임상적 불확실성이나 우월성 검정이 아닙니다.</p>
        <details className={styles.details}><summary>이 계산에 사용한 가정과 원문 근거</summary><p>효용 가중치 {selected.adverse_event_penalty} · 가정한 이상반응 한계 {percent(selected.maximum_adverse_event_rate)}</p>{result.brief.arms.map((a,i)=><div key={a.id} className={styles.evidence}><strong>{a.source_dose}</strong><span>가정 반응 {percent(selected.response[i])} · 이상반응 {percent(selected.adverse_event[i])}</span><div>{a.observation_ids.map(id=><Button key={id} size="small" disabled={disabled} onClick={()=>onSelectRow(id)}>{id} 원문</Button>)}</div></div>)}
          <p>용량별 선택 빈도</p>{insight.rows.map(r=><p key={r.plan.id}>{r.plan.label}: {Object.entries(r.simulation.selection).map(([id,p])=>`${result.brief.arms.find(a=>a.id===id)?.source_dose??id} ${percent(p)}`).join(" · ")}</p>)}
        </details>
      </div>
    </>}
    {diff && previous && <section className={styles.revision} aria-label="직전 계산과 변경 비교"><div className={styles.sectionHead}><div><span className={styles.eyebrow}>CHANGE REVIEW</span><h4><GitCompareArrows size={20}/> 바꾼 입력, 달라진 결과</h4></div><Button startIcon={<ArrowDownToLine size={16}/>} onClick={()=>downloadText("trialboard-calculation-changes.md",changeMarkdown(previous,result),"text/markdown;charset=utf-8")}>변경 요약 저장</Button></div>
      <p>{diff.reason}</p><p className={styles.note}>이 탭에서 보관 중인 직전 실행과 비교합니다. 새로고침 시 이전 실행은 복구되지 않습니다.</p>
      <details className={styles.details} open><summary>바뀐 입력 {diff.changes.length}개</summary>{diff.changes.length?diff.changes.map((c,i)=><div className={styles.change} key={i}><strong>{c.label}</strong><span>{c.before}</span><ArrowRight size={16}/><span>{c.after}</span></div>):<p>설계·가정 입력은 같습니다.</p>}</details>
      {!!diff.effects.length&&<div className={styles.table} role="region" aria-label="변경 전후 계산 빈도" tabIndex={0}><table><caption>이전 → 현재 · 동일 ID의 설계와 가정만 연결</caption><thead><tr><th>가정 / 설계</th><th>가정상 올바른 선택·보류</th><th>가정상 한계 초과군 선택</th><th>선택 보류</th></tr></thead><tbody>{diff.effects.map(e=><tr key={`${e.scenarioId}/${e.planId}`}><th>{e.label}</th>{[e.correct,e.unsafe,e.noSelection].map((m,i)=><td key={i}><span>{percent(m.before)} → {percent(m.after)}</span><strong>{percentagePoint(m.delta)}</strong></td>)}</tr>)}</tbody></table><p className={styles.note}>전후 차이는 기술적 요약입니다. 각 실행의 Monte Carlo 오차를 함께 확인하세요. 유의성 검정이 아닙니다.</p></div>}
    </section>}
    <section className={styles.next}><div className={styles.sectionHead}><div><span className={styles.eyebrow}>NEXT DECISION</span><h4>다음 회의에서 확인할 것</h4></div><Button variant="contained" endIcon={<ArrowRight size={16}/>} onClick={onMeeting}>KOL 질문과 회의 자료 보기</Button></div><ol>{nextQuestions.map(q=><li key={q.id}>{q.question}</li>)}</ol><span className={styles.note}>실제 근거·계산 조건에 연결한 규칙 기반 질문입니다. 전문가 답변은 별도 기록합니다.</span></section>
    <details className={styles.details}><summary>검토 범위·계산 한계·실행 식별 정보</summary><Alert severity="info">근거 링크와 계산 재현이 임상적 타당성을 증명하지 않습니다. 권장 설계안을 자동 선정하지 않습니다.</Alert><ul>{result.limitations.map(l=><li key={l}>{l}</li>)}</ul><p>{result.ai?`AI 재검토 파일 연결 · ${result.ai.mode} · 실행 진위 미인증`:"별도 AI 재검토 파일 미제공"}</p><p>실행 {result.runId}</p><p>입력 hash {result.briefDigest}</p></details>
  </section>;
}

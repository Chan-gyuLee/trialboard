import {coverageStopLabel} from './research';
import type {AutoEvent} from './auto-review';
import {channelLabel,contentLabel,researchProgress} from './research-progress';
import styles from './ResearchProgress.module.css';

export function ResearchSummary({events}:{events:AutoEvent[]}){
 const {inventory,input,anchors}=researchProgress(events);
 return <div className={styles.metrics} aria-label="수집과 검토 범위">
  <div><span>DB 출처</span><strong>{inventory?.total??'—'}</strong><small>{inventory?'중복 ID 제외':'집계 도착 전'}</small></div>
  <div><span>확보한 초록</span><strong>{inventory?.ABSTRACT??'—'}</strong><small>전문 검토 아님</small></div>
  <div><span>PDF 링크</span><strong>{inventory?.PDF_AVAILABLE??'—'}</strong><small>수집 시 본문 미검토</small></div>
  <div><span>{input?.stage==='AI_PLAN'?'AI 계획 입력':'AI 검토 입력'}</span><strong>{input?.input_sources?.length??'—'}</strong><small>{anchors!==undefined?`인용 구간 ${anchors}개`:'전체 출처와 구분'}</small></div>
 </div>;
}

/** Only received events are shown here; no simulated tasks or post-hoc source backfill. */
export default function ResearchProgress({events,replay}:{events:AutoEvent[];replay:boolean}){
 const {requests,inventory,input,artifacts}=researchProgress(events);
 return <div className={styles.progress} aria-label="실제 조사 내역">
  <div className={styles.scope}><strong>수집 ≠ 전문 검토</strong><span>문헌 검색별 20건, 시험번호·AI 후속 검색은 최대 40건. 출처 100개·최종 AI 검토 8개 한도입니다. 과거 기록은 당시 수집 범위를 따릅니다.</span></div>
  {input&&<details className={styles.input}><summary>AI에 전달한 자료 {input.input_sources!.length}개 확인</summary><ul>{input.input_sources!.map(id=>{const source=artifacts.sources.find(s=>s.id===id);return <li key={id}>{source?.title??id}<small>{contentLabel(source?.content_level)}</small></li>})}</ul><p>자료의 제한된 발췌문·인용 구간을 전달했습니다. 모든 전문을 읽었다는 뜻은 아닙니다.</p></details>}
  <div className={styles.columns}><section><h4>검색 경로 · {requests.length}개</h4>
   {requests.length?<div className={styles.searches}>{requests.map(r=><details key={r.key}><summary><span>{channelLabel(r.channel)}<span className={styles.queryPreview}>{r.receipt?.query??r.query}</span></span><b data-limited={r.receipt?.limited}>{r.receipt?r.receipt.status==='FAILED'?`실패 · ${r.receipt.fetched}건 보존`:r.receipt.status==='SKIPPED'?'한도로 생략':r.receipt.status==='EMPTY'?'결과 없음':`${r.receipt.fetched} / ${r.receipt.total??'?'}${r.receipt.limited?' · 일부':''}`:replay?'상세 미기록':'응답 기록 대기'}</b></summary><code>{r.receipt?.query??r.query}</code>{r.receipt&&<small>{r.receipt.channel==='Drugs@FDA'?'신청 건수 · 신청별 문서 최대 12개':'검색 응답 건수 · 중복/비대상 문헌 포함 가능'}{r.receipt.limited?' · 부분 수집':''}{r.receipt.pages!=null&&<><br/>{r.receipt.pages}페이지 · {coverageStopLabel(r.receipt)}</>}</small>}</details>)}</div>:<p>검색 요청이 도착하면 검색어와 수신 범위를 여기에 남깁니다.</p>}
  </section><section><h4>도착한 자료 · 표시 {artifacts.sources.length}개{inventory?` / DB ${inventory.total}개`:''}</h4>
   {artifacts.sources.length?<div className={styles.arrivals}>{artifacts.sources.slice(-4).reverse().map(s=><article key={s.id}><small>{contentLabel(s.content_level)}</small>{s.url?<a href={s.url} target="_blank" rel="noreferrer">{s.title}</a>:<span>{s.title}</span>}</article>)}</div>:<p>{replay?'이 시점에 상세 출처가 기록되지 않았습니다. 나중 결과를 끌어와 채우지 않습니다.':'출처가 수신되면 제목과 확보한 내용의 수준을 보여줍니다.'}</p>}
  </section></div>
  {artifacts.plan&&<section className={styles.plan}><h4>AI가 정한 후속 조사</h4><p>{artifacts.plan.missing_evidence[0]??'별도 부족 항목 없음'}</p><ul>{artifacts.plan.followup_terms.map(term=><li key={term}>{term}</li>)}</ul>{artifacts.plan.priorities[0]&&<p>우선 검토 이유: {artifacts.plan.priorities[0].reason}</p>}</section>}
  <p className={styles.note}>검색 결과 전체를 합산하지 않습니다. 검색 간 중복이 있고 FDA는 문헌이 아닌 신청 단위입니다. 원문 처리는 별도 단계입니다.</p>
 </div>;
}

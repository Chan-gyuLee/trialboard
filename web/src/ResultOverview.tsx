import {coverageStopLabel} from './research';
import {Alert,Button} from '@mui/material';
import {ArrowRight,Check,HelpCircle} from 'lucide-react';
import type {AutoResult} from './auto-review';
import {researchFindingWarnings} from './research';
import {decisionView} from './decision-view';
import styles from './ResultOverview.module.css';

export default function ResultOverview({done,onView}:{done:AutoResult;onView:(section:string)=>void}){
 const decision=decisionView(done),c=done.result.collection,findings=c.review?.findings??[],questions=c.review?.questions??[];
 const status=decision.state==='candidate'?'전문가 검토 필요':decision.state==='incomplete'?'조사 미완료':decision.state==='unknown'?'판단 미확인':decision.state==='limited'?'일부 자료만 확인':'추가 근거 필요';
 return <section className={styles.brief} aria-label="이번 검토에서 무엇을 알았나요" data-product-scene="research-brief">
  <header className={styles.conclusion}>
   <div className={styles.eyebrow}><span>공개 근거 검토 결과</span><span className={styles.status}>{status}</span></div>
   <h2>{decision.title}</h2>
   <p>{decision.reason}</p>
   <div className={styles.counts}><span>수집 자료 <b>{c.sources.length}</b></span><span>인용 쟁점 <b>{findings.length}</b></span><span>전문가 질문 <b>{questions.length}</b></span></div>
   <details className={styles.coverage}><summary>수집 범위 확인 · 초록 {c.sources.filter(s=>s.content_level==='ABSTRACT').length}개 · 수집 시 PDF 링크 {c.sources.filter(s=>s.content_level==='PDF_AVAILABLE').length}개</summary><p>DB 저장은 전체 문헌고찰이나 전문 검토 완료가 아닙니다. 검색마다 제한된 결과를 가져옵니다.</p><ul>{c.coverage.map((r,i)=><li key={i}><strong>{r.channel}</strong> · {r.status==='FAILED'?`요청 실패 · ${r.fetched}건 수신 보존`:r.status==='SKIPPED'?'한도로 생략':`${r.fetched} / ${r.total??'미확인'}${r.channel==='Drugs@FDA'?' 신청':' 검색 결과'}`}{r.limited?' · 부분 수집':''}<p>{r.query}</p>{r.pages!=null&&<p>{r.pages}페이지 · {coverageStopLabel(r)}</p>}</li>)}</ul></details>
  </header>
  <div className={styles.checks}>{decision.checks.map(check=><div key={check.label}>
   {check.value?<Check size={19}/>:<HelpCircle size={19}/>}<div><h3>{check.label}</h3><strong>{check.value===undefined?'아직 확인하지 못함':check.value?'구조 검사 후보 있음 · 미승인':'추가 자료 필요'}</strong><p>{check.detail}</p></div>
  </div>)}</div>
  {done.registryError&&<Alert severity="warning">{done.registryError}</Alert>}
  <div className={styles.body}>
   <section className={styles.findings}><div className={styles.sectionHeading}><span>01</span><h3>어떤 쟁점을 찾았나요?</h3></div>
    <p className={styles.note}>AI가 원문에 연결한 해석입니다. 전문가 검증 전입니다.</p>
    {findings.slice(0,2).map((f,i)=>{const source=c.sources.find(s=>s.id===f.source_id);return <details className={styles.finding} key={i}>
     <summary><span className={styles.findingNumber}>{String(i+1).padStart(2,'0')}</span><span className={styles.preview}>{f.interpretation}</span><span className={styles.expand}>열기</span></summary>
     <div className={styles.findingBody}><p>{f.interpretation}</p>{source&&<><blockquote>{f.quote}</blockquote><a href={source.url} target="_blank" rel="noreferrer">{source.title}</a>{researchFindingWarnings(f,source,c.request.nct_id).map(w=><p className={styles.note} key={w}>{w}</p>)}</>}</div>
    </details>})}
    {!findings.length&&<p>인용에 연결된 AI 쟁점을 확보하지 못했습니다.</p>}
    <Button onClick={()=>onView('evidence')} endIcon={<ArrowRight size={16}/>}>쟁점 {findings.length}개와 출처 확인</Button>
   </section>
   <section className={styles.actions}><div className={styles.sectionHeading}><span>02</span><h3>다음에 무엇을 해야 하나요?</h3></div>
    <p className={styles.next}>{decision.next[0]}</p>
    <h4>전문가에게 가져갈 질문</h4>
    {questions.length ? <ol className={styles.questions}>{questions.slice(0,3).map((question,i)=><li key={i}><span>{String(i+1).padStart(2,'0')}</span><p>{question}</p></li>)}</ol> : <p className={styles.question}>AI 질문을 확보하지 못했습니다. 원문과 미완료 기록부터 확인하세요.</p>}

    <Button onClick={()=>onView('evidence')} endIcon={<ArrowRight size={16}/>}>전체 질문 {questions.length}개 보기</Button>
   </section>
  </div>
  <details className={styles.footnote}><summary>검토 기준과 한계</summary><p>공개 근거와 다음 질문을 정리한 브리핑입니다. 권장 용량·완성된 임상시험 설계안이 아닙니다.<br/>결론 제목은 저장된 상태의 규칙 기반 설명입니다. 자료 개수는 근거의 강도를 뜻하지 않습니다.</p></details>
 </section>;
}

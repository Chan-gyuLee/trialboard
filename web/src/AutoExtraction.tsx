import {Alert,Chip} from '@mui/material';
import type {AutoResult} from './auto-review';
import {safeSourceUrl} from './research';

export default function AutoExtraction({done}:{done:AutoResult}){
 const saved=done.automation,report=saved?.report,decision=saved?.decision;
 const source=done.result.collection.sources.find(s=>s.id===saved?.document.sourceId);
 const observations=report?.attempts.at(-1)?.extraction?.observations??[];
 if(saved?.status==='PLAN_DOCUMENT_SAVED')return <section className="auto-extraction" aria-label="등록 결과 우선 자동 처리"><div className="auto-section-title"><h3>등록 결과로 검토를 이어갔습니다</h3><Chip variant="outlined" label="계획 문서 저장 · 중복 추출 생략"/></div><p>{saved.route?.reason}</p><p className="auto-caption">원문과 페이지 탐색 범위는 저장했습니다. PDF 결과 추출 모델은 추가 호출하지 않았습니다. 임상 승인이나 설계 계산을 완료했다는 뜻은 아닙니다.</p></section>;
 return <section className="auto-extraction" aria-label="자동 추출과 설계 준비 점검">
  <div className="auto-section-title"><h3>원문에서 설계 검토까지</h3><Chip variant="outlined" label={!saved?'추출 미완료':saved.status==='NEEDS_EVIDENCE'?'추가 근거 필요':saved.status==='REVIEW_REQUIRED'?'판단할 쟁점 준비':saved.status==='PREPARED'?'원문 저장됨':saved.status==='RUNNING'?'처리 중':saved.status==='INTERRUPTED'?'이전 실행 중단':saved.status==='CANCELLED'?'사용자 중단':'추출 실패'}/></div>
  {done.automationError&&<Alert severity="warning">{done.automationError}</Alert>}
  {!saved&&<p>준비된 원문이 없거나 자동 추출을 완료하지 못했습니다. 브리핑을 추출 결과로 대신 표시하지 않습니다.</p>}
  {saved&&<p className="auto-caption">원문·페이지 범위·작업 상태는 로컬 DB에 저장됩니다. 기록을 다시 열어도 모델을 재호출하지 않습니다.</p>}
  {report&&<><p>관측 초안 {observations.length}개 · 규칙 검사·모델 반론을 통과한 미승인 초안 {report.accepted.length}개 · 모델 요청 {report.calls.length}회</p>
   {observations.map(o=><article className="auto-finding" key={o.id}><strong>{o.fields.dose?.value??'용량 미확보'} · {o.fields.metric?.value??'평가변수 미확보'}</strong><p>{report.accepted.some(a=>a.id===o.id)?'검토 대기 초안':'검사 미통과·보류'}</p><details><summary>추출값과 인용 확인</summary>{Object.entries(o.fields).filter(([,v])=>v.value).map(([key,v])=>{const span=report.input.spans.find(s=>s.id===v.span_id);return <div key={key}><p>{({asset:'약물',indication:'적응증',study:'시험',cohort:'코호트',dose:'용량',metric:'평가변수',events:'사건 수',denominator:'분모',population:'분석집단',window:'평가시점',definition:'정의',reported_rate:'보고 비율'} as Record<string,string>)[key]??key}: {v.value}</p><blockquote>{v.quote}</blockquote>{span?.page&&source&&safeSourceUrl(source.url)&&<a href={`${source.url}#page=${span.page}`} target="_blank" rel="noreferrer">원본 PDF {span.page}페이지 열기</a>}</div>;})}</details></article>)}
   {!observations.length&&<Alert severity="info">선택한 PDF 문구에서 사용할 수 있는 관측값을 추출하지 못했습니다. 등록부 결과표와는 별개이며, 사건 수·분모·효과 크기를 임의로 채우지 않았습니다.</Alert>}
  </>}
  {decision&&<aside className="auto-decisions"><h3>PDF 추출에서 남은 검토 질문</h3><p>{decision.reason}</p><p className="auto-caption">선택한 PDF 문구를 바탕으로 정리한 질문입니다. 별도로 확보한 등록부 결과표의 집단·분모와 함께 확인하세요.</p><ol>{decision.questions.map((q,i)=><li key={i}>{q}</li>)}</ol><p className="auto-caption">임상 승인 없음 · 실제 근거 기반 설계 시뮬레이션 미실행. 별도 MOC 탐색과 구분하며 자동화 종료 상태는 임상 판단 완료가 아닙니다.</p></aside>}
 </section>;
}

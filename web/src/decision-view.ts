import type {AutoResult} from './auto-review.ts';
import {resultSummary} from './result-summary.ts';

/** Explain recorded readiness in plain language. Never promote collection completion to clinical success. */
export function decisionView(done:AutoResult){
 const summary=resultSummary(done),c=done.result.collection;
 const ready=done.registryError?undefined:done.registryResults?.readiness;
 const incomplete=summary.reviewIncomplete,limited=!!done.registryResults?.limited;
 const insufficient=c.review?.conclusion==='INSUFFICIENT_EVIDENCE';
 const response=ready?.responseCandidate,safety=ready?.safetyCandidate;
 const state=incomplete?'incomplete':!ready?'unknown':limited?'limited':insufficient||!response||!safety?'gap':'candidate';
 const title={incomplete:'조사가 아직 끝나지 않았어요.',unknown:'비교할 준비가 됐는지 아직 모릅니다.',limited:'확보한 일부 결과만 확인했어요.',gap:'지금은 용량을 선택할 근거가 부족해요.',candidate:'비교 후보를 전문가에게 검토받을 차례예요.'}[state];
 const reason={incomplete:'자료가 수집됐더라도 AI 브리핑 또는 조사 일부가 미완료입니다. 미완료 범위를 먼저 확인하세요.',unknown:'등록 결과표의 비교 준비 상태를 확인하지 못했습니다. 약물이 효과가 없다는 뜻은 아닙니다.',limited:'일부 결과만 점검해 비교에 필요한 정보가 빠져 있을 수 있습니다.',gap:insufficient?'AI 브리핑이 근거 부족으로 남아 있습니다. 등록 결과의 구조 검사만으로 이 판단을 해소하지 않습니다.':!response&&!safety?'효과와 부작용을 용량별로 같은 조건에서 비교할 자료가 더 필요합니다.':!response?'안전성 비교 후보는 있지만, 용량별 효과를 비교할 근거가 더 필요합니다.':'효과 비교 후보는 있지만, 용량별 부작용을 비교할 근거가 더 필요합니다.',candidate:'용량별 효과·안전성의 구조 검사 후보를 확보했습니다. 임상적 비교 적합성과 최종 용량은 전문가가 확인해야 합니다.'}[state];
 const checks=[
  {label:'어느 용량이 더 효과적인가?',value:response,detail:'반응 결과 · 분석 대상자 수 · 평가 시점'},
  {label:'어느 용량이 더 안전한가?',value:safety,detail:'이상반응 정의 · 분석집단 · 관측 기간'},
 ];
 return {state,title,reason,checks,next:summary.next,hasSimulation:!!done.exploration&&!done.explorationError};
}

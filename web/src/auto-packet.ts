/** One export of already stored work. No network, model call or clinical approval. */
import type {AutoResult} from './auto-review.ts';
import {researchMarkdown} from './research.ts';
import {resultSummary,explorationDeltas} from './result-summary.ts';

const quote=(value:unknown)=>String(value??'미보고').replaceAll('\r','').split('\n').map(line=>`> ${line}`).join('\n');
export function autoPacketMarkdown(done:AutoResult):string{
 const a=done.automation,r=done.registryResults,d=done.document,c=done.result.collection;
 const summary=resultSummary(done);
 const sections=['# 검토 결과 요약',quote(summary.headline),quote(summary.explanation),...(summary.reviewIncomplete?['AI 브리핑 또는 조사 일부 미완료.']:[]),...summary.cards.map(x=>quote(`${x.label}: ${x.title} · ${x.detail}`)),'## 다음 판단',...summary.next.map(quote),researchMarkdown(c),'## 자동화 처리 기록',`조사 ID: ${c.id}`,`PDF 추출 상태: ${a?.status??'미실행·미확인'}`,
  '임상 승인 없음. 실제 근거 기반 설계 시뮬레이션 미실행. 별도 MOC 계산이 있으면 아래에 구분합니다. 조사·PDF 추출·등록부 원문은 서로 다른 산출물입니다.'];
 if(c.execution_mode==='SCRIPTED_TEST_DOUBLE')sections.unshift('MOC · 합성 테스트 기록. 실제 AI 실행 아님.');
 if(done.automationError)sections.push(quote(done.automationError));
 if(a?.status==='PLAN_DOCUMENT_SAVED')sections.push('등록 결과 우선 자동 처리 · PDF 결과 추출 추가 호출 없음',quote(a.route?.reason));
 if(done.explorationError)sections.push(quote(done.explorationError));
 if(done.exploration){
  const e=done.exploration;
  sections.push('## MOC · 별도 가상 설계 탐색',`정책: ${e.policy} / 출처: ${e.provenance}`,'규칙 라이브러리의 합성 가정. 실제 약물 수치·AI 제안·사용자 선언 아님. A/B는 등록 용량과 연결하지 않았습니다.',`엔진 SHA256: ${e.engineDigest}`,`계산 환경: ${JSON.stringify(e.runtime)}`);
  for(const s of e.scenarios)sections.push(quote(`${s.label}: 반응 A/B ${s.response.join(' / ')}, 이상반응 ${s.adverse_event.join(' / ')}, 효용 가중치 ${s.adverse_event_penalty}, 가정한 한계 ${s.maximum_adverse_event_rate}`));
  for(const s of e.simulations)sections.push(quote(`${s.scenario.label} / ${s.design.label} / 총 ${s.total_sample_size}명 / seed ${s.seed} / ${s.repetitions}회\n가정 규칙상 올바른 선택·보류 ${(100*s.selects_true_utility_best_probability).toFixed(1)}%, 한계 초과 군 선택 ${(100*s.selects_true_unsafe_probability).toFixed(1)}%, 보류 ${(100*s.no_selection_probability).toFixed(1)}%\nMonte Carlo SE ${(100*s.monte_carlo_se.true_utility_best).toFixed(2)}%p`));
  sections.push('### MOC 설계 차이 · 보고서 기준은 군당20명으로 고정','화면에서 선택한 비교 기준과 별개입니다. 차이의 표준오차는 독립 난수 계산 기준이며 모수 불확실성·유의성 검정이 아닙니다.');
  for(const s of e.scenarios)for(const d of explorationDeltas(e,s.id,'n20').filter(d=>!d.reference))sections.push(quote(`${s.label} / ${d.planId}: 기준 대비 참여자 ${d.participants}명, 올바른 선택/보류 ${d.correctPp.toFixed(2)}%p, 차이의 Monte Carlo SE ${d.deltaSePp.toFixed(2)}%p`));
  sections.push(...e.limitations.map(quote),'### 실제 설계 연결 전 질문',...e.questions.map(quote));
 }
 if(d?.coverage)sections.push(`PDF 전체 ${d.coverage.totalPages}페이지 / 텍스트 보관 ${d.coverage.retainedPages.length}페이지`,
  `보관한 원본 페이지: ${d.coverage.retainedPages.join(', ')}`,`미보관 페이지: ${d.coverage.omittedPages.join(', ')||'없음'}`,
  `무텍스트 페이지: ${d.coverage.noTextPages.join(', ')||'없음'}`,'페이지 탐색은 임상 검토·OCR이 아닙니다. 브라우저 추출 텍스트의 PDF 원문 일치는 독립 검증하지 않았습니다.');
 if(a?.report){
  sections.push(`PDF 미승인 관측 초안 ${a.report.attempts.at(-1)?.extraction?.observations.length??0}개 / 규칙 검사·반론 통과 초안 ${a.report.accepted.length}개`,
   `PDF 모델 요청 ${a.report.calls.length}회`,...(a.decision?.questions??[]).map(q=>quote(q)));
 }
 sections.push('## 등록부 보고 결과 · 원본 집단 유지');
 if(done.registryError)sections.push(quote(done.registryError));
 if(!r)sections.push('등록부 결과표 미확보·미확인. 결과가 없다는 뜻이 아닙니다.');
 else{
  if(r.readiness)sections.push('## 비교 준비 자동 점검',`규칙: ${r.readiness.schema} / ${r.readiness.status}`,`효능 검토 후보: ${r.readiness.responseCandidate?'있음':'미충족'} / 안전성 검토 후보: ${r.readiness.safetyCandidate?'있음':'미충족'}`,'규칙 검사이며 임상적 비교 적합성이나 전문가 승인을 뜻하지 않습니다.',...r.readiness.questions.map(quote));
  if(!c.sources.some(s=>s.link_basis.includes('REGISTRY_RESULTS')))sections.push('이 저장된 AI 브리핑에는 아래 등록 결과표가 모델 입력으로 연결되지 않았습니다. 결과표 복구는 기존 AI 해석의 갱신이 아닙니다.');
  sections.push(r.sourceUrl,`원본 스냅샷 SHA256: ${r.snapshotDigest}`,quote(r.notice),
   `효능·결과 ${r.outcomes.length}행 / 안전성 ${r.safety.length}행${r.limited?' · 표시 한도에 따른 일부 행':''}`,
   '임상 비교 적합성 미검증. 통합집단을 용량별로 분할하지 않았으며 비율에서 사건 수를 역산하지 않았습니다.');
  for(const o of r.outcomes)sections.push(quote(`${o.title}\n${o.groupTitle} (${o.groupId})\n${o.groupDescription}\n${o.population}\n${o.window}\n${o.definition}\n${o.classTitle} / ${o.categoryTitle}\n보고값: ${o.value} ${o.unit}\n${o.parameter} / ${o.dispersion}: ${o.lower??'미보고'} ~ ${o.upper??'미보고'}\n산포값: ${o.spread??'미보고'}\n원문 주석: ${o.comment??'미보고'}\n보고 분모: ${o.denominators.map(d=>`${d.value} ${d.unit}`).join(', ')||'미보고'}\n분모 범위: ${o.denominatorScope==='CLASS'?'하위 항목별':o.denominatorScope==='OUTCOME'?'결과 지표 전체':'미확인'}\n결과 지표 전체 분모(참고·대체하지 않음): ${o.overallDenominators?.map(d=>`${d.value} ${d.unit}`).join(', ')||'미보고'}\n원본 위치: ${o.locator}`));
  for(const o of r.safety)sections.push(quote(`${o.groupTitle} (${o.groupId})\n${o.groupDescription}\n${o.metric}: ${o.affected??'미보고'} / ${o.atRisk??'미보고'}\n${o.window}\n${o.description}\n원본 위치: ${o.locator}`));
  sections.push('Serious adverse events는 Grade ≥3 이상반응과 다른 지표입니다. 서로 다른 지표·집단·기간을 합산하지 않았습니다.');
 }
 return sections.join('\n\n')+'\n';
}

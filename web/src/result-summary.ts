/** State summaries and stored simulation differences, not new clinical judgements. */
import type {AutoResult} from './auto-review.ts';
import type {Exploration} from './design-exploration.ts';

export function resultSummary(done:Pick<AutoResult,'result'|'registryResults'|'registryError'|'exploration'|'explorationError'>){
 const c=done.result.collection,r=done.registryError?undefined:done.registryResults?.readiness;
 const response=r?.responseCandidate,safety=r?.safetyCandidate;
 const headline=!r?'비교 근거의 준비 상태를 아직 확인하지 못했습니다':done.registryResults?.limited?'일부 결과만 점검했습니다. 누락 범위 확인이 필요합니다':response&&safety?'비교 후보를 확보했습니다. 적용 범위 확인이 필요합니다':!response&&safety?'용량별 효능 근거를 먼저 보완해야 합니다':response&&!safety?'용량별 안전성 근거를 먼저 보완해야 합니다':'용량별 효능·안전성 근거를 더 확보해야 합니다';
 const questions=[...new Set(r?.questions??[])];
 return {headline,reviewIncomplete:!c.review||c.status!=='COMPLETE',
  explanation:'등록 결과의 집단·분모·시점을 점검한 상태 요약입니다. 임상적 비교 적합성이나 최종 용량을 승인한 결론은 아닙니다.',
  cards:[
   {label:'효능 근거',state:response===undefined?'unknown':response?'candidate':'gap',title:response===undefined?'확인 미완료':response?'검토 후보 확보':'추가 근거 필요',detail:'용량별 반응·분석 분모·평가 시점'},
   {label:'안전성 근거',state:safety===undefined?'unknown':safety?'candidate':'gap',title:safety===undefined?'확인 미완료':safety?'검토 후보 확보':'추가 근거 필요',detail:'집단·이상반응 정의·관측 기간'},
   {label:'설계 탐색',state:done.exploration&&!done.explorationError?'moc':'unknown',title:done.exploration&&!done.explorationError?'9개 가상 조합 계산':'계산 결과 미확인',detail:'MOC · 실제 근거 기반 설계는 미실행'},
  ],
  next:questions.length?questions:['등록부 결과표와 분석집단·분모·기간을 먼저 확인하세요. 미확보는 결과가 없다는 뜻이 아닙니다.'],
 };
}

/** Independent-stream Monte Carlo differences; no ranking, power or significance test. */
export function explorationDeltas(value:Exploration,scenarioId:string,referenceId:string){
 const rows=value.simulations.filter(s=>s.scenario.id===scenarioId),reference=rows.find(s=>s.design.id===referenceId);
 if(!reference||rows.length!==value.plans.length)throw Error('비교 기준 설계가 없습니다.');
 return rows.map(s=>({planId:s.design.id,reference:s.design.id===referenceId,
  participants:s.total_sample_size-reference.total_sample_size,
  correctPp:100*(s.selects_true_utility_best_probability-reference.selects_true_utility_best_probability),
  unsafePp:100*(s.selects_true_unsafe_probability-reference.selects_true_unsafe_probability),
  deltaSePp:s.design.id===referenceId?0:100*Math.hypot(s.monte_carlo_se.true_utility_best,reference.monte_carlo_se.true_utility_best),
 }));
}

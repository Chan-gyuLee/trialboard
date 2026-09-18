import {useState} from 'react';
import {Alert,Tab,Tabs,ToggleButton,ToggleButtonGroup} from '@mui/material';
import type {Exploration} from './design-exploration';
import {explorationDeltas} from './result-summary';

const pct=(v:number)=>(v*100).toFixed(1);
export default function DesignExploration({value,error}:{value?:Exploration|null;error?:string}){
 const [selected,setSelected]=useState('tradeoff');
 const [reference,setReference]=useState('n20');
 if(error)return <Alert severity="warning">{error}</Alert>;
 if(!value)return null;
 const scenario=value.scenarios.find(s=>s.id===selected)??value.scenarios[0];
 const deltas=explorationDeltas(value,scenario.id,reference);
 const signed=(n:number)=>`${n>0?'+':''}${n.toFixed(1)}`;
 return <section className="auto-exploration" aria-label="가상 설계 탐색">
  <span className="auto-kicker">DESIGN EXPLORATION · MOC</span><h3>표본수를 늘리면 판단은 얼마나 달라질까요?</h3>
  <p>규칙 기반 설계 탐색 도구의 계산 결과입니다. <strong>실제 {value.asset}의 예측이 아닙니다.</strong> 가상 A/B는 등록 용량과 연결하지 않았고, 실제 근거 부족은 그대로 남아 있습니다.</p>
  <Tabs value={scenario.id} onChange={(_,id)=>setSelected(id)} variant="scrollable" scrollButtons="auto" aria-label="가상 가정 선택">{value.scenarios.map((s,i)=><Tab key={s.id} value={s.id} label={['차이 없음','효능·독성 상충','모두 한계 초과'][i]} id={`exploration-tab-${s.id}`} aria-controls={`exploration-panel-${s.id}`}/>)}</Tabs>
  <div role="tabpanel" id={`exploration-panel-${scenario.id}`} aria-labelledby={`exploration-tab-${scenario.id}`}>
   <h4>{scenario.label}</h4><p className="auto-caption">가정한 반응 확률 A/B: {scenario.response.map(pct).join(' / ')}% · 이상반응 확률: {scenario.adverse_event.map(pct).join(' / ')}% · 효용 가중치 {scenario.adverse_event_penalty} · 가정한 한계 {pct(scenario.maximum_adverse_event_rate)}%</p>
   {scenario.id==='equal'&&<p className="auto-caption">이 가정에서는 A/B의 참효용이 같으므로 어느 군을 골라도 ‘올바른 선택’으로 집계합니다. 높은 수치가 두 군의 차이를 검출했다는 뜻은 아닙니다.</p>}
   <div className="result-reference"><span>비교 기준</span><ToggleButtonGroup size="small" exclusive value={reference} onChange={(_,id)=>{if(id)setReference(id);}} aria-label="설계 비교 기준">{value.plans.map(p=><ToggleButton key={p.id} value={p.id}>{p.label}</ToggleButton>)}</ToggleButtonGroup><span>기준 변경은 표시만 바꿉니다.</span></div>
   <div className="auto-exploration-plans">{value.simulations.filter(s=>s.scenario.id===scenario.id).map(s=><article key={s.design.id} data-reference={s.design.id===reference}>
    <span>{s.design.label} · 균등배정</span><h4>총 {s.total_sample_size}명</h4>
    <p>가정 규칙상 올바른 선택/보류</p><strong className="auto-exploration-number">{pct(s.selects_true_utility_best_probability)}<small>%</small></strong>
    <meter min={0} max={1} value={s.selects_true_utility_best_probability} aria-label={`${s.design.label} 가정 규칙상 올바른 선택 또는 보류 비율`}/>
    <dl><div><dt>한계 초과 군 선택</dt><dd>{pct(s.selects_true_unsafe_probability)}%</dd></div><div><dt>어떤 군도 선택하지 않음</dt><dd>{pct(s.no_selection_probability)}%</dd></div><div><dt>Monte Carlo 표준오차</dt><dd>{pct(s.monte_carlo_se.true_utility_best)}%p</dd></div></dl>
    {deltas.filter(d=>d.planId===s.design.id).map(d=><div className="result-delta" key={d.planId}>{d.reference?<strong>비교 기준 · 추천안 아님</strong>:<><span>기준 대비 참여자 <strong>{d.participants>0?'+':''}{d.participants}명</strong></span><span>올바른 선택/보류 <strong>{signed(d.correctPp)}%p</strong></span><span>차이의 MC 표준오차 {d.deltaSePp.toFixed(1)}%p</span></>}</div>)}
   </article>)}</div>
  </div>
  <p className="auto-caption">3개 표본수 × 3개 가정 × 각 2,000회 계산 · 추가 모델 호출 0회. 차이의 표준오차는 독립 난수 계산 기준이며 모수 불확실성이나 통계적 유의성을 뜻하지 않습니다. 검정력·허가 확률·권장 표본수가 아닙니다.</p>
  <details><summary>계산 규칙과 한계</summary><p>관측 이상반응률이 가정한 한계 이하인 군 중 반응률 − 가중치 × 이상반응률이 가장 높은 군을 선택합니다. 동률은 균등 추첨하며 모두 한계 초과 시 보류합니다.</p><ul>{value.limitations.map(x=><li key={x}>{x}</li>)}</ul><p>저장된 계산 · seed 42 · {value.policy}</p></details>
  <details><summary>실제 설계로 연결하기 전에 확인할 질문</summary><ul>{value.questions.map((q,i)=><li key={i}>{q}</li>)}</ul></details>
  <footer className="auto-moc-footer">MOC · 가상 계산 부분만 합성 입력입니다. 실제 근거 표와 구분됩니다. 임상 승인·최종 설계 선택 없음.</footer>
 </section>;
}

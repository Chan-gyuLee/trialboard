import {strictJson} from './field-review.ts';
import {bindStressResult,type StressComparison} from './scenario-briefing.ts';
import {percent,type Execution,type RunInput} from './review.ts';

export type CaseRow={id:string;arm:'A'|'B';metric:'response'|'adverse_event';events:number;denominator:number;population:string;timepoint:string;definition:string};
export type DecisionCase={schema:'decision-case/1';dataKind:'SYNTHETIC';asset:string;question:string;protocol:{id:string;currentPerArm:number;alternativePerArm:number};rows:CaseRow[];summary:{sourceId:string;events:number;denominator:number}[];sensitivity:{adverseEvent:[number,number];limit:number;penalty:number;rationale:string}};
export const DEMO_CASE:DecisionCase={
 schema:'decision-case/1',dataKind:'SYNTHETIC',asset:'TB-DEMO-01',question:'증원만으로 충분할까요, 용량 범위를 다시 검토해야 할까요?',
 protocol:{id:'DEMO-P02 v1',currentPerArm:30,alternativePerArm:60},
 rows:[
  {id:'T1-R1',arm:'A',metric:'response',events:15,denominator:50,population:'반응 평가집단',timepoint:'12주',definition:'예시 반응 기준'},
  {id:'T1-R2',arm:'B',metric:'response',events:16,denominator:50,population:'반응 평가집단',timepoint:'12주',definition:'예시 반응 기준'},
  {id:'T2-R1',arm:'A',metric:'adverse_event',events:6,denominator:50,population:'안전성 평가집단',timepoint:'12주',definition:'예시 3등급 이상 이상반응'},
  {id:'T2-R2',arm:'B',metric:'adverse_event',events:10,denominator:40,population:'안전성 평가집단',timepoint:'12주',definition:'예시 3등급 이상 이상반응'},
 ],
 summary:[{sourceId:'T1-R1',events:15,denominator:50},{sourceId:'T1-R2',events:16,denominator:50},{sourceId:'T2-R1',events:6,denominator:50},{sourceId:'T2-R2',events:10,denominator:50}],
 sensitivity:{adverseEvent:[.55,.65],limit:.35,penalty:.7,rationale:'자료의 추정치가 아닌 별도 스트레스 가정: 두 군 모두 독성 우려가 커지는 경우'},
};
const fail=():never=>{throw Error('합성 사례 형식이 올바르지 않습니다. 예제 JSON의 필드·범위·출처 연결을 확인하세요.');};
const text=(x:unknown,max=500):x is string=>typeof x==='string'&&x.trim().length>0&&x.length<=max;
const count=(x:unknown,min=0,max=100000):x is number=>Number.isSafeInteger(x)&&Number(x)>=min&&Number(x)<=max;
const probability=(x:unknown):x is number=>typeof x==='number'&&Number.isFinite(x)&&x>=0&&x<=1;
export function readDecisionCase(raw:string):DecisionCase{
 const c=strictJson(raw,65536,3000) as DecisionCase;
 if(!c||c.schema!=='decision-case/1'||c.dataKind!=='SYNTHETIC'||!text(c.asset,100)||!text(c.question)||!c.protocol||!text(c.protocol.id,100)||!count(c.protocol.currentPerArm,2,499)||!count(c.protocol.alternativePerArm,c.protocol.currentPerArm+1,500))fail();
 if(!Array.isArray(c.rows)||c.rows.length!==4||!Array.isArray(c.summary)||c.summary.length!==4)fail();
 const ids=new Set<string>(),keys=new Set<string>();
 for(const r of c.rows){
  if(!r||!text(r.id,40)||!['A','B'].includes(r.arm)||!['response','adverse_event'].includes(r.metric)||!count(r.denominator,1)||!count(r.events,0,r.denominator)||!text(r.population,150)||!text(r.timepoint,100)||!text(r.definition,200)||ids.has(r.id)||keys.has(`${r.arm}:${r.metric}`))fail();
  ids.add(r.id);keys.add(`${r.arm}:${r.metric}`);
 }
 const refs=new Set<string>();
 for(const s of c.summary){if(!s||!ids.has(s.sourceId)||refs.has(s.sourceId)||!count(s.denominator,1)||!count(s.events,0,s.denominator))fail();refs.add(s.sourceId);}
 const a=c.sensitivity;
 if(!a||!Array.isArray(a.adverseEvent)||a.adverseEvent.length!==2||!a.adverseEvent.every(probability)||!probability(a.limit)||typeof a.penalty!=='number'||!Number.isFinite(a.penalty)||a.penalty<0||a.penalty>5||!text(a.rationale))fail();
 return c;
}
export function inspectDecisionCase(c:DecisionCase){
 c=readDecisionCase(JSON.stringify(c));
 const discrepancies=c.rows.flatMap(row=>{const claim=c.summary.find(s=>s.sourceId===row.id)!;return claim.events===row.events&&claim.denominator===row.denominator?[]:[{row,claim}];});
 const blockers:string[]=[];
 for(const metric of ['response','adverse_event'] as const){const rows=c.rows.filter(r=>r.metric===metric);if(['population','timepoint','definition'].some(key=>rows[0][key as keyof CaseRow]!==rows[1][key as keyof CaseRow]))blockers.push(`${metric==='response'?'반응':'이상반응'}의 분석집단·시점·정의가 두 군에서 다릅니다.`);}
 return {discrepancies,blockers};
}
export function caseRunInput(c:DecisionCase,confirmed:boolean):RunInput{
 const audit=inspectDecisionCase(c);
 if(audit.blockers.length)throw Error(audit.blockers.join(' '));
 if(audit.discrepancies.length&&!confirmed)throw Error('요약표와 원자료의 차이를 확인한 뒤 원자료 기준 가상 계산을 선택하세요.');
 const rates=(metric:CaseRow['metric'])=>['A','B'].map(arm=>{const r=c.rows.find(r=>r.arm===arm&&r.metric===metric)!;return r.events/r.denominator;});
 const baseline={id:'case_baseline',label:'합성 원자료 비율 가정',response:rates('response'),adverse_event:rates('adverse_event'),adverse_event_penalty:c.sensitivity.penalty,maximum_adverse_event_rate:c.sensitivity.limit,rationale:'SYNTHETIC · 원자료 사건수/분모를 가상 계산의 확률로 대입. 실제 모수 추정·임상 승인 아님.'};
 return {mode:'normal',scenarios:[baseline,{...baseline,id:'case_sensitivity',label:'별도 독성 스트레스 가정',adverse_event:[...c.sensitivity.adverseEvent],rationale:c.sensitivity.rationale}],per_arm:[c.protocol.currentPerArm,c.protocol.alternativePerArm],repetitions:10000,seed:42};
}
export function bindCaseExecution(c:DecisionCase,confirmed:boolean,execution:Execution):StressComparison{return bindStressResult(execution,caseRunInput(c,confirmed));}
export function caseQuestions(c:DecisionCase,result:StressComparison){
 const audit=inspectDecisionCase(c),[current,alternative]=result.plans;
 return [
  {owner:'자료 검토',title:'분석집단과 분모 확인',text:audit.discrepancies.length?audit.discrepancies.map(({row,claim})=>`${row.id}: 요약 ${claim.events}/${claim.denominator}, 원자료 ${row.events}/${row.denominator}. 어느 집단·시점을 사용한 값이며 요약표 수정이 필요한가요?`).join(' '):'요약표와 원자료 수치는 일치합니다. 분석집단·시점·평가 정의의 임상적 적합성도 확인했나요?',source:audit.discrepancies.map(d=>d.row.id).join(', ')||'전체 4행'},
  {owner:'임상 · 안전성',title:'스트레스 가정의 타당성',text:`이상반응 A/B ${c.sensitivity.adverseEvent.map(percent).join(' / ')}와 한계 ${percent(c.sensitivity.limit)}는 별도 가정입니다. 이를 뒷받침할 자료와 추가 민감도 범위는 무엇인가요?`,source:'사용자가 제공한 합성 민감도 가정'},
  {owner:'통계 · 임상 운영',title:'증원의 가치와 설계 변경',text:`총 ${current.after.total_sample_size}명 → ${alternative.after.total_sample_size}명에서 스트레스 조건의 선택 보류는 ${percent(current.after.no_selection_probability)} → ${percent(alternative.after.no_selection_probability)}입니다. 추가 참여자 부담과 용량 범위·중단 기준 재검토를 어떻게 비교할까요?`,source:`계산 ${result.execution.execution_id}`},
 ];
}
export function caseConclusion(c:DecisionCase,result:StressComparison){
 const unsafe=c.sensitivity.adverseEvent.filter(v=>v>c.sensitivity.limit).length;
 return unsafe===2?'증원안과 함께, 용량 범위 재검토를 회의 의제로 올리세요.':unsafe===1?'증원 효과와 한계 초과 군 선택 위험을 함께 비교하세요.':'표본수에 따른 선택·보류 차이를 검토하세요.';
}
export function decisionCaseMarkdown(c:DecisionCase,result:StressComparison){
 return ['# TrialBoard · 설계 검토 브리핑','MOC · 합성 자료 / 규칙 기반 검토·질문 / 실제 로컬 계산 / 임상 권고 아님',`약물: ${c.asset} · 프로토콜: ${c.protocol.id}`,`질문: ${c.question}`,`실행: ${result.execution.execution_id} · ${result.execution.started_at}`,'','## 원자료와 요약표',...c.rows.map(r=>{const claim=c.summary.find(s=>s.sourceId===r.id)!;return `- ${r.id} · ${r.arm} ${r.metric}: 원자료 ${r.events}/${r.denominator}, 요약 ${claim.events}/${claim.denominator} · ${r.population}, ${r.timepoint}, ${r.definition}`;}),'','## 설계 비교',...result.plans.map(p=>`- 총 ${p.after.total_sample_size}명: 원자료 비율 가정 보류 ${percent(p.before.no_selection_probability)} → 스트레스 가정 보류 ${percent(p.after.no_selection_probability)}; 스트레스 한계 초과 군 선택 ${percent(p.after.selects_true_unsafe_probability)}; 보류 MC 표준오차 ${(p.after.monte_carlo_se.no_selection*100).toFixed(2)}%p`),'','## 계산 가정',`반응 ${result.execution.input.scenarios[0].response.map(percent).join(' / ')} · 원자료 이상반응 ${result.execution.input.scenarios[0].adverse_event.map(percent).join(' / ')}`,`스트레스 이상반응 ${c.sensitivity.adverseEvent.map(percent).join(' / ')} · ${c.sensitivity.rationale}`,`한계 ${percent(c.sensitivity.limit)} · 가중치 ${c.sensitivity.penalty} · 10,000회 · seed 42`,'','## KOL 질문 · 규칙 기반 초안',...caseQuestions(c,result).map(q=>`- [${q.owner}] ${q.text}\n  연결: ${q.source}`),'','## 한계','합성 원자료 비율을 확률로 대입한 계산이며 모수 불확실성을 모델링하지 않았습니다. 요약표 불일치는 자동 승인·수정하지 않았습니다.','독립 Bernoulli·고정 관찰기간. 결측·탈락·중간중단·기간·비용·검정력 미반영. 선택 빈도는 성공·허가 확률이 아닙니다.','규칙상 검토 의제일 뿐 설계 추천·임상 승인 아님. 서버 영구 저장 없음.'].join('\n');
}

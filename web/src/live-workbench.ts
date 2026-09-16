import type { LiveProgress } from "./agent-live.ts";
export const LIVE_TASKS: Record<string,{title:string;purpose:string;next:string}> = {
  HANDOFF:{title:"추가 자료가 필요한 판단을 사람에게 넘깁니다",purpose:"새 자료 없이 해결할 수 없는 비교 적용 한계가 남아, 같은 문구의 재추출을 생략합니다.",next:"보류 이유와 확인 질문을 검토하고 필요한 근거를 추가하세요."},
  EXTRACT:{title:"원문에서 용량별 관측값을 추출하고 있습니다",purpose:"용량·지표·사건 수·분모와 인용 위치를 구조화합니다. 아직 검증하거나 채택한 값은 아닙니다.",next:"추출 응답을 받으면 인용·수치·문맥을 규칙으로 검사합니다."},
  VERIFY:{title:"추출값과 연결 근거를 대조했습니다",purpose:"인용에서 지원하지 않는 값과 누락·문맥 불일치를 찾습니다. 규칙 통과는 임상 타당성 승인이 아닙니다.",next:"검사 후 남은 관측값이 있으면 비교 가능성에 대한 반론을 요청합니다."},
  CRITIQUE:{title:"이 관측값을 비교해도 되는지 반론을 검토합니다",purpose:"분석집단·평가 기간·지표 정의 차이와 추가 확인 질문을 검토합니다.",next:"반론 응답의 참조를 검사한 뒤 수정 시도 또는 사람의 검토로 인계합니다."},
  REVISE:{title:"검사에서 지적된 추출값을 다시 살펴봅니다",purpose:"이전 추출과 실제 검사 피드백을 참고해 수정합니다. 없던 원문 근거를 만들지 않습니다.",next:"수정된 값도 다시 검사하고 반론 검토를 거칩니다."},
};
export function liveWorkbench(events: LiveProgress[],busy:boolean,error:string,complete:string|null) {
  const last=events.at(-1),stage=last?.stage;
  const task=stage ? LIVE_TASKS[stage] : undefined;
  const failed=!!error || complete==='FAILED' || complete==='BUDGET_EXCEEDED';
  const latestExtraction=events.filter(e=>['EXTRACT','REVISE'].includes(e.stage)&&e.state==='COMPLETED').at(-1);
  return {last,task,
    latestObservations:(latestExtraction?.items??[]).filter(i=>i.kind==='observation').slice(-12),
    title:failed?"실행을 마치지 못했습니다":complete?"이번 실행을 검토자에게 인계합니다":!busy?"실행 전입니다":!last?"서버의 실행 시작 응답을 기다립니다":stage==='HANDOFF'?LIVE_TASKS.HANDOFF.title:last.state==="COMPLETED"?`${stage === "EXTRACT" ? "추출" : stage === "REVISE" ? "수정" : stage === "VERIFY" ? "규칙 검사" : "반론 검토"} 응답을 받았습니다`:task?.title??'서버의 다음 상태를 기다립니다',
    status:failed?"중단/오류":complete?"결과 수신":busy?"실행 중":"대기",
    outputs:events.flatMap(e=>(e.items??[]).filter(i=>i.kind!=="source").map(item=>({...item,stage:e.stage,attempt:e.attempt,elapsed_ms:e.elapsed_ms}))).slice(-24),
    sources:(events.find(e=>e.items?.some(i=>i.kind==="source"))?.items??[]).filter(i=>i.kind==="source"),
  };
}
const findingLabels:Record<string,string>={NO_OBSERVATIONS:'지원되는 관측값 미확보',SECOND_DOSE_MISSING:'비교할 두 번째 용량 근거 미확보',MISSING_FIELD:'필수 정보 미확보',REPORTED_RATE_ONLY:'보고 비율을 사건 수로 역산할 수 없음',CONTEXT_MISMATCH:'검토 맥락과 원문 표현 확인 필요',UNSUPPORTED_METRIC:'현재 계산이 지원하지 않는 지표'};
export function findingLabel(text:string):string|null{return findingLabels[text.split(' · ')[0]]??null;}

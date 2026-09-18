import type {AutoEvent} from './auto-review.ts';
import type {Collection,ResearchEvent} from './research.ts';
import {researchTelemetry} from './research.ts';

export const workRoles=[
 {name:'근거 찾기',tool:'공개 자료 수집 도구',stages:[0,1,2]},
 {name:'근거 읽고 대조하기',tool:'AI 검토 · 원문 대조',stages:[3,4,5,6]},
 {name:'가정별 차이 계산하기',tool:'계산 도구 · MOC',stages:[7]},
];
export const taskDescriptions=[
 '입력한 이름과 연결된 임상시험을 찾고 있습니다.',
 '선택 시험과 관련된 공개 자료를 모으고 있습니다.',
 '검토에 더 필요한 자료와 검색어를 확인하고 있습니다.',
 '수집한 자료의 인용문·쟁점·미답변 질문을 정리하고 있습니다.',
 '선택 시험에 연결된 공개 원문을 준비하고 있습니다.',
 '원문 문구에서 추출한 내용을 대조하고 있습니다.',
 '서로 다른 용량의 결과를 같은 조건에서 비교할 수 있는지 점검합니다.',
 '합성 가정으로 설계별 차이를 계산합니다. 실제 약물 예측은 아닙니다.',
];
export function activityArtifacts(events:AutoEvent[]){
 const research=events.flatMap(e=>e.research?[e.research]:[]);
 return {
  sources:[...new Map(research.flatMap(e=>e.sources??[]).map(s=>[s.id,s])).values()],
  plan:research.filter(e=>e.plan).at(-1)?.plan,
  review:research.filter(e=>e.review).at(-1)?.review,
  items:events.filter(e=>e.progress?.items?.length).at(-1)?.progress?.items??[],
 };
}
/** Saved stage metadata only; never backfill final model output into earlier frames. */
export function replayEvents(collection:Pick<Collection,'id'|'events'>):AutoEvent[]{
 let previous=-1,elapsed=-1;
 const accepted:AutoEvent[]=[];
 for(const raw of collection.events){
  const e=raw as ResearchEvent;
  if(!e||e.run_id!==collection.id||!Number.isInteger(e.sequence)||e.sequence<=previous||!Number.isFinite(e.elapsed_ms)||e.elapsed_ms<0||e.elapsed_ms<elapsed||typeof e.message!=='string'||e.message.length>4000||typeof e.stage!=='string'||!['STARTED','PLAN','SEARCH','SOURCE','GAP','AI_PLAN','AI_PLAN_READY','CITATIONS_READY','AI_REVIEW','REVIEW_READY','COMPLETE','ERROR'].includes(e.stage))continue;
  previous=e.sequence;elapsed=e.elapsed_ms;
  // Old records may lack details. Do not backfill later results into early frames.
  let details:Partial<ResearchEvent>={};
  try{details=researchTelemetry(e);}catch{/* Keep the valid scalar event, not malformed details. */}
  accepted.push({stage:'RESEARCH',message:e.message,research:{run_id:e.run_id,sequence:e.sequence,elapsed_ms:e.elapsed_ms,stage:e.stage,message:e.message,...details}});
 }
 return accepted;
}
export function replayDelay(current:AutoEvent,next:AutoEvent){
 const delta=(next.research?.elapsed_ms??0)-(current.research?.elapsed_ms??0);
 return Math.min(2500,Math.max(650,delta));
}

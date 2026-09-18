import {autoWorkStates,type AutoEvent,type AutoOutcome,type WorkState} from './auto-review.ts';

export type SceneState=WorkState|'passed';
export const stageLabels=['시험 찾기','공개 근거 수집','추가 조사','AI 브리핑','원문 준비','추출·대조','비교 가능성 확인','가상 설계 · MOC'];
/** Visual projection only. Advancing to another stage is NOT proof of success. */
export function agentScene(events:AutoEvent[],outcome:AutoOutcome|null,busy:boolean){
 const last=events.at(-1),done=outcome?.kind==='result'?outcome:null;
 const base=autoWorkStates(events,outcome,busy);
 const indices:Partial<Record<AutoEvent['stage'],number>>={SEARCH:0,SCOPE:0,SELECTED:1,DOCUMENT:4,EXTRACTION:5,ASSESSMENT:6,EXPLORATION:7};
 let active=last?indices[last.stage]??-1:0;
 if(last?.stage==='RESEARCH')active=base.lastIndexOf('running');
 if(active<0&&last?.stage==='RESEARCH')active=3;
 if(!busy||outcome)active=-1;
 const states:SceneState[]=[...base,...(['DOCUMENT','EXTRACTION','ASSESSMENT','EXPLORATION'] as const).map(stage=>events.some(e=>e.stage===stage)?'passed' as const:'waiting' as const)];
 if(done){
  states[4]=done.document?(done.document.status==='READY'?'done':'partial'):'waiting';
  states[5]=done.automation?(['REVIEW_REQUIRED','NEEDS_EVIDENCE','PLAN_DOCUMENT_SAVED'].includes(done.automation.status)?'done':'partial'):done.automationError?'partial':states[5];
  states[6]=done.registryResults?'done':done.registryError?'partial':states[6];
  states[7]=done.exploration?'done':done.explorationError?'partial':states[7];
 }
 states.forEach((state,i)=>{if(state==='running')states[i]='passed';});
 if(active>=0)states[active]='running';
 if(!busy&&!done&&last&&outcome?.kind!=='scope'){const i=indices[last.stage]??base.lastIndexOf('partial');if(i>=0)states[i]='partial';}
 return {active,stages:stageLabels.map((label,i)=>({label,state:states[i]})),title:active>=0?stageLabels[active]:outcome?.kind==='scope'?'검토 범위 확인':done?'검토 기록 준비됨':busy?'검토 기록 정리':'작업 중단'};
}

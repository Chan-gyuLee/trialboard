import type {AutoEvent} from './auto-review.ts';
import type {FollowupExecution,ResearchCoverage} from './research.ts';
import {activityArtifacts} from './activity-model.ts';

export const contentLabel=(level?:string)=>({REGISTRY_TEXT:'등록정보 본문',ABSTRACT:'논문 초록',METADATA:'서지정보만',PDF_AVAILABLE:'PDF 링크 · 본문 미검토'}[level??'']??'수집 수준 미기록');
export const channelLabel=(channel:string)=>({'PubMed DRUG_SEARCH':'PubMed · 약물명','PubMed NCT_SEARCH':'PubMed · 시험번호','PubMed REGISTRY_BIBLIOGRAPHY':'PubMed · 등록부 인용','AI 추가 PubMed':'PubMed · AI 추가 검색','Drugs@FDA':'FDA · 허가 문서','ClinicalTrials.gov':'ClinicalTrials.gov · 등록부'}[channel]??channel);
export function researchProgress(events:AutoEvent[]){
 const research=events.flatMap(e=>e.research?[e.research]:[]),artifacts=activityArtifacts(events);
 const requests:{key:string;channel:string;query:string;sequence:number;receipt?:ResearchCoverage;followup?:FollowupExecution}[]=[];
 for(const e of research){
  if(!e.query||e.stage!=='SEARCH'&&!e.coverage)continue;
  const channel=e.channel??e.message.replace(/ 검색 중$/,'');
  const pending=e.stage==='SEARCH'?undefined:requests.filter(r=>r.channel===channel&&r.query===e.query&&!r.receipt).at(-1);
  if(pending){pending.receipt=e.coverage;continue;}
  requests.push({key:String(e.sequence),channel,query:e.query,sequence:e.sequence,receipt:e.coverage});
 }
 for(const request of requests)request.followup=research.find(e=>e.followup?.query===request.query)?.followup;
 const inventory=research.filter(e=>e.inventory).at(-1)?.inventory;
 const input=research.filter(e=>e.input_sources).at(-1);
 const anchors=research.filter(e=>e.anchor_count!==undefined).at(-1)?.anchor_count;
 return {requests:[...requests].reverse(),inventory,input,anchors,artifacts};
}

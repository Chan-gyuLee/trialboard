/** Retrieval cues from registered text, never a dose recommendation or clinical grade. */
import type {Study} from './evidence-scout.ts';

export const TRIAL_PRIORITY_VERSION='dose-start/1';
export type TrialPriority={version:string;tier:number;score:number;reason:string;quotes:{location:string;text:string}[]};
const escape=(s:string)=>s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
const normalize=(s:string)=>s.trim().toLowerCase().replace(/\s+/g,' ');

export function trialPriority(study:Study,asset:string):TrialPriority{
 // Require the named drug immediately beside a dose. Other drugs, numbers of tablets,
 // dose reductions in one arm, and mg/kg vs mg cannot create a two-arm mg comparison.
 const dose=new RegExp(`(?<![\\p{L}\\p{N}_])${escape(asset)}(?![\\p{L}\\p{N}_])\\s*:?\\s*(\\d+(?:\\.\\d+)?)\\s*mg(?![\\p{L}\\p{N}_]|\\s*[/⁄])`,'giu');
 const armDoses=study.arms.map((arm,index)=>{
  const parts=[{location:`시험군 ${index+1} · 이름`,text:arm.label},{location:`시험군 ${index+1} · 설명`,text:arm.description??''}];
  const hits=parts.flatMap(part=>[...part.text.matchAll(dose)].map(m=>({value:Number(m[1]),location:part.location,text:m[0]}))).filter(h=>Number.isFinite(h.value)&&h.value>0);
  const values=new Set(hits.map(h=>h.value));
  return values.size===1?hits[0]:undefined;
 });
 const first=armDoses.find(x=>x!==undefined),second=first?armDoses.find(x=>x!==undefined&&x.value!==first.value):undefined;
 const titleDose=/\bdose[- ](?:comparison|ranging|optimization|optimisation)\b/i.test(study.title);
 const drugNames=[...new Set(study.interventions.filter(i=>i.type==='DRUG').map(i=>normalize(i.name)))];
 const titleCue=titleDose&&drugNames.length===1&&drugNames[0]===normalize(asset)
  &&new RegExp(`(?<![\\p{L}\\p{N}_])${escape(asset)}(?![\\p{L}\\p{N}_])`,'iu').test(study.title);
 const tier=second?2:titleCue?1:0;
 const quotes=second&&first?[first,second].map(({location,text})=>({location,text})):titleCue?[{location:'시험 제목',text:study.title}]:[];
 const cue=tier===2?'서로 다른 시험군에서 약물명에 인접한 서로 다른 mg 용량 문구를 찾았습니다.':tier===1?'시험 제목에 용량 비교·탐색 표현이 있습니다.':'직접적인 용량 비교 문구를 확인하지 못해 자료 접근성으로 시작점을 정했습니다.';
 const access=(study.results_available?4:0)+Math.min(study.documents.length,2);
 return {version:TRIAL_PRIORITY_VERSION,tier,score:tier*100+access,quotes,
  reason:`${cue} 등록 결과 ${study.results_available?'공개':'미공개'} · 첨부 문서 ${study.documents.length}개. 문구 기반 조사 시작점이며 임상적 우선순위가 아닙니다. 무작위배정·동일 환자군·일정·비교 결과는 별도 확인합니다.`};
}

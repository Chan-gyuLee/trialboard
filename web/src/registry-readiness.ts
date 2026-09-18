import type {RegistryResults} from './registry-results.ts';

export type Readiness = {
  schema: 'registry-readiness/1'; snapshotDigest: string;
  status: 'EXPERT_REVIEW_REQUIRED' | 'NEEDS_EVIDENCE';
  method: 'DETERMINISTIC_RULES'; clinicalApproved: false; simulationExecuted: false;
  responseCandidate: boolean; safetyCandidate: boolean; questions: string[]; steps: string[];
  series: {id: string; family: 'RESPONSE'|'SAFETY'|'OTHER'; title: string; context: string;
    status: 'REVIEW_CANDIDATE'|'NEEDS_EVIDENCE'; issues: string[];
    valueKind: 'REPORTED_PERCENTAGE'|'REPORTED_COUNT'|'OTHER';
    groups: {label: string; groupId: string; locator: string}[];
  }[];
};
export const issueLabels:Record<string,string> = {
  SECOND_GROUP_MISSING:'두 번째 결과 집단 없음', DISTINCT_DOSE_LABELS_MISSING:'상이한 용량의 집단 표기 미확보',
  DUPLICATE_GROUP:'동일 집단 중복', POOLED_OR_MULTI_DOSE_CONTEXT:'통합집단·복수 용량 맥락',
  DOSE_UNITS_DIFFER:'용량 단위가 달라 직접 대조 보류',
  UNSUPPORTED_VALUE_ROLE:'비율·참여자 수로 처리할 수 없는 지표', DENOMINATOR_UNRESOLVED:'행에 맞는 분석 분모 미확인',
  VALUE_UNRESOLVED:'유효한 보고값 미확인', CONTEXT_INCOMPLETE:'정의·관측 기간 미확보', CONTEXT_DIFFERS:'집단 간 맥락 차이',
};
export function readReadiness(value: unknown, tables: RegistryResults):Readiness {
  const r=value as Readiness;
  const strings=(v:unknown,max:number):v is string[]=>Array.isArray(v)&&v.length<=max&&v.every(x=>typeof x==='string'&&x.length<=2000);
  if(!r||r.schema!=='registry-readiness/1'||r.snapshotDigest!==tables.snapshotDigest||r.method!=='DETERMINISTIC_RULES'||r.clinicalApproved!==false||r.simulationExecuted!==false||!['EXPERT_REVIEW_REQUIRED','NEEDS_EVIDENCE'].includes(r.status)||typeof r.responseCandidate!=='boolean'||typeof r.safetyCandidate!=='boolean'||!strings(r.questions,10)||!strings(r.steps,10)||!Array.isArray(r.series)||r.series.length>160)throw Error('등록 결과 점검 형식 오류');
  const ids=new Set();
  for(const s of r.series){
    if(!s||typeof s.id!=='string'||!/^[a-f0-9]{24}$/.test(s.id)||ids.has(s.id)||!['RESPONSE','SAFETY','OTHER'].includes(s.family)||typeof s.title!=='string'||typeof s.context!=='string'||!strings(s.issues,12)||s.issues.some(x=>!Object.hasOwn(issueLabels,x))||!['REVIEW_CANDIDATE','NEEDS_EVIDENCE'].includes(s.status)||!['REPORTED_PERCENTAGE','REPORTED_COUNT','OTHER'].includes(s.valueKind)||!Array.isArray(s.groups)||!s.groups.length||s.groups.length>100)throw Error('등록 결과 점검 항목 오류');
    ids.add(s.id);
    for(const g of s.groups)if(!g||![...tables.outcomes,...tables.safety].some(row=>row.locator===g.locator&&row.groupId===g.groupId&&row.groupTitle===g.label))throw Error('등록 결과 점검 원본 불일치');
    if(s.status==='REVIEW_CANDIDATE'&&(s.issues.length||s.groups.length<2))throw Error('등록 결과 준비 상태 불일치');
    if(s.status==='NEEDS_EVIDENCE'&&!s.issues.length)throw Error('등록 결과 보류 이유 누락');
  }
  if(r.responseCandidate!==r.series.some(s=>s.family==='RESPONSE'&&s.status==='REVIEW_CANDIDATE')||r.safetyCandidate!==r.series.some(s=>s.family==='SAFETY'&&s.status==='REVIEW_CANDIDATE')||r.status!==(r.responseCandidate&&r.safetyCandidate&&!tables.limited?'EXPERT_REVIEW_REQUIRED':'NEEDS_EVIDENCE'))throw Error('등록 결과 점검 집계 불일치');
  return r;
}

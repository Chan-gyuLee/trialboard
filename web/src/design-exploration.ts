/** A separate synthetic result, never a replacement for evidence or clinical approval. */
import {strictJson} from './field-review.ts';
import {arr,obj,str,hash,num,same,exact} from './design-brief.ts';
import type {ResearchResult} from './research.ts';

type Plan={id:string;label:string;per_arm:number};
type Scenario={id:string;label:string;arms:string[];response:number[];adverse_event:number[];adverse_event_penalty:number;maximum_adverse_event_rate:number;rationale:string;provenance:'synthetic_assumption'};
type Simulation={scenario:Scenario;design:Plan;seed:number;repetitions:number;total_sample_size:number;selection_probability:Record<string,number>;no_selection_probability:number;selects_true_utility_best_probability:number;selects_true_unsafe_probability:number;monte_carlo_se:Record<string,number>;true_utility_best_arms:string[];assumptions:string[]};
export type Exploration={schema:'research-exploration/1';policy:'illustrative-designs/1';runId:string;nctId:string;asset:string;createdAt:string;status:'ILLUSTRATIVE_ONLY';provenance:'RULE_LIBRARY_HYPOTHETICAL';clinicalApproved:false;userApproved:false;recommendedPlanId:null;modelCalls:0;simulationExecuted:true;evidenceUsedAsParameters:false;armMapping:'UNMAPPED_GENERIC_A_B';snapshotDigest:string|null;evidenceStatus:string;questions:string[];plans:Plan[];scenarios:Scenario[];simulations:Simulation[];runtime:Record<string,string>;engineDigest:string;limitations:string[]};
const fail=()=>{throw Error('가상 설계 계산의 출처·가정·결과 연결을 확인하지 못했습니다.');};
const close=(a:number,b:number)=>Math.abs(a-b)<1e-10;
export function readExploration(raw:string,result:ResearchResult):Exploration|null{
 const parsed=strictJson(raw,250000,50000);if(parsed===null)return null;const v=obj(parsed),c=result.collection;
 if(v.schema!=='research-exploration/1'||v.policy!=='illustrative-designs/1'||v.runId!==c.id||v.nctId!==c.request.nct_id||v.asset!==c.request.asset||v.status!=='ILLUSTRATIVE_ONLY'||v.provenance!=='RULE_LIBRARY_HYPOTHETICAL'||v.clinicalApproved!==false||v.userApproved!==false||v.recommendedPlanId!==null||v.modelCalls!==0||v.simulationExecuted!==true||v.evidenceUsedAsParameters!==false||v.armMapping!=='UNMAPPED_GENERIC_A_B')fail();
 if(!Number.isFinite(Date.parse(str(v.createdAt))))fail();hash(v.engineDigest);
 if(v.snapshotDigest!==null&&(!c.sources.some(s=>s.id===`registry_${c.request.nct_id}`&&s.raw_snapshots.includes(hash(v.snapshotDigest)))))fail();
 if(!['NEEDS_EVIDENCE','EXPERT_REVIEW_REQUIRED','NO_REGISTRY_RESULTS'].includes(str(v.evidenceStatus))||(v.snapshotDigest===null)!==(v.evidenceStatus==='NO_REGISTRY_RESULTS'))fail();
 const runtime=obj(v.runtime);for(const k of ['python','numpy','rng'])str(runtime[k],100);
 for(const key of ['questions','limitations'])arr(v[key],1,20).forEach(x=>str(x,3000));
 const plans=arr(v.plans,3,3).map(obj),scenarios=arr(v.scenarios,3,3).map(obj);
 plans.forEach((p,i)=>{const n=[20,40,60][i];exact(p,['id','label','per_arm']);if(p.id!==`n${n}`||p.per_arm!==n)fail();str(p.label,200);});
 scenarios.forEach((s,i)=>{
  exact(s,['id','label','arms','response','adverse_event','adverse_event_penalty','maximum_adverse_event_rate','rationale','provenance']);
  if(s.id!==['equal','tradeoff','unsafe'][i]||!same(s.arms,['A','B'])||!same(s.response,[[.3,.3],[.3,.4],[.3,.4]][i])||!same(s.adverse_event,[[.2,.2],[.15,.3],[.5,.6]][i])||s.adverse_event_penalty!==.5||s.maximum_adverse_event_rate!==.35||s.provenance!=='synthetic_assumption')fail();
  str(s.label,200);str(s.rationale,1000);
 });
 const seen=new Set<string>();
 for(const value of arr(v.simulations,9,9)){
  const r=obj(value),s=obj(r.scenario),p=obj(r.design),key=`${s.id}/${p.id}`;
  if(seen.has(key)||!scenarios.some(x=>same(x,s))||!plans.some(x=>same(x,p))||r.seed!==42||r.repetitions!==2000||r.total_sample_size!==Number(p.per_arm)*2)fail();seen.add(key);
  const rates=obj(r.selection_probability),se=obj(r.monte_carlo_se);exact(rates,['A','B']);exact(se,['A','B','no_selection','true_utility_best','true_unsafe']);
  const ps={...rates,no_selection:r.no_selection_probability,true_utility_best:r.selects_true_utility_best_probability,true_unsafe:r.selects_true_unsafe_probability};
  for(const [k,x] of Object.entries(ps)){const q=num(x,0,1);if(!close(q*2000,Math.round(q*2000))||!close(num(se[k],0,1),Math.sqrt(q*(1-q)/2000)))fail();}
  if(!close(Number(rates.A)+Number(rates.B)+Number(r.no_selection_probability),1))fail();
  const a=s as unknown as Scenario,eligible=a.arms.filter((_,i)=>a.adverse_event[i]<=a.maximum_adverse_event_rate),utility=a.response.map((x,i)=>x-a.adverse_event_penalty*a.adverse_event[i]),best=Math.max(...eligible.map(k=>utility[a.arms.indexOf(k)])),bestArms=eligible.filter(k=>close(utility[a.arms.indexOf(k)],best));
  if(!same(r.true_utility_best_arms,bestArms)||!close(Number(r.selects_true_utility_best_probability),bestArms.length?bestArms.reduce((sum,k)=>sum+Number(rates[k]),0):Number(r.no_selection_probability))||!close(Number(r.selects_true_unsafe_probability),a.arms.filter(k=>!eligible.includes(k)).reduce((sum,k)=>sum+Number(rates[k]),0)))fail();
  arr(r.assumptions,1,20).forEach(x=>str(x,3000));
 }
 return parsed as Exploration;
}
export async function requestExploration(result:ResearchResult,signal:AbortSignal,request:typeof fetch=fetch,create=false):Promise<Exploration|null>{
 signal.throwIfAborted();const response=await request(`/api/research/runs/${result.collection.id}/exploration`,{signal,cache:'no-store',...(create?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({consent:true})}:{})});
 if(!create&&response.status===404)return null;
 if(!response.ok)throw Error('가상 설계 탐색을 확인하지 못했습니다. 실제 근거 검토 결과는 유지합니다.');
 const value=readExploration(await response.text(),result);if(create&&!value)fail();return value;
}

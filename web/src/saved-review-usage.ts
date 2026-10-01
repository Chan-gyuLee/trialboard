export const usageModes=['DACON_RESPONSES','SCRIPTED_TEST_DOUBLE','COLLECTORS_ONLY'] as const;
export type UsageGroup={observed_model_calls:number;observed_input_tokens:number;observed_output_tokens:number;input_unknown_attempts:number;output_unknown_attempts:number};
export type SavedReviewUsage={schema:'research-saved-review-usage/1';scope:'SAVED_REVIEW_ONLY';run_id:string;as_of:string;attempts_total:number;completed_attempts:number;failed_attempts:number;cancelled_attempts:number;unfinished_attempts:number;usage_by_mode:Record<typeof usageModes[number],UsageGroup>};
const groupKeys=['observed_model_calls','observed_input_tokens','observed_output_tokens','input_unknown_attempts','output_unknown_attempts'];
function fail():never{throw Error('재검토 사용량 응답의 대상 또는 집계가 올바르지 않습니다.');}
function object(value:unknown,keys:readonly string[]):Record<string,unknown>{
 if(!value||typeof value!=='object'||Array.isArray(value))return fail();
 const o=value as Record<string,unknown>;
 if(Object.keys(o).length!==keys.length||keys.some(key=>!Object.hasOwn(o,key)))return fail();return o;
}
function integer(value:unknown):number{if(typeof value!=='number'||!Number.isSafeInteger(value)||value<0)return fail();return value;}
export function readSavedReviewUsage(value:unknown,runId:string):SavedReviewUsage{
 const o=object(value,['schema','scope','run_id','as_of','attempts_total','completed_attempts','failed_attempts','cancelled_attempts','unfinished_attempts','usage_by_mode']);
 if(!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(runId)||o.run_id!==runId||o.schema!=='research-saved-review-usage/1'||o.scope!=='SAVED_REVIEW_ONLY'||typeof o.as_of!=='string'||!/(Z|\+00:00)$/.test(o.as_of)||!Number.isFinite(Date.parse(o.as_of)))return fail();
 const total=integer(o.attempts_total),completed=integer(o.completed_attempts),failed=integer(o.failed_attempts),cancelled=integer(o.cancelled_attempts),unfinished=integer(o.unfinished_attempts);
 if(total>10000||completed+failed+cancelled+unfinished!==total||total+(total-unfinished)>10000)return fail();
 const groups=object(o.usage_by_mode,usageModes);let calls=0;
 for(const mode of usageModes){
  const group=object(groups[mode],groupKeys);for(const key of groupKeys)integer(group[key]);
  const g=group as UsageGroup;calls+=g.observed_model_calls;
  if(g.input_unknown_attempts>g.observed_model_calls||g.output_unknown_attempts>g.observed_model_calls||g.observed_model_calls===0&&(g.observed_input_tokens!==0||g.observed_output_tokens!==0)||mode==='COLLECTORS_ONLY'&&groupKeys.some(key=>group[key]!==0))return fail();
  if(g.input_unknown_attempts===g.observed_model_calls&&g.observed_input_tokens!==0||g.output_unknown_attempts===g.observed_model_calls&&g.observed_output_tokens!==0)return fail();
 }
 if(calls>total-unfinished||calls<completed)return fail();
 return o as SavedReviewUsage;
}

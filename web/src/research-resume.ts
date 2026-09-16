import {readScoutReceipt,type ScoutContext} from './evidence-scout.ts';
import {readResearchResult,type ResearchResult} from './research.ts';
export type ResearchResume={token:string;context:ScoutContext};
export type ResumedResearch={token:string;result:ResearchResult;sourceId:string};
/** Validate selected provenance before replacing UI context. No external search or model call. */
export function validateResearchResume(context:ScoutContext,receiptValue:unknown,researchRaw?:string){
 const receipt=readScoutReceipt(receiptValue);
 if(receipt.id!==context.receiptId||!receipt.studies.some(s=>s.nct_id===context.study&&s.conditions.includes(context.indication)))throw Error('저장한 수집 기록과 프로젝트의 시험·적응증이 다릅니다.');
 let result:ResearchResult|null=null;
 if(context.document){
   if(!researchRaw)throw Error('프로젝트의 조사 기록이 없습니다.');
   result=readResearchResult(researchRaw);const c=result.collection,r=c.request;
   if(c.id!==context.document.runId||r.search_id!==receipt.id||r.nct_id!==context.study||r.asset!==context.asset||r.indication!==context.indication||!c.sources.some(s=>s.id===context.document!.sourceId&&s.title===context.document!.title))throw Error('프로젝트의 문서 출처와 저장된 조사 기록이 다릅니다.');
 }
 return {receipt,result};
}

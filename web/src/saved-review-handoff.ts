import {canonical,digest,strictJson} from './field-review.ts';
import {readSavedArtifact,type SavedArtifact} from './saved-research-review.ts';
import {safeSourceUrl} from './research.ts';
import type {ScoutContext} from './evidence-scout.ts';
export type ReviewHandoff={schema:'research-saved-review-handoff/1';run_id:string;attempt_id:string;artifact_digest:string;context:{search_id:string;asset:string;indication:string;nct_id:string};sources:{source_id:string;source_digest:string;title:string;url:string;pdf_url:string|null;content_level:string}[];artifact:SavedArtifact;clinical_verified:false};
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
function object(value:unknown,keys:string[]):Record<string,unknown>{if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).sort().join(',')!==[...keys].sort().join(','))throw Error('다음 검토 연결 정보의 형식이 올바르지 않습니다.');return value as Record<string,unknown>;}
export async function readReviewHandoff(value:unknown,runId:string,attemptId:string,expected?:SavedArtifact):Promise<ReviewHandoff>{
 const v=object(value,['schema','run_id','attempt_id','artifact_digest','context','sources','artifact','clinical_verified']);
 if(v.schema!=='research-saved-review-handoff/1'||v.run_id!==runId||v.attempt_id!==attemptId||v.clinical_verified!==false||typeof v.artifact_digest!=='string'||!/^[a-f0-9]{64}$/.test(v.artifact_digest))throw Error('연결할 검토 기록이 다릅니다.');
 const artifact=readSavedArtifact(v.artifact,runId,attemptId);if(artifact.status!=='COMPLETED'||await digest(canonical(artifact))!==v.artifact_digest||expected&&canonical(artifact)!==canonical(expected))throw Error('검토 결과가 바뀌었거나 아직 완료되지 않았습니다. 결과를 다시 확인하세요.');
 const context=object(v.context,['search_id','asset','indication','nct_id']);if(typeof context.search_id!=='string'||!uuid.test(context.search_id)||context.asset!==artifact.context.asset||context.indication!==artifact.context.indication||context.nct_id!==artifact.context.nct_id)throw Error('조사 대상과 검토 문맥이 다릅니다.');
 if(!Array.isArray(v.sources)||v.sources.length!==artifact.sources.length)throw Error('선택 출처가 다릅니다.');
 v.sources.forEach((value,i)=>{const s=object(value,['source_id','source_digest','title','url','pdf_url','content_level']),bound=artifact.sources[i];if(s.source_id!==bound.source_id||s.source_digest!==bound.source_digest||s.title!==bound.title||!safeSourceUrl(s.url)||s.pdf_url!==null&&!safeSourceUrl(s.pdf_url)||!['REGISTRY_TEXT','ABSTRACT','METADATA','PDF_AVAILABLE'].includes(String(s.content_level)))throw Error('선택 출처의 주소나 버전이 다릅니다.');});
 return v as ReviewHandoff;
}
export async function loadReviewHandoff(artifact:SavedArtifact,signal:AbortSignal,request:typeof fetch=fetch):Promise<ReviewHandoff>{
 signal.throwIfAborted();const response=await request(`/api/research/runs/${encodeURIComponent(artifact.run_id)}/review-attempts/${encodeURIComponent(artifact.attempt_id)}/handoff`,{signal,cache:'no-store'});
 if(!response.ok)throw Error(response.status===403?'현재 권한이나 저장 이용조건으로 이 검토를 이어갈 수 없습니다.':response.status===409?'자료나 검토 버전이 달라졌습니다. 다시 열어 확인하세요.':'검토 연결 정보를 가져오지 못했습니다. 새 AI 요청은 하지 않았습니다.');
 const value=await readReviewHandoff(strictJson(await response.text(),8_000_000),artifact.run_id,artifact.attempt_id,artifact);signal.throwIfAborted();return value;
}
export function reviewIntakeContext(packet:ReviewHandoff,sourceId:string):ScoutContext{
 const source=packet.sources.find(s=>s.source_id===sourceId);if(!source)throw Error('원문 확인할 출처를 선택하세요.');
 return {asset:packet.context.asset,indication:packet.context.indication,study:packet.context.nct_id,receiptId:packet.context.search_id,question:packet.artifact.review?.questions[0]??'원문에서 반응·이상반응의 사건 수와 분모, 집단·시점을 확인할 수 있는가?',...(source.pdf_url?{document:{runId:packet.run_id,sourceId,title:source.title}}:{})};
}
export function savedReviewMeetingMarkdown(packet:ReviewHandoff,notes:string):string{
 const a=packet.artifact;
 return [`# ${packet.context.asset} · KOL 검토 준비`,`시험: ${packet.context.nct_id}`,`적응증: ${packet.context.indication}`,`검토 시각: ${a.completed_at}`,`조사/검토: ${packet.run_id} / ${packet.attempt_id}`,`검토 지문: ${packet.artifact_digest}`,'','AI 검토 초안입니다. 임상 승인·최적 용량 추천·수치 검증 결과가 아닙니다.',a.execution_mode==='SCRIPTED_TEST_DOUBLE'?'합성 테스트 모델 기록입니다. 실제 AI 실행이 아닙니다.':'','## 확인할 질문',...(a.review?.questions.map((q,i)=>`${i+1}. ${q}`)??[]),'','## 근거와 검토 초안',...(a.review?.findings.flatMap(f=>{const s=packet.sources.find(s=>s.source_id===f.source_id)!;return [`### ${s.title}`,`출처: ${s.url}`,`출처 지문: ${s.source_digest}`,...f.quote.split('\n').map(line=>`> ${line}`),f.interpretation,''];})??[]),'## 사람이 작성한 회의 메모',notes.trim()||'아직 작성하지 않았습니다.','','## 다음 확인','원문에서 사건 수·분모·집단·시점을 대조한 뒤 설계 가정을 입력하세요. 이 문서의 서술을 임상 수치로 자동 변환하지 않았습니다.'].join('\n');
}

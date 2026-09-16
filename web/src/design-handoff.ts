import {digest,type FieldReview} from './field-review.ts';
import type {PdfSource} from './pdf-contract.ts';
import {newDraft,blankScenario,type DesignDraft} from './design-brief.ts';
import {isMocSource} from './moc-data.ts';
export async function designHandoff(review:FieldReview,source:PdfSource,agentRaw:string|null,moc=false):Promise<DesignDraft>{
 if(source.sha256!==review.sourceDigest)throw Error('현재 PDF와 검토가 다릅니다.');
 if(moc&&!isMocSource(source))throw Error('등록된 합성 PDF에서만 MOC 가정을 사용할 수 있습니다.');
 if(!agentRaw || await digest(agentRaw)!==review.origin.reportDigest)throw Error('현재 검토를 시작한 원본 실행 기록이 필요합니다.');
 const record=JSON.parse(agentRaw),d=newDraft();d.question=record.input.question;
 const doses=[...new Set(review.rows.map(r=>r.fields.dose.current.value).filter((s):s is string=>!!s))];
 if(doses.length<2 || doses.length>4)throw Error('비교할 용량이 2–4개 있어야 합니다. 부족한 근거는 새로 확인하세요.');
 d.arms=doses.map((dose,i)=>({id:`arm-${i+1}`,source_dose:dose,observation_ids:review.rows.filter(r=>r.fields.dose.current.value===dose).map(r=>r.id)}));
 d.scenarios=[blankScenario(1,d.arms.length)];
 if(moc){
  if(doses.length!==2 || !doses.includes('dose-A') || !doses.includes('dose-B'))throw Error('MOC 가정은 dose-A와 dose-B 두 군만 지원합니다.');
  d.plans=[{id:'plan-1',label:'MOC 60명 설계',per_arm:'30',rationale:'합성 발표용 표본수 대안. 권장 표본수 아님.'},{id:'plan-2',label:'MOC 120명 설계',per_arm:'60',rationale:'합성 발표용 증원 대안. 기간·비용 미포함.'}];
  d.scenarios=[{...blankScenario(1,2),label:'MOC 기준 가정',response:doses.map(s=>s==='dose-A'?'0.30':'0.32'),adverse_event:doses.map(s=>s==='dose-A'?'0.12':'0.25'),adverse_event_penalty:'0.7',maximum_adverse_event_rate:'0.35',rationale:'MOC: 임의로 정한 별도 가정입니다. PDF 관측값의 확률 추정이 아닙니다. 확인된 근거에 비교안을 연결하되 계산 전 재검증합니다.'}];
 }
 return d;
}

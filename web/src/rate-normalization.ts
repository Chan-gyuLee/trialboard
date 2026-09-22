import type {PdfSource} from './pdf-contract.ts';
import type {FieldName,FieldReview,ReviewRow,Value} from './field-review.ts';

export type RateNormalization={method:'adjacent-percent/1';display:string;unitSpanId:string;pointEstimateAttested:true;sameGroupAttested:true};
const fail=(message:string):never=>{throw Error(message);};
/** Literal/geometry guards only. Assertions remain unauthenticated human claims. */
export function normalizedRate(value:Value,source:PdfSource,name:FieldName='reported_rate',kind:ReviewRow['valueKind']='reported_percentage'):string|null {
 const n=value.normalization;if(n===undefined)return null;
 if(!n||Object.keys(n).sort().join(',')!=='display,method,pointEstimateAttested,sameGroupAttested,unitSpanId'||n.method!=='adjacent-percent/1'||n.pointEstimateAttested!==true||n.sameGroupAttested!==true)fail('수치 해석의 확인 기록이 올바르지 않습니다.');
 if(name!=='reported_rate'||kind!=='reported_percentage')fail('보고 비율 자료의 비율 필드만 지원합니다.');
 const raw=value.value??'';
 if(!/^[0-9]{1,3}(?:\.[0-9]{1,4})?$/.test(raw)||Number(raw)>100||n.display!==raw+'%')fail('원문 숫자와 0–100% 해석값이 일치해야 합니다.');
 const primary=value.citation,unit=value.supporting?.find(c=>c.spanId===n.unitSpanId);
 const p=source.pages.flatMap(p=>p.spans).find(s=>s.id===primary?.spanId),u=source.pages.flatMap(p=>p.spans).find(s=>s.id===unit?.spanId);
 if(!primary||!unit||unit.role!=='unit'||!p?.box||!u?.box||primary.page!==unit.page||primary.page!==p.page||unit.page!==u.page||p.id===u.id||primary.quote.trim()!==raw||p.text.trim()!==raw||unit.quote.trim()!=='%'||u.text.trim()!=='%')fail('숫자만 있는 원문과 별도의 % 문구를 단위 근거로 연결하세요. 표 머리글·각주 단위는 아직 지원하지 않습니다.');
 const a=p!.box!,b=u!.box!,overlap=Math.min(a.y+a.height,b.y+b.height)-Math.max(a.y,b.y),gap=b.x-(a.x+a.width);
 if(overlap<Math.min(a.height,b.height)*0.5||gap < -0.002||gap>0.04)fail('% 문구가 숫자의 같은 줄 바로 오른쪽에 있지 않습니다. 다른 열·집단의 단위일 수 있습니다.');
 for(const s of source.pages.find(page=>page.number===p!.page)!.spans){if(s.id===p!.id||s.id===u!.id||!s.box)continue;const box=s.box,sameLine=Math.min(a.y+a.height,box.y+box.height)-Math.max(a.y,box.y)>0,nearby=box.x<=b.x+b.width+0.12&&box.x+box.width>=a.x-0.12;if(sameLine&&nearby&&/\b(?:CI|confidence|p\s*value)\b|신뢰구간/i.test(s.text))fail('가까운 문구에 신뢰구간/CI/p값 표현이 있습니다. 결과 비율로 해석하지 말고 보류하세요.');}
 return n.display;
}
export function reviewedRates(review:FieldReview,source:PdfSource):Record<string,string>{
 const rates:Record<string,string>={};
 for(const row of review.rows){if(Object.values(row.fields).some(f=>f.decision==='held'))continue;const f=row.fields.reported_rate;if(['confirmed','corrected'].includes(f.decision)){const rate=normalizedRate(f.current,source,'reported_rate',row.valueKind);if(rate)rates[row.id]=rate;}}
 return rates;
}

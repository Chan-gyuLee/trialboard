/** Checks only the exact selected payload. It cannot certify a table, cohort or alias. */
import type {PdfAgentContext} from './pdf-agent.ts';
export type SelectedInput=PdfAgentContext & {spans:{id:string;text:string;page:number|null}[]};
export type InputCheck={id:string;label:string;found:boolean;detail:string;spanIds:string[]};
export function checkPdfInput(input:SelectedInput){
 const match=(test:(text:string)=>boolean)=>input.spans.filter(s=>test(s.text)).map(s=>s.id);
 const literal=(term:string)=>match(text=>!!term.trim()&&text.toLowerCase().includes(term.trim().toLowerCase()));
 const ncts=[...new Set(input.spans.flatMap(s=>s.text.match(/(?<![A-Za-z0-9_])NCT\d{8}(?![A-Za-z0-9_])/gi)??[]).map(s=>s.toUpperCase()))];
 const study=/^NCT\d{8}$/i.test(input.study.trim())?match(text=>(text.match(/(?<![A-Za-z0-9_])NCT\d{8}(?![A-Za-z0-9_])/gi)??[]).some(n=>n.toUpperCase()===input.study.trim().toUpperCase())):literal(input.study);
 // A header such as "ORR, % (95% CI)" does not contain an observed rate.
 // Exclude explicit confidence-level labels; this is still lexical, not table parsing.
 const asset=literal(input.asset),rates=match(text=>/\d+(?:\.\d+)?\s*[%％]/.test(text
  .replace(/\d+(?:\.\d+)?\s*[%％]\s*(?:C\.?I\.?\b|confidence\s+interval\b|신뢰구간)/gi,'')
  .replace(/(?:\bC\.?I\.?|\bconfidence\s+interval|신뢰구간)\s*[:=]?\s*\d+(?:\.\d+)?\s*[%％]/gi,'')));
 const denominator=match(text=>/\bN\s*=\s*\d+|\b\d+\s+(?:patients|subjects)\b|분모|분석\s*대상\s*\d+/i.test(text));
 const time=match(text=>/\b(?:data.cut.off|follow.up|months?|weeks?|cutoff)\b|자료마감|추적기간|평가\s*기간/i.test(text));
 const headers=match(text=>/[%％]/.test(text));
 const checks:InputCheck[]=[
  {id:'study',label:'선택한 시험명',found:study.length>0,spanIds:study,detail:study.length?'시험명 문구가 포함되어 있습니다. 같은 코호트인지는 별도 확인이 필요합니다.':'시험명 문구를 함께 선택하세요. 검색에서 고른 시험을 원문 근거로 대신할 수 없습니다.'},
  {id:'asset',label:'입력한 약물명',found:asset.length>0,spanIds:asset,detail:asset.length?'입력한 이름의 문구를 찾았습니다. 약물 동일성 확인은 아닙니다.':'일반명·상품명·개발 코드가 다를 수 있습니다. 원문 식별 문구를 추가하고 이름 관계를 확인하세요.'},
  {id:'rate',label:'숫자와 비율 단위',found:rates.length>0,spanIds:rates.length?rates:headers,detail:rates.length?'같은 문구에 숫자와 %가 있습니다. 지표·분모와의 관계는 별도 확인이 필요합니다.':headers.length?'% 표기와 숫자가 별도 문구에 나뉘었을 수 있습니다. 표 제목·수치·단위·각주를 함께 확인하세요.':'숫자와 %가 함께 있는 문구를 찾지 못했습니다. 사건 수 자료라면 비율이 없어도 되며, 임의 단위를 붙이지 마세요.'},
  {id:'denominator',label:'분모·분석 대상 표현',found:denominator.length>0,spanIds:denominator,detail:denominator.length?'대상 수를 나타내는 표현이 있습니다. 해당 지표의 분모인지 확인하세요.':'분모나 분석 대상 수의 문구를 함께 선택하세요. 전체 모집 수를 하위집단 분모로 대신하지 않습니다.'},
  {id:'time',label:'기간·자료마감 표현',found:time.length>0,spanIds:time,detail:time.length?'기간 관련 표현이 있습니다. 반응 지속기간·추적기간·평가시점을 구분해야 합니다.':'기간이나 자료마감 문구를 찾지 못했습니다. 전송 범위에 없는 것과 문서에 없는 것은 다릅니다.'},
 ];
 return {checks,ncts,spanCount:input.spans.length,textBytes:new TextEncoder().encode(input.spans.map(s=>s.text).join('')).length,clinicalApproval:false as const};
}

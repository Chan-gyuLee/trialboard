import {PDF_LIMITS,validatePageSelection,type PdfPageSelection} from './pdf-contract.ts';
/** Explicit original PDF numbers, never print-page labels or zero-based ordinals. */
export function parsePageRange(raw:string,totalPages:number):PdfPageSelection {
 if(typeof raw!=='string'||raw.length>500||!raw.trim())throw Error('원문 쪽수를 입력하세요. 예: 19-22, 33, 35');
 const values=new Set<number>();
 for(const part of raw.split(',')){
  const m=/^\s*(\d{1,3})(?:\s*-\s*(\d{1,3}))?\s*$/.exec(part);
  if(!m)throw Error('쪽수 또는 시작-끝 범위를 쉼표로 구분하세요. 예: 19-22, 33, 35');
  const from=Number(m[1]),to=Number(m[2]??m[1]);
  if(from<1||to<from||to>totalPages)throw Error(`1-${totalPages}쪽 안에서 오름차순 범위를 입력하세요.`);
  for(let p=from;p<=to;p++){values.add(p);if(values.size>PDF_LIMITS.pages)throw Error('한 번에 최대 40쪽을 검토합니다. 범위를 줄여 주세요.');}
 }
 const selection={totalPages,pageNumbers:[...values].sort((a,b)=>a-b)};
 validatePageSelection(selection);return selection;
}

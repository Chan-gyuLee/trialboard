/** Local lexical routing, not model reasoning or clinical relevance classification. */
import type {PdfSource} from './pdf-contract.ts';
import type {PdfAgentContext} from './pdf-agent.ts';
export type PdfCandidate={spanId:string;page:number;text:string;score:number;reasons:string[]};
const rules:[string,RegExp,number][]=[
 ['용량·투여 단위',/\b\d+(?:\.\d+)?\s*(?:mg|mcg|µg|μg)(?:\b|\/)|용량|투여량/i,4],
 ['반응 평가변수',/\b(?:objective response|response rate|ORR|RECIST)\b|객관적\s*반응|반응률/i,4],
 ['안전성 평가변수',/\b(?:adverse events?|toxicity|dose.limiting|grade\s*[≥>]?\s*3|safety)\b|이상반응|독성/i,4],
 ['집단·분석 범위',/\b(?:cohort|population|randomi[sz]ed|pooled|subgroup|evaluable|intent.to.treat)\b|분석집단|코호트|무작위/i,2],
 ['평가시점·자료마감',/\b(?:data.cut.off|follow.up|months?|weeks?|cutoff)\b|자료마감|추적기간/i,1],
];
export const candidateCategories=[...rules.map(([label])=>label),'약물명 문구','시험명 문구'];
export function pdfCandidates(source:PdfSource,context:PdfAgentContext,category=''):PdfCandidate[]{
 const terms=[['약물명 문구',context.asset],['시험명 문구',context.study]] as const;
 return source.pages.flatMap(p=>p.spans).flatMap(s=>{
  if(!s.box||s.text.length>2000||!s.text.trim())return [];
  let score=0;const reasons:string[]=[];
  for(const [label,re,weight] of rules)if(re.test(s.text)){score+=weight;reasons.push(label);}
  for(const [label,term] of terms)if(term.trim().length>=2&&s.text.toLocaleLowerCase().includes(term.trim().toLocaleLowerCase())){score+=3;reasons.push(label);}
  if(!score||(category&&!reasons.includes(category)))return [];
  return [{spanId:s.id,page:s.page,text:s.text,score,reasons}];
 }).sort((a,b)=>b.score-a.score||a.page-b.page||a.spanId.localeCompare(b.spanId)).slice(0,20);
}

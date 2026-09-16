/** Reproducible text/metadata checks, not a model or a clinical identity classifier. */
import type {ResearchSource} from "./research.ts";

export const LINKAGE_LABELS={SELECTED_MENTION:"선택 NCT 문구 발견",MULTIPLE_TRIALS:"여러 NCT 문구 발견",OTHER_TRIAL:"다른 NCT만 발견",REGISTRY_LINK:"등록부 연결 · 본문 확인 필요",DRUG_LEVEL:"약물 단위 규제 문서",UNRESOLVED:"시험 연결 문구 미확보"} as const;
export type LinkageStatus=keyof typeof LINKAGE_LABELS;
export type LinkageQuote={field:"title"|"text";quote:string;signal:string};
export type LinkageAudit={sourceId:string;sourceDigest:string;selectedNct:string;status:LinkageStatus;mentionedNcts:string[];selectedMention:boolean;cohortSignals:string[];quotes:LinkageQuote[];questions:string[];clinicalVerified:false;method:"TEXT_METADATA_RULES/1"};
const nctPattern=()=>/(?<![A-Za-z0-9_])NCT\d{8}(?![A-Za-z0-9_])/gi;
const signals:[string,RegExp][]=[
  ["통합 분석 표현",/\b(?:pooled|integrated)\s+(?:analysis|analyses|safety|data)|통합\s*분석/gi],
  ["하위집단·코호트 표현",/\b(?:subgroup|cohort)s?\b|하위\s*집단|코호트/gi],
  ["용량 증량·확장 표현",/\bdose[-\s]+(?:escalation|expansion)\b|용량\s*(?:증량|확장)/gi],
];
export function auditSourceLinkage(source:ResearchSource,selectedNct:string):LinkageAudit{
  if(!/^NCT\d{8}$/.test(selectedNct))throw Error("선택 시험 NCT 형식 오류");
  const mentions=new Set<string>(),quotes:LinkageQuote[]=[],cohortSignals=new Set<string>();
  const capture=(field:"title"|"text",text:string,index:number,length:number,signal:string)=>{
    const quote=text.slice(Math.max(0,index-55),Math.min(text.length,index+length+80));
    if(quotes.length<10&&!quotes.some(q=>q.field===field&&q.quote===quote&&q.signal===signal))quotes.push({field,quote,signal});
  };
  for(const field of ["title","text"] as const){
    const text=source[field];
    for(const match of text.matchAll(nctPattern())){const nct=match[0].toUpperCase();mentions.add(nct);capture(field,text,match.index,match[0].length,nct);}
    for(const [label,pattern] of signals){const match=new RegExp(pattern.source,pattern.flags).exec(text);if(match){cohortSignals.add(label);capture(field,text,match.index,match[0].length,label);}}
  }
  const selectedMention=mentions.has(selectedNct),other=[...mentions].some(n=>n!==selectedNct);
  // FDA text may mention NCTs but a drug application never establishes trial/cohort identity.
  const status:LinkageStatus=source.kind==="REGULATORY"?"DRUG_LEVEL":mentions.size>1?"MULTIPLE_TRIALS":other?"OTHER_TRIAL":selectedMention?"SELECTED_MENTION":source.link_basis.some(b=>["REGISTRY_RECORD","REGISTRY_DOCUMENT","REGISTRY_REFERENCE_RESULT"].includes(b))?"REGISTRY_LINK":"UNRESOLVED";
  const questions:string[]=[];
  if(other)questions.push(`발견된 다른 시험(${[...mentions].filter(n=>n!==selectedNct).join(", ")})의 결과를 ${selectedNct}의 결과로 옮기고 있지 않은가?`);
  if(status==="DRUG_LEVEL")questions.push("이 규제 문서의 약물 허가 단위와 검토하려는 개별 시험·분석집단의 연결은 원문 어느 부분에서 확인되는가?");
  if(!selectedMention)questions.push(`${selectedNct}가 확보한 제목·문구에 없다. 본문·등록부의 어느 근거로 연결할 수 있는가?`);
  if(cohortSignals.size)questions.push("통합·하위집단·증량/확장 표현의 실제 적용 범위는 무엇이며 용량군·분모·환자 중복·평가시점이 구분되는가?");
  questions.push("같은 NCT가 등장하더라도 이번 관측값의 코호트·암종·치료 차수·분석집단·자료마감일이 비교 목적과 일치하는가?");
  return {sourceId:source.id,sourceDigest:source.digest,selectedNct,status,mentionedNcts:[...mentions].sort(),selectedMention,cohortSignals:[...cohortSignals],quotes,questions,clinicalVerified:false,method:"TEXT_METADATA_RULES/1"};
}
export function linkageMarkdown(sources:ResearchSource[],nct:string):string{
  return ["## 시험·코호트 연결 점검", "저장된 제목·문구와 메타데이터의 규칙 검사입니다. 새 AI 실행·전문 판독·동일 코호트 검증이 아닙니다. 문구가 없다는 이유로 다른 시험이라고 단정하지 않습니다.",
    ...sources.map(source=>{const a=auditSourceLinkage(source,nct);return [`### ${source.id} · ${LINKAGE_LABELS[a.status]}`,`선택 시험: ${nct} / 출처 SHA256: ${a.sourceDigest}`,`발견 NCT: ${a.mentionedNcts.join(", ")||"없음"}`,`코호트 관련 표현: ${a.cohortSignals.join(", ")||"지정 표현 미발견 (동일성 보장 아님)"}`,...a.quotes.map(q=>`문구 위치: ${q.field}\n> ${q.quote.replaceAll("\n","\n> ")}`),...a.questions.map(q=>`- 확인 질문: ${q}`)].join("\n\n");})].join("\n\n");
}

import {useMemo,useState} from "react";
import {Alert,Button,Chip} from "@mui/material";
import type {Collection} from "./research";
import {auditSourceLinkage,LINKAGE_LABELS,type LinkageStatus} from "./research-linkage";
import {downloadText} from "./review";

export default function ResearchLinkage({collection,onInspect}:{collection:Collection;onInspect:(id:string)=>void}){
  const [filter,setFilter]=useState<LinkageStatus|"ALL">("ALL");
  const audits=useMemo(()=>collection.sources.map(s=>({source:s,audit:auditSourceLinkage(s,collection.request.nct_id)})),[collection]);
  const counts=Object.keys(LINKAGE_LABELS).map(status=>({status:status as LinkageStatus,count:audits.filter(x=>x.audit.status===status).length}));
  const visible=audits.filter(x=>filter==="ALL"||x.audit.status===filter);
  return <section className="research-linkage" aria-label="시험·코호트 연결 점검">
    <div className="research-heading"><div><h3>같은 약물의 자료가, 같은 시험의 근거는 아닙니다</h3><p>선택 시험 {collection.request.nct_id} · 저장된 근거 {audits.length}개를 대조했습니다.</p></div><Button variant="outlined" onClick={()=>downloadText(`trialboard-linkage-${collection.id}.json`,JSON.stringify({schema:"research-linkage-audit/1",runId:collection.id,selectedNct:collection.request.nct_id,method:"TEXT_METADATA_RULES/1",clinicalVerified:false,audits:audits.map(x=>x.audit)},null,2),"application/json")}>연결 점검 JSON</Button></div>
    <Alert severity="info">규칙 기반 문구 점검 · 새 모델 호출 없음. NCT가 있어도 동일 코호트·분석집단을 증명하지 않고, 없어도 무관한 자료로 단정하지 않습니다. PDF 본문은 이 점검에 포함되지 않습니다.</Alert>
    <div className="linkage-counts" role="group" aria-label="시험 연결 분류"><Button variant={filter==="ALL"?"contained":"outlined"} aria-pressed={filter==="ALL"} onClick={()=>setFilter("ALL")}>전체 {audits.length}</Button>{counts.map(({status,count})=><Button key={status} variant={filter===status?"contained":"outlined"} aria-pressed={filter===status} onClick={()=>setFilter(status)}>{LINKAGE_LABELS[status]} {count}</Button>)}</div>
    <p role="status">{visible.length}개 표시 · 임상 검증 완료 0건 (이 기능은 임상 검증을 수행하지 않습니다)</p>
    <div className="linkage-cards">{visible.map(({source,audit:a})=><article key={source.id}><div className="linkage-card-head"><Chip size="small" variant="outlined" label={LINKAGE_LABELS[a.status]}/><span>{source.content_level==="ABSTRACT"?"초록·서지":source.content_level==="PDF_AVAILABLE"?"문서 메타데이터":source.content_level}</span></div><h4>{source.title}</h4><p>발견 NCT: {a.mentionedNcts.join(" · ")||"확보 문구에서 미발견"}</p>{a.cohortSignals.length>0&&<p className="linkage-caution">추가 확인할 표현: {a.cohortSignals.join(" · ")}</p>}
      <details><summary>대조 문구와 확인 질문</summary>{a.quotes.map((q,i)=><div key={i}><small>{q.field==="title"?"제목":"확보 문구"} · {q.signal}</small><blockquote>{q.quote}</blockquote></div>)}{!a.quotes.length&&<p>지정된 NCT·코호트 표현을 찾지 못했습니다. 본문을 읽은 결과가 아닙니다.</p>}<ul>{a.questions.map(q=><li key={q}>{q}</li>)}</ul><p className="hash">출처 SHA-256 {a.sourceDigest}</p></details>
      <Button onClick={()=>onInspect(source.id)}>원문 근거·검토 이력 확인</Button></article>)}</div>{!visible.length&&<Alert severity="info">이 분류에 해당하는 자료가 없습니다. 검색 범위 밖의 자료까지 없다는 뜻은 아닙니다.</Alert>}
  </section>;
}

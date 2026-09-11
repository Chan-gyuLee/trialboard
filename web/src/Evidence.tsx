import { useEffect, useState } from "react";
import { Button, Checkbox, FormControlLabel, InputAdornment, TextField } from "@mui/material";
import { ArrowUpRight, Check, ChevronRight, Download, Search } from "lucide-react";
export type Fact = {
  id: string; source_id: string; page: number; title: string; topic: string; quote: string;
  interpretation: string; boundary: string; decision_question: string; image: string;
  boxes: { x: number; y: number; width: number; height: number }[];
};
export type Packet = {
  sources: Record<string, { title: string; issuer: string; published: string; url: string; scope: string; sha256: string }>;
  facts: Fact[];
};
export function Evidence({ packet, selected, onSelect }: { packet: Packet; selected: string; onSelect: (id: string) => void }) {
  const [query, setQuery] = useState("");
  const [highlight, setHighlight] = useState(true);
  const [imageError, setImageError] = useState(false);
  const fact = packet.facts.find(f => f.id === selected) ?? packet.facts[0];
  const source = packet.sources[fact.source_id];
  useEffect(() => { setImageError(false); }, [selected]);
  const filtered = packet.facts.filter(f => `${f.title} ${f.topic} ${f.interpretation}`.toLowerCase().includes(query.toLowerCase()));
  return <><div className="section-context"><span>공개 FDA 원문 2건 · 인용 근거 5개</span><Button href="/data/evidence.json" download startIcon={<Download size={16} />}>근거 데이터</Button></div>
    <p className="quiet-note">원문 위치를 확인한 공개 참고자료입니다. 해석은 개발자 검토 초안이며, 합성 시뮬레이션의 약물 데이터가 아닙니다.</p>
    <div className="evidence-layout"><section className="source-list" aria-label="근거 목록">
      <TextField fullWidth label="근거 검색" value={query} onChange={e => setQuery(e.target.value)} slotProps={{ input: { startAdornment: <InputAdornment position="start"><Search size={17} /></InputAdornment> } }} />
      <div className="fact-list">{filtered.map(f => <button key={f.id} className={`fact ${f.id === fact.id ? "active" : ""}`} onClick={() => onSelect(f.id)} aria-pressed={f.id === fact.id}><span className="meta">{f.topic} · PDF p.{f.page}</span><h2>{f.title}</h2><p>{f.decision_question}</p><span className="fact-bottom"><span><Check size={14} /> 문구 위치 확인</span><ChevronRight size={16} /></span></button>)}</div>
      {!filtered.length && <div className="empty"><p>일치하는 근거가 없습니다.</p><Button onClick={() => setQuery("")}>전체 근거 보기</Button></div>}
    </section><section className="source-detail" aria-label="선택한 근거 상세"><div className="source-description"><span className="overline">선택한 근거</span><h2>{fact.title}</h2><p>{fact.interpretation}</p><div className="boundary"><strong>적용할 때 주의할 점</strong><p>{fact.boundary}</p></div></div>
      <div className="source-toolbar"><div><strong>{source.title}</strong><p>{source.issuer} · {source.published} · PDF p.{fact.page}</p></div><Button href={`${source.url}#page=${fact.page}`} target="_blank" rel="noreferrer" endIcon={<ArrowUpRight size={16} />}>공식 원문</Button></div>
      <div className="page-toolbar"><span>원문 페이지</span><FormControlLabel label="인용 위치 강조" control={<Checkbox size="small" checked={highlight} onChange={e => setHighlight(e.target.checked)} />} /></div>
      <div className="page-scroll">{imageError ? <p role="alert">이미지를 불러오지 못했습니다. 공식 원문에서 확인해 주세요.</p> : <div className="pdf-page"><img key={fact.id} src={fact.image} alt={`${source.title} PDF ${fact.page}페이지. 인용문은 아래 텍스트로 제공됩니다.`} onError={() => setImageError(true)} onLoad={e => e.currentTarget.closest(".page-scroll")?.scrollTo({ top: Math.max(0, fact.boxes[0].y * e.currentTarget.height - 80), behavior: "instant" })} />{highlight && fact.boxes.map((b, i) => <span key={i} aria-hidden className="highlight" style={{ left: `${b.x * 100}%`, top: `${b.y * 100}%`, width: `${b.width * 100}%`, height: `${b.height * 100}%` }} />)}</div>}</div>
      <details className="citation" open><summary>인용문과 출처 정보</summary><blockquote>{fact.quote}</blockquote><p>{source.scope}</p><p className="hash">SHA-256 {source.sha256}</p></details>
    </section></div></>;
}

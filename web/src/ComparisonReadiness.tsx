import {Chip} from '@mui/material';
import type {RegistryResults} from './registry-results';
import {issueLabels} from './registry-readiness';

export default function ComparisonReadiness({tables}:{tables:RegistryResults|null|undefined}) {
  const r=tables?.readiness;
  if(!r)return null;
  return <section className="auto-readiness" aria-label="비교 준비 자동 점검">
    <div className="auto-section-title"><div><span className="auto-kicker">COMPARISON READINESS</span><h3>이 근거로 어디까지 검토할 수 있나요?</h3></div><Chip variant="outlined" color="warning" label={r.status==='NEEDS_EVIDENCE'?'추가 근거 필요':'전문가 판단 필요'}/></div>
    <div className="auto-readiness-grid">
      <article><span>01 · 효능</span><h4>{r.responseCandidate?'용량별 검토 후보 확보':'용량별 비교 근거 미충족'}</h4><p>통합 결과와 용량별 결과, 분석 분모를 구분합니다.</p></article>
      <article><span>02 · 안전성</span><h4>{r.safetyCandidate?'용량별 검토 후보 확보':'용량별 비교 근거 미충족'}</h4><p>지표 정의와 관측 기간이 다른 결과를 합치지 않습니다.</p></article>
      <article><span>03 · 실제 근거 기반 설계</span><h4>아직 실행하지 않음</h4><p>임상 비교 적합성과 설계 가정을 승인한 상태가 아닙니다. 별도 MOC 탐색과 구분합니다.</p></article>
    </div>
    <details><summary>결과별 준비 상태와 원문 집단 확인</summary><div className="auto-readiness-series">{r.series.filter(s=>s.family!=='OTHER').map(s=><article key={s.id}><strong>{s.title}</strong>{s.context&&<p>{s.context}</p>}<p>{s.groups.map(g=>g.label).join(' / ')}</p><p>{s.status==='REVIEW_CANDIDATE'?'기본 구조 검사 통과 · 미승인 검토 후보':s.issues.map(code=>issueLabels[code]).join(' · ')}</p><details><summary>원본 위치</summary>{s.groups.map((g,i)=><code key={i}>{g.groupId} · {g.locator}</code>)}</details></article>)}</div></details>
    <aside className="auto-readiness-next"><h4>다음 판단에 필요한 것</h4><ul>{r.questions.map((q,i)=><li key={i}>{q}</li>)}</ul></aside>
    <p className="auto-caption">등록 결과 {tables!.outcomes.length+tables!.safety.length}행에 대한 규칙 기반 점검입니다. AI 임상 판정이나 전문가 승인, 완전한 근거 검토를 뜻하지 않습니다. {r.schema}</p>
  </section>;
}

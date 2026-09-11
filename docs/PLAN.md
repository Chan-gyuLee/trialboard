# Trial Board 본선 구현 계획

> 작성 2026-09-11(금). 제출 마감 **2026-10-02(금) 16:00**. 남은 기간 3주.
> 메인 개발자: ryul. 페어 구현: Claude Code. 도메인·검증: 팀원.
> 목표: (1) 본선 1위 (2) 바이오기업이 인수·계약할 만한 제품 골격.

---

## 0. 한 문장 전략

**"소토라십의 용량 결정 역사를 1차 자료(FDA 심사문서·승인서한·라벨·등록정보 버전·논문)만으로 자동 재구성하고, 화면의 모든 숫자를 클릭하면 원문 PDF의 해당 페이지가 하이라이트되어 열리는 시스템."**

심사위원이 처음 보는 장면은 이것 하나입니다. 다른 팀은 LLM 요약을 보여주고, 우리는 **원문 위치가 붙은 사실만 저장하는 근거 그래프**를 보여줍니다. 그 위에 설계안 비교·시뮬레이션·반론·판단 보류가 얹힙니다.

기업이 사는 것은 에이전트가 아니라 **근거 그래프 + 결정적 검증 게이트 + 감사 가능한 실행 기록**입니다. 에이전트는 교체 가능한 부품으로 설계합니다.

---

## 1. 본선 배점을 어떻게 가져가나

| 배점 | 항목 | 우리가 보여줄 장면 |
|---|---|---|
| 30 | 과학적 타당성·혁신 | 실제 FDA·ICH·식약처 문서에 조항 단위로 연결된 설계 결정. "요약이 아니라 계보, 단일안이 아니라 비교·반증, 숨기지 않고 보류" |
| 30 | 시연·완성도 | 상태기계 전이와 에이전트 판단 로그가 실시간 스트리밍되는 UI. 스냅숏 모드로 절대 안 깨짐. 원문 클릭-스루 |
| 15 | 도구 활용·통합 | ClinicalTrials.gov v2 + history, Drugs@FDA, openFDA label, Europe PMC, PubChem, RDKit 실호출 로그와 응답 해시. 생성 수치 = 원문 수치 검증 표 |
| 15 | 리소스 효율 | 실행별 토큰·호출수·비용·시간 미터. 두 번째 약물(adagrasib)을 같은 파이프라인으로 라이브 실행 |
| 10 | 자율성 | UI의 "오류 주입" 토글 → 단위 1,000배·분모 불일치·구버전 문서를 시스템이 스스로 탐지·재시도·보류 |

---

## 2. 놀라게 할 장면 8개 (우선순위 순)

1. **원문 클릭-스루.** Dose Evidence Map의 `AUC 71.8` 클릭 → FDA 2021 심사문서 p.N이 하이라이트된 채 열림. 모든 claim에 `source_id + page + bbox + quote`가 있어야 가능.
2. **실제 계보 타임라인.** 등록정보 버전(2018~), 2021 가속승인 서한의 시판후요구(240 mg 비교), ODAC 2023, 2025 정식승인 심사문서, 라벨 5개 버전, 주요 논문을 한 타임라인에. "무엇이 언제 왜 바뀌었나"가 자동 생성.
3. **오류 주입 라이브.** 심사위원 앞에서 버튼 하나로 소스에 오류를 심고, 게이트가 잡아 `E_UNIT`, `E_ID`, `E_VERSION`을 띄우고 보류로 승격.
4. **두 번째 약물 라이브 실행.** adagrasib(NCT03785249, 600 mg BID 논쟁)를 입력해 같은 8화면이 채워짐. "확장성"을 말이 아니라 실행으로.
5. **기준선 비교 패널.** 같은 질문을 단일 LLM에 던진 결과(출처 없음·수치 불일치)와 Trial Board 결과를 나란히. 검증 통과율 숫자로.
6. **결정론적 시뮬레이션.** 10,000회 Monte Carlo, seed 고정, 설계 A/B의 operating characteristics. "LLM은 산술을 하지 않았다" 로그.
7. **KOL 브리프 내보내기.** 미해결 쟁점을 질문·근거·차단되는 결정으로 정리한 PDF. 바이오텍이 실제로 돈 내는 산출물.
8. **API-first.** `/runs` REST + SSE 이벤트 스트림 + OpenAPI 문서. 기업 시스템에 붙일 수 있음을 보임.

---

## 3. 시스템 아키텍처

```
┌──────────────────────── web (React + TS, Vite) ─────────────────────────┐
│ 8 screens · SSE 이벤트 소비 · PDF 뷰어(하이라이트) · 오류주입 토글 · 미터 │
└───────────────────────────────▲──────────────────────────────────────────┘
                                │ REST + SSE
┌───────────────────────────────┴──────────────────────────────────────────┐
│ api (FastAPI)  POST /runs · GET /runs/{id}/events · GET /sources/{id}/page │
├──────────────────────────────────────────────────────────────────────────┤
│ orchestrator  상태기계 COLLECT→NORMALIZE→PROPOSE→SIMULATE→VERIFY→REVISE   │
│               →ACCEPT|ABSTAIN · 실패코드 · 실행 manifest · 이벤트 버스    │
├─────────────┬─────────────┬────────────┬─────────────┬───────────────────┤
│ agents      │ evidence    │ design     │ sim         │ audit             │
│ (도구 바인딩)│ scout·      │ generator· │ Emax/logit· │ citation gate·    │
│             │ lineage·    │ SPIRIT map·│ MC engine·  │ attribution gate· │
│             │ normalize   │ protocol   │ OC metrics  │ regulatory map·   │
│             │             │ DSL        │             │ critic checklist  │
├─────────────┴─────────────┴────────────┴─────────────┴───────────────────┤
│ graph (SQLite)  Source · Span · Claim · LineageNode/Edge · DesignOption · │
│                 SimResult · Critique · KOLQuestion · Run · Manifest       │
├──────────────────────────────────────────────────────────────────────────┤
│ corpus  ctgov(v2 + history) · drugsfda · openfda label · epmc · pubchem · │
│         guidance(FDA/ICH/MFDS/SPIRIT) · pdf(pymupdf, page+bbox) · snapshot│
├──────────────────────────────────────────────────────────────────────────┤
│ llm  OpenAI 호환 클라이언트(대회 엔드포인트) · structured output ·        │
│      응답 캐시(prompt hash) · 토큰 미터 · 공급자 교체 가능                │
└──────────────────────────────────────────────────────────────────────────┘
```

### 불변 원칙 (코드로 강제)
1. **LLM은 계획·추출·비판·설명만.** 계산·단위·해시·상태전이·통계는 결정론적 코드.
2. **게이트를 통과하지 못한 LLM 출력은 그래프에 저장되지 않는다.** 인용문이 원문 페이지 텍스트에 문자 그대로 존재해야 claim이 생성된다.
3. **근거 부족·상충이면 보류.** 상충은 평균 내지 않고 출처별로 나란히.
4. **모든 실행은 manifest로 재현 가능.** 모델·프롬프트 해시·도구 버전·seed·소스 해시·토큰.
5. **스냅숏 우선.** 모든 외부 응답은 content hash로 저장. 시연은 스냅숏, 라이브는 토글.

### 저장소 구조

```
trialboard/
  pyproject.toml            # uv, Python 3.12
  trialboard/
    core/      schemas.py ids.py hashing.py units.py errors.py
    llm/       client.py cache.py meter.py
    corpus/    ctgov.py drugsfda.py openfda.py epmc.py pubchem.py guidance.py pdf.py snapshot.py
    graph/     store.py models.py queries.py
    extract/   extractor.py gate.py attribution.py
    lineage/   builder.py timeline.py
    design/    generator.py dsl.py spirit.py
    sim/       models.py engine.py oc.py
    critic/    critic.py checklist.py kol.py
    audit/     citation.py regmap.py
    orchestrator/ states.py runner.py manifest.py events.py
    api/       app.py routes/
    cli.py
  web/                      # Vite + React + TS
  data/
    snapshots/              # 해시 이름 원문 (git-lfs 또는 fetch 스크립트)
    guidance/               # FDA·ICH·MFDS·SPIRIT PDF
    gold/                   # 정답 라벨 jsonl
    faults/                 # 오류 주입 명세
  eval/                     # run_eval.py baselines.py report.md
  tests/
  docs/                     # PLAN.md ARCHITECTURE.md DEMO_SCRIPT.md
  deploy/                   # Dockerfile fly.toml
```

---

## 4. 핵심 기술 결정

| 영역 | 결정 | 이유 |
|---|---|---|
| Python | **3.12** + **uv** | RDKit·pymupdf 휠 안정. 3.14는 생태계 미성숙 |
| 스키마 | **Pydantic v2** | 모든 에이전트 입출력·DB 레코드 계약 |
| DB | **SQLite** (SQLAlchemy 2.0) | 단일 파일 배포. 제안서 명시 |
| PDF | **pymupdf** | 페이지·bbox·`search_for(quote)`로 하이라이트 좌표 획득 |
| LLM | 대회 제공 OpenAI 호환 엔드포인트 (`gpt-5.6-terra` 기본, `luna` 저비용, `sol` 고난도). Responses API + JSON schema 강제 | 크레딧 3,000만 토큰. 응답 캐시로 개발 중 소모 억제 |
| 검색 | BM25(rank_bm25) + 임베딩 재순위(선택) | Recall@5·nDCG@10 측정용 인덱스 |
| 시뮬 | NumPy/SciPy, seed 고정, 단위테스트 | LLM 산술 금지 |
| 분자 | RDKit + PubChem | InChIKey 일치 검증 |
| 오케스트레이터 | 자체 상태기계(enum + 전이 함수 + 실패코드). LangGraph 미사용 | 3주엔 디버깅 쉬운 것이 이김 |
| API | **FastAPI** + SSE(sse-starlette) | 실시간 사고과정 스트리밍 |
| UI | **React + TypeScript (Vite)**. 기존 `trialboard-mockup.html`을 컴포넌트로 이식 | 제안서 목업과 동일한 외형을 실데이터로. Streamlit은 시연 30점에서 손해 |
| UI 백업 | **9/21(일)까지 React 화면 1~3이 실데이터로 안 돌면 Streamlit으로 전환** | 명시적 손절 기준 |
| 배포 | Docker 단일 컨테이너(FastAPI가 빌드된 web을 정적 서빙). Fly.io 또는 Render | Demo URL 1개, 스냅숏 모드 기본 |
| 테스트 | pytest, 게이트·시뮬·단위파서는 100% 커버 | 심사 Q&A 방어 |

---

## 5. 데이터: 오늘 확인한 실제 소스

| 소스 | 접근 | 계보에서의 역할 |
|---|---|---|
| ClinicalTrials.gov v2 `studies/NCT03600883` | 확인 완료. 6개 arm, Phase 1/2, 713명, 결과·첨부 없음 | 등록정보 현재 상태 |
| ClinicalTrials.gov `api/int/studies/{nct}/history` | 확인 완료. 버전별 날짜·변경 모듈 | **등록정보 버전 계보**(2018-07 v0부터) |
| Drugs@FDA NDA 214665 | 2021 원심사(TOC), 2025 s009 심사 PDF, 라벨 2021/22/23/24/25, 승인서한 | 가속승인 → 시판후요구 → 정식승인 |
| FDA ODAC briefing 2023 (`fda.gov/media/172698`) | 제안서 [14] | 240 vs 960 논쟁 심사자 관점 |
| openFDA label (LUMAKRAS 2025-01) | 확인 완료 | 현행 용량 960 mg |
| Europe PMC | 검색 API 동작. OA 논문은 전문 XML | CodeBreaK 100 Ph1(NEJM 2020), Ph2(NEJM 2021), 용량비교 논문, Nat Med 2025 |
| PubChem CID 137278711 | 확인 완료. InChIKey `NXQKSXLFSAEQCZ-SFHVURJKSA-N` | 분자 식별 게이트 |
| FDA 용량최적화 가이드 2024, 식약처 2025, ICH E4/E8(R1)/E9(R1)/E6(R3), SPIRIT 2025 | 공개 PDF | Regulatory Traceability Matrix 코퍼스 |
| **두 번째 약물** adagrasib (KRYSTAL-1, NCT03785249, NDA 216340) | 같은 API로 수집 | 확장성 시연 |

protocol·SAP 원문은 이 시험에 없다. **"원문 protocol 미확보"를 결측으로 표시**하는 것이 제안서 약속이며, 그 자체가 정직성 시연이다.

---

## 6. 에이전트 계약

각 에이전트 = `(input schema, allowed tools, output schema, gate, failure codes)`. 프롬프트가 아니라 이 5개가 정체성이다.

| 에이전트 | 허용 도구 | 출력 | 게이트 |
|---|---|---|---|
| Evidence Scout | ctgov, drugsfda, openfda, epmc, pubchem, pdf, snapshot | Source[], Span[], Claim[] (raw), LineageNode[] | quote-in-page 일치, 단위 파싱, 문서 버전 존재 |
| Normalizer | units, ids, graph | 정규화 Claim[], DoseEvidenceRow[], Missing[] | 단위 표준화 성공, 분모 일관성, InChIKey 일치 |
| Clinical Design | graph 읽기, spirit, dsl | DesignOption[≥2] (Protocol DSL JSON) | SPIRIT 필수항목 채움 또는 미확정 표기, 용량이 근거 범위 안 |
| Statistics | sim.engine만 | SimResult[] | seed 기록, 시나리오 커버, 단위테스트 통과한 엔진 버전 |
| Critic | graph 읽기, checklist | Critique[], KOLQuestion[] | 각 반론이 claim_id 또는 Missing에 연결 |
| Citation Auditor | pdf, graph | 검증 상태 갱신, RegMap[] | 신청자/심사자 귀속, 가이드 조항 버전·발행일 |

실패코드: `E_ID_AMBIGUOUS E_UNIT E_SOURCE_MISSING E_VERSION_CONFLICT E_OUT_OF_SCOPE E_CONFLICT E_API`.
종결 상태: `ACCEPT` 또는 `ABSTAIN(INSUFFICIENT_EVIDENCE_HUMAN_REVIEW_REQUIRED)`.

---

## 7. 3주 일정 (금요일마다 처음부터 끝까지 완주)

### W1 · 9/11(금) ~ 9/14(일) · 뼈대 + 최대 리스크
- [ ] 저장소 히스토리 합치기, uv 프로젝트, pre-commit, CI(pytest)
- [ ] `core/schemas.py` 확정: Source, Span, Claim, LineageNode/Edge, DesignOption, SimResult, Critique, KOLQuestion, Run, Manifest
- [ ] `corpus/`: ctgov v2 + history, drugsfda, openfda, epmc, pubchem 클라이언트 + 스냅숏 캐시
- [ ] `corpus/pdf.py`: FDA 2021 심사문서·2025 심사문서·ODAC·라벨 PDF 다운로드 → 페이지 텍스트 + bbox
- [ ] `llm/client.py`: 대회 엔드포인트 연결 확인, structured output 동작 확인, 캐시, 미터
- [ ] **추출 스파이크**: FDA 문서에서 Dose Evidence 표(용량별 AUC·Cmax·ORR·Gr≥3) 20행 추출 → quote 게이트 통과율 첫 측정
- [ ] 팀원: gold 라벨 양식 확정, critical 필드 50개 후보 선정
- **일요일 통과 기준**: `trialboard run NCT03600883 --stage collect` → Source/Span/Claim이 SQLite에 저장, 게이트 통과율 숫자 나옴

### W2 · 9/15(월) ~ 9/21(일) · 계보 + 인용검증 + UI 골격
- [ ] `lineage/builder.py`: 등록정보 버전 + FDA 서한·라벨·심사 + 논문을 타임라인 노드로. 변경 유형 태깅
- [ ] Normalizer + Dose Evidence Map + Missing 명시
- [ ] Citation Auditor: quote 재검증, 신청자/심사자 attribution gate, 규제 가이드 조항 매핑
- [ ] 오케스트레이터 상태기계 + 이벤트 버스 + manifest
- [ ] FastAPI `/runs`, SSE, `/sources/{id}/page/{n}` (하이라이트 좌표 포함)
- [ ] React: 앱 셸 + 화면 1(COLLECT) + 화면 2(NORMALIZE) + 화면 3(Dose Map)을 실데이터로. PDF 뷰어 클릭-스루
- [ ] 오류 주입 10개 작성 → 탐지 확인
- **일요일 통과 기준**: 화면 1~3 실데이터, 숫자 클릭 → PDF 하이라이트. **여기서 UI 스택 최종 결정**

### W3 · 9/22(월) ~ 9/28(일) · 설계·시뮬·반론·보류
- [ ] Clinical Design: Protocol DSL, 설계안 2개, SPIRIT 매핑, RDKit 식별 검증
- [ ] Statistics: Emax·logistic 시나리오 5종 × 설계 2안, OC 지표, 단위테스트, seed 재현
- [ ] Critic: 체크리스트 + LLM 반론 → REVISE 2회 → KOLQuestion. ABSTAIN 로직
- [ ] Regulatory Traceability Matrix, Protocol Diff
- [ ] React 화면 4~8 + 오류주입 토글 + 토큰·비용 미터 + KOL 브리프 PDF 내보내기
- [ ] adagrasib 스냅숏 수집 → 같은 파이프라인 완주
- **일요일 통과 기준**: 입력 → ABSTAIN까지 CLI·UI 모두 완주, 두 약물, LLM 호출 ≤15, 5분 이내. **기능 동결**

### W4 · 9/29(월) ~ 10/2(금) 16:00 · 평가·배포·제출물
- [ ] 평가 실행: critical 50항목 정확도, citation precision, 충돌·결측 탐지 P/R, abstention P/R, fault 탐지율, 기준선 3종 비교, 비용
- [ ] Docker 배포 + Demo URL + 예시 쿼리 3개 페이지(NCT03600883 / adagrasib / 오류주입 모드)
- [ ] 시연 영상 10분 촬영·편집 → YouTube 일부 공개
- [ ] 발표 PDF(성능지표·평가기준 필수) + 기술서 PDF + GitHub 정리
- [ ] **10/1(목) 저녁 제출 완료.** 10/2는 안전 마진
- 이후: 오프라인 Q&A 예상 질문 20개 (10월 마지막 주)

---

## 8. 평가 계획 (발표 PDF에 표로 들어갈 것)

제안서 약속을 현실 크기로 조정하고 **조정 사실을 보고서에 명시**한다.

| 제안서 | 본선 실행 |
|---|---|
| Held-out 200+ 항목, 전문가 2인 | critical 필드(용량·군·단위·1차 평가변수·분모) **50개 이중 검증** + silver |
| 개발 사례 5건 | sotorasib 완결 + adagrasib 확장 |
| Fault 40~60개 | **25개**, 7유형 × 최소 3개 |
| Human-use Pilot | 팀원·지인 3~5명 내부 파일럿, "내부 검증" 표기 |
| 목표 0.95/0.90 | critical 0.95, 서술형 0.85, 신뢰구간·오류 사례 동봉 |

기준선: 단일 LLM / LLM+RAG(같은 스냅숏) / Trial Board(게이트 제거 ablation) / Trial Board 전체.

---

## 9. 인수 가능한 제품이 되기 위한 설계 선택 (지금 비용 거의 0, 나중에 가치 큼)

- **코퍼스 어댑터 인터페이스** 하나로 통일. 나중에 고객 내부 protocol·CSR을 같은 파이프라인에 넣을 수 있음.
- **LLM 공급자 추상화.** OpenAI 호환이면 무엇이든. 온프렘 모델 교체 가능.
- **PII·영업비밀 0.** 공개 자료만. 모든 외부 호출 로그.
- **manifest = 감사 로그.** 규제팀이 원하는 그 문서.
- **API-first.** UI는 API의 한 소비자. 기업 워크플로(Veeva 등)에 붙일 수 있음.
- **Protocol DSL(JSON).** 설계안이 데이터라서 diff·버전·비교가 된다.
- 이름은 대회 동안 **Trial Board 유지**. 상용명은 대회 후 결정.

---

## 10. 리스크와 손절 기준

| 리스크 | 신호 | 대응 |
|---|---|---|
| PDF 추출 정확도 | W1 게이트 통과율 < 70% | 표 추출을 pymupdf 표 파서 + LLM 셀 정규화로 분리. 범위를 FDA 2025 심사문서 1건 중심으로 축소 |
| React 일정 | 9/21 화면 1~3 미완 | Streamlit 전환. 목업 스타일 CSS만 이식 |
| 대회 엔드포인트 structured output 미지원 | W1 첫날 확인 | JSON mode + Pydantic 재검증 + 재시도 3회 |
| 크레딧 소모 | 잔여 < 1,000만 토큰 at W3 | 캐시 강제, 개발은 `luna`, 시연만 `terra` |
| gold 라벨 인력 | W1 말까지 팀원 확정 없음 | critical 30개로 축소, 보고서에 명시 |
| Demo URL 불안정 | 시연 중 API 장애 | 스냅숏 모드 기본, 라이브는 토글 |

---

## 11. 역할

- **ryul(메인 개발)**: 아키텍처 결정, 오케스트레이터·API·UI·배포, 코드 리뷰 최종 승인, 발표.
- **Claude Code(페어)**: 모듈 단위 구현·테스트 작성, 코퍼스 클라이언트, 시뮬 엔진, 평가 스크립트, 문서. 매 모듈은 테스트와 함께 PR 단위로.
- **팀원(도메인)**: sotorasib·adagrasib 원문 확보와 검수, gold 라벨 50개, 설계안 임상적 검토, 규제 조항 매핑 검수, KOL 질문 품질, 발표자료 내용, 영상 내레이션.

## 12. 오늘 바로 할 일

1. 저장소 히스토리 합치기 (`git pull --rebase --allow-unrelated-histories`, README 충돌은 로컬 유지) 후 push
2. `uv init` + Python 3.12 + 의존성 잠금, `tests/` 스모크 테스트, GitHub Actions
3. 대회 API 키 확인 → `llm/client.py`로 `Reply only OK` 호출 + JSON schema 출력 확인
4. `corpus/ctgov.py`, `corpus/drugsfda.py`로 NCT03600883·NDA214665 스냅숏 저장
5. FDA 2025 심사문서 PDF 내려받아 `pdf.py`로 페이지 텍스트 추출 → 추출 스파이크 시작

# 로컬 검토 실행 API

## 2026-09-16 로컬 프로젝트 체크포인트

`--enable-evidence-scout` opt-in. [저장 범위·보안·검증](PROJECT_CHECKPOINTS.md).

- `GET /api/projects`: 최근100버전의 project_id/revision/title/created_at/pdf_digest/bundle_digest.
- `GET /api/projects/{UUID}/{revision}`: 위 metadata + bundle_json + pdf_base64. 외부 검색/모델 없음.
- `POST /api/projects`: `{consent:true,project_id:null,expected_revision:0,title,pdf_base64,bundle_json}`.
  새 프로젝트는 null/0, 후속은 저장된 ID/revision. 최신버전 불일치409, 잘못된 자료422.
  로컬 Origin 필수. 이 경로에만48MiB 본문 허용. 기본 및 다른 경로의 제한은 그대로다.
  한 프로젝트 PDF 변경 금지. 별도 복사본은 ID=null/revision=0으로 새로 저장한다.
- bundle schema `trialboard-project/1`: source,notes,reviewRaw,draftRaw,meetingRaw,agentRaw,context.
  source는 PDF추출 계약, Raw 항목은 기존 JSON 계약을 보존한다. 내부 `persisted:false`는 원래 파일 계약이며
  외부 프로젝트의 명시적 DB 저장을 나타내는 필드로 임의 변경하지 않는다.
- 프로젝트100개/버전100개/총1GiB, bundle32MiB/PDF5MiB. 영구 저장을 자동 삭제하지 않는다.
  조회 시 bytes/bundle hash 대조. 브라우저는 실제 PDF재추출과 strict 업무 reader 검사 후에만 적용한다.
- 암호화·사용자 인증·클라우드 동기화·임상적 의미 검증 없음. 원본 연구 기록은 기존 DB ID 참조다.

## 2026-09-15 다중 출처 조사·근거 검토 DB

`--enable-evidence-scout` 활성화 시 아래도 열린다. [정확한 범위](DEEP_RESEARCH.md).
기존 Scout 단순 등록정보 검색은 계속 모델0회다. 아래 model_consent:true 조사만 실제 모델을 호출한다.

- `POST /api/research/run`: `{search_id,nct_id,asset,indication,public_consent:true,model_consent:false}`.
  저장된 검색의 선택 NCT/적응증을 대조한다. 로컬 Origin 필수. 조사 동시1(409), 실제 모델 경로 슬롯 공유1(429).
  SSE `STARTED/PLAN/SEARCH/SOURCE/AI_PLAN/AI_PLAN_READY/AI_REVIEW/REVIEW_READY/GAP/COMPLETE/ERROR`.
  모든 이벤트에 run_id/sequence/elapsed_ms. 단계별 DB checkpoint, 연결 중단 시 부분 기록 보존.
- `GET /api/research/runs`: 최근30건 요약. `GET /runs/{id}`: collection + 이전 동일 프로젝트 대비 changes.
- `GET /runs/{id}/search?q=...`: 해당 조사/버전 FTS 검색, 최대20건. 저장한 제목/초록/등록 문구만 검색.
- `POST /runs/{id}/documents/{source_id}`: `{consent:true}`. DB에 연결된 허용 출처 PDF만5MB까지 다운로드.
  bytes를 저장하고 `X-Source-Sha256` 반환. 재열기는 같은 조사 영수증의 저장 bytes와 `X-Source-Cache:HIT`.
  임의 URL 입력/리다이렉트 없음. PDF 본문 분석/임상 검증 완료 API가 아니다.
- `GET /runs/{id}/curation`: 출처별 최신 판단. `?source_id=...`이면 해당 출처의 최대100개 버전.
- `POST /runs/{id}/curation`: `{source_id,expected_revision,decision,reason,reviewer_label}`.
  decision은 INCLUDE/CHECK/EXCLUDE. 사유3–2000자, 표시명1–80자. 미인증 작성자/임상 미검증 기록.
  로컬 Origin 필수, 버전 충돌409. 원문·기존 AI 초안은 불변이며 자동 재추론하지 않는다.

수집 API의 DB와 별도로 위 프로젝트 저장을 명시적으로 선택하면 PDF 추출·설계·회의도 함께 보관한다.
PDF/설계 실행 요청 자체는 여전히 자동 저장하지 않으며 개별 JSON 복구도 유지한다.
공개 수집 동의가 모델 전송 동의를 대신하지 않는다. 대회 API 키와 인증 파일은 다루지 않는다.

## 2026-09-15 공개 등록정보 수집 · 로컬 영구 저장 opt-in

`--enable-evidence-scout`로 활성화. 모델 호출 없음. [범위·보안·저장](EVIDENCE_SCOUT.md).

- `GET /api/evidence-scout/capabilities`: enabled/persisted/source/limit20/model_calls0. 기본 disabled.
- `POST /api/evidence-scout/search`: `{ "query": "sotorasib", "public_query_confirmed": true }`.
  약물명2–100자 또는 정확한 NCT. JSON/origin/body경계. 동시1, 초과409.
  NDJSON `SEARCHING→COLLECTED→SAVING→COMPLETE(receipt)` 또는`ERROR(message)`.
  외부연결 실패는 스트림ERROR이며 HTTP200만으로 성공을판정하지 않는다.
- `GET /api/evidence-scout/searches`: 최근20검색 요약, 외부요청없음.
- `GET /api/evidence-scout/searches/{id}`: 저장된 구조화receipt, 없으면404.
- 원본/receipt는 `output/evidence/trialboard.sqlite3`; 같은내용snapshot중복제거, 검색이력별도보존.
- `/health.persisted`는Scout활성화시true. PDF/모델/설계 경로의 개별persisted:false 정책은그대로다.
- default app와다른경로는변경없음. 기업인증·공유저장·문서자동다운로드없음.

## 2026-09-15 PDF 선택 문구의 실시간 실행

`--enable-pdf-agent`를 추가하면 `POST /api/pdf-agent/run`을 연다. 고정 사례 opt-in과 독립적이다.
요청은 `{ "input": AgentInput, "consent": true }`. PDF provenance·단일 source hash·페이지·32 KiB 요청 경계를 검사한다.
프런트엔드는 명시적으로 확인한 문구 ±2개 문맥만 조합하고 전송 범위를 보여 준다.
`Span.locator`는 PDF에서 `null`로 명시해 Python 정규화 후 input hash와 일치시킨다.
capabilities의 `pdf_enabled`로 상태를 표시하며 인증 검사나 모델 요청은 하지 않는다.
고정/PDF 실행의 동시 슬롯1을 공유한다. 최대4요청/수정1회, 서버120초. 영구 저장 없음.
SSE progress의 제한된 `items`는 source/observation/finding/concern/question/decision이다.
HANDOFF는 비교 적용 한계만 남아 같은 자료 재추출을 생략하는 제어 이벤트다. 반론은 최종 기록에 유지한다.
표시 내용은 명시적 작업 산출물이며 내부 사고 전문/가짜 타이핑이 아니다. [전체 흐름](PDF_LIVE_WORKFLOW.md).

설계 계산은 현재 AI 재검토가 없을 때 최초 실행의 비교 한계를
`PREVIOUS_AI_LIMITATION_UNRESOLVED`로 유지한다. 필드 확인만으로 비교 차단을 해제하지 않는다.

## 2026-09-15 고정 사례 실시간 에이전트 데모 · 별도 opt-in

`uv run python -m trialboard.api --enable-designs --enable-agent-demo`.
기존 계산 경로는 여전히 모델 호출을 하지 않으며 아래 경로만 모델을 실행한다.

- `GET /api/agent-demo/capabilities`: 활성 여부·고정 사례·동시1·120초·최대4요청·저장 없음.
  `case_limits`: public `{max_calls:2,max_repairs:0}`, synthetic `{max_calls:4,max_repairs:1}`.
  실제 실행과 같은 상수 사용. 인증/모델 연결 확인은 하지 않는다. 준비 점검은 GET만 사용한다.
- `POST /api/agent-demo/run`: `{ "case": "public" | "synthetic", "consent": true }`만 허용.
  추가 키/임의 입력/동의 누락 거부. 브라우저 Origin은 localhost/127.0.0.1:5173이어야 한다.
- SSE `started` → `progress` → `result` 또는 `error`. sequence/run_id/서버 경과시간 포함.
  progress는 단계 시작/완료와 집계만 전송. reasoning/진단 텍스트는 노출하지 않는다.
- 공개 발췌는 최대2요청/수정0회, 합성은4요청/수정1회. 기존 Codex ChatGPT 로그인 adapter만 사용.
- 429는 다른 실행 중. 비활성 경로404. 실패 진단은 안전한 코드. 자동 재연결·재시도·대체 결과 없음.
- 연결 종료 시 작업 취소/CLI 정리 후 슬롯 반환. 영구 저장·인증된 협업·배포용 API가 아니다.
- [발표 데모 및 한계](AGENT_DEMO.md). 아래의 ‘모델 없음’은 기존 계산 경로 설명이다.

2026-09-14: 아래 기존 `/api/reviews`는 계속 합성 전용이다. 추가한 PDF 연결 설계 계산은
**`uv run python -m trialboard.api --enable-designs`**로 명시적으로 켠 경우만 지원한다.
[전체 사용 흐름](DESIGN_WORKSPACE.md). 외부 공개·기업 자료 저장·모델 실행은 지원하지 않는다.

### PDF 연결 설계 계산 · 선택 기능

- `GET /api/design-comparisons/capabilities`: 활성 여부, localhost 전용·모델 0회·저장 없음·임상 미승인 표시.
- `POST /api/design-comparisons`: 비활성일 때 경로 없음(404). 활성 시 현재 PDF bytes/hash, 원문 export,
  필드 검토, 최초 agent 결과/수동 문맥, 선택적 현재 AI 결과와 설계 입력을 검증하고 `design-comparison/1`을 반환한다.
- JSON 봉투: `brief`, `review_json`, `source_json`, `pdf_base64`, `agent_json|null`, `ai_json|null`, `context|null`.
  원본 agent 파일은 원래 UTF-8 문자열로 전달하여 바이트 hash를 유지한다. 키/외부 URL은 받지 않는다.
- 봉투 24 MiB, 원본 PDF 5 MiB, 각 JSON 8 MiB. 중복/위험 키·깊이·노드·비유한 수·UTF-8을 제한한다.
  기존 합성 경로의 본문 한도는 늘리지 않는다. 동일한 프로세스당 2건 계산 슬롯을 공유한다.
- 파일은 메모리에서만 처리하고 서버에 저장하지 않는다. 소스의 텍스트/좌표를 PDF에서 다시 추출하지는 않는다.
  원본 hash와 제공된 추출/검토의 연결 검사를 원문 의미 인증으로 해석하지 않는다.
- 잘못된 입력은 내용/예외를 노출하지 않는 `DESIGN_INPUT_MISMATCH`(422), 계산 장애는 `DESIGN_EXECUTION_FAILED`(500).
- 브라우저는 localhost:5173에서 명시적 동의 후만 자료를 전송하고, 서버가 기능을 켰는지 먼저 검사한다.
  자동 재시도/외부 모델/인증 정보 공유가 없다. CORS/Host와 loopback은 기업용 인증 체계가 아니다.
- 건강 상태 `evidence_mode`는 기본 `SYNTHETIC_ONLY`, opt-in 시 `LOCAL_PDF_OPT_IN`이다.

## 기존 합성 검토 API

이 API는 입력을 받을 때마다 Python 검토 엔진을 실행한다. 현재 제공하는 근거 입력은
합성 fixture 3종뿐이다. 사용자가 바꾸는 확률은 임상자료에서 추정한 값이 아니라 합성 가정이다.
실제 자료 업로드·원문 의미 검증·LLM·자동 설계 추천·임상 권고는 구현하지 않았다.
비공개 배포 웹은 여전히 저장 결과를 탐색한다. 로컬 웹 개발 서버는 `/api`를 이 서버로
중계하며 조건 편집·재실행·이전 결과 비교를 지원한다. 원격 연결은 아직 구현하지 않았다.

## 실행

```bash
uv sync
uv run trialboard-api --port 8000
```

서버는 `127.0.0.1`에만 바인딩한다. 실행 중인 터미널에서 Ctrl-C로 종료한다.
실행 후 `http://127.0.0.1:8000/docs`에서 입력 계약과 호출 화면을 확인할 수 있다.
대화형 문서 화면의 JS/CSS는 기본 FastAPI CDN 리소스를 사용한다. API 실행 자체에는
외부 자료 조회·API 키·LLM 호출이 필요 없다.

| 경로 | 내용 |
| --- | --- |
| `GET /health` | 서버 응답 여부, 합성 전용 표시 |
| `GET /api/reviews/defaults` | 편집 가능한 기본 입력, 고정 용량군 순서, 실행 제한 |
| `POST /api/reviews` | 입력 검증 → 합성 원본 대조 → 새 계산 → JSON/Markdown 반환 |

예를 들어 비교할 각 군 표본수를 24명·72명으로 바꾼다. 생략한 항목은 기본값을 사용한다.

```bash
curl --fail-with-body http://127.0.0.1:8000/api/reviews \
  -H 'Content-Type: application/json' \
  -d '{"mode":"normal","per_arm":[24,72],"repetitions":10000,"seed":42}'
```

`mode`는 `normal`, `denominator-error`, `missing-evidence` 중 하나다.
오류·결측 모드에서도 합성 가정 탐색은 가능하지만 보고서의 `PARTIAL_ABSTENTION`은 유지된다.
계산 결과로 근거 결측을 채우거나 실제 용량 선택을 허용하지 않는다.

## 입력과 실행 제한

시나리오는 `id`, `label`, `response`, `adverse_event`, `adverse_event_penalty`,
`maximum_adverse_event_rate`, `rationale`을 받는다. 확률 배열의 순서는 항상
`dose_a`, `dose_b`다. 기본 입력을 조회해 값을 수정한 뒤 POST하면 된다.

- 확률은 유한한 수 0–1, 이상반응 가중치는 유한한 수 0–10이다. 문자열·boolean을 수로 바꾸지 않는다.
- 표본수는 각 군 2–500명인 정수 두 개다. 중복 없이 오름차순으로 지정한다.
- 시나리오는 1–5개이고 ID는 중복할 수 없다. 라벨·설명에도 길이 제한이 있다.
- seed는 0–4,294,967,295인 정수, 반복은 100–100,000회다.
- `반복 × 2개 군 × 시나리오 수 × 2개 설계`가 1,000,000을 넘으면 거부한다.
  이것은 계산량 제한 지표이며 환자 수·임상적 적정성·실행시간 보장이 아니다.
- JSON 본문은 최대 32,768바이트다. Content-Length뿐 아니라 실제 수신량도 검사한다.
  본문 수신 제한은 10초이며 계산 강제 종료 제한과는 다르다.
- 프로세스당 동시 계산 2건까지만 허용한다. 대기열은 없으며 초과 요청은 429와 Retry-After를 받는다.

## 재현과 반환값

반환에는 매번 새로운 `execution_id`, UTC 실행 시각, 계산·검토 소요시간 `elapsed_ms`,
정규화한 `input`, 실제 대조에 사용한 `evidence_input`, `report`, 동일 보고서의 `markdown`이 있다.
소요시간은 HTTP 전송·응답 직렬화를 포함한 사용자 체감 시간은 아니다.

`report.input_digest`는 근거 입력·시나리오·설계·seed·반복을 정규 직렬화한 SHA-256이다.
같은 입력과 실행 환경에서는 보고서가 같고, 실행 ID·시각은 달라진다. 보고서에는
엔진·Python·NumPy·난수 생성기 버전과 가정, Monte Carlo 표준오차도 포함한다.
환경 버전이 다른 실행까지 비트 단위 동일성을 보장하지 않는다.

결과는 서버에 저장하지 않는다(`persisted: false`). 실행 ID로 재조회하는 기능이나
불변 감사로그는 아직 없다. 저장이 필요하면 응답 전체를 보관해야 한다.
Markdown은 데이터로 반환한다. 향후 웹에서 사용자가 입력한 라벨·설명을 렌더링할 때는
HTML을 이스케이프하고 Markdown의 raw HTML을 허용하지 않아야 한다.

## 오류와 개발 환경 경계

| 상태 | 의미 |
| --- | --- |
| 400 | 잘못된 Host 또는 Content-Length |
| 403 | 허용하지 않은 브라우저 Origin |
| 408 | 본문 수신 시간 초과 |
| 413 | 본문 크기 초과 |
| 415 | application/json이 아닌 POST |
| 422 | 잘못된 JSON·값·중복 ID·표본수 순서·계산량 초과 |
| 429 | 동시 계산 한도 초과; 잠시 후 다시 요청 |
| 500 | 실행 실패; 입력값·예외 본문을 반환하지 않음 |

422 응답은 문제 필드의 경로와 오류 유형을 제공한다. `work_budget_exceeded`는
시나리오 수나 반복을 줄이면 되고, `sample_size_order`는 표본수 순서를 수정하면 된다.
실패 로그에는 실행 ID와 예외 클래스만 기록하며 입력값·예외 메시지는 기록하지 않는다.

Host는 localhost·127.0.0.1만 허용한다. 브라우저 Origin은 같은 출처 또는
`http://localhost:5173`, `http://127.0.0.1:5173`만 허용하며 wildcard CORS를 사용하지 않는다.
이는 인증이나 운영용 보안 체계가 아니다. **외부 네트워크에 노출하거나 기업 자료를 넣지 않는다.**
일반 로컬 프로그램의 호출을 인증하지 않으며, 여러 worker를 띄우면 계산 한도도 프로세스별로 적용된다.
원격 연결에는 별도 호스팅·인증·권한·요청 제한·관측·보관 정책이 필요하다.

## 검증

```bash
uv run pytest
uv run ruff check .
```

테스트는 엔진과 API의 결과 일치, 입력 변경에 따른 재계산, 동일 입력 재현,
오류·결측 보류, 입력·본문·계산량 제한, 동시 실행 제한과 회복, 로컬 Origin/Host를 확인한다.
의료적 타당성·전문가 평가·제품 성능을 입증하는 테스트가 아니다.

구현 참고: [FastAPI testing](https://fastapi.tiangolo.com/tutorial/testing/),
[FastAPI concurrency](https://fastapi.tiangolo.com/async/),
[Pydantic strict mode](https://docs.pydantic.dev/latest/concepts/strict_mode/).

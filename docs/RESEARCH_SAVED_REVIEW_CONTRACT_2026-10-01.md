# 저장 출처 재검토 계약 v1 — 다음 구현용 확정 인터페이스

범위: 기존 TEAM 조사 실행의 사용자가 선택한 정규화 SOURCE_TEXT를, 명시 동의와 정확한 이용조건 revision으로 **REVIEW 1회만** 재검토한다. collector/PLAN/followup 호출0. 2026-10-01 backend endpoint와 부모 전담 UI/엄격reader를 구현하고 합성 검증했다. 실제 공급자 호출·배포·임상검증 완료를 뜻하지 않는다. 구현/운영 한계는 `DEVELOPMENT_PERSONAL_C2_2026-10-01.md` 참조.

## 요청과 라우트

- POST `/api/research/runs/{run_id}/review-saved`
- GET `/api/research/runs/{run_id}/review-attempts` — 최근30개 metadata만.
- GET `/api/research/runs/{run_id}/review-attempts/{attempt_id}` — 아래 전체 artifact, 현재 원문 조회 권리 재검증.
- 모두 기존 TEAM 인증·CSRF·route classification 적용. POST는 admin/reviewer만, strict boolean `model_consent`가 실제 true여야 한다. 숫자1·문자true 거부. 모델 예산1call, source 최대8, 요청 body32KiB. TEAM 전용이며 legacy는404 `SAVED_REVIEW_TEAM_REQUIRED`.

POST JSON의 허용 필드는 정확히 다음 둘이다:

```json
{"model_consent":true,"source_bindings":[{"source_id":"paper_123","source_digest":"64 lowercase hex","policy_revision":1}]}
```

source_bindings는1..8개, source_id1..150자/중복 금지, source_digest64자리 lowercase hex, policy_revision 정수1..100(boolean 거부). 임의 본문·지시문·모델·공급자·프롬프트를 받지 않는다. 선택되지 않은 source 본문·과거plan/review/coverage는 전송하지 않는다. 부모 조사 request의 asset/indication/nct_id와 선택된 source만 서버에서 payload 구성한다.

조회404(다른팀/없음),403(권리/역할/세션 무효),409(출처 지문·정책 revision 다름/모델 슬롯 사용중),422(요청계약 오류). 시작 전 exact binding·두 목적 original_storage/external_ai ALLOW·세션 재검증을 마치지 못하면 provider factory0/모델0이며 attempt를 생성하지 않는다. 사용자 입력을 자동으로 최신정책에 덮어쓰거나 자동 재시도하지 않는다.

공통 HTTP 경계는 과대본문413 `BODY_TOO_LARGE`, JSON이 아닌 Content-Type415 `JSON_REQUIRED`로 endpoint 이전 거부한다. 기존 세션 만료401 처리도 그대로 적용한다.

## 보관 방식과 SSE

원래 Collection과 plan/review/events를 덮어쓰지 않는다. 새 UUID attempt_id, 서버 인증 subject_id, 최초정확bindings를 갖는 독립 append-only attempt이다. 시작과 단 하나의 terminal record를 별도 불변 행으로 저장한다(UPDATE/DELETE 금지). 기존 source_versions를 참조하며 새 수집/새 출처 허가를 만들지 않는다.

성공적으로 시작한 POST의 Content-Type은 text/event-stream. 모든 data JSON은 정확히 `schema,run_id,attempt_id,sequence,type,message` 6필드이며 schema=`research-saved-review-event/1`, IDs=해당 UUID, sequence는1부터연속, message는1..400자이다.

1. `type=STARTED`, sequence1: 실행 예약과 전송조건 확인 시작. 실제 전송 완료를 뜻하지 않는다.
2. terminal은 `type=COMPLETE` 또는 `FAILED`, sequence2 하나만. `COMPLETE`는 검증·저장된 artifact GET 준비를 뜻한다. 실패/취소는FAILED 메시지로 구분하고 실제 artifact status에 기록한다.

SSE에 source text·quote·review·raw model 응답은 넣지 않는다. 클라이언트는 terminal 뒤 exact attempt GET을 수행하고 권리와 계약이 유효할 때만 결과를 표시한다. comment heartbeat는 허용하되 sequence에 포함하지 않는다. 연결 종료는 후속 자동 모델 재시도 금지; 아직 실행중이던 작업은 취소를 요청하고 terminal CANCELLED를 저장한다.

## 전체 artifact

GET artifact의 허용 top-level 필드는 다음과 같다(모든 필드 필수):

| 필드 | 계약 |
| --- | --- |
| schema | `research-saved-review/1` |
| mode | `SAVED_REVIEW_ONLY` |
| run_id / attempt_id | 요청과 정확히 같은 UUID |
| status | `RUNNING`, `COMPLETED`, `FAILED`, `CANCELLED` |
| created_at / completed_at | UTC ISO시간 / terminal이면UTC ISO시간, RUNNING이면null |
| asserted_by | 서버 인증 subject UUID |
| context | 정확히 `{asset,indication,nct_id}`; 부모 request와 일치 |
| source_bindings | 요청과 동일 순서·동일 source_id/digest/policy_revision,1..8 |
| sources | 선택된 source 순서의 `{source_id,source_digest,title}`만, 각binding일치, 본문없음 |
| collector_calls / plan_calls | 각각0 |
| model_calls | 실제 complete 진입 횟수0또는1 |
| execution_mode | `COLLECTORS_ONLY`, `DACON_RESPONSES`, `SCRIPTED_TEST_DOUBLE` |
| model / response_id | 실제값 또는null, 각각최대200자 |
| input_tokens / output_tokens | 비음수정수 또는null(관측미제공) |
| review | COMPLETED일때 기존 ResearchReview 구조, 나머지null |
| citation_bindings | COMPLETED일때 기존 CitationSpan.binding 배열(최대8), 나머지[] |
| error_code | FAILED/CANCELLED의 고정 코드 또는null |
| notices | 최대10개,각1..500자 |

ResearchReview는 정확히 findings/questions/conclusion. findings0..8개의 `{source_id,quote,interpretation}`(각기선택ID/1..600자/1..700자), questions0..8개문자열(1..700자), conclusion=`NEEDS_EXPERT_REVIEW` 또는 `INSUFFICIENT_EVIDENCE`. citation_bindings는 각finding과같은순서·길이이고 `{anchor_id,source_id,source_digest,start,end,offset_unit}`이며 offset_unit=`UNICODE_CODE_POINTS`; 해당 immutable Source의 정확한 구간과 quote가 일치해야 한다. 서버가 anchor 선택 모델응답을 기존 resolve_citations로 원문 인용에 바꾼다.

RUNNING은 model_calls0/response_id·tokens·review null/citation_bindings[]/error_code null. 결과검증 실패는 토큰과 response_id를 관측했다면 보존하되 review null/인용[]이다. 실패코드는 고정 allowlist `MODEL_POLICY_DENIED`, `MODEL_FAILED`, `MODEL_RESPONSE_REJECTED`, `CANCELLED`, `INTERRUPTED`만 클라이언트에 노출하며 원본 공급자 오류나 submitted payload를 포함하지 않는다.

최근목록 응답은 정확히 `{run_id,attempts}`이며 각항목은 `attempt_id,run_id,status,created_at,completed_at,model_calls`만 포함한다. 최신created_at순 최대30개. 정책 차단 중에도 이 metadata만 볼 수 있다.

## 경계와 검사

실제 호출 바로 전과 반환 후에 세션·role·team/subject·source digest·정책 revision·original_storage/external_ai를 재확인한다. lazy factory와 request 전 gate, 반환 후 게시 gate를 모두 적용한다. PDF/raw/cache 권리는 이 계약으로 생기지 않는다. 단일요청 1call이며 자동 재시도/후속검색/다른 공급자fallback 없음.

완성 artifact GET은 현재 original_storage ALLOW와 당시 source digest의 정확한 저장 버전을 재검증한다. external_ai DENY는 새전송을 차단하며, original_storage ALLOW인 과거결과의 조회까지 자동으로 철회하지는 않는다. Source가 현재run에서 다른digest로 바뀌거나 참조가 없으면409로 닫고 자동 현재버전 재연결하지 않는다. 기존 원문에 인용된 실제 임상/법적 검증 완료를 주장하지 않는다.

필수검사: explicitTrue·targetbinding, cross-team404, UNKNOWN/DENY factory0, ALLOW 실제fakecall1, source버전/정책/role/만료철회 전송0 또는다음호출0, response대기중철회 게시0, source본문/임의payload가 SSE·목록에 없음, 원래Collection byte-equivalent 보존, 최근목록/GET roundtrip와 reader 엄격성. 부모 UI와 backend가 이 계약대로 분담하고 변경이 필요하면 상대에게 먼저 전달한다.

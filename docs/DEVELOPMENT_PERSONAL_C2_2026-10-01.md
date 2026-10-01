# 개인 개발 C2 경계 연결 — 2026-10-01

사용자 ‘사용량50퍼 전까지 쭉해 너가 최대한’ 지속 승인 아래 동일 개인 에이전트1로 진행. 이번 체크포인트는 C1 FTS snapshot 보완과 연구 SOURCE_TEXT 외부모델 전송 경계이며, 허가 후 저장자료 재검토 정상 경로는 다음 묶음이다. 대회 API·worker·추가 에이전트·인증파일 읽기·실DB·영상·배포·commit 없음. 임시 합성 DB/fake collector/provider만 사용했다. 전체 계획 추정79±10%p 유지.

## 이번 구현

- TEAM FTS에서 `BEGIN` 후 정책과 query result를 조회한다. WAL 동시정책철회 회귀로 기존 조회는 처음 snapshot을 일관되게 읽고 다음 요청부터 제외됨을 확인한다. 이미 전송된 바이트를 회수한다고 주장하지 않는다.
- `trialboard/research/model_policy.py` 신설: ResearchModelGate는 실제 TeamIdentity.revalidate를 매 호출 전·factory 후·모델 응답 후 수행한다. 세션/role/team/subject 불일치, 자료 digest·본문과 실제 저장 Collection 불일치, 목적 original_storage 또는 external_ai가 UNKNOWN/DENY, 처음 확정한 revision 변경, 임의 본문 payload,2MB 초과를 거부한다. 기존 연구 PLAN/REVIEW payload를 저장된 source에서 재구성해 완전대조한다. 과거 plan/selection의 의존성을 고려해 현재 연구 경로는 전체 run 출처의 권리를 보수적으로 요구한다.
- LazyResearchProvider는 첫 유효한 payload 권리 확인 뒤에만 provider_factory를 호출한다. TEAM에서는 Dacon 또는 합성 double만 허용하며 개인 공급자로 자동 전환하지 않는다. 모델 반환 대기 중 철회되면 결과 게시를 차단하지만 관측된 response_id/token 사용량은 감사기록에 남긴다.
- `/api/research/run`의 실제 스트림 경로에 연결했다. 신규 source 정책 UNKNOWN은 정상적으로 factory0/요청0으로 멈추며 수집 자료는 PARTIAL로 보존된다. 초기 source SSE는 제목/ID/URL 등 metadata만 포함한다. AI_PLAN_READY/REVIEW_READY 원문/인용이 나오지 않는 통합회귀를 추가했다.
- 전송 직전 안내를 ‘전송 조건 확인·요청 준비’로 고쳤다. provider0은 COLLECTORS_ONLY와 BLOCKED_POLICY로 기록한다. 공급자를 실제 생성/호출한 경우 성공·실패 양쪽에서 실제 model/mode를 갱신한다. 고정 권리차단 error_code를 허용해 일반 공급자 실패와 구분한다.
- TEAM PDF 자동화 `/automation/run`은 SOURCE_TEXT ALLOW를 재사용하지 않고 provider_factory 이전403 `AUTOMATION_PDF_USAGE_POLICY_REQUIRED`로 차단한다. 별도 PDF 권리 연결이 필요하다는 한국어 이유를 제공한다. 기존 legacy loopback 자동화는 보존했다.

## 검증과 한계

- 신규15개 합성 tests: UNKNOWN/ALLOW와 storage DENY, factory0, 정확한 허용 요청1, 후속세션만료·viewer·교차팀·digest·policy 변경 차단, 조작 payload, 반환 중 철회 게시 차단, FTS WAL snapshot, PDF 자동화403, 실제 TEAM 연구 SSE UNKNOWN factory0/본문0/metadataGET200, 실제 인증DB absolute/idle/role/logout 재검증.
- 실제 연구 endpoint가 injected fake factory를 closure로 캡처한 것을 inspect로 직접 확인해 잘못된 monkeypatch 때문에 호출0으로 보이는 오검증을 방지했다. 이 검사를 처음 추가할 때 FastAPI의 nested router를 top-level로 조회해 테스트만 StopIteration 실패했다. 제품 gate를 완화하지 않고 기존 `_iter_routes`로 바로잡아 해당 통합회귀 재통과했다.
- 관련 기존 Python60개 통과, 웹 research/auto-review 관련119개 dot reporter exit0, Ruff trialboard/tests·diffcheck 통과. 전체 Python 최종결과는 아래에 추가한다. 부모는 C1 UI와 기존 프로젝트 모델 경계를 별도로 독립 검수했다.
- 이번 경계는 신규수집 raw/PDF 저장 허가·캐시집행을 구현한 것이 아니다. 수집 후정책UNKNOWN을 차단하기 때문에 현재 TEAM ‘새 수집→자동모델’ 경로는 허가를 자동 생성하지 않는다. 다음 저장자료 REVIEW-only 정상 재개 endpoint와 부모 UI가 필요하며, 보안경계 연결만으로 제품 기능 완료라 하지 않는다.
- PDF/raw 권리 모델과 일반 자동화 정상 허용은 별도 후속이다. SOURCE_TEXT 정책은 해당 자료의 허가가 아니다. 신규수집 중 모델 PLAN followup이 새source를 추가하면 그 새source도 별도 ALLOW 없이는 다음 검토를 차단한다.

## 파일·후속 계약

신규: `trialboard/research/model_policy.py`, `tests/test_research_model_policy.py`, 이 문서와 `docs/RESEARCH_SAVED_REVIEW_CONTRACT_2026-10-01.md`.

수정: `trialboard/research/store.py`, `trialboard/api/research.py`, `trialboard/api/app.py`, `trialboard/api/automation.py`, `trialboard/research/agent.py`, `trialboard/research/validation.py`. UI는 부모 소유이며 이번 에이전트가 수정하지 않았다. 기존 dirty 변경 보존.

부모와 확정한 [다음 계약](RESEARCH_SAVED_REVIEW_CONTRACT_2026-10-01.md): exact run/source/digest/policy revision + 명시 model_consent, REVIEW만1call·최대8출처·collector/PLAN0, 원래Collection 불변·별도append-only attempt, metadata-only SSE와 권리검사된 별도GET. 부모가 dedicated UI/reader를 병행하고 같은 에이전트가 backend를 다음15분 묶음에서 이어간다.

## 사용량

첫 RPC1790831668 주간32%, 이후33→34→35%. 1790832304/2322에는35%, secondary미제공, status ok/model_calls0. 보고된 유효창 중45%에 닿은 값 없음. 일부 긴 편집 묶음은60초 목표를 초과했으며 관측지연/미제공창 때문에50% 하드보장을 주장하지 않는다. 다음 묶음도45% 선제중단/조회실패 중단을 유지한다.

최종 전체 Python 회귀: `.venv/bin/pytest -q -o addopts=''` **820 passed, 기존경고2, 53.78초, exit0**. 마지막 RPC1790832432 주간35%, secondary미제공, model_calls0. 부모에게 결과를 인계했으며 동일 승인 아래 다음 저장출처 재검토 backend 묶음을 이어간다.

## 후속 묶음 — 저장 SOURCE_TEXT REVIEW-only 정상 경로

RPC1790832556 주간36%로 시작. `trialboard/research/saved_review.py`, `trialboard/api/saved_review.py`, `tests/test_saved_research_review.py` 신설, app 라우터와 team_auth 정확한 route allowlist 연결. 부모가 전담하는 UI/reader/웹 tests와 확정계약대로 분업했으며 본인은 해당 프런트 파일을 수정하지 않았다.

- POST review-saved는 실제 true·1..8 unique binding·strict revision·임의추가필드 금지·32KiB 제한. 현재 실세션 admin/reviewer를 검증하고 정확한 run/source/digest/current revision 및 두 목적 ALLOW를 요구한다. UNKNOWN/DENY는403, 허용정책의 revision 불일치는409이며 시작 전 거부는 attempt/factory/request0이다. 기존 공통경계 과대본문413/Content-Type415/인증401을 계약에 명시했다.
- 선택한 source만 저장본에서 서버가 다시 구성한다. 선택하지 않은 UNKNOWN 출처, 과거 plan/review, followup은 전송하지 않는다. collector/PLAN0, 실제 모델1call; lazy provider 생성 전·실제 complete 직전·반환 후·저장결과 게시 전 세션/role/digest/revision/목적을 다시 검사한다. Dacon default/no personal fallback 보존.
- 원래 Collection JSON을 변경하지 않는 별도 UUID attempt. 불변 시작·terminal 두 행은 PRIMARY KEY와 UPDATE/DELETE 거부 trigger로 보존된다. metadata-only SSE STARTED→COMPLETE/FAILED, 별도 artifact GET은 현재 original_storage와 정확한 source version을 같은 snapshot에서 검사한다. external_ai만 DENY된 이전 결과는 original_storage ALLOW이면 조회할 수 있다. 원문권리 철회 후 목록 metadata는 남고 artifact403.
- 인용은 기존 citation_context/resolve_citations로 원문에서 직접 복사한다. 제한된 기존 design-claim 검사와 새경로 question1..700/공백·metadata 크기 검사를 적용한다. 임상 사실성 검증 완료가 아니다.
- 취소는 CANCELLED 단일terminal, 자동재시도 없음. 반환중 철회는 MODEL_POLICY_DENIED, 관측된 model/response_id/tokens는 보존하지만 review/인용은 저장하지 않는다. model_slot 해제는 terminal 저장실패에도 finally로 수행한다.
- **남은 운영 한계:** 프로세스 강제종료 또는 terminal SQLite 저장 자체 실패 시 불변 start의 RUNNING이 남을 수 있다. 자동 재실행·무조건 INTERRUPTED 덮어쓰기는 하지 않았으며 관리형 복구/실행 lease가 후속이다. 전송된 바이트의 회수 또는 세션 DB와 evidence DB 사이 모든 순간의 원자성까지 보장하지 않는다. raw/PDF 권리와 일반 자동화 정상 실행은 여전히 미구현이다.

신규 검증은 임시TEAM auth/DB와 합성 source/provider만 썼다. 정상 ALLOW 실제1call·미선택UNKNOWN 비전송·metadata SSE·parent Collection JSON byte-equivalent·immutable SQL·철회후GET·strict consent/int/중복/extra/digest/revision·실제 타팀 known run/attempt404·응답중 role/만료/정책/버전철회·factory후철회 request0·취소·크기경계를 검사한다. 초기14개 및 관련57개 통과. 과대본문 tests는 처음 Content-Type누락415, 보완 후 기존 공통413을422로 예상해 실패했고, 보안 경계 변경 없이 test expectation/계약 설명만 바로잡았다. 중간 전체회귀836pass+이 한개fail은 수정 전 수집된 tests였다. 최종 재실행 결과는 아래에 기록한다.

사용량은36→37%, RPC1790833051 주간37%, secondary미제공/model_calls0. 관측지연 때문에50% 하드보장을 주장하지 않으며45% 선제중단을 계속 적용한다. 전체 계획완료율79±10%p를 시험 숫자로 올리지 않았다.

후속 최종 전체 Python 회귀: `.venv/bin/pytest -q -o addopts=''` **838 passed, 기존경고2, 62.19초, exit0**. 도구는1초yield로 실행하고 진행중 별도사용량을 조회했다. Ruff trialboard/newtests, git diff --check 통과. 마지막 확정 RPC1790833106 주간38%, secondary미제공/model_calls0. 부모 독립 UI 검증: 실제 backend response→엄격TS reader roundtrip, 전체web1071pass+1skip, TS/build와1440/390합성 mounted QA 통과(부모가 수행한 결과이며 본인시험과 구분).

### 다음 PDF 범위 사전 감사(아직 구현 아님)

현재 연구 PDF GET cached와 POST documents는 SOURCE_TEXT policy와도 독립이며 별도PDF권리 검사가 없다. `public_pdf_receipts` 키는run/source/pdfSha지만sourceDigest를 저장하지 않는다. public_pdf_blobs는sha256에 묶이며 GET은해시검사하지만 POST cached분기는그검사를생략한다. 연구 automation prepare는정확receipt/pdfSha/길이·브라우저추출input 구조를검사하나PDF이용조건은없고 `textVerifiedAgainstPdf=False`이다. TEAM automation/run은현재임시403으로닫혀있다. 기존ProjectModelGate는project revision/pdfDigest/policy에묶여연구run/source receipt에자동재사용할수없다. 별도PDF_BYTES권리+정확binding과metadata/CAS부터연결하고출처본문허가를재활용하지않아야한다. 일반rawcollector권리는별도후속이다.

# 개인 개발 C1 서버 체크포인트 — 2026-10-01

최신: 사용자 후속 승인으로 같은 개인 에이전트가 C1 UI·엄격 reader를 추가했다. 아래 첫 단계의 ‘UI 미구현/개발 종료’는 당시 기록이며, 최하단 UI 후속 검증 결과가 최신이다. C2/C3와 운영 검증은 여전히 미완료다.

## 부모 독립 확인 / UI 재개

2026-10-01 사용자 재개 승인 후 기존 개인계정 agent1을 C1 UI·엄격 client reader 범위로 재개했다. 부모가 source_policy와 research/store/API 연결을 읽고 `pytest -q tests/test_research_source_policy.py tests/test_team_auth.py tests/test_dacon_worker_disabled.py`를 독립 실행해 exit0/전부 통과(기존 경고2개)를 확인했다. 부모 RPC1790830060 주간30%, secondary미제공. 자식 착수 RPC1790830056도30%. 전체805 재실행은 앞선 자식보고이며 이번 부모는 관련 회귀만 재실행했다. 서버 원문전체조회는 같은 snapshot을 쓰지만 FTS 정책검사→SELECT는 명시 BEGIN이 없어 동시철회 일관성 추가검토가 남는다. 이번 UI완료를 모든 권리경계 또는 C2/C3 완료로 확대해 말하지 않는다.

범위: 이미 저장된 조사 `SOURCE_TEXT`의 이용조건과 조회 경계. 부모가 요청한 서버·계약·보안 단위만 구현했다. 기존 PART A/B, dirty 작업트리와 영상은 보존했다. 전체 계획 추정 79±10%p를 올리지 않는다.

## 사용 경로와 관측

- 개인 계정 내장 개발 에이전트 1개만 작업. 추가 에이전트·대회 worker·외부 모델·대회 API·직접 인증파일 읽기 없음. 테스트는 임시 DB와 합성 자료만 사용했다.
- `scripts/read_codex_usage.py`의 공개 account/rateLimits/read RPC 사용. 최초 timestamp1790825937: ChatGPT/codex primary 주간10080분 used28%, secondary 미제공, model_calls0.
- 중간 1790825991/6127/6137/6226/6284/6312/6353에는29%, 1790826406/6470에는30%. 모든 관측은45% 선제중단 기준 미만이었다.
- 일부 편집 묶음의 조회 간격이60초를 넘었다(5991→6127의136초 등). 따라서 요청한 최대60초 주기를 엄격히 충족했다고 주장하지 않는다. 관측 지연과 미제공 secondary 때문에50% 하드보장도 아니다. 이 단계 후 새 개발을 자동으로 이어가지 않는다.

## 구현

- `trialboard/research/source_policy.py`: 정확한 run_id/source_id/source.digest에 결속된 SOURCE_TEXT 정책. 네 목적 ALLOW/DENY/UNKNOWN, 근거·사유, 서버 인증 주체·시각, USER_ATTESTED_UNVERIFIED. append-only SQL trigger, CAS, 최대100회 이력·500개 출처 조회 상한. 공개 URL에서 허가를 추정하지 않는다.
- 새 TEAM 조사 실행의 시작 트랜잭션에 실제 주체를 소유자로 기록한다. 일반 save/read로 과거 실행의 소유자를 만들지 않는다. 기존 소유자 미상 실행은 admin만 정책 초기화 가능하다. reviewer인 실제 소유자/admin만 변경하고 viewer는 변경할 수 없다.
- GET `/api/research/runs/{run_id}/source-metadata` 및 `/sources/{source_id}/usage-policy`는 mode=ro와 TeamDataPath.lookup을 사용한다. DB·디렉터리·테이블을 생성하지 않으며 정책 미존재는 UNKNOWN/revision0이다. 텍스트·인용·rawsnapshot·모델 payload를 응답하지 않는다. POST는 실제 출처 지문·현재 revision을 검증한다. 새 라우트를 TEAM 보호 목록에 명시했다.
- 전체 collection은 원문과 정책을 동일 SQLite 읽기 스냅샷에서 확인한다. UNKNOWN/DENY original_storage이면403이며 원문을 가짜로 지운 Collection을 반환하지 않는다.
- 로컬 FTS는 original_storage와 internal_search가 모두 ALLOW인 정확한 버전만 SQL 조건에 넣어 snippet/결과 LIMIT20 이전에 제외한다. 차단된 출처의 hit count는 반환하지 않는다. 기존 바이트·색인은 삭제하지 않았다.
- curation/result-tables/exploration/automation의 저장 내용은 현재 실행 전체 출처를 기준으로 보수적으로 차단한다. 완전한 의존성 그래프나 모든 과거·외부 파생물 추적을 주장하지 않는다. metadata·recent run list는 차단 중에도 사용 가능하다.
- legacy loopback 경로는 정책을 요구하지 않는다. 제품 default dacon/no automatic fallback는 수정하지 않았다.

## 수정 파일

새 파일: `trialboard/research/source_policy.py`, `tests/test_research_source_policy.py`, 이 문서.

기존 파일의 좁은 수정: `trialboard/research/store.py`, `trialboard/api/research.py`, `trialboard/api/team_auth.py`, `trialboard/api/automation.py`, `trialboard/api/exploration.py`, `tests/test_team_auth.py`.

일부 기존 파일은 원래 미추적이므로 git diff 통계만으로 이번 변경량을 판단하지 않는다. SESSION_HANDOFF/NEXT_TASKS/AGENTS 및 영상 파일은 이 에이전트가 편집하지 않았다.

## 검증

- 초기 관련47 tests 통과. 새 정책8 tests: UNKNOWN/DENY/ALLOW, read/FTS 분리, 원문 포함 없는 metadata, GET 무쓰기, CAS·불변 이력, run/digest/team 격리, legacy creator/admin 복구, owner/viewer 경계, 실제 TEAM API 라우트.
- 기존 TEAM 격리·자동화 테스트2개는 권리 미설정 fixture의 원문200 기대 때문에 처음 실패했다. 기존 기대를 무조건 허용하지 않고 실제 인증 admin의 명시 정책POST를 fixture에 추가했다. 잘못된 비16진 digest도 정상 SHA로 고쳤고 두 테스트 재통과했다. 없는 run은 artifact 준비 전404로 거부한다.
- 전체 Python805 passed/기존 경고2개(44.77초), Ruff trialboard/tests 및 git diff --check 통과. 이후 동일 스냅샷 보완 뒤 관련37 tests 통과(1.69초). 최종 전체 재실행 결과는 아래 체크포인트에 기록한다.
- 프런트 파일 미변경. UI/모바일/브라우저 QA, 실제 운영·임상 검증은 이번에 수행하지 않았다.

## 남은 경계

- C1 UI(최근 조사 목록에서 정책관리 진입/입력보존/충돌/모바일), 클라이언트 엄격 reader는 미구현이다. 현재는 서버 metadata/정책 API까지만 완료했으므로 C1 전체 또는 phase3 완료라고 표현하면 안 된다.
- SOURCE_TEXT 정책은 raw API snapshot이나 PDF 바이트 저장·다운로드·캐시에 대한 허가가 아니다. raw 수집·PDF gate와 연구/자동화의 매 모델 호출 전 외부전송 권리·세션 재확인은 C2/C3 후속이다. external_ai/training 필드는 기록만 하며 학습 기능은 없다.
- source 변경/삭제를 가로지르는 완전한 과거 artifact 의존성 추적, 동시 실행 중 모든 파생 응답의 동일 DB snapshot 결속은 후속 검토 대상이다. 현재 full collection만 정책과 반환 내용을 동일 snapshot으로 읽는다.
- 다운로드한 과거 파일 회수, 법적 권리 인증, DLP, 배포/실DB migration은 하지 않았다. 부모 독립 검수 후 다음 단계 판단이 필요하다.

## 최종 체크포인트

- 최종 코드 전체 Python805 passed/기존 경고2개,45.60초, exit0. Ruff trialboard/tests와 git diff --check도 통과했다. 마지막 전체 실행 이후 제품·테스트 코드 추가 변경 없음.
- 마지막 사용량 RPC timestamp1790826600: status ok / ChatGPT / codex primary 주간10080분 used30% / secondary미제공 / model_calls0. 최초 관측부터663초(약11분) 안에 이 단계 구현·검증을 마쳤다.
- 여기서 자식 개발 종료. 부모 독립 검수와 사용자 지시 없이 다음 UI/C2/C3/큐/OCR/배포 단계로 자동 확장하지 않는다.

## 사용자 재개 승인 후 C1 UI — 개인 계정 동일 에이전트

사용자 ‘계속 진행해. 너가 개발하는거지 내 계정으로?’에 따른 부모 위임으로 착수했다. 서버는 부모 독립 검수 범위로 두고 이번에는 backend를 수정하지 않았다. 추가 에이전트·대회 API·인증파일 직접 접근·영상·실DB·배포·commit은 없다.

### 화면과 계약

- `frontend-design` SKILL 전체를 읽고 기존 TrialBoard 디자인을 유지했다. 기존 DM Sans/Noto Sans KR와 ink#15223b/navy#122346/blue#2855e8/muted#59677f/line#dbe2ef/canvas#f5f7fc를 재사용했다. 왼쪽 정렬의 한 패널 안에서 출처 선택→현재 조회 상태→목적별 이용조건→근거·사유→불변 이력을 읽는다. 데스크톱2열/모바일1열이며 장식·신규폰트·이미지는 추가하지 않았다. Sites 도구 지침도 확인했고 이번 요청의 명시적 로컬 전용·배포 금지를 따랐다. 세션에 별도 Sites skill은 제공되지 않았다.
- `research-source-policy.ts`: metadata와 history의 필드·타입·상한, 정확한 요청 run/source/digest, revision0 UNKNOWN의 null 근거/저자, 양의 revision의 실제 author·시각·근거, 이력 연속성과 current-head 일치를 엄격 검증한다. 부가 본문 필드·위조 권한 boolean·외부 대상·중복 출처를 거부한다. API 요청은 기존 전역 인증 fetch를 사용하고 자동 POST/재시도하지 않는다.
- `SourcePolicyManager.tsx`와 전용 CSS: 원문403이어도 metadata GET으로 정책관리 진입. 현재 서버 can_manage와 실제 세션 role이 모두 허용해야 쓰기 가능하다. UNKNOWN/DENY 차단, 근거·사유 필수, 저장된 네 목적과 author/time 이력, CAS409 초안 보존·최신 이력 재조회, 출처 버전 변경 시 목록 재조회, 권한거부 잠금,401 기존 세션 만료 처리.
- run/source/digest별 keyed component와 AbortController/generation으로 이전 대상 응답을 폐기한다. 출처별 미저장 초안은 현재 열린 패널 동안 유지하고409 재조회로 덮어쓰지 않는다. 패널을 닫거나 페이지를 떠난 초안의 영구 저장은 지원하지 않는다.
- `ReviewNavigation`의 최근 검토(실제 AutoReview 사용)와 `ResearchPanel`의 최근 조사에 진입 버튼을 연결했다. 기존 fullread 실패 문구에 이용조건 확인 경로를 추가했다. 기존 history CSS의 광범위 button selector를 직계 기록 버튼으로 제한하여 내부 정책 컨트롤을 덮지 않게 했다.
- 외부 AI·학습은 ‘기록만’이며 조사/자동화 외부전송 집행 미연결·학습 기능 없음·PDF/raw 권리 별개를 화면에 표시한다. ProjectShelf 기존 ‘향후 외부 모델’ 설명은 이미 구현된 PDF 검토·설계 제안 범위로 바로잡았다.

### 실제 검증

- 신규 계약 테스트5개 통과: metadata target/field strictness, UNKNOWN 권리 위조 차단, history 결속·연속성·current 일치,409/401/403/404/422 자동 재시도 없음, GET 무POST.
- 전체 웹1065 passed /1 skipped /0 failed(1066개), 저장소 루트에서 `node --test --test-reporter=spec web/tests/*.test.mjs`,3.16초. 최초 web 하위 cwd 실행은 기존 Python 상호운용 테스트2개가 상대 tests 경로를 찾지 못했다. 코드/검사 기준을 완화하지 않고 정상 루트에서 재실행해 통과했다.
- TypeScript + Vite production build 통과. 마지막 UI 조정 후 빌드 재통과. `git diff --check` 통과.
- `web/scripts/check-source-policy-ui.mjs`: 실제 AccessShell/ReviewTools/SourcePolicyManager를 기존 로컬 Vite에 mount, 모든 API는 공개·비민감 합성 응답으로 interception. 1440/390에서 keyboard 진입, 처음 POST0, CAS409 초안 보존/버튼잠금/최신revision 재조회 후 정확한 digest+revision POST, 출처 변경 뒤 지연응답 폐기·초안보존, 권한회수 readonly,401 세션만료를 확인했다. 양쪽 pageerror0/overflow0. 서버 E2E·실자료 테스트는 아니다.
- 화면2개를 직접 육안 검토했다. 데스크톱의2열 목적 선택과 모바일1열, 긴 출처 지문 줄바꿈, 입력·안내·이력 배치가 정상이다. 최신 반복 QA 스크린샷은 `/var/folders/nq/5rr31cs56rsgsvvmxnnmzffw0000gn/T/trialboard-source-policy-ui-PVTpxH/policy-1440.png`, `policy-390.png`. 임시 경로이므로 장기 보존을 보장하지 않는다. 테스트 후 해당 headless browser는 정상 종료했다.

### 이번 변경 파일과 사용량

신규: `web/src/research-source-policy.ts`, `web/src/SourcePolicyManager.tsx`, `web/src/source-policy.css`, `web/tests/research-source-policy.test.mjs`, `web/scripts/check-source-policy-ui.mjs`.

수정: `web/src/ReviewNavigation.tsx`, `web/src/ReviewNavigation.module.css`, `web/src/ResearchPanel.tsx`, `web/src/AutoReview.tsx`, `web/src/ProjectShelf.tsx`, 이 상태 문서. 다른 기존 변경은 보존했다.

사용량 RPC 최초1790830056 주간30%, 이후31%,1790830609/0636/0675에는32%. 마지막 status ok / ChatGPT codex primary10080분 / used32% / secondary미제공 / model_calls0. 어떤 관측도45% 선제중단 기준에 닿지 않았다. 이번에도 일부 긴 편집 묶음은60초 목표를 넘었다(0171→0283의112초 등). 상한50% 하드보장이나 모든 window 확인을 주장하지 않는다. 이번 묶음은 약11분이며 새 개발 단계로 자동 확장하지 않고 부모에게 인계한다.

부모가 지적한 FTS 정책조회와 결과SELECT 사이의 명시적 동일 snapshot 미결속은 이번 UI 작업으로 해소하지 않았다. 전체Collection의 snapshot 보완과 다른 경로의 동시성 보장을 구분한다. C2/C3·완전한 artifact 의존성·운영/임상 검증은 남아 있으며 전체 계획 추정79±10%p는 유지한다.

UI 단계 종료 직전 최종 RPC1790830741도 주간32%, secondary미제공/status ok/model_calls0이었다. 문서만 갱신하고 제품 코드 추가 변경 없이 종료했다.

## 부모 C1 UI 독립 검수 완료

- 계약/auth/session 관련18tests 독립 실행 통과.
- 부모가 `web/scripts/check-source-policy-ui.mjs`를 다시 실행해 1440/390 양쪽 CAS초안 보존·정확revision 저장·키보드진입·지연응답폐기·권한회수·만료를 확인했다. overflow=false/pageerrors=[]/exit0.
- 부모가 새 두 화면을 직접 확인했다. 출처지문 줄바꿈과 모바일1열/데스크톱2열 정상. 결과 경로 `/var/folders/nq/5rr31cs56rsgsvvmxnnmzffw0000gn/T/trialboard-source-policy-ui-7KOb7f` (임시파일).
- 최초이후 추가서버수정 없이 C1 UI검수 통과. 사용자 50%전까지 지속승인에 따라 같은 agent1이 다음 전송권리 단계를 진행하며 부모 감독 유지. 이후 상태는 DEVELOPMENT_PERSONAL_C2_2026-10-01.md.

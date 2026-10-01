# 대회 API 제품 개발 결과

현재 감사+A/B/C+통합검증 완료. **영상 작업은 수행하지 않았다.** 기존 영상·대사·TTS·이미지·기술명세 원본을 고치지 않았다. 구현은 Dacon `gpt-5.6-sol` 4회, 감독·독립 검증은 이 세션 계정으로 분리했다. 개인 공급자 fallback 없음, 키는 승인 비밀파일을 실행기가 명시적으로 읽었으며 값 출력/저장소 복사 없음. 추가 background worker는 실행 중이지 않다.

## A — 반대 근거 검색 의도와 실제 실행 기록

`trialboard/research/{agent,models,validation,plan_probe}.py` 및 웹 조사 reader/활동 표시에 구현.

- 새 계획은 첫 후속 질의의 CONTRARIAN 의도와 실패·유해·중단 등의 명시 키워드를 검사한다. 후속질의 최대2개·모델 최대2회·동의·인용 경계 유지.
- 계획과 실제 query/coverage index/OK·EMPTY·FAILED·SKIPPED/시도 여부를 연결한다. 실패·한도생략은 PARTIAL로 보존한다.
- legacy followup_terms 저장기록은 읽되 과거 반대검색을 새로 했다고 생성하지 않는다.
- 정확한 주장: **반대 신호를 찾는 검색 의도를 실행·기록하고 실패와 생략을 구분한다.** 결과가 부정적이라는 판정/검색 편향 해소/전체 문헌 완전성은 아니다.
- 독립 검증: Python733 전체, 관련웹43, Ruff/diffcheck 통과. 별도 synthetic SKIPPED 저장복원 확인. 실제 ResearchProgress 합성 브라우저1440×1000/390×844 시각검토·pageerror0·가로넘침0.

## B — KOL 질문 규칙 우선순위

`trialboard/agent/design_compare.py`, `web/src/{design-result,meeting-packet,DesignPanel}.ts[x]`, `design.css`에 구현.

- 비교 전 근거차단을 네 단계의 검토순서 관례(100/200/300/400)로 정리하고 이유를 표시한다. 조건 불일치/보류·필수근거누락 등을 실제 trigger에서 사용한다.
- 질문ID와 원래 BEFORE_COMPARISON/BEFORE_PROTOCOL 유지. 고정 tie-break 및 브라우저 재계산으로 점수·이유·순서 변조 거부.
- 새 design-comparison/2와 이전 /1 읽기 분리. 이전 기록에 점수를 소급 삽입하지 않으며 kol-meeting-notes/1 reportKey 결속 유지.
- 가정상 안전한계초과/보류 빈도는 계산된 경우 설명에만 포함한다. 점수는 임상위험·확률·학습모델 예측값이 아니다.
- 정확한 주장: **근거차단 종류에 따른 규칙 기반 회의 의제 우선순위와 이유를 제공한다.** KOL의 실제 질문/반응 예측 모델이 아니다.
- 독립 검증: 영향Python80/웹113/Ruff/diffcheck 통과. 실제 DesignPanel 합성세션에서 우선질문400/이유/메모작성·탭왕복보존, 데스크톱/모바일 시각검토·pageerror0·가로넘침0.

## C — 정확 버전에 기록된 직접 참조 조회

`trialboard/research/store.py`, `trialboard/api/research.py`, `web/src/{ResearchImpact,research-impact,ResearchPanel}.ts[x]` 및 `research.css`에 구현.

- `GET /api/research/runs/{run_id}/impact?source_id=…&source_digest=…`는 SQLite를 mode=ro로 열어 조회만 한다. 원자료/상태/스키마를 변경하지 않는다.
- anchor와 같은 프로젝트의 다른 저장실행 중 정확 source ID+source-record digest가 같고 finding 또는 계획 우선순위에 직접 참조된 것만 반환한다. 단순 인벤토리 포함과 다른 버전/프로젝트는 제외한다.
- 빈 결과·없는 출처·버전 불일치·조회 실패를 구분한다. 웹은 기준run/source/digest와 형식을 검사하고 출처를 바꾼 뒤 도착한 이전 응답을 버린다.
- 정확한 주장: **같은 자료 버전을 참조한 저장 조사 기록을 확인할 수 있다.** 완전한 영향 그래프·설계/회의 산출물 영향·자동 갱신/재계산·인증/테넌트격리는 아니다. 조회 실패는 후보가 없다는 뜻이 아니다.
- Source 레코드 digest와 PDF 바이트 digest를 구분한다. 계획 우선순위 참조는 최종 AI 입력/임상 채택의 증명이 아니다.
- 합성DB 테스트에서 버전·프로젝트 구분/인벤토리 제외/직접참조/오류/SQL 인자화/DB 바이트불변 확인. 브라우저에서 키보드조회·후보/범위·빈값·실패·출처교체 늦은응답폐기, 두 화면폭 pageerror0·가로넘침0.

## 최종 감독 검증

| 명령/검사 | 결과 |
|---|---|
| `.venv/bin/python -m pytest -q -o addopts=''` | 738 passed, 기존경고2 |
| `.venv/bin/ruff check trialboard tests` | 통과 |
| `node --test --test-reporter=tap web/tests/*.test.mjs` | 1032 passed / 1 skip / 0 fail |
| `npm --prefix web run build` | TS/Vite 통과, 기존경고 |
| `git diff --check` | 통과 |
| 실제 A/B/C 컴포넌트 합성브라우저 QA | 1440×1000/390×844, 오류0·가로넘침0, 캡처6개 시각확인 |

`frontend-design` 기준은 기존 제품색/서체/레이아웃을 유지하고 실제 의도·상태·이유·조회범위에 필요한 정보만 추가하는 데 적용했다. 영상 디자인이나 새 애니메이션에는 적용하지 않았다. Browser QA는 합성자료/응답으로 변경 컴포넌트와 메모 동작을 확인한 것이며 전체 제품 사용자흐름·실임상 자료 end-to-end 검증은 아니다.

총4회 worker의 provider/model/completed/no-fallback 및 기록된 수정31경로가 제품코드/테스트 안임을 확인했다. CLI집계 input12,763,053(그중 cache12,185,305)/output79,668이며 실제 대회 차감량과 다를 수 있다. 한도는 최대8회였고 추가호출은 하지 않았다.

## 제외와 한계

제품 실제 외부 문헌·모델 호출, 임상 정확도 평가, 전문가 승인, 인증/권한/테넌트격리, 다문서 의미병합, 의미캐시, 주기갱신/자동재시도, 최적용량 추천은 이번에 구현/검증하지 않았다. 기존 Starlette/httpx/anyio 경고와 MUI/Vite 경고가 남는다. 전체 진행률79%(±10%p)는 계획추정이며 테스트 통과율이나 임상 성능이 아니다.

전체 저장소 Ruff는 범위 밖 기존 미추적 영상 문서 생성 스크립트 `scripts/build_cinematic_review.py`의47건 때문에 실패했다. 해당 스크립트는 변경하지 않았다. 위 표의 Ruff 통과 범위는 제품 `trialboard`와 `tests`다. 대회 worker 안에서는 브라우저 포트가 제한되어 있었으나 감독이 별도로 로컬 브라우저 검사를 완료했다.

원문 감사: [현재 코드 감사](DEVELOPMENT_GAP_AUDIT_2026-09-30.md). 실행별 상태: [감독 기록](DEVELOPMENT_DACON_STATUS_2026-09-30.md). QA 스크립트/캡처는 `output/dacon-development-20260930/`에 보존한다. 배포·Git commit/push 없음.

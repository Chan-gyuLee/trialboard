# 찬규용 제품·배포 인수인계

기준: 2026-10-01, 이번 Git 업로드의 제품 코드. **이 문서를 먼저 읽고**, 이전 날짜의 개발 기록보다 현재 코드와 아래 상태를 우선한다.

## 결론

핵심 제품 흐름은 구현되어 로컬 TEAM 환경의 합성 검증을 통과했다. 그러나 **정적 웹 배포나 도메인 연결만으로 모든 실제 기능이 돌아가는 상태는 아니다.** 공개 서버용 Host/Origin/쿠키/실행 경계를 보완한 다음 배포해야 한다. 운영·임상 검증 완료품이 아니라 본선 시연용 연구 프로토타입이다.

사용자 요청은 기능 흐름 우선, 세부 확장 보류다. **도메인·서버·배포는 찬규 담당**이며, 아래 공개 실행 코드 보완도 직접 맡거나 률 측 개발 세션에 파일 단위로 요청하면 된다. 여기서 도메인을 구입하거나 서버를 배포한 것은 없다.

## 1. 구현된 것

| 영역 | 현재 구현 | 중요한 한계 |
| --- | --- | --- |
| 공개 근거 조사 | 약물/NCT 검색, 공개 등록·논문·규제 출처 수집, 검색/출처/변경 기록 | 수집 범위 제한·부분 실패가 있으며 전체 문헌조사 아님 |
| 반대 근거 탐색 | 반대 방향 검색어·검증 로직 | 편향 제거 효과의 독립 평가는 아님 |
| 수집→AI 검토 | TEAM 자료 선택, 출처 텍스트·연결 원본 허가 확인, 별도 동의 후 저장 자료 검토 | 자동 권리 추정 없음. 초기 scout 검색 기록의 목적별 권리는 별도 남음 |
| 인용·출처 | 원문 구간/지문 연결, 서버 인용 대조, 부족 근거·보류 표시 | 문자열 결속 검증이지 해석의 임상적 검증 아님 |
| 숫자·설계 | PDF 필드 대조, 수동 관측값 검토, 결정론적 계산·가정별 비교, 원본 결과에 연결한 AI 초안 | 검증된 최적 용량 추천이나 Tabular 전용 예측 모델 아님 |
| PDF | 브라우저 원문/페이지·구간 검토, 정확 버전 캐시 열기, 파일별 허가, 서버 준비 텍스트 기반 재검토 API/UI | OCR 없음. macOS 서버 준비 차단, Linux 실제 환경 확인 필요 |
| KOL·결과 활용 | 질문 긴급도 규칙, 인용·질문·회의 메모 Markdown, 원문 검토로 이동 | 예측 모델 아님. 새 회의 준비 메모는 내려받기 전 탭 메모리 |
| 변경 영향 | 기록된 출처 관계를 역참조한 영향 조회 | 모든 의미적 영향의 자동 탐지 아님 |
| 작업 저장·복원 | 프로젝트/checkpoint, 문서 버전 계보, 공동 검토·충돌 처리, 기록 복원 | 신규 회의 준비 메모·일부 첨부/진행 중 상태는 자동 영속화 아님 |
| 팀·권리 | 로그인/세션/역할, 팀별 저장, 프로젝트 ACL, 문서 공유·검토, SOURCE/PDF/RAW 목적별 기록·집행 | 현재 HTTP 루프백용. 운영 SSO/TLS·완성형 보안 인증 아님 |
| 사용량 | 저장 재검토의 관측 모델 호출·토큰 UI, 불확정 사용량 구분 | 운영진 청구/전체 토큰 잔량의 대체 자료가 아님 |

최근 연결 흐름: **수집 → 자료 선택·허가 → AI 검토 → 인용/질문 → 회의 메모 저장 또는 PDF → 원문/필드 → 설계·KOL**.
수치 근거가 없는 AI 문장을 확정 관측값으로 자동 바꾸지 않는다.

## 2. 배포 전에 반드시 해결할 코드 작업

아래는 ‘배포하면 알아서 해결되는 문제’가 아니라 아직 남은 연결 작업이다.

| 우선 | 작업/현재 제한 | 확인할 파일 | 완료 기준 |
| --- | --- | --- | --- |
| P0 | 서버가127.0.0.1 바인딩, TrustedHost/Origin 루프백만 허용 | `trialboard/api/__main__.py`, `app.py`, `boundary.py` | 배포 구조에 맞춘 명시적 도메인·Origin·프록시 신뢰 정책, 외부 직접 API 접근 차단 |
| P0 | TEAM 세션 쿠키 Secure=False, HTTP 로컬 전제 | `trialboard/api/team_auth.py`, `web/src/auth-client.ts`, `access-session.ts` | HTTPS 로그인/로그아웃/만료/CSRF/다른 팀 차단 실브라우저 검사 |
| P0 | 설계 계산 프런트와 capability가 localhost/LOOPBACK_ONLY | `web/src/design-client.ts`, `LocalDesignRunner.tsx`, `trialboard/api/app.py`, `designs.py` | 실제 도메인에서 동의한 사용자의 계산 성공, 미인증·viewer·잘못된 Origin 차단 |
| P0 | 다른 PDF/AI/프로젝트 클라이언트의 로컬 전제도 전체 대조 필요 | `web/src/pdf-agent.ts`, `project-checkpoint.ts`, `design-proposal.ts`, 서버 boundary/라우트 | 시연할 모든 경로를 실제 도메인에서 검사. 한 파일 allowlist만 바꿔 완료 처리하지 않음 |
| P0 | 서버 PDF 준비의 실행 자원 제한 | `trialboard/research/pdf_preparation.py`, `pdf_extract_worker.py` | Linux 대상에서 제한/시간초과/정상 추출·인용 연결 검증. 미지원이면 해당 기능을 명시 차단 |
| P0 | 실제 대회 모델·공개 수집 서비스 연결 미재검증 | `trialboard/api/__main__.py`, `trialboard/agent/` | 제품 서버의 Dacon으로 최소 승인 시연 성공, 사용량/오류 기록 확인 |

**금지:** Host를 localhost로 위조해 공개 서비스인 사실을 숨기는 우회, 모든 Origin 허용, 인증·CSRF·원문 권리 검사 제거, 미지원 PDF 제한 해제. 배포 전 보완이 어렵다면 로컬 기능을 완성된 공개 기능처럼 표시하지 말고 지원 범위를 합의한다.

## 3. 찬규가 맡을 작업 순서

1. 이 커밋을 새 폴더에서 받아 아래 로컬 설치·테스트로 기준선을 재현한다. 기존 개인 DB/촬영 폴더는 옮기지 않는다.
2. 공개 범위를 결정한다. 처음에는 **초대된 심사/팀 계정만 쓰는 베타**가 적절하며 계정 발급 방식·동시 사용자·사용 한도를 정한다.
3. 위 P0 공개 실행 코드 보완 담당을 정한다. 찬규가 직접 수정하거나 률 측에 구체 항목을 요청한다. 수정 후 로컬 회귀도 재실행한다.
4. Python3.12·Node 빌드와 영구 볼륨을 지원하는 서버를 준비한다. 현재 SQLite 구조를 고려해 우선 단일 인스턴스로 구성하고 여러 서버/worker의 안전성을 가정하지 않는다.
5. 프런트와 `/api`를 동일 HTTPS origin으로 제공하도록 구성한다. `web/dist`만 정적 호스팅하면 실제 제품 서버가 빠진다. `VITE_PUBLIC_PREVIEW=true`는 API를 막는 정적 데모이므로 실제 시연 배포에 사용하지 않는다.
6. identity DB·팀 자료·프로젝트·원문을 영구 볼륨에 분리하고 권한을 제한한다. 새 관리자/심사 계정을 만든다. 개발자의 기존 DB나 개인 계정 인증 파일을 복사하지 않는다.
7. 대회 API 키를 **서버 Secret**으로 주입한다. 제품은 Dacon 기본, 개인 Codex 자동 fallback 없음. 프런트 `VITE_*`·Git·로그·Docker build argument에 키를 넣지 않는다.
8. `trialboard.ai.kr` 등록 여부와 소유권을 확인하고 DNS·TLS를 연결한다. 등록 대행자/Cloudflare zone/네임서버는 별도일 수 있다. 이전 문서의 등록 가능 여부·가격은 현재 사실로 가정하지 말고 구매 화면에서 확인한다.
9. 아래 실제 도메인 체크리스트를 통과한 뒤 심사위원에게 링크와 계정/안내를 전달한다.
10. SQLite 일관 백업·복원, 로그 비밀정보 제거, 디스크/오류 알림, API 비용·동시 실행 제한, 롤백을 준비한다. 심사 중 자동 업데이트는 피하고 검증된 커밋을 고정한다.

## 4. 로컬 기준선 재현

Python **3.12**, Node **24.x**(이번 검증24.14.0), uv와 npm이 필요하다. 루트에서 실행한다.

```bash
uv sync --locked --group dev
cd web
npm ci
npm run build
cd ..
uv run ruff check trialboard tests
uv run pytest -q -o addopts=''
node --test web/tests/*.test.mjs
```

최신 로컬 결과: **Python1054 통과/기존경고2**, **웹1123 통과/1skip**, TypeScript/Vite/Ruff/diff 통과. macOS 개발 환경 결과이며 Linux CI 결과로 바꿔 말하지 않는다. 웹 계약 테스트 일부는 루트 `.venv/bin/python`을 쓰므로 uv 동기화 후 실행한다.

**이번 Git 전달 스냅샷 독립 검증:** index에 포함된 파일만 별도 임시 폴더에 꺼내 Python **1049 통과/5skip/기존경고2(153.11초)**, 웹 **1120 통과/4skip**, 전체 Ruff·TypeScript·Vite 빌드를 재통과했다. 차이는 Git에 포함하지 않는 선택적 참고 PDF 스냅샷 테스트다. 제품 모듈이 실제 임시 checkout에서 import되는 것도 확인했다. Python/Node 의존성은 기존 설치본을 연결하여 재사용했으므로 새 머신의 네트워크 설치나 Linux 실행까지 검증했다고 주장하지 않는다. 영상 프로젝트 없이 제품 코드/계약 테스트와 빌드가 통과했다.

공유 index 전체548개 파일(약6.9MB)을 대상으로 비밀키/토큰/credential URL·고엔트로피16진수 패턴과 영상/DB/비밀파일 경로를 점검했다. 발견된 후보는 악성 URL 차단용 합성 테스트, 기존 Git 커밋 ID·프로젝트 식별자·합성 PDF 식별자로 분류했다. 실제 비밀키와 운영 데이터는 포함하지 않았다. 자동 패턴 검사가 범용 보안 인증을 대신하지는 않는다.

TEAM 최초 로컬 시험(새 임시 저장소, 운영 영구 데이터 경로 아님):

```bash
TB_LOCAL_STATE="$(mktemp -d /tmp/trialboard-handoff.XXXXXX)"
mkdir -m 700 "$TB_LOCAL_STATE/teams"
uv run python -m trialboard.api.team_bootstrap \
  --identity-db "$TB_LOCAL_STATE/identity.sqlite3" \
  --username changyu --team-name TrialBoard
uv run python -m trialboard.api --access-mode team \
  --identity-db "$TB_LOCAL_STATE/identity.sqlite3" \
  --team-storage-root "$TB_LOCAL_STATE/teams" \
  --enable-evidence-scout --enable-designs --enable-pdf-agent \
  --agent-provider dacon
```

bootstrap은 비밀번호를 비표시 입력받고 새 DB만 만든다. 기존 DB를 다시 bootstrap하거나 덮어쓰지 않는다. 별도 터미널에서 `cd web && npm run dev` 후 `http://127.0.0.1:5173`에 접속한다. 키 없는 기능/합성자료부터 확인한다.

실제 모델 시험은 명시적으로 동의한 공개·비민감 자료로만 한다. 제품 키는 서버 환경변수 `TRIALBOARD_DACON_API_KEY`, CLI `--prompt-dacon-key`, 또는 저장소 밖 소유자전용 비밀 파일을 `--dacon-key-file`로 명시 지정한다. 이 문서와 저장소에는 실제 키/비밀번호가 없다. 현재 크레딧 잔량은 이번 인수인계에서 조회하지 않았다.

추가 계정 CLI는 `uv run python -m trialboard.api.team_members --help`를 확인한다. reviewer는 검토 실행, viewer는 읽기 전용이다. 개인 모델 로그인 파일을 제품 서버로 옮기지 않는다.

## 5. 실제 도메인 최종 통과 체크리스트

- [ ] 새 브라우저 로그인·로그아웃·만료·잘못된 비밀번호와 CSRF 차단
- [ ] reviewer가 공개 시험 검색 → 허가한 자료 수집 → 선택 자료 권리 확인
- [ ] 별도 동의 후 Dacon 검토 1회, 인용 원문/실행 기록·사용량 확인
- [ ] 401/403/429/시간초과 때 오류 안내, 숨은 재시도·개인 공급자 fallback 없음
- [ ] 질문·근거·사람 메모 Markdown 다운로드 내용 확인
- [ ] PDF 저장 권리 → exact 버전 열기 → 원문/필드 확인
- [ ] 실제 배포 도메인에서 설계 가정 입력·결정론적 비교·KOL 기록까지 완주
- [ ] 프로젝트 저장 → 서버 재시작 → 같은 계정 복원, 다른 팀/제한 사용자 접근 차단
- [ ] viewer 쓰기/모델 요청 차단, 권한 철회 후 새 읽기·쓰기 차단
- [ ] Linux PDF 서버 준비를 사용할 경우 추출·인용·비정상 PDF/시간 제한 검사
- [ ] 모바일·PC 글자/버튼·오류 경로 확인
- [ ] 프런트 번들/로그에 비밀정보 없음, 비용·동시 실행 제한·백업 복원·롤백 확인

API 호출 테스트는 토큰을 소비한다. 대규모 자동 반복 대신 작은 공개 허가 사례 하나로 시작한다. `scripts/dacon_worker.py`는 개발용 대회 호출을 금지하도록 차단되어 있으며 재활성화하지 않는다.

## 6. 지금은 남겨도 되는 것

예약 갱신/재시도 큐, 조건부 캐시, 여러 문서·코호트 자동 병합, OCR, 초기 scout 목적별 권리 확장, 관리자 관리 UI 고도화, 전면 접근성 개선. 전문가 정답·치명 오류율·임상/통계 독립 평가는 실제 서비스 주장 수준에 맞춰 별도로 해야 한다.

구현 완료와 배포 완료, 테스트 통과와 임상 정확도를 혼동하지 않는다. 제안서 전체 계획 추정79%±10%p는 주관적 추정이며 출시 보증이 아니다.

## 7. 같이 읽을 문서 / Git 포함 범위

- [최신 연결 흐름과 QA](TEAM_REVIEW_FLOW_2026-10-01.md)
- [개인 개발 최신 상태](PERSONAL_DEVELOPMENT_PROGRESS_2026-10-01.md)
- [다음 작업](NEXT_TASKS.md), [인수인계](SESSION_HANDOFF.md)
- [제품 API 사용 원칙](API_USAGE_POLICY_2026-10-01.md)
- [팀 협업](TEAM_COLLABORATION_2026-09-30.md), [프로젝트 이용조건](PROJECT_USAGE_POLICY_2026-09-30.md)

제품 Python/웹 소스·lockfile·테스트·제품 문서를 포함한다. 영상 프로젝트·촬영/더빙 원본·렌더 출력·개발자 실DB·키·로컬 로그·node_modules는 포함하지 않는다. `web/scripts/check-*-ui.mjs` 일부는 작성 당시 로컬 Chrome/영상 작업용 Playwright 경로를 사용한 보조 QA다. 새 컴퓨터에서 그대로 동작한다고 보장하지 않으며 실행하려면 해당 경로/별도 Playwright 환경을 조정한다. 제품 실행과 위 단위/계약 테스트에는 영상 폴더가 필요 없다.

# 수집에서 검토·원문·회의로 이어지는 흐름

2026-10-01. 기능 흐름 연결 우선, 세부 확장은 보류한다.

## 이번에 연결한 사용자 행동

1. TEAM 자료 수집 완료 또는 최근 조사 기록에서 검토할 출처를 최대 8개 선택한다.
2. 선택한 텍스트·연결 원본에 공통으로 적용되는 허가 근거와 사유를 입력하고 각각 확인한다. 기존 SOURCE/RAW 정책 API에 순차 기록한다. 내부 검색·학습·PDF 조건은 자동 변경하지 않는다.
3. 다음 화면에 선택 자료가 유지된다. **별도 AI 전송 동의** 후 저장 자료 검토를 요청한다. 새 수집·PDF 다운로드는 하지 않는다.
4. 결과의 인용·해석·질문을 읽고 ‘KOL·원문 연결 정보 확인’을 누른다. 현재 권한과 원문 결속을 다시 검증하는 읽기 전용 handoff다.
5. 회의 메모를 작성하고 질문·인용·출처 지문·사람 메모를 한 Markdown으로 내려받는다. 메모는 탭 메모리이며 자동 서버 저장이 아니다.
6. 선택 출처의 시험·약물 문맥을 원문 검토로 넘긴다. PDF 연결이 있으면 저장 버전을 명시 선택하여 exact cached GET으로 연다. 저장본이 없으면 기존 PDF 이용조건 화면에서 저장하거나 허가된 보유 PDF를 직접 선택한다.
7. 실제 브라우저 PDF.js 원문 → 수동 필드 확인 → 설계 비교·KOL의 기존 경로로 이어진다. 수동 설계의 약물·적응증·시험 입력은 전달된 문맥으로 초기화하며 사용자가 수정할 수 있다.

AI 서술을 사건 수·분모·확정 관측값으로 자동 변환하지 않는다. PDF 연결은 동일 시험·코호트의 임상 확인이 아니다. 잘못된 숫자를 만들어서 끝까지 자동 실행하는 흐름은 추가하지 않았다.

## 구현 위치

- `TeamReviewWorkflow.tsx`, `team-review-flow.ts`: 공통 선택/허가/재검토 연결. 순차 CAS 부분성공 수와 재확인 안내, 자동 재시도 없음.
- `SavedResearchReview.tsx`, `SavedReviewNextSteps.tsx`, `saved-review-handoff.ts`: 선택 유지, 명시 AI 요청, 엄격 handoff reader, 회의 Markdown, 원문 이동.
- `TeamCollectedPdf.tsx`, `PdfWorkspace.tsx`: PDF metadata → 파일 버전 선택 → 권리 재검증 cached GET → 제한 크기/SHA 확인 → 실제 원문 화면. durable ScoutContext 계약 변경 없음.
- `AutoReview.tsx`, `ResearchPanel.tsx`, `ReviewNavigation.tsx`, `main.tsx`: 수집/이력 진입 연결. 기존 전체 Collection 읽기가 미허가 비선택 자료로 막히더라도 선택 검토 경로로 들어갈 수 있다.
- `LocalDesignRunner.tsx`, `DesignPanel.tsx`: 수동 계산 문맥 초기값 연결. 계산 알고리즘·숫자 검증·동의 조건은 유지한다.
- 서버 handoff와 계약: `DEVELOPMENT_PERSONAL_FLOW_2026-10-01.md`, `RESEARCH_SAVED_REVIEW_HANDOFF_CONTRACT_2026-10-01.md`.

공통 허가 저장과 AI 검토 중 상위 재수집/닫기/선택 변경을 잠근다. 캐시 PDF GET 중에는 기존 PDF 편집·교체 영역을 inert로 두고 프로젝트 작업도 잠근다. 자식 독립 읽기 감사에서 발견한 잠금 누락을 부모가 보완했다.

## 검증

- 부모 전체 Python: **1,054 통과**, 기존 경고 2개, 146.87초. 실제 서비스 호출 없는 테스트.
- 전체 웹: **1,123 통과 / 1 건너뜀**. 신규 흐름 helper 5개와 실제 TEAM 임시 DB→fake provider→handoff→엄격 TypeScript reader 5개 포함.
- TypeScript, Vite 빌드, Ruff, `git diff --check` 통과.
- 신규 `web/scripts/check-team-review-flow-ui.mjs`: 실제 React/AccessShell을 1440·390px에서 실행. 합성 허가 POST 2회 → 명시 fake review 1회 → handoff GET → 회의 Markdown 실제 다운로드 → 선택 PDF GET → 복수 버전 선택·권리 철회 차단 → **실제 PDF.js 워크스페이스와 필드/설계 탭** 연결. 정책 저장/AI 대기 잠금 및 PDF GET 중 편집 잠금 확인. 화면 넘침·pageerror 없음.
- 최종 신규 화면 기록을 모바일 결과와 PDF 화면에서 직접 검토. 합성 PDF에 테스트용 주석만 추가한 바이트를 사용했다.
- 기존 수집 UI 자동·수동·viewer·늦은 취소·예상 밖 AI 이벤트, 저장 검토 UI 충돌·취소·권한 회수·불확정 사용량 회귀를 각각 1440·390px에서 통과했다.
- 중간 QA 실패: 초기 shell의 예측 가능한 GET을 fixture에 누락한 신규 스크립트와, 상세 설정으로 이동한 버튼을 숨겨진 상태로 찾던 이전 수집 스크립트. fixture/선택자를 보완 후 재통과. 제품 검사를 완화하지 않았다.

이 검증은 모형 응답·합성 PDF 기반이다. 실제 외부 모델 결과의 품질이나 실제 도메인 전체 계산 완주를 검증한 것이 아니다.

## 알려진 한계

- 배포·도메인·기존 서버 설정은 변경하지 않았다. 공개 서비스는 프런트 파일만 올리는 것으로 완성되지 않는다.
- **일부 계산 경로는 현재 로컬 전용이다.** `design-client.ts`의 허용 origin은 localhost/127.0.0.1:5173, 서버 계산 capability도 LOOPBACK_ONLY다. 원격 심사 링크에서 같은 계산을 실행하려면 HTTPS/인증/Origin/서버 경계에 맞춘 별도 호스팅 연결 보완이 필요하다. allowlist 제거·Host 위조로 우회하지 않는다. 단순 '미검증'으로 축소하지 않는다.
- macOS 서버 PDF 파서는 UNSUPPORTED_SANDBOX 차단을 유지한다. 브라우저 원문·수동 필드 경로와 별개이며, Linux 서버 준비/AI PDF 경로는 해당 환경에서 확인해야 한다.
- 대회 API 실호출 없이 검증했으므로 실제 모델 응답 성공 여부는 별도 확인이 필요하다.
- 예약 갱신/재시도 큐, 조건부 캐시, 다문서·코호트 자동 병합, OCR, 초기 scout 목적별 권리 확장, 독립 임상 평가·운영 보안 점검은 남긴다.

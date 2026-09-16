# TrialBoard 세션 인수인계

저장일: 2026-09-16. 목적: 앱 종료/재시작 또는 새 대화 뒤에도 작업을 처음부터 반복하지 않고 이어간다.
이 파일은 작업에 필요한 결정·상태·다음 행동을 기록한 것이다. 대화 전체나 브라우저의 미저장 편집을 자동 백업한 것은 아니다.

## 가장 최근 사용자 요청과 확인

2026-09-16 최신 요청: 최신 작업 전체 Git 업로드 + 실행 방법/구현 현황 README 정리.
루트/웹 README를 현재 기능 기준으로 재작성. Node24/Python3.12, 두 서버 실행, MOC/AI 구분,
현재 Codex CLI0.154.0 제한, 데이터 비공유/정적 빌드 한계/미완료를 명시했다.
재검사 Python486/웹750/build/Ruff 통과. MUI use-client/큰 청크/테스트 deprecation 경고는 유지.
이후 추가 요청: 개발 Codex는 유지하고 제품 에이전트 실행만 대회 API로 전환. 별도 후속 변경으로 진행한다.
기존 구현 전체77%/기업25% 유지. 아래 ‘미커밋/push 없음’은 이전 작업 당시 기록이다.

아래는 직전 기능 구현 기록이다.

2026-09-16 최신 사용자: ‘다음 작업 알아서 계속 진행해봐’. **전체77%/기업25% 유지.**
[SUPPORTING_CITATIONS.md](SUPPORTING_CITATIONS.md): 필드의 같은 페이지 보조 인용1–4개/역할/원문 이동/추가·제거 사유 이력.
- `pdf-field-review/2`에서 optional supporting 허용, v1 완전 호환/빈 배열을 구버전 dump에 추가하지 않음.
- Python 재검증 source 대조+모델 입력 span 보존, 재검토 prompt2/field_context_citations에 채택·확인 필드만 전달.
  shared critique_payload로 설계 AI hash 대조 일치, 브라우저 결과 reader1/2지원. 최초 추출 output/단일 값 literal 조건은 유지.
- JSON/프로젝트 저장/필드·회의 Markdown 연결. 다중 근거 있는 행은 일괄 확인 금지, 개별 필드에서 확인.
- 웹750/Python486/build/Ruff/diff 통과. 신규 웹7/Python12, Python→브라우저 결과 교차 검사와 임시 DB v2 복구 포함.
- 실제 FDA v3 p19-i41→p19-i42 주변 문맥 연결/원문 이동→제거 확인,1365/390px 가로넘침 없음/모바일 버튼44px.
  확인 기록·새 실자료 프로젝트 버전은 남기지 않음. 모델0회, 대회 키 미사용. 종료 화면 FDA 필드 검토p19, viewport override복구.
- API 최신 코드로 재시작 PID48750/exec8303,127.0.0.1:8000, 기존4flag. Vite5173 유지.
- 기존 WIP 전부 보존. 이번 커밋/push/배포/새영상 없음. 큰 청크·테스트 의존성 경고 유지.
- 다음: 분리 숫자/단위의 원문 인용을 보존하는 정규화 값 계약. 이번 구현은 보조 문맥만 연결하며36→36% 자동 조립이나 임상 검증이 아니다.

아래는 직전 UI 보완 기록이다. 최신 API PID/테스트 수/기능은 위를 우선한다.

2026-09-16 최신 사용자: ‘계속 진행해. 배너랑 버튼들이 붙는 경우 점검하고 다음 작업’.
**전체77%/기업25% 유지.** [UI_SPACING_INPUT_CHECK.md](UI_SPACING_INPUT_CHECK.md) 구현/화면 검사 완료.
- MUI 공통 배너/모바일 동작/확인창 간격, PDF 에이전트 직접 자식20px, 설계/범위 대조16px, 수집 입력20px.
- 전송할 정확한 문구만 로컬 표현 검사: 시험·약물·비율·분모·기간, 여러NCT 경고, 원문 이동. 명시적95% CI는 결과 비율에서 제외. 임상 승인/표 해석/실행 점수가 아님.
- 실제 FDA v3 복구 후 p18시험 식별, p8다중NCT, 원문 이동, p19-i73±6의13문구에서 분리 단위 안내 확인.1365/390px 스크린샷과 가로 넘침/배너 동작 배치 검사.
- 출처 복귀 중 ‘기록 여는 중’ 표시를 새 검색과 분리. 새 외부 검색/모델0회, 저장본 변경 없음.
- 기존 MOC v2의 KOL8질문/메모1 복구도 유지 확인. 종료 전 FDA v3로 복귀, viewport override 해제. 기존 API/Vite 유지.
- Python474/웹743/build/Ruff 통과. 기존 큰 청크/테스트 의존성 경고 유지. 기존 WIP 보존, 커밋/push/배포/새영상 없음.
- 다음 핵심은 아래 표 단위·각주 다중 문구 계약이다. 이번 준비 카드는 그 계약을 대신하지 않는다. 후보 선택/펼침 상태는 프로젝트 저장 범위 밖.

아래는 직전77% 단계 기록이다. 최신 검사 수와 이번 변경은 위를 우선한다.

2026-09-16 최신 사용자: ‘다음 작업 진행해. 쭉 해봐 진행률90퍼까지’. **현재77%, 목표90% 미달.** 기업25% 유지.
이전 git HEAD/origin `3796935` 이후 이번 변경은 미커밋. 사용자 요청에 새 push/배포는 없어 수행하지 않음. 기존 파일/DB/프로젝트 모두 보존.

- [EVIDENCE_SCOPE_WORKFLOW.md](EVIDENCE_SCOPE_WORKFLOW.md): 수집 출처 복귀/ID 대조, PDF 로컬 후보+설명+분류(임상 검색 순위 아님), 앞뒤2/6문구/기존40문구 한도, 관측 적용 범위 대조·원문 이동·JSON/회의 Markdown, 중단 RUNNING기록 정리+늦은 쓰기 차단.
- 실시간 보드에 최신 추출 초안 별도 카드/주요 검사 코드 한글 설명 추가. 추출값이24개 로그 밖으로 밀려나도 확인 가능. 이 마지막 보드 변경은 단위검사/빌드만, 새 라이브 UI 실행 검사는 남음.
- 실제 UI FDA문서 `fda_54960f08dcc799b9`,26페이지/SHA `231b4a8717fdea8107777bd5629f69192279cd4b9f5db7b92e1d9b9a4b1950a4`.
  기존 연구 `b7bc5371-f160-4193-9858-9070ff8ea9c4`에서 다운로드→뷰어→후보→로그인 모델 실행.
  첫 실행 `bbd71957-6cdd-413c-bd1f-5af45e29bca6`:19문구/2요청/화면16초/관측0/부분보류.
  두 번째 `6b089669-36a0-4152-b9e2-1eb180c16166`:39문구/2요청/화면78초/최종초안3/채택0/쟁점24/부분보류. 반론 모델 호출까지 진입 못함.
  표의 단위가 분리되고 맥락/시점이 부족한 실제 한계다. 비교 계산 성공·임상 성능 검증으로 계산하지 않는다.
- 실제 프로젝트 `ed7acdbe-98ad-47e3-8bec-030c6be12504`, `FDA 실제 문서 · 출처·후보·인계 QA`, v1원문/v2첫실행/v3두번째초안+원본 실행+수집 맥락 저장.
  HMR 새로고침 뒤 v3복구·초안3/미확인 상태·대조표→원문p18/19·정확한 조사/문서 복귀·대조표 JSON/MD 다운로드 검증.
  Downloads `trialboard-pdf-agent (1).json`, `(2).json`, `trialboard-evidence-scope.json/.md`는 로컬 재현 자료. Git에 넣지 않음.
- 실자료에서 긴 선택값의 필드 잘림과 PDF sticky 부모 문제 발견/수정.1365/390px 전체 가로넘침 없음, 모바일 표 내부 스크롤. MOC전환 시 행/지문 교체 중 대조표 예외를 표시용 연결 필터/지문 대기로 수정했다.
- 기존 MOC프로젝트v2복구→관측4/질문8/메모1 유지, 회의 Markdown에 범위 대조 추가됨. 다운로드 `trialboard-meeting (2).md` 확인. 새 계산/새 임상 평가 아님.
- 자동 검사 Python474/웹736/build/Ruff. 빌드 큰 청크, Starlette/httpx/anyio deprecation 경고는 남음. 새 독립 평가/최종 영상/팀 인증/운영 배포 없음.
- 기존 CLI 로그인만 모델4요청 사용. 대회 키/인증 파일 접근 없음. Sites 지침대로 기존 MUI UI 개선, 별도 사이트 배포 없음.
- API 재시작 PID50690/exec4571,127.0.0.1:8000/기존4flag 활성. Vite5173/PID99507 유지. Chrome브라우저1/탭1907030730. 실제/MOC프로젝트 DB는 Git제외.
- 다음: 표 단위·각주·줄바꿈 다중 문구 인용의 계약부터 보완. 임상·독립평가4/20이므로 현재 가중치에서 코드만으로90% 완료라 할 수 없다.

아래는 직전 요청/작업 기록이다. 최신 진행률·API PID·검사 수는 위를 우선한다.

2026-09-16 최신 사용자: ‘깃 한번 업로드해. 그리고 다음작업 진행해.’
기존 WIP를 `994c726` core / `ba23348` web / `495daa8` docs로 분리해 origin/main에 push 완료.
다음 [RESEARCH_LINKAGE.md](RESEARCH_LINKAGE.md)의 시험·코호트 연결 사전 점검을 구현. **전체75%, 기업25% 유지.**

- `research-linkage.ts`, `ResearchLinkage.tsx`: 기존 다중 출처 조사에 ‘시험·코호트 연결’ 탭.
  title/text만 NCT와 지정 코호트 표현을 검사. 약물 규제 문서 별도 분류, 원문 인용/확인 질문/검토 이력 이동.
  method TEXT_METADATA_RULES/1, clinicalVerified:false. 새 모델 호출/자동 제외/설계 차단 해제 없음.
  JSON export, 기존 검토 Markdown에 동일 사전 점검 추가. DB 스키마·원본·AI 해석은 바꾸지 않음.
- sotorasib 기존86근거: 선택NCT8/여러NCT2/다른NCT2/등록부연결0/규제12/미확보62.
  UI 다른NCT2 필터→NCT05221372 인용/질문→해당 PubMed38507877 원문/검토 화면 이동 확인.
  390px viewport에서도 가로넘침 없음, override복구. 브라우저1/탭1907030730, 종료시 여러NCT 필터.
- 웹18개 추가, 전체703통과. Python469·build·Ruff 통과. Vite 빌드의 큰 청크 경고는 남음.
  Git 후보 비밀/대용량 파일 점검, 로컬 DB/영상 제외. 웹사이트 배포·새 시연 영상 없음.
- API/Vite와 MOC 프로젝트는 아래 저장·복구 단계 상태 유지. 이번 사전 점검에 추가 모델/대회키 사용 없음.
- 다음: 원문 관측값에 실제 코호트/분석집단/시점 연결→사용자 확인→설계/차단/KOL→통합 저장의 실자료 UI 완주.
  문구 사전 점검을 자동 임상 검증으로 부르지 않는다. 전체80%와 독립 임상 평가는 아직 미달.

아래는 같은 날 프로젝트 저장 단계의 이전 기록이다. ‘커밋/push 없음’은 당시 상태다.

2026-09-16 최신 사용자: ‘다음 작업 진행해’. [PROJECT_CHECKPOINTS.md](PROJECT_CHECKPOINTS.md) 구현.
**제안서 전체 약75%, 기업25% 유지. 목표80% 미달.**

- 새 `trialboard/api/projects.py`, `ProjectShelf.tsx`, `project-checkpoint.ts`, Python16/웹12 추가 테스트.
  기존 `--enable-evidence-scout` opt-in. POST/GET `/api/projects`, GET `/{project_id}/{revision}`.
  SQLite `project_pdfs` hash중복제거, `project_checkpoints` append버전/expected_revision409.
- 원본 PDF·원문 메모·필드 이력·미완성 설계·현재 비교/KOL·필드에 인계한 최초 agentRaw·검색/문서 맥락 참조.
  저장·복구 동의/교체 확인. 원문 재추출→strict 필드/초안/회의 reader 통과 후 전체 교체.
  저장과 모델 호출 전역 알림을 구분. 새 모델 호출 없음. 대회키/인증파일 읽기 없음.
- 미기록 필드/원문 메모/KOL 편집, 오래된 결과, 버전 충돌 차단. 과거 버전은 별도 프로젝트 복사 가능.
  AI 재검토 패널/계산기 수동 첨부/CSV·별도 브리핑/임시 실행 화면은 저장 제외를 UI에 고지.
  설계 JSON 교체 확인을 native confirm 대신 MUI Dialog로 변경했다.
- 실제 UI: MOC PDF→v1→MOC필드/설계→실제로컬계산→KOL8/메모1→v2.
  서버 재시작+브라우저 새로고침 후 원본/필드/설계/회의 복구, 메모 내용까지 대조.
  미기록 메모 차단, v1열기→별도복사→기존v1/v2유지 확인. PDF 캔버스,1365px/390px 가로넘침없음.
- MOC주프로젝트 `1c6e8107-6d71-4c6f-bb24-c2f50ec45c08`, 제목 `MOC · 프로젝트 복구 점검`.
  v1빈초안, v2설계/회의. 추가 `MOC · v1 복사본 점검` 프로젝트. Git제외DB에 저장.
- 전체 Python469/웹685/build/Ruff/diff검사. 기존 WIP 전부 보존. 커밋/push/사이트배포/새영상 없음.
- API PID52908 / exec57585,127.0.0.1:8000. 기존4flag활성. Vite5173/PID99507 유지.
  Chrome브라우저1/탭1907030730. 종료시 MOC주프로젝트v2 복구 화면, viewport override복구.
- 다음: 동일 시험/코호트 연결 강화→실수집PDF→관측/차단/KOL/통합복구 전체 실자료 UI.
  이 MOC 복구와 전날 실자료 모델 검사를 합쳐 ‘실자료 전체 자동 완주’로 주장하지 않는다.

아래는74% 단계의 이전 기록이다. 최신 API PID/저장 범위는 위를 우선한다.

2026-09-15 최신: ‘진짜 에이전트처럼 광범위 검색/DB, 실제 연결, 다시80%까지’ 요청.
[DEEP_RESEARCH.md](DEEP_RESEARCH.md) 구현. **제안서 전체 약74%, 목표80%는 미달, 기업25% 유지.**

- 새 `trialboard/research/` (models/store/collect/agent) 및 `/api/research` 라우터.
  CT.gov 참조 PMID/문서 + Europe PMC/PubMed 초록/서지 + Drugs@FDA 문서 링크.
  AI 계획→실제 후속 검색→인용문 대조 검토. 기존 Codex 로그인2요청, 고정/PDF와 슬롯1 공유.
- SQLite: 기존 snapshots/searches 보존, source_versions/research_runs/research_sources/research_links/FTS5,
  공개 PDF bytes/다운로드 영수증, 출처 지문+revision에 묶인 근거 포함/제외/추가 확인 사유.
  원본/AI 검토는 수정 안 함. 미인증 표시명, 원문/코호트 임상 검증 아님.
- `ResearchPanel`, `ResearchActivity`, `ResearchCuration`, `research*.ts/.css`: 브리핑/근거 DB/조사 기록,
  초기 계획과 당시 부족한 근거, 실제 경과시간/이벤트, DB 검색, 판단 이력 저장/충돌 검사.
  다른 프로젝트 저장 기록 열면 상단 검색/시험/약물/적응증 함께 복원. PDF 공용 원문 뷰어로 인계.
- 실제 sotorasib 조사 `b7bc5371-f160-4193-9858-9070ff8ea9c4`:86근거(73논문/12PDF링크/1등록),
  2모델요청102.85초,8검토/6KOL. 초기62→후속86, 새 후속 자료를 최종 입력에 포함.
  usage 입력27474/출력2721. 전체 계정 잔량/과금값 아님. 새 대회키·인증파일 접근 없음.
- 실제 osimertinib 조사 `d465bff5-962e-444b-8cdc-2cc7f3e67390`:67근거(53/13/1),3.84초,모델0.
  등록정보에 UI 점검자의 ‘추가 확인’v1을 DB 저장. 전문가 평가/임상 검증 기록 아님.
- FDA2025-02-24 Letter `fda_2863ae10dd3f1197`:226594bytes/5페이지,다운로드→DB→SHA대조→PDF렌더확인.
  SHA22d64728ea6289bd7fef7ba543bb2080a389d657929f3088ce26b745fd0ede8f. 같은 조사 재열기는 캐시.
- Python453/웹673/build/Ruff. 첫 Python전체는 기존 macOS killpg PermissionError1회;
  개별+전체재실행통과, 원인해결은아님. 동시슬롯/인용불일치/URL/버전/캐시/FTS/판단충돌 회귀검사추가.
- 브라우저1/탭1907030730,127.0.0.1:5173. 실제 모델완료→저장복원→FTS960검색8건→FDA뷰어확인.
  최종 UI390px 브리핑가로넘침없음·인용출처이동·조사기록복원·다른약물맥락복원확인,viewport복구.
  기존MUI/Sites지침유지. 이번에 새 영상·커밋·push·사이트배포 없음. 모든 기존WIP보존.
- 중요한남은연결: 수집/PDF다운로드DB와 기존 PDF관측/필드/가정/회의JSON저장은아직분리.
  검색→모든 PDF전문자동해석→검증된설계추천의 완성판아님. 마지막 실자료 전체UI완주/통합복구필요.
  강제종료시RUNNING기록복구처리, 독립임상/통계평가,최종영상/제출미완료.
- 최신 실행모델 이후 프롬프트의 NCT귀속제약을 강화했으나 추가모델호출은하지않음.
  화면/Markdown은 AI해석이선택NCT를언급하지만확보문구에없으면별도경고. 임상적 의미검증아님.
- 종료 시 API PID1712 / exec1561,127.0.0.1:8000,4개flag 모두활성. Vite5173기존유지.
  서버재시작후 동일FDA문서 캐시HIT/226594bytes/지문일치 확인. 새 외부 다운로드·모델호출 없이복원.

아래는60% 단계의 이전 기록이다.

2026-09-15 최신: 사용자 ‘약물명으로 자동 수집이 제안서에 없었나?’ → 원문에 Evidence Scout/DB가 핵심임을 확인.
‘맞아. 이어서 작업해봐 확실하게 멋지게’에 따라 [EVIDENCE_SCOUT.md](EVIDENCE_SCOUT.md) 구현.
**전체 제안서 기준 약60%로 재산정**. 이전78%는 자동 수집·lineage 미구현을 과소 반영한 추정이라 정정. 기업25% 유지.

- 새 첫 탭 EvidenceScout: 약물/개발 코드/NCT → 공개검색 동의 → 실제 CT.gov 최대20건 수집 → SQLite.
- `trialboard/api/scout.py` opt-in, 고정 외부호스트/시간·크기 제한, strict 정규화, NDJSON 실제단계, 실패/빈결과/부분수집 구분.
- `output/evidence/trialboard.sqlite3` 원본snapshot SHA256중복제거+append검색receipt. Git 제외.
- 웹 `EvidenceScout.tsx`, `evidence-scout.ts/.css`. strict stream/receipt reader, 최근기록복구/JSON.
- SourceWorkspace→PdfWorkspace→PdfAgentRunner에 선택 맥락 전달. PDF에서 명시적 ‘검색 맥락 적용’.
  입력 NCT를 약물명으로 자동사용 안 함. 복수 중재면 약물 지정 필요. 기존 생성 모델기록/검토 상태 자동교체 안 함.
- 실UI: NCT03600883 한건 및sotorasib 일치72건 중20건 저장. 서버재시작 후 기존NCT복구→sotorasib 지정→PDF진입 맥락 확인.
  390px 첫 화면 넘침없음. 맥락 적용 후 실제동일PDF모델/전체접근성/모든오류·중단UI는 미검증.
- Python433/웹645/build/Ruff/diffcheck 통과. 웹첫전체실행은PATH에서uv를제외한실행환경으로실패;
  기존PATH+Node24절대경로로재실행645통과. 테스트스펙또는제품결함으로숨기지않음.
- 모델 호출0/대회키·인증파일 접근0/커밋·push·사이트배포0. 기존WIP전부보존.
- API PID12859/exec60413,127.0.0.1:8000, 기존3flag+`--enable-evidence-scout`. Vite5173기존유지.
  Chrome1/탭1907030730 사용. 재개 시 URL/제목 대조. DB는남지만 선택/PDF/모델작업은기존메모리·JSON정책.
- 다음핵심: 선택시험 공개문서/논문수집 + 동일시험/버전연결 → 기존원문에이전트통합.
  현재CT.gov등록정보첫슬라이스이지 전자료자동DB/자율설계/규제미팅업무완성 아님.
- 종료 전 viewport override 복구, 같은 탭 새로고침 뒤 빈 입력창/최근 저장2기록 유지 확인, markDeliverable.
  마지막 주요평가변수 표시개수·1초미만 문구 수정 후 최종 build/Ruff/diffcheck 통과. 새 영상 없음.

아래는 이전 기록이다.

2026-09-15 최신: 사용자 ‘약85%까지 계속, 전체 흐름/UI/와우/실시간 에이전트 상태가 핵심’ 요청.
[PDF_LIVE_WORKFLOW.md](PDF_LIVE_WORKFLOW.md) 구현. 현재 전체78%/기업25%,85%는 미달이며 수치 임의 상향하지 않음.
주요 파일: PdfAgentRunner/pdf-agent, LiveWorkbench/live-workbench, RowReview/row-review,
EvidenceAssumptionDialog/evidence-assumption, design-handoff, api/agent_demo의별도PDFroute,
engine의bounded progress items/HANDOFF 조기 종료, design_compare의최초 AI 비교 한계 차단 유지.
FieldReviewPanel→DesignPanel→LocalDesignRunner 원본실행자동연결. MUI 앱내교체확인창(기존native confirm 대체).
SourceWorkspace PDF기본. AgentBriefing은탭이동시unmount하지않아실행/기록유지. App전역실행알림,PDF전체화면보드 추가.

검증: 웹631/Python414(전체 재실행 통과), Ruff. 처음 Python 전체 실행에서 기존 codex_provider 출력파이프정리test가
macOS killpg PermissionError 1회; 개별+전체 재실행은 통과. 원인 해결로 주장하지 않는다.
실제PDF모델 실행 3회 시작: 첫 회는 HMR로최종저장전상태유실, 둘째53초응답은locator:null정규화누락으로
최종input hash검사차단, 수정+Python정규화왕복test추가 후 셋째2요청58초완료.
최종실행83fc659b-298e-49ab-b700-c224b14c5dce: 4관측/2반론/3질문/PARTIAL_ABSTENTION.
저장 `/Users/ryul/Downloads/trialboard-pdf-agent.json`; 원문 `/Users/ryul/Downloads/trialboard-pdf-evidence.json`.
전후추정usage는기록완료된요청만확인가능. 대회키·인증파일접근·공급자전환없음.

실제UI 인계는native확인창CDP정체로미완료였고, MUI확인창으로고친뒤별도합성scripted UI에서
취소/확정→4관측44보고필드확인(사유MOC자동점검)→원본자동연결→MOC가정준비→B반응0.32→0.40
출처/이유변경→60/120명2계산(45.7/51.6%,차이5.9%p,MC SE2.2%p)→KOL7질문/메모1/JSON·MD저장완료.
실행8e696dfe-a88d-4184-975f-a3231c1e43df. Downloads `trialboard-meeting (1).json/.md`,
`trialboard-field-review.json`, `design-brief.json`. restoreMeetingSession/Markdown정확일치.
390px KOL가로넘침없음확인,viewport복구. 그후UI소스수정(HMR)로화면메모리초기화가능,파일은저장됨.

저장실제기록의자동전체검사:
`node web/scripts/check-live-pdf-handoff.mjs /Users/ryul/Downloads/trialboard-pdf-agent.json /Users/ryul/Downloads/trialboard-pdf-evidence.json`
결과 `output/live-pdf/handoff-QmTHXA`: 확인→근거참고가정→최초반론차단(계산0)→KOL8질문→회의메모/복구완료.
확인이력은합성자동기록이며 실제사람/전문가아님. 추가모델0. 정상UI계산과실제기록차단경로를혼동하지말것.

API최신 PID54840/exec68610, `--enable-designs --enable-agent-demo --enable-pdf-agent`,127.0.0.1:8000.
Vite5173유지,Node24필요. Chrome1 최신QA탭1907030730(markDeliverable),이전실제탭1907030720확인창정체.
NativeChrome이계속다른사용자업무창을반환하므로다른창조작안함. 새탭extension제어로MOC확인성공.
최신전체화면보드/전역알림/rowtable높이조정후실행화면QA는아직미완료. 커밋/push/사이트배포없음.
다음은 NEXT_TASKS상단. 새시연영상은이번에녹화하지않았다.

아래는 이전 기록이다.

2026-09-15 최신: 사용자가 기존 영상의 불명확한 클릭·긴 대기를 지적, 실제 기능 개발 우선 요청.
재녹화는 미루고 [의사결정 브리핑](DECISION_BRIEFING.md)을 첫 탭으로 구현했다.
근거 수정 대조→별도 합성 설계 계산→조건별 회의 의제, 실행별 메모, 최대4회 작업 JSON 저장/복구.
웹575/Python401/build/Ruff, 실제 Chrome2회 계산·가정변경 잠금·메모 분리·다운로드 확인.
다운로드 JSON reader복구/Markdown 정확 일치. 새 파일 재업로드 UI/모바일은 미검증.
종료 경고 추가 후 HMR로 시연 상태 초기화됐지만 파일은 먼저 저장·검증했다.
새 로컬 탭1907030715/Chrome1, 기존 getTab조회 시간초과를 새 탭으로 해결. 대회키/새모델/커밋/push/배포 없음.
본선72%/기업25% 유지. 이전 영상은 최종 발표본으로 승인받은 것이 아니다.
다음: 실근거→사용자 확인 가정 연결 확장, 실제 오류/보류 사례, 복구 클릭/접근성, 목적 설명을 넣은 재녹화.
아래는 이전 기록이다.

2026-09-15 최신: MOC 전체 흐름·화면 하단 표시·직접 영상 녹화 완료. [상세](MOC_DEMO_RECORDING.md).
`MocDemo.tsx`, `moc-data.ts`, `moc-demo.css`, `DemoRecorder.tsx`. 고정 합성 PDF/3개 JSON을
기존 importer로 연결, SHA-256 검증, 테스트6개 추가(웹548/Python401/build/Ruff).
자료 검토→PDF→추출 기록→자동 확인 fixture→두 설계×두 가정 실제 계산→KOL8질문→가상메모1→JSON/MD 저장을 브라우저에서 완료.
저장 파일 reader복구/Markdown 정확 일치 검사. 브라우저 파일 재업로드 복구는 미검증.
전체 영상 `output/video/trialboard-moc-full.mp4` 236.25초, 편집본 `trialboard-moc-demo.mp4` 약181초.
원래 WebM과 회의 JSON/MD는 Downloads. Chrome 기본 탭 캡처·무음·추가 AI 호출0·외부 전송0.
영상 후반 분모200→20은 별도 합성 스크립트 브리핑이며 PDF 실행 결과와 혼동하지 않는다.
새 자동전체검사 `output/pdf/moc-run-MOX7HtQJ` 관측4/계산4/질문8/보류차단/모델0.
확인창 CDP지연→같은 Chrome 정상 OK 버튼으로 완료. 녹화 대기40–95초 제외한 편집본, 배속 없음.
브라우저1/새 탭1907030708. 이전 탭 ID는 재사용됐으니 추정하지 말고 최신 탭 제목/URL 대조.
본선72%(주관적+2), 기업25% 유지. 기존 모든 WIP 보존, 커밋/push/사이트배포 없음.
다음: 문구/스크롤 동선 개선·해설/챕터 최종영상, 실제 회의 복구 클릭, 실자료 평가/제출환경.
아래는 이전 기록이다.

2026-09-15 최신: [실제 시연 준비/중단/실측](LIVE_DEMO_REHEARSAL.md). `demo-readiness.ts`와
LiveAgentRunner 준비 점검(GET only), 실제 경과 초, USER/TIMEOUT 구분, 명시적 저장 기록 전환.
집중 모드 중단 안내 누락 수정, 결과 없이 ‘직접 실행 결과’라고 표시하던 chip도 수정.
API `case_limits`를 실행과 동일 상수로 제공. 구버전 서버는 준비 미확인. 실제 공개 실행2회 중단 후
재실행 완료: 공개2요청, 브라우저52초, 서버추출24.7/반론52.2초, 관측2·반론3·질문3/PARTIAL_ABSTENTION.
실행bc730a40-629d-475b-9ff4-9f43632b8c8d, Downloads/trialboard-agent-record (1).json reader 검사 통과.
웹542/Python401/build/Ruff/diff check. 390px 가로넘침 없음, viewport 복구. 단일 실측/중단 점검이지
135초 전체 대기·네트워크 장애·전체 타이머 리허설 완료가 아님. 본선70%(데모+1), 기업25% 유지.
기존 API61373을 정상 종료 후 최신 설정으로 시작: PID38380/exec세션31437. 127.0.0.1:8000,
`--enable-designs --enable-agent-demo`. Vite5173 유지. 실제 로그인은 CLI 소유, 인증파일/대회키 접근 없음.
기존 Chrome1/탭1907030651 사용. 최신 결과를 다운로드한 뒤 유지. 커밋/push/배포 없음.
다음은 전체 발표 타이머 리허설/영상, 실제 오류/보류 사례 확대, 공식 제출 조건 재확인. 아래는 이전 기록.

2026-09-15 최신 후속: 발표가 최우선이라는 요청으로 브리핑 안에 ‘01 근거 검토 / 02 합성 설계 비교’를 연결.
`ScenarioBriefing.tsx`, `scenario-briefing.ts/.css`, 신규33개 테스트. `/api/reviews`에 기준/변경 두 합성 가정과
각 군30/60명,10,000회,seed42를 한 요청으로 전송. 공개 발췌값은 전달하지 않고 추가 모델 호출 없음.
입력/네 조합/확률 합/MC 오차 대조, 빈칸/범위/기준 동일 입력 차단, 이전 결과/질문 표시·저장 잠금.
가정에 따른 KOL 질문은 규칙 기반 표시. Markdown/계산 JSON 저장, 발표 모드, 1440/390px 화면 확인.
브라우저 실제 A55/B65 보류98.5%/99.8%, A12/B45 한계 초과 군 선택2.4%/0.6% 확인.
다운로드 `trialboard-design-briefing.md`, `trialboard-design-execution.json` (Downloads), 실행
11df6ce9-1642-4da9-862a-e0c0762db81c. 실제 reader/Markdown 일치 재검사. 서버 계산30.745ms(모델 시간 아님).
웹526/Python401/build/Ruff 통과. 본선 약69%(데모+1), 기업25% 유지. [시연 대본](DEMO_SCRIPT_3MIN.md).
새 모델 호출/인증 읽기/대회 키/커밋/push/배포 없음. 기존 서버와 WIP 유지.
기존 Chrome 탭1907030651/브라우저1 사용, viewport 복구. 새 모델2요청 시간·중단 실측과
실제 오류/보류 사례 확대, 타이머 리허설/영상이 다음 단계. 아래는 이전 기록.

2026-09-15 마무리: 발표 집중 모드(설정/주변 메뉴 접기)와 이벤트 트랙 방향키/Home/End를 추가하고
브라우저에서 확인했다. 전체 웹493개/Python401개/build/Ruff 통과. README/진행률/다음 작업 갱신.
기존 브라우저 탭이 닫혀 같은 로컬 주소의 새 탭을 열었다. 재개 시 새 탭 ID를 직접 조회한다.
브라우저 viewport override는 원래대로 복구했다. 기본/좁은 화면 점검은 전체 접근성 검증이 아니다.

최신: 사용자 요청으로 기업 협업보다 발표용 에이전트 가시성을 우선했다.
[에이전트 브리핑/실시간 실행](AGENT_DEMO.md)을 첫 탭으로 추가. 기존 기록 재생·실제 모델
실행·규칙 검사·반론·합성200→20 수정·원문·회의 질문을 구분해 표시한다.
고정 공개/합성 자료만 `--enable-agent-demo` + 화면 동의로 SSE 실행. 실제 공개 실행4요청,
98.1초, 관측2/반론3/질문3 수신과 JSON다운로드/reader재검사 통과. 이후 공개 자료는
반복을 없애 최대2요청/수정0회로 변경(설정 테스트, 시간 재측정 없음).
동시/중단 후 슬롯 반환 결함 수정. 기업 로그인·공유 편집/프로토콜·규제 전용 업무는 미구현.
Vite5173 기존 유지, API8000은 이번에 `--enable-designs --enable-agent-demo`로 시작했다.
API 최신 PID61373/exec세션81077(재개 시 상태 재확인). API를 공개로 노출하지 않는다.
새 결과: `/Users/ryul/Downloads/trialboard-agent-record.json`, run69abf3b9-c6fb-42b7-ae8f-0dafc61a1502.
Chrome 확장 브라우저 제어 사용 가능: TrialBoard 탭1907030421/브라우저1.
실행·원문·저장·390px 화면 확인. 파일 다시 열기 자동 점검은 확장의 파일 URL 접근 권한에 막혔다.
과거 native창 선택 반복 문제와 구분하며 미해결 권한을 우회하지 않는다.
대회 키·원격 배포·커밋/push 없음. 기존 WIP 보존. 이전 좁은 본선 기준 약68%로 추정(+2: 데모 가시성/실행).
기업용3업무 전체 완료율이 아니다. 다음은 가정 변경→설계 비교→질문 변화의 단일 시연 동선.
아래 기록은 이전 단계이며 위 내용이 최신이다.

최신 구현: [회의 파일로 전체 검토 복구](MEETING_SESSION_RECOVERY.md). 같은 PDF와 회의 JSON만으로
당시 필드 검토·설계·결과·KOL 이력을 모두 검증한 뒤 복구한다. 기존 형식을 재사용하며 새 AI/계산 없음.
`restoreMeetingSession` → FieldReviewPanel의 명시적 전체 교체 → DesignPanel의 새 세션 초기 상태로 연결했다.
일반 추출/검토 파일 교체 때도 기존 설계 세션을 초기화하고 이를 확인창에 명시한다.
미기록 필드 편집 시 메모/이력 JSON 내보내기를 잠근다. 신규9개, 웹456개·Python387개·build·diff check 통과.
실제 저장된 합성 meeting.json 왕복도 관측4/계산4/질문8/메모이력1 동일. 본선 약66% 유지.
화면 QA는 Chrome 창 메뉴로 TrialBoard를 찾았지만 이후 다른 사이트로 대상이 바뀌어 중단했다.
다른 창에 입력하지 않았으며 실제 클릭 QA 완료로 계산하지 않는다. 사용자 Chrome 사용과 충돌하면
반복 조작 대신 UI QA를 미완료로 남기고 공개 문서 문맥 개발 검사 등 비UI 작업을 진행할 수 있다.
이번에 별도 API/모델 호출·커밋/push·배포 없음. 기존 Vite 유지.

최신 화면 QA 재시도: 파일 경로 입력 → PDF 선택 확정 → 대화상자 닫힘까지는 성공했다.
이전 HMR 전의 파일 요청이 남아 있었으므로 업로드 완료로 계산하지 않았다. 새 PDF 선택 요청 중
CUA가 TrialBoard(127.0.0.1:5173) 대신 다른 Chrome 프로필의 네이버지도 창을 반환했다.
다른 업무 창에 키 입력이 전달될 위험 때문에 즉시 화면 조작을 중단했다. 권한 문제로 단정하지 않는다.
다음 QA는 사용자가 TrialBoard 로컬 탭을 활성화하고 Chrome 조작을 잠시 멈춘 상태에서 재개한다.
앱 핸들이 특정 창에 고정된다고 가정하지 말고 매 단계 대상 URL을 확인한다. 네이버지도 등 다른 창은 조작하지 않는다.
이번 재시도는 제품 코드 변경·새 테스트·배포 없이 관측과 중단 사유만 기록했다. 진행률 약66% 유지.

최신 후속: 작성 중 빈칸을 저장할 수 없던 문제를 해결했다. `web/src/design-draft.ts`의
별도 `design-draft/1`은 미완성 문자열을 PDF/검토 hash와 연결해 보관하며 계산용 입력으로는 거부한다.
DesignPanel ‘작성 중 초안 저장’과 기존 ‘설계 입력 복구’ 연결. [초안 안내](DESIGN_DRAFT_RECOVERY.md).
웹447개(신규19)·production build·diff check 통과. Python 미변경, 직전387개 유지. 진행률 약66% 유지.
파일 선택창 일부 동작 이후 다시 제어가 어긋나 회의/초안 다운로드·복구 클릭은 미완료다.
최종 관측은 Open 창. 사용자 앱 변경 알림 이후 상태만 읽고 추가 조작하지 않았다.
다음엔 최신 CUA 상태부터 확인한다. 기존 Vite 유지, API/모델/배포/커밋 없음.

사용자는 약70%까지 연속 구현을 요청했고, 직전 구현 후 본선용 추정 약66%에 도달했다.
이후 실제 화면 점검을 명시적으로 승인했다. OS 권한 적용 때문에 앱 재시작이 필요할 수 있어
현재 맥락을 저장해달라고 요청했고, 이어 ‘권한을 허용했으니 지금 되는지 확인’도 요청했다.

**최신 권한 결과:** 2026-09-14 `cua.getState()`와 `cua.getApp("Google Chrome")` 호출 성공.
이전의 ‘Accessibility and Screen Recording permissions pending’ 오류 없이 Chrome의 실제 창·탭·버튼 트리를 읽었다.
당시 현재 창은 New Tab이고 기존 `TrialBoard · 근거에서 설계까지` 탭이 확인되었다.
따라서 현재 앱 접근은 가능하며 재시작이 필수라고 단정하지 않는다.
후속 작업에서 기존 TrialBoard 탭을 http://127.0.0.1:5173/ 로 열고 실제 스크린샷,
PDF 모드 전환, 합성 PDF 업로드·렌더링·문구 추출, 필드 검토 진입까지 확인했다.
review.json 복구용 macOS Go to Folder 창에서 경로 확정/취소가 반복해서 어긋났다.
앱 복구 실패로 확정하지 않으며 회의 복구·다운로드·반응형/키보드 QA는 미완료다.
파일 선택창이 남아 있을 수 있다. 새 세션은 최신 상태를 읽고 취소/재선택부터 확인한다.
이번 보완: PDF 세션 종료 경고(자동 백업 아님), 설계/KOL 초기화 안내, 조건부 전송 문구,
PDF 교체 후 원문 탭 복귀와 저장한 원문 메모의 원문 탭 이동. 웹 428개·Python 387개,
TypeScript/production build·Ruff·diff check 통과. 수정 후 화면 재검증은 미완료다.
기존 Vite 5173 서버는 유지했고 새 API 서버는 실행하지 않았다. Git/사이트 배포하지 않았다.
다음에는 허용된 CUA 문서를 확인하고 기존 TrialBoard 탭이 올바른 로컬 URL인지 확인한 뒤 재사용한다.
다른 업무 탭은 조작하지 않는다. 이전 도구의 UI 인덱스/JS 변수는 새 세션에 재사용하지 않는다.

## 제품과 사용자 의도

- 저장소: `/Users/ryul/Desktop/trialboard`, 원격 `https://github.com/ryullee-hideandseek/trialboard.git`.
- 사용자와 친구의 팀 ‘대전곡사포’, 제4회 JUMP AI 분야3 본선. 우승과 이후 바이오기업 유료 파일럿/사업화를 지향한다.
- 원래 제안서 본문: `docs/reference/예선제안서_본문.md`; 개정안: `docs/proposal/`.
- 제품은 표적항암제의 용량 비교시험을 준비하는 **근거 기반 설계 검토 작업공간**이다.
  단순 자료 추출 서비스가 아니라 근거 → 복수 설계안 → 가정 시뮬레이션 → KOL 회의 자료를 연결한다.
- 친구 피드백: 자료 검토/교정 다음으로 여러 설계안·시뮬레이션·KOL 질문을 우선하고 최종 시간 분할 평가는 마지막에 한다.
- 임상 처방·최적 용량·승인 확률을 자동 확정하는 제품은 아니다. 현업 적합성·독립 전문가 검증은 아직 미완료다.
- UI는 기존 React/MUI를 유지한다. MUI는 Google 공식 컴포넌트라는 뜻이 아니다.

## 현재 진행률과 Git 상태

- 본선용 **약66%**, 기업 도입/판매 수준 **약25%**. 주관적 가중 계획 추정, 오차 최소 ±10%p.
  근거: `docs/COMPLETION_ESTIMATE.md`. 숫자에 맞춰 미검증 항목을 완료 처리하지 않는다.
- 마지막 커밋은 `c43ebe5 docs: publish implementation status and remaining delivery roadmap`.
- 그 이후 설계 엔진/웹/API/회의 패키지/시연/문서 작업은 **로컬 미커밋 변경과 미추적 파일**이다.
  재개 직후 `git status --short`로 확인하고 보존한다. 새 변경은 아직 GitHub에 백업되지 않았다.
- 이 인수인계와 AGENTS.md 역시 로컬 파일 저장이며, 이번 요청으로 커밋/push/배포를 하지 않는다.
- `web/.openai/hosting.json`이 있는 기존 Sites 프로젝트. 최신 PDF/설계 기능은 기존 배포 사이트에 미반영.
- 기존 배포 주소: `https://trialboard-evidence-review.fuzzyline-9367.chatgpt.site` (이전 owner-private 미리보기).

## 구현 완료 범위

1. CSV 자료 검사와 별도 합성 가정 실험.
2. 브라우저 PDF.js 파싱, 원본 SHA-256·페이지·문구·근사 좌표, PDF 강조/확인 메모.
3. Python 제한된 추출 → 문자 근거 검사 → AI 반론 → 수정/보류 에이전트, 공식 Codex CLI 로그인 adapter.
4. PDF 필드 확인/수정/보류, 원래 값과 수정 이력, JSON 복구.
5. 사용자 수정 후 로컬 재검증/한 번의 AI 재검토와 현재 버전에 맞는 결과 파일 읽기.
6. 근거 연결 설계 엔진/CLI: 2–4개 용량군, 표본수 다른 2–4개 고정 균등배정 설계, 1–6개 명시적 가정.
7. PDF의 넓은 ‘설계 비교·KOL’ 탭: 설계 입력 / 결과 비교 / KOL 회의, 근거 필드로 복귀.
8. opt-in localhost API: 화면 전송 동의와 `--enable-designs`가 모두 있어야 PDF/검토/가정으로 계산.
9. 버전 결합 KOL 답변 메모·담당자·다음 행동·사유, 불변 수정 이력, 회의 Markdown/JSON 저장·복구.
10. 렌더링 가능한 합성 PDF와 전체 연결 시연 생성기, 독립 작은 표본 이항 전수열거 수치 대조 테스트.

관측 비율을 참확률로 바꾸지 않는다. 미확인/보류·문맥 불일치·제공된 현재 AI 비교 한계는 계산을 차단한다.
AI 파일을 제공하지 않으면 NOT_SUPPLIED로 표시하며 다른 패널/이전 파일을 자동 탐색하지 않는다.
메모의 답변 상태는 임상 승인이 아니고 계산 차단·원문·가정을 자동 수정하지 않는다.

## 코드 위치와 중요한 계약

| 영역 | 주요 파일 |
| --- | --- |
| 설계 엔진/CLI | `trialboard/agent/design_compare.py`, `tests/test_design_compare.py` |
| 로컬 API | `trialboard/api/designs.py`, `app.py`, `boundary.py`, `__main__.py`, `tests/test_design_api.py` |
| 설계 입력/결과 읽기 | `web/src/design-brief.ts`, `design-result.ts` |
| 화면 | `web/src/DesignPanel.tsx`, `LocalDesignRunner.tsx`, `design.css` |
| 전송 | `web/src/design-client.ts` |
| 회의 자료 | `web/src/meeting-packet.ts` |
| PDF/검토 연결 | `web/src/PdfWorkspace.tsx`, `FieldReviewPanel.tsx` |
| 새 웹 회귀 검사 | `web/tests/design-result.test.mjs`, `design-client.test.mjs`, `meeting-packet.test.mjs` |
| 수치 기준 코드 | `tests/test_simulation_reference.py` |
| 시연 생성/왕복 | `scripts/create_design_demo_pdf.py`, `web/scripts/check-design-workflow.mjs` |

- `design-brief/1`: 전체 exportReview의 canonical SHA-256과 PDF hash에 결합. 새 확인 이력도 새 버전이다.
- `design-comparison/1`: 임상 승인 false, recommended_plan_id null, model_calls 0.
  `brief_canonical`을 별도로 제공해 Python/JS의 0.0/작은 지수 직렬화 차이를 처리한다.
  웹은 해당 원문 hash와 파싱 구조를 동시에 검사한다. 이 필드 없는 초창기 결과는 재생성한다.
- 웹 결과 읽기는 일관성 검사이지 Python 재실행/작성자 인증이 아니다. 일관되게 변조된 파일의 진위를 인증하지 않는다.
- `kol-meeting-notes/1`: 전체 비교 결과 hash 결합, 질문당 40회/전체200회 수정 한도.
- `trialboard-meeting-packet/1`: 결과+메모 저장. 같은 PDF와 필드 검토를 먼저 복구해야 이어할 수 있다.
- API 기본은 합성 전용. opt-in 요청 봉투24 MiB/PDF5 MiB/각 JSON8 MiB. 기존 합성 API의 더 작은 한도 유지.
- 로컬 화면은 localhost 또는127.0.0.1:5173에서만 전송. 외부 모델·인증 토큰·서버 영구 저장 없음.
- 검토/가정/문맥/연결 파일 변경 시 현재 결과 채택과 전송 동의 상태를 다시 확인한다.
- 취소는 응답 대기/채택 중단이지 이미 시작한 서버 계산의 강제 종료는 아니다.

## 검증 결과 — 직전 구현 완료 시

- Python 전체 **387 passed**, 기존 Starlette/httpx 관련 deprecation warning 2개.
- 웹 전체 **426 passed**. TypeScript와 Vite production build 통과.
- Ruff 및 `git diff --check` 통과.
- 기존 `check-field-review-bridge.mjs` 통과: 추출→검토→복구→재검증 회귀 검사.
- 실제 PDF.js 파싱→스크립트 응답→웹 검토 복구→Vite/HTTP 계산4건→KOL질문8개→회의 복구 성공.
- 관측값 하나 보류 시 계산0건·선결 질문 생성 성공.
- 별도 작은 표본의 이항 전수열거로 시뮬레이션 빈도 대조7개 테스트 통과.
- 합성 PDF의 렌더링 PNG를 직접 확인했다. 이는 브라우저 UI 검증과 다르다.
- 이번 단계에 새 실제 모델 호출/대회 API 호출 없음. 독립 임상/KOL 평가 및 최종 temporal 평가 미수행.

## 실행 환경과 명령

macOS/zsh. Node24 명시 경로: `/Users/ryul/.nvm/versions/node/v24.14.0/bin/node`.

```bash
uv run pytest -q -o addopts=''
uv run ruff check trialboard tests scripts/create_design_demo_pdf.py
```

web 디렉터리에서:

```bash
PATH=/Users/ryul/.nvm/versions/node/v24.14.0/bin:$PATH npm run build -- --logLevel error
/Users/ryul/.nvm/versions/node/v24.14.0/bin/node --test --test-reporter=tap tests/*.test.mjs
/Users/ryul/.nvm/versions/node/v24.14.0/bin/node scripts/check-field-review-bridge.mjs
```

검증 당시 기존 Vite `http://127.0.0.1:5173/`는 HTTP200이었고 이전부터 실행되던 서버라 종료하지 않았다.
직전 검사에서 임시로 시작한 Python API(8000)는 검사 후 정상 종료했다.
재시작 후 프로세스/포트를 다시 확인한다. 기존 사용자 서버를 중단하거나 중복 실행하지 않는다.

```bash
uv run python -m trialboard.api --enable-designs
```

Vite가 없다면 web에서 Node24 경로로 `npm run dev`를 실행한다. `/api`는127.0.0.1:8000에 중계된다.
로컬 결과파일 가져오기/회의 복구는 Python API를 켜지 않아도 된다.

## 바로 사용할 시연 파일 — 실제 존재 확인

폴더: `/Users/ryul/Desktop/trialboard/output/pdf/design-demo-zuo9nsmj/`

- `SYNTHETIC-DEMO-NOT-CLINICAL.pdf`: 실제 파싱/렌더링 가능한 한 페이지 합성 자료.
- `review.json`, `source-export.json`, `original-agent.json`, `design-brief.json`, `report.json`.
- `meeting.json`, `meeting.md`: 비교 결과와 예시 추가 확인 메모.
- `held-review.json`, `held-brief.json`, `held-report.json`: 보류로 계산 차단되는 경로.
- `synthetic-pdf-qa.png`, `workflow-check.json`: PDF 렌더링/자동 연결 검증 기록.

모두 가상 숫자/스크립트 응답/자동 생성 확인 이력이다. 실제 AI 성능·사람의 확인·임상 근거로 소개하지 않는다.
`output/`은 Git ignored. 로컬 재시작 후 남아 있지만 Git clone만으로 복구되지 않는다.
파일이 없어졌으면 `docs/DEMO_REHEARSAL.md` 생성 절차를 사용한다.
시연 스크립트는 기존 파일 덮어쓰기를 거부한다. 재실행하려면 새로운 시연 PDF 폴더를 생성한다.

## 다음 세션 첫 작업 — 새 기능보다 먼저 화면 QA

1. 이 인수인계/현재 git 상태 확인. 자동 검증을 처음부터 개발 완료라고 재작업하지 않는다.
2. 적용 스킬을 읽고 CUA로 Chrome/기존 TrialBoard 탭을 확인한다. 앱 접근은 이미 성공했다.
3. 필요한 로컬 서버만 시작한다. 시연 자료로 PDF → 필드 검토 복구 → 설계·회의 JSON 복구를 실제 조작한다.
4. 비교 시나리오 전환, KOL 메모 수정/저장/복구, 원문 복귀, 입력 수정 후 과거 결과 숨김, 로컬 계산을 점검한다.
5. 잘못된 파일/보류/취소/미기록 편집/다운로드, 좁은 화면·키보드 접근성을 점검하고 발견한 문제를 수정한다.
6. 검증한 범위만 기록하고 전체 구현율을 재평가한다. 아직 70% 완료로 선언하지 않았다.

그 다음: 공개 문서의 표·각주·다중 문구 문맥 개발 검사 → KOL/통계 범위 확인 → 프로젝트·가정 수정 계보/저장 정책 →
공식 제출 조건·시연/영상/배포 검증 → 최종 시간 분할 평가.
사용자 대신 전문가에게 연락하거나, 과거 대화의 API 키를 사용하거나, 원격 배포/커밋을 자동 수행하지 않는다.

## 읽을 문서의 우선순위

현재 재개: 이 파일 → `docs/NEXT_TASKS.md` 상단 → `docs/COMPLETION_ESTIMATE.md`.
사용 흐름: `docs/DESIGN_WORKSPACE.md`, `docs/DEMO_REHEARSAL.md`.
상세 계약: `docs/DESIGN_COMPARISON.md`, `docs/API.md`, 필드 재검증/재검토/복구 문서.
장기 방향: `docs/MASTER_PLAN.md`, `docs/TEMPORAL_EVALUATION.md`.
이전 ‘권한 대기 중’ 문구는 직전 구현 당시 기록이며, 이 파일 상단의 성공 확인이 최신 상태다.

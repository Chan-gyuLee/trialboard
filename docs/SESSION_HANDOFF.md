# TrialBoard 세션 인수인계

저장일: 2026-09-16. 목적: 앱 종료/재시작 또는 새 대화 뒤에도 작업을 처음부터 반복하지 않고 이어간다.
이 파일은 작업에 필요한 결정·상태·다음 행동을 기록한 것이다. 대화 전체나 브라우저의 미저장 편집을 자동 백업한 것은 아니다.

## 가장 최근 사용자 요청과 확인

2026-09-22 ‘깃에 일단 배포’: 최신 제품 코드를 origin/main에 공유하는 요청. 사이트 배포가 아니다.
제품 엔진/API·웹 화면/테스트·문서로 커밋을 나누며 영상·출력물·로컬 DB·API 키는 제외한다.
Python725/웹1012/Ruff/build 통과. Git 대상만 별도 폴더에 풀어 uv sync --locked/API import/npm ci/build 확인.
깨끗한 복사본 웹1008통과·선택적 참고 PDF4개 skip·실패0. 테스트는 저장소 루트에서 실행한다.
410개 대상 파일의 비밀값 패턴 검사에서 실제 자격증명 발견 없음(합성 PDF 문서 ID는 제외).
README의 현재 기능·검증 수·남은 작업 갱신. 진행률79%는 계획상 주관적 추정이며 출시 준비도가 아니다.
이번 작업의 모델 API 호출0, 기존 서비스/사용자 DB/영상 보존. 아래 ‘push 없음’은 각 과거 작업 당시 기록이다.
최종 원격 반영 여부와 커밋은 git log 및 origin/main으로 확인한다.

2026-09-22 최신 ‘다음 작업 계속해’: [실제 공개 PDF 대조](PUBLIC_PDF_AUDIT.md).
FDA172696 51쪽/3,005,656바이트, sha0e2c73e8… 실제33·35쪽 결과표는 이미지이며PDF.js/pdfplumber텍스트0.
NCT03600883 API스냅샷 resultsSection 없음. Amgen172698 146쪽/5,663,303바이트는현재한도초과; 우회하지않음.
FDA자료는CodeBreaK200 sotorasib/docetaxel 비교이지CodeBreaK100 두용량비교아님. 개발자 원문대조만/전문가검증아님.
openReviewPdf: ≤40기존full,41–200키워드탐색→selected최대40. 직접업로드도긴문서지원.
PdfScopeControl/pdf-page-range: 텍스트미확보쪽수,명시적범위변경(확인후기존편집초기화)/지문/쪽수대조.
실패/거절시기존자료보존, OCR/이미지표수치생성 없음. 프로젝트복구후안내는저장범위만, 전체scan영구저장아님.
실제FDA표33/35렌더링·무텍스트확인버튼차단·41쪽범위거절·교체취소·임시DB저장/새로고침/복구QA.
1440/390px 콘솔0/넘침0, output/public-pdf-audit/, tmp/qa-public-pdf.mjs. 모델호출0.
웹1012(선택적실제PDF검사1포함)/Python725/Ruff/build통과. 해당파일없으면1skip, 테스트에서다운로드안함.
주석tests/fixtures/fda-codebreak200-audit.json,원본PDF Git제외. 원본은/tmp/trialboard-fda-odac-2023.pdf.
전체79%/기업25%유지. 기존API50808/session2946·5173유지, 실제사용자DB/영상보존, Gitcommit/push/외부배포없음.
QA 임시8002/PID65788/session71467 정상종료·임시DB정리. FDA원본/tmp파일은 재현테스트용으로 남겼다.
다음: OCR/vision인용계약 및 제공모델지원확인→실제표추출검증→다문서/영구비교. 완주나임상정확도검증으로설명하지않기.

2026-09-22 최신 ‘이어서해’: [긴 PDF 선택 페이지 검토](SELECTED_PDF_REVIEW.md).
`pdf-evidence-selected/1`+totalPages, 최대200쪽의 저장된 최대40쪽. 기존full계약/직렬화 보존.
research-handoff→openSelectedPdf→원래page번호 기반 필드/메모/인용/정규화/재검증/설계 연결.
PdfPageNavigation: 포함/미포함 범위·원래 쪽수 선택, 프로젝트 복구 시 동일 선택 재추출/검증.
전체 쪽수 불일치/손상 파일/인용 범위 오류 차단, 신규 모델 요청·사용자 확인 자동생성 없음.
웹991/Python725/Ruff/build 통과. 합성80쪽 PDF48쪽 근거/73쪽빈페이지, 실제PDF.js·임시SQLite 브라우저 QA.
1440/390px,48→73→48 탐색·강조·미확인44·설계진입·저장새로고침복구·손상시기존4관측유지, 콘솔0/넘침0.
output/selected-pages-qa/ 및 tmp/qa-research-handoff.mjs --selected 참조. 모델호출0.
로컬API8075→최신PID50808/session2946, 기존대회옵션·외부키파일, localhost8000. Vite5173 유지.
QA 임시8002/PID43203 정상 종료 및 임시DB 정리. 실제 사용자DB에는 QA 프로젝트를 저장하지 않았다.
전체79%/기업25% 유지, 기존 변경/DB/영상 보존, Git commit/push/배포 없음.
직접 파일 전체 읽기는40쪽, 임의페이지추가/전문검토/실제임상검증 미구현. 다음은 실제문서 독립대조·다문서/등록결과·영구변경비교.

2026-09-22 최신 ‘남은 작업 많이 이어서’: [공개 조사→원문 검토 연결](RESEARCH_REVIEW_HANDOFF.md).
ResearchContinuation/research-handoff/ReviewProgress: 저장된 추출을 PDF 필드 검토로 직접 연결, 핵심 값 탐색.
캐시 전용 GET run/source/digest, 지문/문구/페이지 대조 후 원본추출·조사맥락·질문 연결. 모든 필드 미확인.
관측0/계획문서만/40페이지초과/미완료는 이유 표시, 무추출·무다운로드·무모델재시도. 기존 작업 교체 전 확인.
프로젝트 저장→새로고침→복구에서 원본추출/문맥 유지. 프로젝트 출처 검사도 정확한digest로 수정.
웹976/Python710/Ruff/build. 합성 조사 fixture + 실제PDF/캐시/별도 임시SQLite로 브라우저1440/390 검증.
원문 이동/미확인44/제안동의false/저장복구/손상파일 기존검토 보존/콘솔0/넘침0. 모델호출0.
output/handoff-qa/ 및 tmp/qa-research-handoff.mjs 참조. 최근실제조사6건 automation 없음; 실제약물완주 미검증.
기존 변경/사용자DB/영상 보존, Git commit/push/배포 없음. 전체79%/기업25% 유지.
최종 서버: 기존92790→최신PID8075/session20802, localhost8000, 기존대회옵션·외부키파일 유지. Vite5173 유지.
QA 임시8002서버/PID1959 종료·임시DB 정리, 실제DB에는 QA 프로젝트 미저장. 다음: 긴PDF 연결·실자료 대조·영구 변경 비교.
Python 첫 전체1실패는 기존 Codex killpg PermissionError 재발. 미수정, 최종 전체 재실행710통과. dacon신규호출 없음.

2026-09-22 최신 ‘우리 제품 더 멋지게’: [설계 결과 브리핑·직전 계산 비교](DESIGN_OUTCOME_BRIEFING.md).
DesignOutcome/CSS module/design-insight: 요약→가정 탭→3차이 지표→2설계 카드→원문→회의 질문.
DesignPanel의 로컬 재계산 때 직전 결과를 메모리에 보관, 입력 변경·세 계산 빈도 전후 비교/Markdown 저장.
원문/검토/질문/용량군/엔진 변경·보류이면 수치 비교 차단. 새로고침 복원/영구 이력은 미구현.
결과 진입 시 제목 포커스·스크롤, 준비/복구 안내 접기. MOC/근거 범위/MC 오차 유지.
웹959/Python708/Ruff/build 통과. 합성 브라우저1440/390px 재계산·다운로드·KOL·키보드·넘침0/콘솔0.
output/outcome-qa/의 스크린샷/qa-report.json과 tmp/qa-design-outcome.mjs 참조. 이번 대회 모델 호출0.
기존 API17150/5173 유지, DB/영상/기존 변경 보존. 커밋/push/사이트 배포 없음. 전체79%/기업25% 유지.
다음은 실제 문서 한 사례 독립 대조, 공개 조사→검토PDF→제안 연결 단순화, 영구 변경 이력.

2026-09-22 최신 ‘남은 개발 이어서’: [AI 설계 초안 연결](AI_DESIGN_PROPOSAL.md).
검토된 PDF/원본 실행 → 결정적 사전검사 → 대회 단일 호출 → 2안×2–3가정 → 사용자 입력 확인 → 기존 계산·KOL.
`ai_proposed_hypothetical`의 제안ID/관측ID/확인digest 보존. 변경 시 확인 무효화, 미확인 서버 계산 차단.
DesignProposalPanel/AIProposalAcknowledgement, `/api/design-proposals` SSE. enable-designs+enable-pdf-agent 필요.
실제 합성 대회2호출: 엔진1회(2,705+1,645토큰), 브라우저1회. 각각2안×3가정/6계산 성공.
브라우저1440/390px·KOL·표본수 변경 무효화·콘솔0/가로넘침0, output/proposal-qa/ 참조.
API 이전PID38423 종료→새PID17150/session54169, localhost8000. 기존5173 Vite 유지.
키는 기존 승인된 외부 비밀파일만 서버 로드, DB·영상 유지. Git commit/push/외부배포 없음.
전체 추정79%(±10%p), 기업25% 유지. 실제 약물 임상 검증/자동 수집부터 완주/다문서 연결은 미완료.
최종 Python708/웹946/Ruff/build 통과. 병렬 테스트의 기존 Codex subprocess killpg PermissionError1회는 단독/전체 재실행 통과, 미수정 간헐 이슈로 기록.
다음: 실제 문서 한 사례 독립 대조→공개 조사/검토 결과에서 이 경로 진입 단순화→변경 영향 추적.

2026-09-18 최신 ‘친구가 빌드하도록 제품 코드 GitHub 공유, 영상 제외’:
제품 Python/API/웹 UI/자동화/합성 설계 검토/로고/테스트/문서만 업로드 대상으로 선정.
`/video/` 전체와 output/tmp/로컬DB/비밀키는 제외. 기존 영상 작업은 로컬 보존.
README에 Node24 설치·키 없는 대표 합성 흐름·대회 키 비표시 입력 안내 갱신. 새 clone에는 개발자 기록/DB가 없음.
Python689/Node24 웹933/Ruff/웹빌드 통과. Node22.9의2개 테스트 실패와 Vite 지원 경고는 Node24 사용으로 회피.
Git index만 임시 새 폴더로 추출→uv sync --locked/npm ci/Node24 build 통과. 추적되지 않은 로컬 파일 의존 여부 확인.
깨끗한 복사본 웹930통과/0실패/선택적 로컬 참고PDF3검사 skip. CLI --help도 통과. 개발 환경에서는933전부 통과.
제품 구현율 약78% 유지. 아래 영상 문서는 로컬 제작 기록이며 GitHub 배포에 해당 파일이 없을 수 있음.

2026-09-18 최신 ‘오프닝 느낌 유지, 중간 기능 소개와 플로우 제작’: 중간 v1 별도55초.
`video/src/middle.tsx`/CSS/`middle-timeline.ts`, composition `TrialBoardMiddleV1`.
실제 저장 실행→공개 브리핑→별도 MOC→분모 대조/확인 클릭→60/120명·스트레스 비교→KOL 회의 질문→마무리.
실제 UI 확대/좌우 분할/하단 단계 레일/단일 커서 클릭. 대조 버튼이 잘리지 않도록 `capture-middle.mjs`로 GET-only 재캡처.
`npm run middle`, `npm run qa:middle`. 출력 `output/video/launch-middle-v1/trialboard-middle-v1.mp4`.
v4 오프닝과 기존 v3 전체는 보존하며 아직 합치지 않았다. 새모델/공개검색 호출0(캡처용 로컬 GET은 사용), 제품 기능 미변경/78% 유지.
브리핑 진입의18프레임 지연을 제거해 비는 화면을 줄임. 다음은 중간 사용자 피드백→오프닝 연결/내레이션/최종 제출 QA.
커밋/push/배포 없음. 상세 타임라인·검증은 video/README.md와 출력폴더 qa-report.json.
최종55초/1650프레임/9,406,262바이트. TypeScript/16테스트/실제 계산·공개 기록 대조/전체디코드·PTS·큰점멸후보0·표면1320프레임 통과.
ANGLE/swangle 모두 간헐적 Chromium 하단 readback 누락 발견. 최종6프레임(365/541/625/1190/1197/1372)을 정확한 renderStill PNG로 교체해 재검사 통과. `repair-middle.mjs`와 frame-repair.json 참조.
새 렌더도 QA 필수. 캡처 엔진 원인 해결과 구별한다. 오디오peak−5.9dB, 내레이션 없음. 클릭/전환 연속 이미지 확인.

2026-09-17 최신 ‘v2 오프닝 복원+블루, 레퍼런스 사선 클로즈업 그대로, 중반v3 유지’: 오프닝v4 별도17초.
`video/src/opening-v4.tsx`/CSS/`opening-camera.ts`. 타이핑·카드·Meet·브랜드캡슐은 기존OpeningQuestion을 재사용하되 블루와 정확한 로고경계 적용.
입력은 왼쪽모서리(225,80), 오른쪽/아래 프레임밖의 대형 평면. 4점 homography로 가까운 수직모서리/원근감을 맞춘 뒤 정면top405로 내리고 제목 등장.
새검토툴바→거대UI→타이핑·동의·12.4초클릭→정면. 마우스가 화면밖으로 잘리지 않게 입력카드1000px로 제한.
v4 composition `TrialBoardOpeningV4`, 렌더 `npm run opening:v4`, 검사 `npm run qa:opening`. 출력 `output/video/launch-v4/trialboard-opening-v4.mp4`.
전체v3와 중반은 그대로이며 아직76초판에 병합하지 않았다. 새AI/API0, 제품78% 유지. 첫렌더에서 도입 문서카드의 중첩3D 누락 발견→평면변환+깊이별스케일로 변경.
최종17초/510프레임/4,361,345바이트. 전체디코드/PTS/큰단일프레임점멸후보0, 입력175프레임 버튼최소58/표면최소2887 가시성통과.
오프닝·카메라·클릭 연속이미지 확인. TypeScript/13테스트/diff검사 통과. 출력·QA는 launch-v4에 저장.
다음: v4 오프닝 사용자 정상속도 확인→승인 뒤 v3중반과 연결. 커밋/push/배포 없음.

2026-09-17 최신 ‘블루/로고 정렬/세워진 UI/다양한 애니메이션/제품 설명 강화’: [영상 v3](../video/README.md).
76초/1080p/30fps, 11장면. `video/src/v3.tsx`, `v3.css`, `v3-layout.ts`에 별도 구현. 기본 composition TrialBoardFilm=v3, v2는 TrialBoardFilmV2로 보존.
입력 UI는 positive rotateY26→0, X/Z회전0. 제목하단252/UI시작300을 분리. 내부는 flat 합성해 중첩3D 깜빡임 방지.
로고alpha실제경계를 코드 crop해서 심볼/워드마크 수직 중심 계산. 원본이미지 변경 없음.
문서수렴/입력카메라/출처그래프/실제실행분할/82≠8/분모대조/설계분기/위험확대/브리핑으로 모션 다양화.
새공개검색·AI호출 없음. v2 실제UI캡처/저장기록과 기존합성계산을 사용. 34–71초 MOC유지. 제품78% 유지.
TypeScript/11테스트 및 대표스틸 점검 통과. 최종출력대상 `output/video/launch-v3/trialboard-film-v3.mp4`, 오프닝17초 `trialboard-opening-v3.mp4`.
최종 전체MP4 완료: 76초/2280프레임/17,709,998바이트. 첫렌더24.4초 실행표면 한프레임 누락 발견 → 정면의 불필요한3D/will-change 제거와 overflow 경계로 수정.
재렌더 전체디코드/PTS/큰점멸후보0, 입력버튼72프레임최소456/실행표면220프레임최소3398 가시성 통과.
회전·클릭·수정구간·스트레스·전환 연속이미지와 전체콘택트시트 확인. Python 실제계산98.7/99.9%, TypeScript/11테스트/diff 통과. 오디오peak−5.9dB, 내레이션 없음.
상세는 영상 README/qa-report.json. 커밋/push/배포 없음. 다음은 사용자 정상속도 시청 피드백과 최종 음악/내레이션·임상표현 승인.

2026-09-17 최신 ‘레퍼런스 같은 대형 3D UI + 실제 제품 화면 + 클릭/전환 깜빡임 수정’: [영상 v2](../video/README.md).
70초/1080p/30fps. 0–8초 타이핑/문서 조각/Meet/발광 로고 캡슐, 8–16초 대형 tilted 입력 UI.
16초 이후 실제 앱 DPR2 PNG와 저장 기록 재생12초 클립. 전용 Playwright headless 캡처, 기존 사용자 탭은 변경하지 않음.
공개 조사→진행 기록과 설계→스트레스는 각각 같은 영상/카메라를 유지. 실제 대조 행/회의 질문을 확대 레이어로 표현.
실제 UI 캡처에서 기본 선택이 스트레스였던 점을 수정: 원자료 가정 버튼 명시 선택, 0.0/0.0→98.7/99.9% 확인.
첫 v2 MP4의 입력 카드에서 중첩 preserve-3d로 버튼/글자가 간헐적으로 사라지는 문제를 연속 프레임에서 발견.
입력 표면 내부를 flat으로 합성, 바깥 카메라만3D 유지. 수정된16초 MP4 연속 캡처에서 버튼/글자 유지 확인.
TypeScript/7테스트/실제 계산·공개 저장기록 대조 통과. 큰 단일프레임 점멸 검사에 입력 버튼 ROI 가시성 검사 추가.
새 AI 호출0, 캡처용 로컬 합성 계산만 실행. 기존 앱 소스는 이번 영상 작업에서 수정하지 않음. 제품78% 유지.
`output/video/launch-v2/trialboard-film-v2.mp4`와 `trialboard-opening-v2.mp4`가 최신 출력 대상. v1 보존.
최종70초/2100프레임 재렌더링 완료, 24,018,366바이트. 전체 디코드/30fps PTS/큰 단일프레임 점멸 후보0 통과.
입력 버튼72프레임 ROI 가시성 모두 통과(최소538 blue pixels), 수정후 클릭 연속 콘택트시트 확인.
16초/480프레임 오프닝 별도 출력 완료. 자세한 검증은 영상README와 launch-v2/qa-report.json.
다음: 사용자 정상속도 시청/최종 음악·내레이션 선택/발표장 가독성/임상 표현·제출 규격 확인. 커밋/push/배포 없음.

2026-09-17 최신 ‘수정 콘티 기반 Remotion 영상 제작’: 독립 `video/` 프로젝트, [편집/재생 안내](../video/README.md).
65초/1080p/30fps, 11컷. 입력→공개 조사 실제 저장기록→근거부족→명시적 별도 MOC→분모 대조→60/120명 가상 비교→KOL→로고.
CSS perspective 기반 2.5D 모션, 로컬 폰트, 직접 합성한 음악/효과음, 내레이션 없음. 직접 화면 녹화 아님.
실행 b35ea05c… GET의82출처/66초록/12PDF/8AI입력/36구간/7쟁점/6질문 검증.
실제 caseRunInput+Python 엔진 재계산98.7/99.9% 및 MC SE0.11/0.04%p 대조. 설명도 seed 해시에 포함되므로 입력 수기 재작성 금지.
소스/스틸 QA 후 전체 렌더링 완료. `output/video/launch-v1/trialboard-film-v1.mp4`, 약14.5MB.
최종MP4 1950프레임/영상65초/AAC포함65.045초, 전체 디코드 통과·콘택트시트/회의프레임 확인.
TypeScript/영상계약4테스트/실제계산·저장기록대조 통과. 오디오 최대−5.9dB, 내레이션 없음.
기존 앱 코드 미변경, API/대회 모델 추가 호출0(저장기록GET과로컬계산만). 제품 전체78% 유지.
최종 사용자 시청 피드백·오디오/내레이션·임상 표현 검토·제출 규격 확인이 남음. 커밋/push/외부배포 없음.

2026-09-17 최신 ‘대표 데모 흐름 구현 + 첨부 로고 분리/적용’: [DECISION_CASE_DEMO.md](DECISION_CASE_DEMO.md).
DecisionCaseWorkspace/decision-case: 합성JSON 엄격 입력→4행대조→불일치 확인→2설계×2가정 실제 Python 계산→질문/Markdown.
첫 화면 보유자료 버튼은 새 설계검토, 기존 PDF/CSV는 새 화면 상단/기존 자료검토 메뉴에서 유지.
입력·결과 일치/MC오차/군별 문맥/미확인 불일치 차단. 실제 근거 기반 AI 설계는 아님, 새 모델0.
BrandLogo에 사용자 심볼/워드마크를 imagegen으로 분리한 투명PNG 적용, 원본 별도 보존. 로고 설명은 위 문서.
웹933개(신규26개, Python 실제엔진 연동 포함)/build/diff 통과. 전체78% 유지.
1440×1000 실제 브라우저 계산: 스트레스 보류60명98.7%/120명99.9%, 기준가정 전환 확인,
KOL탭과390×844 브리핑/입력/로고 확인. 모바일 메뉴 가로 넘침 수정. MOC 하단 sticky+결과 제목 유지.
파일 업로드/다운로드 대화상자·네트워크중단의 브라우저QA는 남음(입력검증/응답거부는 자동검사).
커밋/push/배포 없음. 개인/대회 모델 추가 호출 없음. 이미지 분리에 내장 이미지 편집 사용.

2026-09-17 추가 ‘최근 검토/상세 검색 위치·상단 문구·3단계’ UI 수정.
ReviewNavigation 컴포넌트/CSS Modules: 상단 번호+연결선 단계표시(현재 단계 aria-current),
YOUR CLINICAL RESEARCH와 Research workspace 문구 제거. 기존 큰 헤드라인 유지.
입력 카드와 같은760px 폭의 보조 메뉴에 최근 검토/상세 검색을 좌우 정렬. MUI 버튼/Collapse로 목록 개폐,
약물·NCT/한국어 상태/연도 포함 날짜·시간/이동 화살표를 분리. 모바일은 행 정보를 세로 배치.
2059×1271/390×844 첫 화면·메뉴 점검, 최근 검토 열기→저장 결과 복구와 상세 검색 이동 확인.
웹907/build/diff 통과. 새 수집/모델 호출 없음. viewport reset, 에이전트 화면 복귀.
전체78% 유지. Sites의 작업 중심·보조 메뉴 계층화 원칙 적용, 배포/커밋/push 없음.

2026-09-17 추가 디자인 피드백 ‘수집 지표 정렬 / 메인 결과 MOC 배너 제거’ 반영.
ResearchSummary는 제목→숫자→보조 설명의 공통 3행 정렬, 데스크톱4열/모바일2열.
ResultOverview의 큰 가상 비교 배너 제거. 별도 ‘가상 비교 · MOC’ 탭과 합성 데이터 표시는 유지.
2059×1271 결과/지표 및390×844 지표를 Chrome에서 직접 확인. 저장된20:23:57 검토 기록 재생으로 점검,
새 검색·모델 호출 없음. 웹907/build/diff 통과, Python 변경 없음. 전체78% 유지, 커밋/push/배포 없음.

2026-09-17 최신 디자인 피드백 ‘데모/프로토타입/발표보기 제거·체크박스 정렬’ 반영.
AutoReview 첫 재생 홍보영역, 발표 버튼/상태/CSS, 앱 전체 프로토타입 푸터/Research preview/녹화 도구 진입 제거.
기존 AgentBriefing의 발표 집중 모드도 제거. 실제 저장기록·MOC·전문가 검증 전 표시는 유지.
첫 화면은 입력→동의→시작. 체크박스44px/문구14px·24px행간, 상세설명52px 들여쓰기,
전송·저장·모델사용량 설명은 데이터 처리 안내에 유지. 공통 MUI 규격과 PDF/필드검토의 충돌 스타일 정리.
최근 기록은 ‘최근 검토’→결과→실행 과정 재생. 이전 첫 화면 재생 버튼 안내는 더 이상 유효하지 않음.
결과의 재생 홍보 제거, 모델/상태는 원문·처리 기록의 실행정보로 이동, 검토한계 상세 접기.
2059×1271 입력/결과/기록,390×844 입력·체크박스·버튼 확인. 라벨 클릭 체크/시작 활성화,
입력 변경 후 동의해제·시작 비활성화 확인. 새 AI/검색 실행 없이 기존5777f80e 기록복구.
웹907/build/diff 통과. Python 변경 없음. 전체78% 유지, 커밋/push/배포 없음.
Sites의 간결한 작업화면/통일된 컨트롤 원칙 적용. 현재 CUA browser1/tab1907030740 재사용.
QA 후 viewport override 해제, 빈 입력/동의 미선택 상태의 첫 화면으로 복귀.

2026-09-17 최신 ‘색감이 따뜻하다/이어서’: [COOL_THEME_AND_RETRIEVAL.md](COOL_THEME_AND_RETRIEVAL.md).
쿨 화이트/네이비/블루 테마 적용, 상태의 앰버/MOC 바이올렛 구분. 기존 레이아웃/기능 유지.
NCT/AI후속2페이지40건, 나머지1페이지20건. 페이지별실제수신 알림, pages/stop_reason 저장·실시간·결과·재생·보고서.
부분 실패자료 보존, 커서/페이지/출처한도 및 취소 검사. 논문 전문 확보나 전수조사 구현은 아님.
새실행5777f80e... 19:56:35KST, 50.133초/100출처=이벤트100, 초록83/PDF링크12.
조사48이벤트/화면60알림, 대회2호출16,889토큰, 6쟁점7질문, 여전히 용량선택 근거부족.
Python689/웹907/build/ruff/diff통과, 데스크톱 실실행/결과와390px 재생·결과 점검.
viewport reset 후 최신 결과 기본탭 복귀. PDF자동추출 저장null, 별도MOC계산만 존재(근거가정 미사용).
API process38423/exec67203, Vite5173 유지. 전체78% 유지. 커밋/push/배포없음.
다음: 중요 원문/표·각주 검토와 설계입력 연결, 초기검색/AI후속 저장용량 예약, 시연 내용검증/Remotion.

2026-09-17 최신 ‘수집이 너무 빠르다/뭘 하는지 안 보인다’: [COLLECTION_TRANSPARENCY.md](COLLECTION_TRANSPARENCY.md).
범위 감사 결과: 제한된 API 초록/메타/링크 수집이지 전수·전문 검토 아님. 실제 SQLite 저장/검색은 동작.
채널/검색어/개별 수집 범위/DB 종류별 집계/AI 입력ID/인용수 telemetry, 실제 출처 전량6개씩 전달.
조사 현황 기본탭·4집계·대기시간·결과 수집범위·발표용 느린 재생. 오래된 기록은 상세 미기록 처리.
새실제 e1efd8b0...: 32.845초, DB77=이벤트77, 초록61/PDF링크12, 계획24→검토8, 조사36이벤트/화면48알림,
대회모델2회/17,380토큰, 6쟁점7질문, 근거부족. PDF자동추출저장null, 별도MOC9계산 저장. 전문까지 완주로 보고 금지.
Python677/웹906/build/변경ruff통과. 2059×1271 실실행 및390×844 저장 상세/재생 QA. viewport reset.
API 새 process11640/exec session12504, Vite5173 유지. 전체78% 유지. 키비공개, 커밋/push/배포없음.

2026-09-17 최신 겹침·가독성 재수정: [WORKSPACE_CLARITY.md](WORKSPACE_CLARITY.md).
V2 큰 카드들을 제거하고 AgentActivity를 단계 레일 + 현재 작업/탭형 기록으로 교체. ResultOverview는 결론/두 확인 상태/쟁점·다음 행동.
두 컴포넌트 CSS Modules 격리, 옛 agent-studio 전역 카드 CSS 제거. 모바일 grid 최소 폭 잘림 수정.
2059×1271 실제 검색 중 화면·저장 결과, 390×844 결과/인용/재생 확인. 실제 sotorasib 검색72/20→범위대기, 새AI0.
웹900/build통과. 기존 저장12:05:39 결과를 사용했으며 새 AI 전체 완주 아님. 전체78% 유지.
V2 레이아웃 설명은 최신 문서로 대체. 기존 WIP 보존, 커밋/push/배포 없음.

2026-09-17 후속 ‘굴러가는 디자인·결과가 눈에 안 들어온다, 전면개편’: [AGENT_STUDIO_V2.md](AGENT_STUDIO_V2.md).
AgentActivity 3작업묶음/진한초록현재작업/옆이벤트피드/실제누적산출물, ResultOverview 질문→판단→근거→다음회의.
ActivityReplay 실제저장20이벤트 재생·정지·다음·슬라이더, 첫화면 진입. 새API없음/재생범위·대기축약표시.
activity-model/decision-view 순수함수 신규. 후자는 AI/임상판정아닌 저장상태의 설명. 기존 부족/미완/부분우선.
웹900통과. 1440/390px 브라우저 복구·재생종료·결과·인용펼침·MOC이동 확인. 새유료모델/수집0.
최신실자료93785079...는 이번turn전부터존재(2026-09-17 11:38). UI새완주로보고하지않음.
전체78%유지, 다음최신UI실제완주/Remotion. Git커밋/push/배포없음, 기존WIP보존.

2026-09-17 최신: 승인한 세이지/화이트 목업 느낌을 실제 UI에 적용하고 Remotion 데모용 실행 화면 강조.
[AGENT_WORKSPACE_REDESIGN.md](AGENT_WORKSPACE_REDESIGN.md) 참조. 실제 앱5173, 목업8769와 구별.
AutoReview 주요 동선·AgentActivity 신규·agent-scene 순수 상태 투영·agent-workspace CSS·공통 테마 변경.
실제 이벤트만 표시/발표 보기/4결과탭(핵심·근거·MOC·처리)/장면data속성. Remotion 영상은 아직 미구현.
웹889/build통과. 1440/390px 화면·저장된 실제 sotorasib 결과 복구·발표 전환 확인.
실제 검색72/20→범위 대기까지 확인, 새 유료모델0. 중단은 자동테스트로 검증/UI중단완료 확인없음.
Sites UI 지침 적용, 기존 React/Python 유지. 외부배포/커밋/push없음. Node22.9경고 남음.
전체78%/기업25%유지. 이번 사용자 우선순위는 시연UI이며, 다음은 실제 최종 시연사례 완주·Remotion 캡처/Composition.
임상 본체의 AI_PROPOSED 계약·실제 근거 기반 설계 생성은 여전히 미완료.
CUA 실제앱탭1907030740/browser1, viewport reset완료. API8000/Vite5173 유지.

2026-09-16 최신 ‘다음 작업해…마지막 결과 눈에 딱’: [RESULT_OVERVIEW.md](RESULT_OVERVIEW.md).
결과판단1문장/3상태카드/다음판단 우선, 자료개수보조, MUI3탭(설계·근거·처리)로 기존긴화면분리.
ResultOverview.tsx/result-summary.ts 신규. 고정규칙요약이며 새AI판정아님. 모름/부분표시/AI미완료와 근거부족구별.
설계기준20/40/60전환→추가참여자·선택보류pp차이·독립MC SE, 재계산/네트워크없음/추천없음.
보고서 요약우선+비교차이(군당20기준고정명시). 핵심질문앞3개는 원래AI텍스트 그대로.
웹884/build/Ruff/diff/키매칭통과. Python코드변경없음/직전673유지. 유료모델0·외부수집0.
Chrome2bc...복구·첫화면스크린샷·기준60전환(-80명/-6.1pp등)·근거/처리탭·상단다운로드확인.
다운로드 trialboard-review-2bc2945b-6d02-48f9-b269-3cada28748e7 (1).md 첫줄요약확인.
API/Vite/DB그대로, API PID65409/8000·CUA trialTab/tab1907030730. 기존WIP보존·commit/push/배포없음.
실제모바일/전체키보드미완. 전체78%/기업25%유지. **AI_PROPOSED 가정계약/실모델연결 여전히 다음1순위**.

2026-09-16 최신 ‘남은 작업 진행해’: [AUTO_DESIGN_EXPLORATION.md](AUTO_DESIGN_EXPLORATION.md).
research/exploration.py + api/exploration.py, 연구 run에 GET/POST /exploration 추가. enable_designs+scout 필요.
RULE_LIBRARY_HYPOTHETICAL/illustrative-designs/1 별도계약, 고정3표본수×3가정×2000회/seed42/기존실제엔진.
관측수치추정·실제용량매핑·임상/사용자승인 없음. **AI 제안 계약 아직미구현**. 기존 DesignBrief 검증 우회안함.
research_exploration 테이블 run1기록/idempotent/digest/기존기록불변. 로컬Origin/consent/동시계산한도/실패보존.
기본흐름 AI브리핑후 자동가상계산·7단계상태·GET복구/MUI3가정탭·3안카드·MOC하단·보고서.
실제저장2bc...에 별도가상계산 추가 POST→GET→웹계약156ms/모델0/원래조사불변; NEEDS_EVIDENCE 유지.
Chrome기록복구·탭전환·데스크톱스크린샷·보고서다운로드파일 확인. 새유료모델/새검색전체브라우저실행없음.
MOC 자동연결/실패/취소검증, Python673/웹875/Ruff/build/diff/키Git스캔통과. 모바일/전체키보드미완.
API PID65409/exec41536,8000/4flags+dacon+외부keyfile. Vite5173/CUA trialTab/tab1907030730 유지.
최근ff42a40c-c355-466e-8216-a35d56fb41d6(19:22)조사도존재하나 이번turn생성아님/변경안함.
다운로드 /Users/ryul/Downloads/trialboard-review-2bc2945b-6d02-48f9-b269-3cada28748e7.md 확인.
전체78%/기업25%유지; 고정가상계산연결을 실제AI설계생성완료로계산하지않음. commit/push/배포/위임없음.
**다음:** AI_PROPOSED 별도가정계약+근거연계/제한된모델제안→검토필요성유지한 연구용계산,
새실행전체검증/다약물/의미인용/임상평가. 고정템플릿을 AI생성으로소개금지.

아래는 이전 상태이며 최신서버PID/카운트/가상계산연결은 위를우선한다.

2026-09-16 최신 ‘계속 실행해. 자동화 완벽하게 해놔’: [REGISTRY_RESULTS_AUTOMATION.md](REGISTRY_RESULTS_AUTOMATION.md).
registry-context/1 두 묶음 각18k/전체30행 보존, 일반4500/최대8출처. source-spans/2·dose-context/2.
registered design 입력+RANDOMIZED/비무작위 충돌 좁은 보류 검사. 하위 항목 분모 우선/전체 분모 별도/산포·주석 보존.
registry-readiness/1 규칙 기반 비교 준비 카드·보고서. 임상 승인false/시뮬레이션false 유지.
posted-results-first/1: 검증된 AI_REVIEW가 모든 결과 묶음을 읽었으면 PDF보관→PLAN_DOCUMENT_SAVED→추출 추가 모델 생략.
현재 실제 run2bc2945b-6d02-48f9-b269-3cada28748e7:48초/81자료/8쟁점/7KOL/연구2회26190+PDF1회2080토큰.
묶음 내18개 누락을 전체 누락으로 오해해 global coverage 수정. 별도 REVIEW진단1회17343토큰에서 누락 오해 해소,
비무작위 오해 새 발견→후속 입력·보류 규칙 합성검증. 마지막 변경 유료 재검증 없음. 이번 총4회45613보고토큰.
원래2bc의 오류 포함 저장 기록은 보존. 새 결과 우선은 실자료 임시DB검증/모델0회/원래DB불변이지 새브라우저전체완주아님.
실제 readiness 효능false/안전성true/NEEDS_EVIDENCE; 통합ORR분할·비율역산 없음.
Python664/웹852/Ruff/build/diff/키값Git스캔 통과. Chrome 실제실행/복구·데스크톱QA, 최신 모바일/전체 영상 미완.
API 최신 PID37186/8000 기존4flags+dacon+외부keyfile. Vite5173 유지. CUA trialTab/tab1907030730.
전체78%/기업25% 유지. 임상품질/복수설계인계 미완이라 진척 과대계산하지 않음. commit/push/배포/대리agent 없음.
**다음:** AI 제안 가정 계약(사용자선언 사칭금지)→근거/가상 계산 분리된 복수 설계 자동 인계,
의미단위 인용/다약물/최신정책 제한된실모델 평가. 600자 인용 문자 일치는 임상 해석 정확도 아님.

아래는 이전 기록이며4500자 결과 입력 한도/서버PID/우선순위는 위를 우선한다.

2026-09-16 최신 ‘자동화 완성시킬 때까지 끝까지’: [AUTO_EXTRACTION_PERSISTENCE.md](AUTO_EXTRACTION_PERSISTENCE.md).
자동 희소PDF 저장/복구/API+모델 추출·규칙검사·인계/SSE/통합보고서와 registry-result-tables/1 구현.
API3경로research/runs/{id}/automation GET/POST, /automation/run POST + /result-tables GET.
동일run1회/원본PDF바이트·지문확인/입력DB/SSE실작업·종료저장/중단복구/개인fallback없음. 본문전용4MB.
UI새입력없음/조사2+추출반론2최대4모델/복구GET만. PDF텍스트원본일치독립재추출없음명시false.
실제07438cdb... SAP43/40보관/3후보15문구→대회1회2080토큰/0관측 NEEDS_EVIDENCE 저장.
Chrome새입력→범위1회확인→b183262a-4890-492c-b5b7-77cdf11969d2,약37초77이벤트,
79근거7인용7KOL/조사2회17012토큰+추출1회2080/0관측. 이번총4회21172보고토큰. 설계성공아님.
후속저장등록스냅샷→결과24행/안전성6행. 첫ORR통합집단/안전성용량별 보존; 역산/SAE→Grade3변환없음.
새collectorREGISTRY_RESULTS입력후보 추가했으나 위실모델후에만든기능. 기존브리핑입력미포함UI안내/보고서.
모델검토4500자한도로전체결과행검토아님. 이한계를다음1순위구조화계약으로해결할것.
Python636/웹839/Ruff/build/diff/키값Git스캔통과. UI저장복구/표펼침/간격확인, 새모바일/다운로드클릭/영상미완.
API재시작 PID70840/exec9701,8000,4flags+dacon+명시외부keyfile. Vite5173유지. 이전WIP/DB보존.
CUA Chrome1/tab1907030730(trialTab). 마지막UI변경HMR초기화가능,새AX읽기. 저장실행다시여는것은유료요청아님.
전체78%/기업25%,±10%p. 자동수집DB영역+1만반영. commit/push/배포없음. subagent사용없음.
**다음:** 등록결과구조화입력→결과자료우선→AI제안가정(사용자선언사칭금지)·복수설계인계→다약물/임상평가.

아래는 직전 기록이다. 최신 저장/추출 미완료와 서버PID 안내는 위를 우선한다.

2026-09-16 최신 ‘이어서 작업해’: [LONG_PDF_PREPARATION.md](LONG_PDF_PREPARATION.md).
신규 pdf-auto-pages.ts/tests9개. 자동200페이지/10씩 탐색·문구신호별40페이지 보관, 전체80kspan/1M문자, 파서40초.
pdf-extract.ts 선택페이지 검사/실패시cleanup, 수동40페이지 경로 유지. pdf-session/loader의 auto모드 명시.
pdf-evidence-window/1 별도형식 및 lexical-pages/1 coverage; 실제원본page/ID 유지, 기존 v1 프로젝트에 주입금지.
auto-document 기본loader연결/coverage·상태, AutoReview 전체/보관/미보관/무텍스트 페이지 펼침/JSON 조사ID·URL추가.
실제07438cdb...의 SAP_00543페이지/Prot_004123페이지 각각 자동helper→실제pdfjs→후보3/입력15 READY.
SAP 후보p21,10,12/프로토콜p31,42,11. 둘 다40페이지보관, 프로토콜후반119/122포함, 캐시HIT/모델0.
초기진단 Origin누락403 후 기존경계맞춰재검사. 서버변경/검증완화없음. 실제준비검사는브라우저새조사완주아님.
웹전체815/build/Ruff/diff 통과, Python코드변경없음/직전606 유지. 새형식분리뒤 최종검사결과 확인.
CUA Chrome1/tab1907030730(trialTab) 첫화면동의/기록 읽기만. 새READY펼침/모바일QA미완.
API PID18815/exec50587 및 Vite5173 유지, 기존DB/WIP보존, commit/push/배포없음.
전체77%/기업25%. **다음1순위:** 희소원본페이지 저장/복구/뷰어계약 → 자동AI추출 인계. 탭/JSON만인한계 유지.
field_review_contract.py/field-review-restore.ts는 연속1~40페이지 가정. 한도만올리거나 원본번호재매김금지.

아래는 직전40페이지 병목 단계이며 최신 실제문서는 원문 준비에 성공했다.

2026-09-16 최신 ‘작업 계속 진행해’: [AUTO_DOCUMENT_PREPARATION.md](AUTO_DOCUMENT_PREPARATION.md).
신규 web/src/auto-document.ts: 동일 NCT/공식 등록 SAP·프로토콜 최대2개, 기존 문서 API/지문검사/파서/문구 후보.
auto-review.ts 조사 뒤 DOCUMENT 단계 자동 실행. AutoReview.tsx 동의 범위/5단계/후보·한도 실패/JSON 저장 표시.
문서당55초/전체370초, 기존5MB·40페이지 등 제한 유지. 추가 모델0회, 임상 AI 추출/설계 자동 실행 아님.
준비 입력은 탭/JSON만, 원본은 기존DB. 저장조사 재열기는 새 준비·모델 요청 없음.
신규 웹15+흐름1=16, 전체806/build/Ruff/diff 통과. Python변경없음/직전606 유지.
실제07438cdb-8633-4d11-b857-39d4b466f8ce의 doc_NCT04933695_SAP_005/Prot_004 다운로드·DB 성공.
파서 한도 실패 후 메타데이터 확인: SAP43/프로토콜123페이지. 확인 요청은 캐시 HIT, 모델0회.
실제 자동helper 실행 당시 UNREADABLE였고 이후 PAGE_LIMIT 별도분류를 추가/합성검증했다. 실제helper 새분류 재실행은 안함.
고정 FDA PDF→실제파서→입력 검사는 MOC연결이며 실제선택시험 문서 성공과 혼동 금지.
Chrome1/tab1907030730(trialTab)에서 동의/저장성공기록 재열기/원문 미실행 표시 확인. 새원문준비/모바일 QA 미완.
API PID18815/exec50587(8000)/Vite5173 유지. WIP/DB보존, 키 출력없음/값매칭 Git스캔 통과, commit/push/배포없음.
전체77%/기업25%. **다음1순위:** 긴 PDF 페이지 선택/검토 범위 추적 계약 → 준비 입력 저장/AI 추출 인계.

아래는 직전 시험 선정 단계다.

2026-09-16 최신 ‘이어서 작업해. 지금 계속 자동화 하는거지?’: [TRIAL_START_PRIORITY.md](TRIAL_START_PRIORITY.md).
신규 web/src/trial-priority.ts dose-start/1을 researchCandidates에 연결. 별도 시험군에서 정확한 약물명+상이한 mg 문구,
단일 약물 제목의 용량 탐색 신호, 없으면 기존 접근성. 별칭/암종/NCT 임의 변경 금지. 임상 검증 점수가 아니다.
AutoReview 범위 선택/새 결과에 TrialStart 선정 이유/원문 문구 표시. 범위 확인 시 작업 기록 접음.
evidence-scout arm.description null타입/런타임 검사. 신규 web tests15+흐름1=16개, 웹전체790/build/Ruff/diff 통과.
Python코드 변경 없으며 직전606통과. 새 공개검색2회/모델0회,72건중20건→적응증선택 UI/문구 확인.
저장검색07f0311a...의 NSCLC 범위는 기존과 동일한 NCT04933695,960/240mg 등록문구 표시. 선택이 바뀐 실증아님.
선정 정책/문구 영구저장 아직없음. 저장결과는 원래시험을 그대로 열고 새이유를 소급생성하지않음.
CUA Chrome1/tab1907030730(trialTab); 이전0856은 없어 기존0730 재사용. API PID18815/exec50587 유지, Vite5173.
전체77%/기업25%, 커밋/push/배포없음. 최신 정책 새 실모델/모바일/전체키보드QA 미완.
**다음1순위:** 원문 후보→안전한 본문 확보→추출 자동 연결. 다음 실모델 평가와 선정 정책 기록도 필요.

아래는 직전 근거 입력 선정 단계다.

2026-09-16 최신 ‘다음작업해’: [RESEARCH_RELEVANCE.md](RESEARCH_RELEVANCE.md) 구현.
신규 research/relevance.py dose-context/1; validation.plan_payload와 agent의 실제 검토 source선정에 연결.
등록정보 보존, 정확한 NCT 문구/결과 인용/약물+용량 비교 표현 우선, 배경은 동일 수준에서 후순위.
검토 PDF_AVAILABLE/METADATA 제외(수집/계획에는 유지). 임상 연결 NOT_VERIFIED, 기존2모델/인용 계약 유지.
calls[].context_selection은 출처ID/지문/선정 신호 기록. 기존 CITATIONS_READY에 입력 수/등록정보/선택NCT 논문 수 표시.
신규 합성22개; Python606/웹774/Ruff/diff 통과. 웹 코드변경/새 브라우저QA/새 유료모델 없음.
기존07438cdb... 저장82개 read-only 선정 대조, AI_FOLLOWUP외 링크로 초기55개 재구성.
새 입력8개 맨앞 registry_NCT04933695, 다음 paper_39029295(다른NCT 문구/미검증 용량 비교 후보).
선택NCT가 있는 논문0개 유지. 새 정책 실모델 성공이나 임상 품질향상으로 단정하지 않는다.
API idle 확인 후 재시작: PID18815/exec50587,8000,기존4flags+dacon+명시외부keyfile. Vite5173 그대로.
capabilities 및 과거 COMPLETE/82자료/8인용 GET 복구 확인. 기존DB/WIP보존, commit/push/배포없음.
전체77%/기업25%. **다음1순위는 최초 시험 선택의 용량 비교 목적 적합성**(이번은 이미 선택된 시험에서 자료 선정).
그다음 제한된 실제 모델 평가 및 자동 원문 확보→설계 초안 연결. 사용자 입력은 늘리지 않는다.

아래는 직전 실제 브리핑 완주 단계이며 서버PID와 최우선작업은 위 최신 기록을 따른다.

2026-09-16 최신 사용자: ‘다음작업해. 이제 완벽히 자동화로 사용자의 입력 최소화 하고 에이전트가 돌아가는 과정만 보여줄거야?’
방향: 약물 입력/전송 동의→모호한 범위만 확인→자동 조사→결과. 임상 설계 자동 승인 아님.
[SOURCE_SPAN_CITATIONS.md](SOURCE_SPAN_CITATIONS.md): 모델의 원문 재타이핑을 원문 구간 ID 선택으로 변경.
신규 research/citations.py, source-spans/1, 서버 원문 복사/기존 검증 유지/바인딩 기록, Python 신규20개.
웹 CITATIONS_READY 허용 목록 및 실제 Python API SSE→웹 reader 합성 회귀1개. Python584/웹774/Ruff/build 통과.
Chrome 새 입력 실제 첫 시도 0c22372f-bad1-4aff-9d8c-1ba45e6bb24b는 새 이벤트 미인식으로 CANCELLED(수정 완료).
계획6,147토큰, 취소 검토 요청 사용량 미확인. 두 번째07438cdb-8633-4d11-b857-39d4b466f8ce는 COMPLETE.
sotorasib/Non-small Cell Lung Cancer/NCT04933695,82근거/8인용쟁점/6KOL, 범위 확인 뒤 약36초.
대회 terra 계획/검토2회 모두 검증 통과,12,351보고 토큰. 이번 알려진 합계18,498+취소 요청 미확인 사용량.
총 최대4요청 시작/3응답 수신으로 종료, 추가 유료 재시도하지 말 것. 한 사례이며 임상 정확도/설계 자동화 검증 아님.
AutoReview 완료 후 작업 기록 접고 결과 우선 배치. 새 실행 자동 접힘은 UI 변경 후 유료 재실행 안 함.
API 최신 PID71466/exec81674,8000; 기존4flag+dacon+명시 keyfile(아래 외부파일 유지). Vite5173.
CUA trialTab Chrome1/tab1907030856. 실제 성공 기록 재열기로 인용/배치 QA, 새 모델 호출 없음.
전체77%/기업25% 유지. 커밋/push/배포 없음, 이전 WIP/DB/실패 기록 보존.
다음1순위: 용량 비교에 맞는 시험/직접 근거 선정 → 자동 원문 추출/설계 초안 연결. 입력을 줄여도 근거 부족을 숨기지 않는다.

아래는 직전 키 파일 저장·계획 검증 단계 기록이며 서버 PID/브리핑 미완료 안내는 최신 상태가 아니다.

2026-09-16 최신: ‘이어서 작업해’ + 대회 키를 파일로 저장하라는 명시 요청.
저장소 밖 `/Users/ryul/.config/trialboard/dacon-api-key`, 디렉터리700/파일600로 저장. 키 내용 출력/복사 금지.
API `--dacon-key-file` 추가: 본인 소유/POSIX 권한/일반 파일/비링크/크기 검사, 프런트 노출 없음.
최종 API PID60064/exec49584,127.0.0.1:8000,4flag+dacon+명시 키파일. 최신 코드로 재시작했고 Vite5173은 유지했다.
AGENTS의 과거 파일 금지 지침을 최신 사용자 승인 예외로 갱신. 키 값은 Git/문서에 없으며 저장소 값 매칭 검사 통과.
`source-bound/1` 계획·검토 요청 schema에 입력 출처 ID enum/검색어 pattern, 별도 서버 검증 유지.
안전한 필드명/오류 분류·대회 HTTP 코드만 진단에 보존, 원응답/추가 키이름/예외 원문 저장 없음.
`python -m trialboard.research.plan_probe`는 기존 DB읽기 전용/추가 검색0/모델1회/명시 동의/값 출력 없는 진단 경로다.
실제 계획 probe: 기존55개→입력24개, 우선순위6/후속어2 통과, terra1회6,286토큰.
실제 조사 `7c4ccc9a-d061-4533-9d36-b28943a0085b`: 이전 검색 문맥 재사용, 계획 통과→후속검색2회→근거85개,
마지막 인용 검증 `UNSUPPORTED_REVIEW_CITATION`로 review없음/PARTIAL.42.3초,2회11,666토큰.
이번 추가합계3회/보고17,952토큰. 호출한도를 여기서 종료. 개인fallback 없음. 브라우저 첫입력 전체 QA와 구분한다.
이전55개 실패의 정확한 원인은 소급 확정 못함. 새로운 성공한 계획+수집 자료는 DB에 저장됐고 인용 실패는 숨기지 않았다.
Python564/웹773/Ruff/build 검증. 첫Python전체에서 기존 macOS Codex killpg PermissionError1회, 단독+전체재실행 통과.
신규35개 합성 검사. 재실행 통과를 기존 간헐오류 해결로 보고하지 않는다. 최신 자세한 기록 [RESEARCH_VALIDATION_RUN.md](RESEARCH_VALIDATION_RUN.md).
실제85개 저장 결과를 웹 `readResearchResult`로 읽어 데이터 계약 통과/PARTIAL/plan있음/review없음을 확인했다. 새 브라우저 화면 QA는 하지 않았다.
전체77%/기업25% 유지. 미커밋 WIP/기존 DB보존, push/배포 없음.
**다음1순위:** 모델이 인용문을 재작성하지 않고 원문 구간 ID를 선택하도록 검토 계약 강화 → 실제 브리핑 완주.

아래는 직전 자동화 UI 구현 당시 기록이다. 키 재입력/서버 구버전 안내는 최신 상태가 아니다.

2026-09-16 최신 요청: ‘왜 수동 입력/클릭이 많고 에이전트 느낌이 없는가’ → ‘다음 해봐’.
[AUTO_REVIEW_WORKFLOW.md](AUTO_REVIEW_WORKFLOW.md) 구현. `AutoReview.tsx`/`auto-review.ts`/CSS, main 기본 탭/보조 메뉴 변경.
약물명 하나·전송 동의 하나 → 모호한 범위만 확인 → 기존 실제 조사 API → 결과/인용/KOL/저장 기록 복귀.
자동 PDF 추출·설계 제안·시뮬레이션까지 완료한 것은 아니다. Sites 지침에 따라 기존 MUI/로컬 구조 유지, 배포 없음.
실제 Chrome 대회 실행 `43cd440d-3a58-4a6c-bd38-c8e3e141aad9`: sotorasib/NCT04933695, 근거55개/약17초,
terra 계획 응답1회/보고6372토큰, 검증 실패로 plan/review없음/PARTIAL. 추가 모델 호출/개인 fallback 없음.
55개 부분 결과 복귀 확인. 예전 개인 Codex 86개/8쟁점/6질문 기록은 결과 레이아웃/인용/상세 검토 연결 QA용으로만 열었다.
새 진단 코드(`research/agent.py`)는 오류 종류 allowlist/validation 상태/수신 사용량 보존이며 원문/비밀키 저장 없음.
API PID12342/exec60303은 이전 코드+키 메모리 상태 그대로. 새 진단/정규화 적용에 사용자 비표시 키 재입력과 재시작 필요.
키를 지금 입력할 수 있는지 비동기 질문을 보냈지만 아직 응답 없음. 키를 파일·명령 인수·로그에 복사하지 말 것.
Python529/웹773/Ruff/build/diff 통과. 데스크톱 UI 직접 확인, 새 화면 모바일/전체 키보드 QA 남음.
마지막 공개 검색 QA는 sotorasib72건/20건 확보 → 범위 목록/선택 후 버튼 활성 → 입력 복귀. 추가 모델 호출 없음.
종료 화면은 자동 검토 첫 화면, sotorasib 입력/동의 해제 상태다. 최근 부분 조사와 기존 DB는 유지했다.
전체 추정77%/기업25% 유지. 자동화 성공률과 분리한다. 이번 및 앞선 정규화 WIP 보존, 커밋/push/배포 없음.
**다음1순위는 대회 계획 검증 원인 분류 및 실제 AI 브리핑 완주.** 아래 이전 표 계약 우선순위보다 최신 자동화 목표가 먼저다.

아래는 직전 정규화 작업 기록이다.

2026-09-16 최신 요청: ‘다음 단계 빨리 시작’. [RATE_NORMALIZATION.md](RATE_NORMALIZATION.md) 구현.
원문 숫자와 단독 인접 `%` 근거를 별도 보존하는 review v3 + 사용자 해석 메타데이터.
UI 두 확인 항목/사유/원문 대조 → 이력/복구 → 재검증 → AI 입력/설계 검증/Markdown 연결.
아래 대회 연결 변경까지 HEAD/origin main은 `013059793fcca5080875eacdfebfdcc64873bd5a`였다.
이번 변경은 미커밋이며 push/배포 없음. 기존 작업/DB는 보존했다.
검사 Python524/웹757/빌드/Ruff. 기존 MUI use-client/청크 크기 및 테스트 deprecation 경고 유지.
추가 모델·외부 검색 0회. 전체77%/기업25% 유지. 자동 시험은 합성 자료이며 임상 성능 시험이 아니다.
브라우저 Chrome1/탭1907030730: MOC PDF의 새 비율 행/보고 비율 UI/근거 없을 때 기록 비활성/패널 간격 확인.
해석 성공 전체 UI·모바일은 아직 미검사. 브라우저에 이번 QA용 빈 MOC 관측값이 남아 있으며 DB에는 저장하지 않았다.
중요: API PID12342는 이전 코드가 메모리에 올라와 있다. 키도 그 프로세스 메모리에만 있어 이번에는 유지.
새 계약을 브라우저→API로 사용하기 전 비표시 키 입력 절차와 함께 API 재시작 필요. Vite는 HMR 적용.
다음: 실제 FDA 열 머리글/행열/집단/CI 검증 → AI 최초 다중 인용 추출 → 대회 실제 실행/전체 복구.
인접 `%` 기능을 FDA p19의 원래 실패 사례 해결로 보고하지 말 것.

아래는 직전 대회 API 전환 기록이다.

2026-09-16 추가 요청: 개발 Codex는 그대로, 제품 에이전트만 대회 API 사용. 기존 키 테스트 승인.
최신 작업/README는 `736f655`(중단 조사 복구), `720cfbf`(근거/UI), `06503d8`(실행 안내) 3커밋을 origin/main에 push/원격 SHA 일치 확인했다.
그 뒤 [DACON_RUNTIME.md](DACON_RUNTIME.md) 구현: 고정 endpoint/api-key/3모델 allowlist,
제품 API·CLI 기본 dacon/개인 Codex 명시 선택/자동 fallback 없음. 키는 환경/비표시 입력만, 파일 없음.
실제 기존키 smoke77토큰 + 고정 공개 추출/검증/반론2요청5,901토큰 = 총3요청5,978토큰.
결과 DACON_RESPONSES/gpt-5.6-terra/초안2/부분보류. 임상 성공 또는 실자료 전체 설계 완주 아님.
최종 API PID12342/exec60303,127.0.0.1:8000,4flag+dacon. 키는 이 프로세스 메모리에만 있어 재시작하면 다시 비표시 입력 필요.
Vite5173 유지. 대회 연결 검사와 API 실행은 개인 Codex를 호출하지 않았다. 개발 도구 로그인은 그대로다.
자동 검사 Python503/웹751/build/Ruff. 전체77%/기업25% 유지. 대회 PDF/조사/UI 전체 실제 완주는 후속.
기존 Chrome 탭의 에이전트 브리핑에서 대회API/terra/팀공용/개인Codex미사용 안내와 미동의 실행 비활성 확인.
아래 저장 기록은 이전 Codex 사례로 별도 표시됨을 확인. UI 점검 중 추가 모델 호출 없음.

아래는 직전 Git 공유 요청 기록이다.

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

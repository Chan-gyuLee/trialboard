# 저장 자료 재검토 화면 / 부모 구현·독립 검수

사용자 개인계정 개발 지속 승인에 따라 부모가 UI·reader를, personal_product_c1가 서버를 병행했다. 대회API/원본영상/실DB/배포는 변경하지 않았다.

## 화면

frontend-design을 읽고 기존 DM Sans/Noto Sans KR, ink#15223b/navy#122346/blue#2855e8/muted#59677f/line#dbe2ef/canvas#f5f7fc를 유지했다. 기존 최근 검토/최근 조사에서 진입하며 한 패널에 출처선택→명시동의→1회실행→인용·질문을 왼쪽 정렬로 배치했다. 새로운 장식·폰트·이미지·자동모션을 추가하지 않는다.

- SOURCE_TEXT 원문조회와 외부AI 전송이 모두 ALLOW인 출처만 최대8개 선택 가능.
- 선택 변경·목록 재조회 시 동의를 초기화하고 숫자1이 아닌 실제 boolean true만 POST한다. 정확한 source/digest/policy revision을 보내며 원문/임의프롬프트/모델은 받지 않는다.
- 자동 모델호출/재시도 없음. CAS409는 현재선택을 보존하며 사용자가 새로고침·재선택·재동의한다.
- metadata-only SSE 뒤 해당 attempt의 권리검사 GET을 거쳐 표시한다. 원래Collection과 별도 결과이며 PDF전문/새수집/계획호출을 하지 않는다.
- 조회거부 시 이전표시 결과를 지우며, generation/AbortController로 중단·닫기·다른run의 지연응답을 버린다. 중단이 이미 전송한 요청의 비용취소를 보장하지 않음을 표시한다.
- 정책관리 도움말을 현재 조사텍스트 전송집행에 맞췄다. PDF/raw/일반자동화는 별도 미완료 경계로 명시한다.

## 파일

신규 `web/src/saved-research-review.ts`, `SavedResearchReview.tsx`, `web/tests/saved-research-review.test.mjs`, `web/scripts/check-saved-review-ui.mjs`. 기존 ReviewNavigation/ResearchPanel 진입, source-policy.css, SourcePolicyManager 문구를 부모가 수정했다.

## 검증

- 새6tests: target/source/revision, 허가/상한/명시동의, 인용digest·유니코드offset, 상태/목록내용누출, SSE순서·내용누출·불완전종료, 실제TEAM FastAPI+fakeprovider 응답/SSE→TS엄격reader roundtrip. 모두통과. Python fixture는 임시DB,1fakecall이며 대회호출0.
- TypeScript/Vite production build 통과. 기존 MUI use-client 경고와 chunk>500kB 경고가 남으며 경고를 숨기지 않았다.
- 실제컴포넌트+합성API 1440/390: 거부출처disabled/명시동의/409입력보존·새revisionPOST/완료인용/권리철회시결과clear/중단후지연결과무시/키보드진입 통과. pageerrors[]/overflowfalse. 부모가 두 화면 직접검토.
- 부모 C2 관련32Python 독립회귀 통과. 저장검토추가후 전체웹/서버독립회귀는 진행 중이며 후속기록으로 대체한다.

당시 사용률37%, secondary미제공. 전체계획추정79±10%p 유지. 당시45% 선제중단 지시는 최신 사용자 요청의 **50% 중단 / 48%부터 작은 검증 단위**로 대체했다.

최종 부모 추가검증: 전체웹1071pass/1skip/0fail, 신규6tests의 실제서버→TS roundtrip 통과. JSON/SSE에 기존 strictJson을 적용해 중복키도 거부하고 신규6tests+1440/390 QA를 재실행해 통과했다. 부모 서버독립회귀는 최초 과대본문413/422 기대불일치1건을 확인했고 기존공통경계413을 올바르게 기대하도록 자식수정 후 **관련33tests 전부통과**했다. 이 실패를 제품허용범위 완화로 해결하지 않았다. 부모 최신usage RPC1790833128 주간38%/secondary없음. 최종QA스크린샷 임시경로는 `trialboard-saved-review-ui-Dvnm7v`이며 이전직접시각확인본과같은레이아웃이다.

후속 UI 교차 검수: 취소 뒤 늦은 SSE 완료가 결과 GET을 시작하지 않도록 각 await 경계에서 현재 작업을 확인한다. 결과 수신 후 실행 목록 갱신이 거부되면 이전 결과도 지운다. 자식 1440/390 재검증, 부모 최신 전체 웹1076 통과/1건너뜀 및 TypeScript/build 통과.

종료 기록 불명확성 보완: RUNNING은 서버 프로세스가 살아 있다는 증명이 아니므로 ‘종료 기록 없음’으로 표시한다. 초기 기록의 model_calls=0을 실제 사용량0으로 보여주지 않고 ‘호출 수 미확정’으로 안내한다. 실제 실행 중 또는 서버 중단 가능성을 설명하며 자동 재시도하지 않는다. 1440/390 합성 QA에서 안내/미확정/추가POST0/가로넘침0 통과. 임시 스틸 `trialboard-saved-review-ui-Zu9D5p`.

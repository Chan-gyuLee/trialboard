# 수집 원본 JSON 이용조건 화면 · 2026-10-01

개인 계정 개발. 실제 수집·모델 호출·실사용 DB 변경 없이 임시 TEAM DB와 합성 JSON/API로 검증한다. R1은 기존 저장 원본의 정확한 버전별 정책 단계이며 신규 수집의 사전 저장 허가 R2는 후속이다.

## 화면과 계약

- 최근 검토 → 수집 원본 이용조건. 자료 내용을 열지 않고 출처명·출처 지문·원본 지문·바이트 수로 선택한다.
- `ResearchRawPolicy.tsx`와 `research-raw-policy.ts`: 정확 run/source/sourceDigest/snapshotDigest 결속, 기본 UNKNOWN, SOURCE_TEXT/PDF 정책 재사용 금지, owner/admin 확인, 별도 4목적과 확인 근거·사유, 변경 이력.
- 충돌 시 작성 내용 보존/명시 최신 이력 조회 후 직접 저장. 다른 원본 전환·창 닫기 뒤 늦은 응답 무시. 권한 회수 시 이전 정책 상세 제거/쓰기 차단. 모델 실행과 자동 재시도 없음.
- reader는 필드 추가·중복 출처/원본·잘못된 지문·bool revision·끊어진 이력·미확인 자동허가·본문 혼입·잘못된 UTC/Unicode를 거부한다. sources500/출처당원본100/run bindings1000/원본5MB/이력100 한도.

## 확인한 결과

- reader **4개 통과**. 실제 TEAM 임시 DB의 metadata→정책 POST→metadata/history를 TypeScript로 읽는다. 동일 JSON SHA가 두 출처에 연결돼도 한 출처 허가만 ALLOW, 나머지는 UNKNOWN. 원문 내용 응답 유출0/provider factory0/call0.
- 첫 실행은 Node strip-only 모드가 TypeScript constructor parameter property를 지원하지 않아 실패했다. 명시 클래스 필드 대입과 `.ts` import로 수정 후 통과했다. 테스트를 삭제하거나 우회하지 않았다.
- 실제 컴포넌트/TEAM context/StrictMode 합성 브라우저 QA `check-raw-policy-ui.mjs`, 1440/390: 키보드 진입, 정확 원본·CAS request, 충돌 입력 보존, 성공, 다른 원본 지연 응답 무시, 읽기 전용,403 상세 제거. 각 합성 POST2회, 실제 모델0, 가로 넘침0/pageerror0.
- 스크린샷으로 직접 시각 확인. 기존 흰 바탕·파란 제품 색·본문 서체를 유지하며 긴 지문은 줄바꿈한다.
- TypeScript 검사와 diff 검사는 통과. 서버 R1 추가 검사/공통 파생 게이트는 별도 진행 중이며, 이 화면만으로 전체 raw 권리 집행 완료라고 주장하지 않는다.

후속 R1 연결 후 부모 전체 Python **994개 통과/기존 경고2(131.49초)**. 부모 RAW28 회귀 및 Ruff 통과. 서버는 현재권리+실제자료 조회를 동일 SQLite snapshot에서 수행하며, FTS/결과표/저장재검토/기존모델전송/저장파생 결과에 RAW 교집합을 적용했다. 요청 내 고유 원본 총25MB 제한과 동일SHA 중복 파싱 방지, 유효UTC·정책 연속성 검사를 추가했다. R2 신규 사전저장 허가는 다음 개발 단계다.

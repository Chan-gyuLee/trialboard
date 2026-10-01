# PDF 이용조건 화면 / 부모 구현·검수

C3A 서버와 확정된 RESEARCH_PDF_POLICY_CONTRACT_2026-10-01.md를 따른다. 실제 개발은 개인 계정, 검증은 합성 응답/임시DB/가짜 PDF뿐이다. 실다운로드·대회호출·원본영상·실DB·배포는 하지 않았다.

## 구현

- 기존 최근조사/최근검토에 ‘PDF 이용조건’ 진입 추가. 기존 제품 색상·글꼴·패널/모바일 배치를 frontend-design 기준으로 재사용했다.
- `research-pdf-policy.ts`가 exact run/sourceDigest/pdfSha·정책이력·명시 boolean·본문없는 metadata를 검증한다. SOURCE_TEXT를 PDF_BYTES로 받아들이거나 LEGACY_UNBOUND에서양의허가를받는응답을거부한다.
- 새PDF는 근거·사유·명시체크박스를 갖춘 별도 storage_permission POST. 서버응답 PDF길이/Content-Type/SHA를 확인한다. 사용자명시저장허가만그파일에연결,externalAI권리자동부여없음.
- 기존PDF는파일버전선택·네목적기록·CAS409작성보존/최신조회·권한회수잠금. 다목적기록은PDF자동모델실행을열지않는다고표시한다. legacyreceipt는명시확인전UNKNOWN을명시한다.
- run/source/version 변경 및 StrictMode effect재실행에서 AbortController/generation으로오래된응답을폐기한다. 다운로드이미발생한경우 클라이언트닫기가서버작업취소를보장하지않는점은실행감사와구분한다.
- 기존PdfWorkspace의403/409에최근조사→PDF이용조건확인경로를안내한다.

## 검증

- 신규4웹tests:metadata원문/URL비노출,source/pdfdigest강결속,legacy권리자동상승거부,불변이력·CAS,실제TEAM fake-download API의metadata/history→TSreader 왕복. 초기Node검사에서확장자없는runtime import를찾지못한1실패를 `.ts` 명시로보정한뒤통과했다.
- 실제StrictMode컴포넌트+합성API 1440/390에서키보드진입,다운로드전명시동의/네트워크0,수신sha확인,external_ai UNKNOWN,409입력보존/정확revision저장,권한회수readonly,잘못된수신sha거부,콘솔오류0/가로넘침0 통과. 부모가 두스크린샷직접확인.
- 부모전체웹1075pass/1skip/0fail,TS/Vite build통과. 부모서버독립관련47tests통과. 자식전체Python852pass/경고2는별도C3서버문서참고.
- 교차 검수 완료: 복수 버전에서 선택한 SHA의 정확한 캐시 GET을 호출하는 파일 저장 버튼을 추가했다. 서버의 현재 권리 검사와 클라이언트의 선택 SHA/응답 헤더/실제 수신 해시/PDF 형식 검사를 모두 거친다. 읽기 전용 사용자는 허가된 파일만 받을 수 있다. 이미 내려받은 파일을 권리 철회가 회수한다고 주장하지 않는다.
- 수정 후 부모 전체 웹 **1076 통과 / 1 건너뜀**, TypeScript/Vite build 통과. 자식의 별도 실컴포넌트 QA는 1440/390에서 두 번째 버전 선택, 키보드, SHA 불일치 및 권리403의 다운로드 차단을 확인했다. 부모 독립 재실행 결과는 아래에 추가한다.

## 경계

부모 후속 검수: `check-pdf-exact-download-ui.mjs`를 독립 실행하여 1440/390 모두 통과했고 모바일 스틸을 직접 확인했다 (`trialboard-pdf-exact-ui-7ThOCV`). 이후 수신 전체를 먼저 메모리에 올리는 방식 대신 5MB 제한 스트림 읽기로 보강했다. Content-Length를 신뢰하지 않으며, 초과·중단 시 reader를 취소한다. 분할 수신/거짓 길이/초과/취소/전송 오류를 포함한 PDF reader 7tests, TypeScript, 동일 1440/390 QA 재실행 통과 (`trialboard-pdf-exact-ui-UFKPcv`). 이 보강 이후 전체 웹 개수는 후속 전체 회귀에서 갱신한다.

PDF자동화 외부모델은여전히차단. 서버PDF본문검증/준비artifact와별도전송승인은후속이다. raw수집권리,예약큐,완전의존성/임상·운영검증은완료하지않았다. 사용률은최신사용자지시로50%중단(이전45%는이력),48%이후작은단위로마무리한다.

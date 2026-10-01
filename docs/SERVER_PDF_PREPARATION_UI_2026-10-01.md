# 서버 PDF 본문 준비 화면

최신 사용자70% 개인 개발 승인으로 부모가 UI/엄격 reader, 기존 자식이 metadata·모델 gate를 분담했다. 대회 API 실호출·영상·실사용 DB·배포·commit 변경은 없다.

## 구현

- PDF 이용조건에서 정확한 저장 버전을 선택한 뒤 ‘서버 PDF 본문 준비’를 연다. 열기만으로 파서나 AI를 실행하지 않는다.
- 서버 capabilities가 UNSUPPORTED_SANDBOX면 새 준비 버튼을 비활성화하고, 기존 준비본 조회는 허용한다. Linux의 RUNTIME_CHECK_REQUIRED도 실제 실행 제한 성공을 보장하지 않는다.
- 새 준비는 저장 권리·실제 관리 권한·명시 동의가 필요하다. 서버가 처리할 파일 SHA/출처 digest/정책 revision만 보내며 브라우저 본문은 보내지 않는다.
- 최근 준비본 최대30개 선택/조회, 새 준비 성공 시 목록과 선택을 함께 갱신한다. 본문을 쪽별로 펼쳐 볼 수 있고 텍스트 없는 쪽은 그대로 표시한다.
- `server-pdf-preparation.ts`는 정확 root/target/UUID/정책 revision/limits/Unicode 문자 수와 canonical SHA를 검증한다. 추가 인용·좌표 필드나 임상 승인 주장을 허용하지 않는다.
- 권리 철회·잘못된 응답 시 기존 본문 제거, 닫기/다른 버전/StrictMode의 지연 응답 폐기. 별도 AI 실행은 다음 단계로 분리한다.

## 검증

- 신규4 reader tests: 준비본·capabilities·목록의 엄격 계약, 변조된 본문/limits/모델호출/가짜 좌표/Unicode 한도, 실제 TEAM 임시DB+합성 파서의 세 API → TypeScript canonical SHA/reader 왕복 통과. 실제 모델0.
- TypeScript 통과. `check-server-pdf-preparation-ui.mjs` 실제 StrictMode 컴포넌트+합성 API 1440/390: unsupported 차단, 명시 동의,409 안내, 정상 준비, 본문 변경 거부,403 기존 본문 제거, 읽기 전용, 닫기 뒤 늦은 결과 무시, 모델POST0/overflow0/pageerrors0 통과. 부모 모바일 스틸 직접 확인.
- 첫 QA는 fixture 접근 모드를 실제 계약에 없는 `local`로 지정해 실패했다. `legacy_loopback`으로 fixture만 고친 뒤 통과했으며 제품 권한 검사를 약화하지 않았다. 이는 전체 인증 브라우저 E2E가 아니라 실제 컴포넌트 합성 QA다. 실제 TEAM 계약은 별도 임시 서버 roundtrip으로 검증했다.
- 직접 시각 검수에서 새 준비 성공 뒤 ‘저장된 준비본 없음’이 남는 문제를 찾아, 성공 응답으로 목록도 갱신했다. 추가 검증 후 양쪽 화면 재통과. 최종 임시 스틸 `trialboard-server-preparation-ui-g9xHVp`.
- 부모 backend 관련59tests 독립 통과/기존 경고2. 자식 전체 관련116은 C4 문서에 별도로 기록. 실제 Linux 정상 PDF 추출 성공이나 운영·임상 검증으로 확대 해석하지 않는다.

## 다음

서버 준비본에만 결속된 PDF REVIEW-only 요청/SSE/별도 결과·사용량 화면을 이어 붙인다. 기존 브라우저 임의 추출문에 기반한 TEAM automation/run 차단은 그대로다. 준비본 원래 정책 이력과 현재 외부 AI 전송 허가 이력을 구분한다.

# 수집 원본 권리 경계: 다음 단계 감사

개인 계정 개발 중 읽기 전용 코드 감사. 실제 자료 수집·모델 호출·실사용 DB 변경은 하지 않았다. 이는 구현 완료 보고가 아니다.

## 확인한 실제 경로

- `research/collect.py`: registry, 논문 검색, regulatory 수집 응답을 `store.snapshot(data)`로 보존한다. 공개 URL이라는 이유만으로 이용 목적별 권리가 검증되는 것은 아니다.
- `research/store.py:snapshot`: canonical JSON의 SHA를 키로 snapshots에 저장한다. 지금은 목적별 RAW_SNAPSHOT 정책이나 사전 저장 허가를 인자로 받지 않는다.
- `research/result_tables.py:registry_results`: Source.raw_snapshots의 지문으로 저장 JSON을 읽고 실제 SHA를 확인한 뒤 시험 등록 결과표를 만든다.
- 위 결과표 함수는 API result-tables, 최초 registry 수집, exploration, automation에서 재사용된다. API의 SOURCE_TEXT require_content만으로 RAW_SNAPSHOT 권리가 확인되지는 않는다.
- 기존 SOURCE_TEXT·PDF_BYTES 정책은 독립 자원 정책이다. 이를 원본 JSON 허가로 자동 재사용해서는 안 된다.

## 후속 구현에서 필요한 결정

1. 저장 전 명시 허가: 수집 응답의 실제 SHA는 응답을 받은 뒤에야 알 수 있으므로, 사전 허가의 수집 대상·범위와 실제 bytes의 결속 방식을 먼저 계약으로 정한다. 기존 DB의 원본을 자동 ALLOW로 이관하지 않는다.
2. 조회 및 파생물: 정확한 run/source/snapshot SHA를 검증하는 정책을 결과표·exploration·automation의 공통 원본 읽기 경로에 적용한다. API 한 곳만 막는 것으로 완료 처리하지 않는다.
3. 수집과 저장을 구분: 금지/미확인 원본을 로그나 디스크에 우회 보관하지 않는다. 기존 자료는 삭제하지 않고 접근 경계를 분리한다.
4. 장기 실행 중 세션·권한·정책 재검증, 원본 SHA 변조, 다른 팀/출처 연결, 읽기 요청의 DB 생성 방지, legacy 호환을 합성 자료로 검증한다.

현재는 미구현 경계를 명시적으로 기록한 상태이며, 이 문서만으로 전체 수집 권리 집행이 완료되었다고 주장하지 않는다. C3B1 서버 PDF 준비와 파일 범위가 겹치므로 동시 변경하지 않았다.

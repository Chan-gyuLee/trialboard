# TEAM 수집과 AI 검토 분리 · 2026-10-01

R2 서버 사전저장 권리와 연결한 프런트 작업이다. 실제 TEAM 라우트·임시 DB·가짜 수집기의 서버→브라우저 계약 검증까지 통과했다. 외부 서비스 실수집·실모델 성공을 뜻하지 않는다. 부모·기존 개인 에이전트만 개발하며 실 모델·실 수집·실 DB·영상·배포 변경 없음.

## 계약과 사용 흐름

1. 원본 수집 경로 REGISTRY/LITERATURE/REGULATORY 중 사용자가 선택한 경로마다 `original_storage: ALLOW`, 허가 근거, 사유를 기록한다. 공개 주소를 허가로 자동 해석하지 않는다.
2. 공개 검색 동의 후 수집한다. 초기 시험 찾기 EvidenceStore는 별도 검색 동의 경로이며 이번 research RAW 정책의 적용 범위라고 주장하지 않는다.
3. TEAM 조사 요청은 `model_consent:false`, `raw_storage_permissions`를 명시한다. AI 설정이나 대회 API 키를 수집 기능의 전제로 삼지 않는다.
4. 완료 뒤 whole-run 본문을 열지 않고 SOURCE_TEXT/RAW metadata만 읽는다. 출처·원본 이용조건을 각각 관리한 후 기존 SavedReview로 명시 동의한 자료를 1회 검토한다.
5. 사용자 선택 변경은 수집 동의를 취소하고, 새 수집은 허가 선택·근거를 초기화한다. viewer는 조회 전용, 실패·중단 후 자동 재시도 없음.

AutoReview와 ResearchPanel 양쪽에 적용한다. 기존 legacy 루프백 자동조사·추출 흐름은 유지한다. 이미 저장한 과거 Collection에는 새 권리 필드를 만들어 끼워 넣지 않으며, 필드가 있을 때만 엄격히 검증한다.

## 구현 파일

- `raw-storage-consent.ts`, `RawStorageConsent.tsx`: 최대3/중복scope금지/저장ONLY/추가필드금지/근거·사유 한도·Unicode.
- `team-research-collection.ts`: 모델 준비 확인 없이 공개 수집 capability 확인, 기존 검색 기록·범위 선택 재사용, 자료 수집 1회, metadata만 후속 GET. 예상하지 않은 AI 이벤트 거부.
- `AutoReview.tsx`, `ResearchPanel.tsx`: TEAM 전용 2단계 흐름, 별도 수집 진행 표시, 모델·PDF 실행 없음, 권리 관리 진입. legacy 기존 8단계 실행 표현을 TEAM 수집 완료에 잘못 사용하지 않는다.
- `research.ts`: 선택적 `raw_storage_permissions` 검증. 과거 이력 호환.

## 검증 경과

- 새 팀 수집 helper6 + 기존 auto-review20 =26 통과. 새 필드/기존 research reader 포함 별도32통과.
- 저장 허가 없거나 공개 동의 없거나 로컬 외부 위치면 요청0. 중단·403·미완료 stream 자동 재시도0. scope 선택 뒤 최초 검색 재전송0. 모델 capability/PDF/자동화/본문 GET0.
- request reader 테스트1건은 null-prototype JSON 객체를 일반 객체와 deepStrictEqual 비교해 실패했다. 기존 엄격 JSON parser는 유지하고 시험 비교를 JSON 값으로 정규화해 수정했다.
- AutoReview 실제 TEAM context/StrictMode/1440·390 합성 QA 통과. 수집2 POST(초기검색1/조사1), 선택REGISTRY만 전달, model_consentfalse, 원본권리 변경시동의해제, 새수집권리초기화, viewer비활성, overflow/pageerrors0.
- 첫 모바일 시각 점검에서 기존 composer CSS가 중첩 허가 입력창까지 덮는 것을 발견했다. `.raw-storage-consent`로 입력창 스타일을 제한해 테두리·본문 크기를 복구하고 재검증했다. 출력 `/var/folders/nq/5rr31cs56rsgsvvmxnnmzffw0000gn/T/trialboard-team-collection-ui-CE2Xgb/intake-390.png` 직접 확인.
- 수동 ResearchPanel까지 합친 실제 두화면 UI 재검증 1440/390 통과. 각 합성 POST3회(초기검색1+AutoReview수집1+수동수집1), 선택REGISTRY만 전달, model_consentfalse, 모델/PDF POST0. 출력 `/var/folders/nq/5rr31cs56rsgsvvmxnnmzffw0000gn/T/trialboard-team-collection-ui-szoe97`.
- 최종 수집 helper **8개 통과**. 실제 TEAM 라우트/임시 DB/가짜 수집기로 전체 경로 두 번 및 REGISTRY만 한 번 실행했다. 실제 SSE·SOURCE/RAW metadata·권리 허가 뒤 Collection 응답을 TS reader로 검증했다. SOURCE 미허가는403, RAW는storage만ALLOW/나머지UNKNOWN, 반복 논문의 같은본문SHA·별도수집시각·다중원본 연결 및 등록결과표 출처 보존을 확인했다. 외부 모델·수집 호출0.
- 전체웹 **1109통과/1skip**, TypeScript/Vite 통과. 수동 조사 화면도 수집 전용 상태에서는 요청하지 않은 AI 계획·검토 단계를 표시하지 않도록 보정했다. 이 보정 후1440/390 두화면 재검증 통과, `/var/folders/nq/5rr31cs56rsgsvvmxnnmzffw0000gn/T/trialboard-team-collection-ui-PdWqAX`.
- 자식 읽기전용 교차감사에서 수동수집의 취소후buffered COMPLETE 표시 및 예상밖AI이벤트 수용 차이를 발견했다. `readTeamCollectionStream`을 양쪽에서 공유하고 이벤트별·완료후abort검사,수집단계allowlist를 적용했다. 관련9웹tests 및 실제1440/390에서abort를무시하고늦게오는응답/AI_PLAN 응답을가로채어 완료표시0검증통과. 최신QA `.../T/trialboard-team-collection-ui-gn3BAk`, 각합성POST5(기존3+취소1+비정상이벤트1),실모델0/overflow0/pageerrors0. 검사기준을완화하지않았다.

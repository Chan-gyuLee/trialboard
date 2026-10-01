# Legacy 조사 context 분리 가져오기

TEAM checkpoint 가져오기는 기본적으로 과거 조사 `context`가 있으면 `LEGACY_CONTEXT_RELINK_REQUIRED`로 거부한다. 사용자가 선택한 PDF·bundle에 대한 공개/사용 허가·비민감 저장 확인과 별도로 **“과거 조사 연결을 분리하고 원본 이력으로 보존”**에 동의한 경우에만 분리 가져오기를 진행한다.

서버는 원본 PDF와 원본 bundle 전체 계약을 먼저 검증한다. 그 뒤 최상위 `context`만 `null`로 바꾼 `legacy-context-detach/1` working bundle을 결정적으로 생성하고 다시 검증한다. 과거 receipt/run/source ID를 현재 팀 객체로 조회하거나 권한 근거로 사용하지 않으며 새 조사·모델 실행도 만들지 않는다. review/agent/design/meeting raw 값은 그대로 유지하지만 모두 `imported_non_authenticated_history`로 표시하며 새 작성자·검토 승인으로 취급하지 않는다. 안전하게 재검증할 수 없는 중첩 계약은 `LEGACY_CONTEXT_DETACH_UNSAFE`로 거부한다.

Preview는 새 TEAM 저장소나 스키마를 만들지 않고 원본/working bundle hash, context 분리 여부, 입력 전체에 묶인 preview digest를 표시한다. 제목·PDF·bundle·공유 범위·ACL·분리 동의가 바뀌면 commit이 거부되어 preview를 다시 해야 한다. Commit은 checkpoint, 저장 확인, 중복 registry, 불변 provenance를 한 트랜잭션으로 만든다. 동일 원본 또는 동일 sanitized working bundle의 반복·동시 import는 하나만 성공한다.

원본 bundle bytes/hash/context, 실제 가져온 TEAM subject·시간, 변환 버전은 프로젝트 ACL로 보호되는 provenance에 보존된다. 일반 목록과 중복 충돌 응답에는 이 원본 이력이 노출되지 않는다. 프로젝트를 열면 원본 hash와 “현재 팀에서 검증되지 않은 과거 연결” 표시를 확인할 수 있다.

실제 현재 팀 조사 receipt/run/source에 재연결하는 기능은 아직 없다. 필요한 경우 새 현재 팀 조사를 별도로 실행해야 한다.

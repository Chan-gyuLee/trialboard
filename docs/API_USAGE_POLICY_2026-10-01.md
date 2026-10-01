# API 사용 분리 — 2026-10-01

## 최신 사용자 결정

- 대회 API는 TrialBoard 제품의 실제 모델 실행 전용이다.
- 개발·영상은 개인 계정의 현재 개발 세션에서 한다. 기존 Dacon 개발 위임 및 자동재개 승인은 철회한다.
- 개발 worker는 키 읽기/프로세스 생성/네트워크 호출 전에 종료 코드 2로 차단한다. 과거 구현/산출물은 보존한다.
- 제품 런타임은 기존 `dacon` 기본값과 `gpt-5.6-terra`, `api-key` 헤더를 유지한다. 자동 개인 계정 fallback/전송 재시도는 없다.
- 개인 로그인 인증 파일이나 전역 Codex 로그인은 읽거나 변경하지 않았다.

## 최소 연결 확인

승인된 저장소 밖 비밀 파일을 명시 사용, 권한 700/600 확인 후 `gpt-5.6-luna`의 `Reply only OK` 요청 **1회**, 출력 상한 128. 키/응답 본문은 기록하지 않았다. 재시도 없음.

| 응답 | 값 |
| --- | --- |
| HTTP | 403 |
| x-team-remaining-quota-tokens | 0 |
| x-team-tokens-consumed | 헤더 없음 — 이번 사용량 확정 불가 |
| x-team-remaining-tokens | 1050788 |
| x-team-remaining-requests | 299 |

총잔여 헤더는 추정치지만 현재 요청이 거부된 사실은 확정이다. 분당 여유가 있으므로 TPM 소진으로 설명되지 않는다. 추가 할당이 기존 키에 반영되었는지, 새 키 발급인지 운영진 확인 필요. 타 팀과의 공유 여부는 이 응답만으로 알 수 없다.

## 현재 로컬 제품 상태와 연결 경계

- 포트8000 기존 서버는 정상응답, 런타임 표시 `DACON_RESPONSES` / `gpt-5.6-terra`지만 `configured=false`, PDF/demo 실행 비활성 상태다.
- 활성 Dacon 개발 worker 없음. 기존 로컬 서버의 메모리/영상 시연 상태는 변경하지 않았다.
- 키를 명시 로드한 별도 로컬 앱 객체 검사 완료: `DACON_RESPONSES` / `gpt-5.6-terra` / `configured=true`, demo/PDF 활성 설정 확인(모델 실행 0회). 기존 포트8000 서버에는 아직 적용하지 않았다. 실제 제품의 종단간 실행 성공과 혼동하지 않는다.
- 키/할당 확인 후 기존 서버를 안전하게 재시작할 명령:

```sh
.venv/bin/python -m trialboard.api --agent-provider dacon --dacon-key-file ~/.config/trialboard/dacon-api-key --enable-evidence-scout --enable-designs --enable-agent-demo --enable-pdf-agent
```

키 값은 Git/프런트엔드/명령 인자에 넣지 않는다. 서버 시작만으로 모델을 실행하지 않는다. 제품 실행 버튼/동의/기존 제한을 통과한 요청만 모델을 호출한다. 이 문서는 외부 배포나 개발 자동 재개 승인이 아니다.

제품 기능 개발률은 기존 계획 추정 79%±10%p 유지. 음악 교체는 준비만 했으며 새 믹스/영상은 아직 생성하지 않았다.

검증: `tests/test_dacon_worker_disabled.py` + `tests/test_dacon_provider.py` 18개 통과, 변경 Python 2파일 Ruff 통과. 가짜 전송 기반 검사이며 추가 유료 호출 없음.

# TrialBoard Web

React 19 · TypeScript · Material UI · Vite · PDF.js 기반 로컬 검토 화면입니다.
설치, AI 로그인, MOC 체험, 현재 구현 범위와 한계는 [루트 README](../README.md)를 기준으로 합니다.
이 문서에서 별도 진행률이나 과거 기능 상태를 중복 관리하지 않습니다.

## 개발 실행

저장소 루트에서 Python 의존성을 설치한 뒤 API를 실행합니다.

```bash
uv sync --locked
uv run python -m trialboard.api \
  --enable-designs \
  --enable-agent-demo \
  --enable-pdf-agent \
  --enable-evidence-scout
```

별도 터미널의 저장소 루트에서 Node.js 24로 실행합니다.

```bash
npm --prefix web ci
npm --prefix web run dev
```

http://127.0.0.1:5173 에 접속합니다. Vite가 `/api`를 127.0.0.1:8000으로 전달합니다.
이미 `web/` 폴더 안이라면 `npm ci`, `npm run dev`를 사용합니다.
실제 AI 기본값은 대회 API이며 서버의 대회 키 설정과 모델 전송 동의가 필요합니다.
키는 화면에서 받지 않습니다. 비표시 입력 방법은 루트 README를 참고하세요.
개인 Codex 로그인은 서버에서 `--agent-provider codex`를 명시했을 때만 사용합니다.

## 검증과 빌드

저장소 루트 기준:

```bash
node --test web/tests/*.test.mjs
npm --prefix web run build
```

테스트 일부는 Python과 uv가 필요합니다. 빌드는 TypeScript 검사 후 `web/dist/`를 생성합니다.
정적 파일만 올리면 Python API/AI/SQLite까지 배포되는 것은 아닙니다.
전체 로컬 기능은 5173 개발 화면에서 실행하세요. 현재 정적 사이트의 기능 범위와 구분합니다.

## 주요 화면

- 첫 화면: 약물/개발 코드/NCT로 공개 근거 조사 또는 보유 PDF 검토 시작.
- 근거 DB: 수집 출처·스냅샷·검색·검토 이력, 선택 PDF 다운로드와 원문 이동.
- PDF 작업공간: 문구 후보·전송 전 점검·실시간 AI 상태·필드/보조 근거·적용 범위 대조.
- 설계 비교·KOL: 가정별 실제 로컬 계산·질문/메모·회의 내보내기.
- 저장한 프로젝트: 원문·검토·설계·회의를 로컬 DB에서 버전 복구.
- 별도 브리핑: 기록된 사례와 합성 계산 시연. 실제 새 모델 실행과 구분하고 MOC 표시 유지.

화면/실패 경로의 검증 범위와 남은 작업은 [다음 작업](../docs/NEXT_TASKS.md)을 확인하세요.

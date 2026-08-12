# 작업공간 설정

## 1. 필수 도구

| 도구 | 기준 | 목적 |
|---|---:|---|
| Git for Windows | 2.55 이상 | 버전관리와 GitHub 연결 |
| uv | 0.11 이상 | Python·가상환경·잠금파일 관리 |
| Python | 3.14.x | Astropy/FastAPI 런타임 |
| Node.js | 24.x LTS | React/Vite 개발과 빌드 |
| npm | 11.x | 프런트엔드 잠금파일 관리 |

## 2. 새 환경 준비

새 PowerShell에서 저장소 루트로 이동한 뒤 환경 스크립트를 적용합니다. 저장소 내부의 로컬 Node 런타임이 있으면 우선 사용하고, 없으면 시스템에 설치된 Node.js를 사용합니다. 사용자 또는 시스템 PATH를 영구 변경하지 않습니다.

```powershell
. .\scripts\activate.ps1
uv python install 3.14
uv sync --project backend --locked
npm ci
```

`backend/uv.lock`과 루트 `package-lock.json`은 반드시 Git에 포함합니다. `backend/.venv`, `node_modules`, 다운로드 캐시는 포함하지 않습니다.

## 3. 개발 서버

터미널 1에서 API를 실행합니다.

```powershell
. .\scripts\activate.ps1
npm run dev:api
```

터미널 2에서 웹 앱을 실행합니다.

```powershell
. .\scripts\activate.ps1
npm run dev
```

Vite는 개발 중 `/api` 요청을 `http://127.0.0.1:8000`으로 전달합니다. API 상태 확인은 `http://127.0.0.1:8000/health`, OpenAPI 문서는 `http://127.0.0.1:8000/docs`를 사용합니다.

## 4. 검증

```powershell
npm run check
```

이 명령은 Ruff lint·format 확인, Pytest, ESLint, Vitest, TypeScript/Vite 프로덕션 빌드를 차례로 실행합니다. 개별 명령은 루트 `package.json`의 `lint:*`, `test:*`, `build` 스크립트를 사용할 수 있습니다.

## 5. 선택 의존성

기본 동기화에는 웹 API와 계산에 필요한 패키지만 포함합니다.

```powershell
uv sync --project backend --group catalog   # 이후 astroquery 기반 카탈로그 연구용
uv sync --project backend --group research  # 과거 PNG/MP4 재현용
```

운영 중인 LoTSS DR3 검색은 기본 API 의존성으로 설치되며 별도 그룹이 필요하지 않습니다. 외부
조회 시간 제한과 최대 행 수는 `.env.example`의 `CATALOG_REQUEST_TIMEOUT_SECONDS`,
`CATALOG_MAX_ROWS`를 기준으로 배포 환경에서 조정합니다.

배포 빌드에서는 개발 의존성을 제외하고 잠금 상태를 검증합니다.

```powershell
uv sync --project backend --locked --no-dev
```

## 6. 환경 변수와 생성물

`.env.example`은 지원 설정의 값과 이름을 보여 주는 템플릿입니다. 현재 개발 명령은 루트 `.env`를
자동으로 읽지 않으므로 로컬 override는 PowerShell process 환경 변수로 지정합니다. 예를 들어
`$env:CATALOG_REQUEST_TIMEOUT_SECONDS='30'` 또는 `$env:CORS_ORIGINS='https://web.example'`를
설정한 터미널에서 API를 시작합니다. 프런트 API 주소는 `frontend/.env.local`의
`VITE_API_BASE_URL`로 지정할 수 있습니다. `.env`, `.env.local`, 토큰, 인증서, 개인키는 Git에
추가하지 않습니다. 기본 CORS 허용 주소는 로컬 Vite 서버입니다.

다음 경로는 재생성 가능하거나 기기별 상태이므로 Git에서 제외됩니다.

- `.tools/`, `backend/.venv/`, `node_modules/`, `.cache/`, `.astropy/`
- `products/`, `plots/`, `frontend/dist/`
- `.env` 및 인증서·개인키 파일

`references_2026`와 루트 `image.png`는 기존 연구 자료이므로 자동 포맷·이동·삭제하지 않습니다.

## 7. Git과 배포

로컬 `main`은 GitHub의 `origin/main`을 추적합니다. 작업 전후에는 다음을 확인합니다.

```powershell
git status --short --branch
git diff --check
```

CI는 동일한 잠금파일로 백엔드와 프런트엔드를 검증합니다. 실제 서비스 배포에는 Python/Astropy API를 실행할 호스팅과 프런트엔드의 API 주소·CORS 설정이 함께 필요합니다.

# 작업공간 설정

## 1. 필수 도구

| 도구 | 기준 | 목적 |
|---|---:|---|
| Git for Windows | 2.55 이상 | 버전관리 및 원격 저장소 연결 |
| uv | 0.11 이상 | Python 설치, 가상환경, 잠금파일 관리 |
| Python | 3.14.x | Astropy/FastAPI 런타임 |
| Node.js | 24.x LTS | React/Vite 빌드 및 npm |
| VS Code | 현재 설치본 | 편집기 및 권장 확장 사용 |

## 2. 백엔드 환경

새 PowerShell에서 먼저 작업공간 도구 경로를 현재 세션에 적용합니다. 이 스크립트는 사용자 또는 시스템 PATH를 영구 변경하지 않습니다.

```powershell
. .\scripts\activate.ps1
```

그다음 다음 명령을 실행합니다.

```powershell
Set-Location backend
uv sync
```

기본 동기화는 API/천문 계산 런타임과 개발 도구만 설치합니다.

```powershell
uv sync --group catalog   # SIMBAD/VizieR/Gaia 접근을 시작할 때
uv sync --group research  # 과거 PNG/MP4 산출을 재현할 때만
```

`uv.lock`은 모든 환경에서 같은 해석 결과를 사용하도록 Git에 포함합니다. `.venv`와 다운로드 캐시는 포함하지 않습니다.

## 3. 프런트엔드 환경

저장소 루트에서 실행합니다.

```powershell
npm ci
```

이 단계는 패키지 잠금파일과 `node_modules`만 준비합니다. UI 소스 스캐폴딩은 구현 단계에서 `frontend` 안에 생성합니다.

배포 환경에서는 개발 의존성을 제외하고 잠금 상태를 검증합니다.

```powershell
uv sync --project backend --locked --no-dev
```

## 4. 환경 변수

애플리케이션 구현이 시작되면 `.env.example`을 `.env`로 복사합니다. `.env`는 Git에서 제외됩니다. 비밀 토큰, 카탈로그 API 키, 배포 자격증명을 `.env.example`이나 소스에 기록하지 않습니다.

## 5. 생성물과 캐시

다음 경로는 재생성 가능하거나 기기별 상태이므로 Git에서 제외됩니다.

- `.venv/`, `node_modules/`, `.cache/`, `.astropy/`
- `products/`, `plots/`, `frontend/dist/`
- `.env` 및 인증서·개인키 파일

`image.png`는 기존 자료이며 용도가 확정되지 않았으므로 이동하거나 무시하지 않습니다.

## 6. Git 초기화 이후 검증

```powershell
git status --short --branch
git check-ignore -v .env products/example.csv frontend/node_modules/example
```

첫 커밋과 원격 연결 전에는 저장소 로컬 범위의 `user.name`, `user.email`과 원격 제공자/저장소 공개 범위를 먼저 확정합니다.

# Mutual Visibility — 공통하늘

선택한 관측지에서 같은 시각에 볼 수 있는 천체를 찾는 웹 애플리케이션입니다. `references_2026`의 천문 좌표 변환 실험을 제품 코드로 직접 가져오지 않고, 검증 가능한 FastAPI 계산 모듈과 React 인터페이스로 다시 구현합니다.

## 첫 번째 기능

현재 구현된 첫 번째 수직 기능은 다음과 같습니다.

- Narrabri, Pyeongchang, Fushan 중 1–3개 관측지 선택 및 좌표 편집
- 중심 UTC, 전후 시간창, 샘플 간격, 최소 고도 설정
- 3C 123, 3C 273, 3C 433, 3C 295, 3C 134 선택
- 관측지별 시간–고도 곡선과 지평선·최소 고도선 표시
- 모든 선택 관측지에서 동시에 임계 고도 이상인 샘플과 연속 샘플 묶음 강조
- 상세 그래프 아래에 중심 UTC 시각의 공통 가시 target 전체 시간–고도 개요 표시
- 입력 검증, 로딩·오류·빈 결과 상태, 접근 가능한 표 형태 대체 정보

## 빠른 실행

Windows PowerShell에서 저장소 루트를 기준으로 실행합니다.

```powershell
. .\scripts\activate.ps1
uv sync --project backend --locked
npm ci
```

두 개의 터미널을 열고 각각 API와 웹 개발 서버를 시작합니다.

```powershell
npm run dev:api
```

```powershell
npm run dev
```

웹 화면은 `http://127.0.0.1:5173`, API 문서는 `http://127.0.0.1:8000/docs`에서 확인할 수 있습니다.

전체 정적 검사·테스트·프로덕션 빌드는 한 번에 실행할 수 있습니다.

```powershell
npm run check
```

## 계산의 의미

현재의 “보임”은 각 UTC 샘플에서 천체의 **기하학적 AltAz 고도**가 선택한 모든 위치에서 최소 고도 이상이라는 뜻입니다. 한 곳을 선택하면 해당 위치만 판정하고, 세 곳을 선택하면 같은 샘플에서 세 곳 모두 기준을 만족해야 합니다. 대기 굴절은 끄고(`pressure=0`) IERS 네트워크 다운로드도 요청 중 사용하지 않습니다. 강조 구간은 연속된 가시 샘플의 묶음이며 샘플 사이의 모든 순간을 보장하지 않습니다.

Fushan 기본 좌표는 제공된 `24°45′23.3″ N, 121°34′53.9″ E`를 각각 `24.7564722222°, 121.5816388889°`로 변환한 값입니다. 해발고도는 제공되지 않아 편집 가능한 `0 m` 기본값을 사용합니다.

이 단계에는 천체 밝기, 태양·달, 날씨, 지형 차폐, 관측 장비 성능이 포함되지 않습니다.

## 구조

```text
.
├─ backend/          # FastAPI + Astropy 계산 API
├─ frontend/         # React + TypeScript + Vite 인터페이스
├─ references_2026/  # 수정하지 않는 과거 연구 코드
├─ docs/             # 설정·설계·운영 문서
└─ image.png         # 기존 참고 이미지
```

상세 설정은 [작업공간 설정](docs/WORKSPACE_SETUP.md), 초기 기술 선택은 [ADR 0001](docs/decisions/0001-initial-stack.md)을 참고하십시오.

`references_2026`는 원자료로 보존하며 새 서비스가 해당 스크립트를 직접 import하지 않습니다. 검증된 계산만 테스트와 함께 `backend/app`에 구현합니다.

## Git 및 배포

`main` 브랜치는 [GitHub 저장소](https://github.com/ecsupernova78/Project_mutual_visibility_260811)에 연결되어 있고, 푸시와 pull request마다 프런트엔드·백엔드 CI를 실행합니다. 현재 로컬 전체 기능은 완성되었으며 실제 공개 배포는 Python/Astropy API를 실행할 호스팅 서비스와 계정 권한을 확정한 뒤 연결합니다.

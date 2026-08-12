# Mutual Visibility — 공통하늘

선택한 관측지에서 같은 시각에 볼 수 있는 천체를 찾는 웹 애플리케이션입니다. `references_2026`의 천문 좌표 변환 실험을 제품 코드로 직접 가져오지 않고, 검증 가능한 FastAPI 계산 모듈과 React 인터페이스로 다시 구현합니다.

## 첫 번째 기능

현재 구현된 첫 번째 수직 기능은 다음과 같습니다.

- Narrabri, Pyeongchang, Fushan 중 1–3개 관측지 선택 및 좌표 편집
- 중심 UTC, 전후 시간창, 샘플 간격, 최소 고도 설정
- 3C 123, 3C 273, 3C 433, 3C 295, 3C 134 선택
- 별도 LOFAR DR3 카탈로그 탭에서 LoTSS DR3 전파원 검색, 144 MHz 밝기 정렬 및 계산 대상으로 가져오기
- 관측지별 시간–고도 곡선과 지평선·최소 고도선 표시
- 모든 선택 관측지에서 동시에 임계 고도 이상인 샘플과 연속 샘플 묶음 강조
- target별 시간창 내 최장 공통 가시 구간을 샘플 기준으로 표시
- 상세 그래프 아래에 전체 시간창 중 공통 가시 샘플이 존재하는 target 전체 시간–고도 개요 표시
- 개요 패널에서 관측 가능한 target별 플롯 표시 여부 선택 및 전체 표시·숨기기
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

LoTSS DR3에서 가져온 total/peak flux는 카탈로그 검색 결과의 정렬과 식별에만 사용합니다. 밝기를
가시성 판정에 반영하지 않으므로, 현재 계산에는 태양·달, 날씨, 지형 차폐, 관측 장비 성능이나
검출 한계가 포함되지 않습니다.

## LOFAR DR3 카탈로그 연계

카탈로그 탭은 ASTRON의 공개 asynchronous TAP 서비스에 있는 `lotss_dr3.main_sources`를 서버에서
제한된 ADQL 템플릿으로 조회합니다. prefix를 비워 두면 전역 카탈로그에서 밝기 순 목록을 가져오고,
필요하면 LoTSS Source ID 앞부분으로 범위를 좁힐 수 있습니다. integrated flux 또는 peak flux,
정렬 방향, 표시할 결과 수를 선택할 수 있습니다. 선택한 source의 ICRS 좌표 snapshot을 계산 요청에
포함하므로 고도 계산 중에는 외부 카탈로그를 다시 조회하지 않습니다. 공개 조회에는 계정이나 API
키가 필요하지 않습니다.

서버는 같은 검색 요청을 하나의 TAP job으로 합치고 성공 결과를 잠시 캐시합니다. 서로 다른
upstream 검색의 동시 실행 수도 제한하며, 용량을 초과한 새 검색에는 잠시 후 재시도하도록
안내합니다. 이 보호 상태는 API process별로 관리됩니다.

- [LoTSS DR3 공개 릴리스](https://lofar-surveys.org/dr3.html)
- [ASTRON LoTSS DR3 source table](https://vo.astron.nl/tableinfo/lotss_dr3.main_sources)
- [ASTRON asynchronous TAP service](https://vo.astron.nl/__system__/tap/run/tap/async)

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

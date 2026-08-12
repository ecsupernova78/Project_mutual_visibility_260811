# Mutual Visibility API

선택한 1~3개 관측지와 고정 ICRS 카탈로그 천체를 받아 UTC 시간축의 기하학적 AltAz 고도를 계산하는 FastAPI 서비스입니다.

## 실행

저장소 루트에서 다음을 실행합니다.

```powershell
. .\scripts\activate.ps1
uv sync --project backend --locked
npm run dev:api
```

OpenAPI 문서는 `http://127.0.0.1:8000/docs`에서 볼 수 있습니다.

## 엔드포인트

- `GET /health`: 서비스 상태
- `GET /api/v1/targets`: 현재 지원하는 카탈로그 천체
- `POST /api/v1/visibility/altitude-series`: 선택 위치의 시간–고도 계열과 공통 가시 샘플 계산

요청은 서로 다른 ID를 가진 위치 1~3개, 시간창, 샘플 간격, 최소 고도, 대상 ID를 받습니다. 최소 2개·최대 2,000개 시간 샘플로 제한하며 알 수 없는 필드·대상, 중복 ID, 범위를 벗어난 좌표를 거부합니다.

## 과학적 경계

좌표는 ICRS에서 AltAz로 변환하고 동쪽 경도를 양수로 사용합니다. 고도는 대기 굴절을 적용하지 않은 기하학적 값입니다. `simultaneous_mask`는 모든 선택 위치의 고도가 같은 샘플에서 임계값 이상인지 나타내며, `visible_intervals`는 연속된 참 샘플을 묶은 결과입니다. 한 곳만 선택하면 그 관측지의 가시성과 같습니다.

요청 처리 중 IERS 네트워크 다운로드는 비활성화되어 있습니다. 현재 결과에는 밝기, 낮/밤, 달, 날씨, 지형, 장비 제한이 포함되지 않습니다.

## 검증

```powershell
uv run --project backend ruff check backend/app backend/tests
uv run --project backend ruff format --check backend/app backend/tests
uv run --project backend pytest backend/tests -q
```

테스트에는 1~3개 위치 API 검증, 모든 위치 순열 불변성, 위치 추가에 따른 공통 가시성의 단조성, 경도 정규화, `references_2026` 기준 시각의 3개 관측지 고도 golden fixture가 포함됩니다.

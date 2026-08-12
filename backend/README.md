# Mutual Visibility API

선택한 1~3개 관측지와 ICRS 카탈로그 천체를 받아 UTC 시간축의 기하학적 AltAz 고도를 계산하는 FastAPI 서비스입니다. 기본 3C 목록과 ASTRON LoTSS DR3 검색 결과의 좌표 snapshot을 함께 처리합니다.

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
- `GET /api/v1/catalogs/lotss-dr3/sources`: LoTSS DR3 밝기 순 전역 목록 또는 Source ID prefix 조회
- `POST /api/v1/visibility/altitude-series`: 선택 위치의 시간–고도 계열과 공통 가시 샘플 계산

요청은 서로 다른 ID를 가진 위치 1~3개, 시간창, 샘플 간격, 최소 고도, 기본 대상 ID와 외부 카탈로그 좌표 snapshot을 받습니다. 기본·외부 대상을 합해 최대 25개, 시간축은 최소 2개·최대 2,000개 샘플로 제한하며 알 수 없는 필드·대상, 중복 ID, 범위를 벗어난 좌표를 거부합니다.

LoTSS adapter는 서버에 고정된
`https://vo.astron.nl/__system__/tap/run/tap/async`와 `lotss_dr3.main_sources`만 사용합니다.
임의 URL이나 ADQL은 API로 받지 않습니다. `source_prefix`를 생략하면 전역 목록을 조회하고,
지정하면 해당 `Source_Name` prefix만 조회합니다. `Total_flux`(mJy) 또는
`Peak_flux`(mJy/beam), 오름차순·내림차순, 10·25·50·100·250·500·1,000개 중 결과 수를 선택할
수 있습니다. TAP/UWS job은 생성·실행·상태 확인·결과 수신 후 삭제하며, 전체 job 제한시간을
넘기면 중단한 뒤 정리합니다. 검색 서비스 장애는 이미 선택한 좌표 snapshot의 고도 계산에
영향을 주지 않습니다. 기본 전체 제한시간은 90초이고 실행 상태는 1·2·3·4·5초의 점진적 간격
(이후 최대 5초)으로 확인합니다.

한 API process 안에서 동일한 검색은 하나의 upstream job을 공유하며 성공 결과는 기본 300초 동안
최대 32개까지 캐시합니다. 서로 다른 upstream job은 기본 2개(설정 가능 범위 1~4개)까지만 동시에
실행합니다. 동시 상한에 도달한 새 검색은 `429`와 `Retry-After: 5`를 반환하지만, 이미 실행 중인
동일 검색은 그 job에 합류합니다. 캐시는 process-local이므로 여러 worker 사이에는 공유되지 않습니다.

## 과학적 경계

좌표는 ICRS에서 AltAz로 변환하고 동쪽 경도를 양수로 사용합니다. 고도는 대기 굴절을 적용하지 않은 기하학적 값입니다. `simultaneous_mask`는 모든 선택 위치의 고도가 같은 샘플에서 임계값 이상인지 나타내며, `visible_intervals`는 연속된 참 샘플을 묶은 결과입니다. 한 곳만 선택하면 그 관측지의 가시성과 같습니다.

요청 처리 중 IERS 네트워크 다운로드는 비활성화되어 있습니다. 현재 결과에는 밝기, 낮/밤, 달, 날씨, 지형, 장비 제한이 포함되지 않습니다.

## 검증

```powershell
uv run --project backend ruff check backend/app backend/tests
uv run --project backend ruff format --check backend/app backend/tests
uv run --project backend pytest backend/tests -q
```

테스트에는 1~3개 위치 API 검증, 모든 위치 순열 불변성, 위치 추가에 따른 공통 가시성의 단조성, 경도 정규화, `references_2026` 기준 시각의 3개 관측지 고도 golden fixture, 외부 좌표 snapshot 계산, 제한된 ADQL 생성, TAP/UWS 상태 전이, redirect 검증, timeout·중단·삭제 및 응답 검증이 포함됩니다.

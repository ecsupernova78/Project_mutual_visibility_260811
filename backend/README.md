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
- `GET /api/v1/catalogs/lotss-dr3/cone`: ICRS 중심 좌표와 반경 안의 LoTSS DR3 source 조회
- `POST /api/v1/visibility/altitude-series`: 선택 위치의 시간–고도 계열과 공통 가시 샘플 계산

요청은 서로 다른 ID를 가진 위치 1~3개, 시간창, 샘플 간격, 최소 고도, 기본 대상 ID와 외부 카탈로그 좌표 snapshot을 받습니다. 기본·외부 대상을 합해 최대 25개, 시간축은 최소 2개·최대 2,000개 샘플로 제한하며 알 수 없는 필드·대상, 중복 ID, 범위를 벗어난 좌표를 거부합니다.

LoTSS adapter는 서버에 고정된
`https://vo.astron.nl/__system__/tap/run/tap/async`와 `lotss_dr3.main_sources`만 사용합니다.
임의 URL이나 ADQL은 API로 받지 않습니다. 밝기 순 endpoint는 선택적인 `source_prefix`,
`Total_flux`(mJy) 또는 `Peak_flux`(mJy/beam), 정렬 방향을 받습니다. Cone endpoint는 ICRS
`ra_deg`, `dec_deg`, 0보다 크고 60 이하인 `radius_arcmin`을 받고 중심 거리·total flux·peak flux
중 하나로 정렬합니다. 두 endpoint 모두 10·25·50·100·250·500·1,000개 중 결과 수를 선택할 수
있습니다. TAP/UWS job은 생성·실행·상태 확인·결과 수신 후 삭제하며, 전체 job 제한시간을 넘기면
중단한 뒤 정리합니다. 검색 서비스 장애는 이미 선택한 좌표 snapshot의 고도 계산에 영향을 주지
않습니다. 기본 전체 제한시간은 90초이고 실행 상태는 1·2·3·4·5초의 점진적 간격(이후 최대 5초)으로
확인합니다.

ASTRON의 `Source_Name`은 대부분 좌표에서 자동 생성한 `ILTJ...` LoTSS 식별자입니다. 응답의
`S_Code`는 물리적 유형이 아니라 source fitting 형태이며 `S`는 단일 Gaussian, `M`은 복수 Gaussian,
`C`는 다른 source와 같은 island 안의 단일 Gaussian source입니다. API는 원본 ID와 `S_Code`를
항상 보존합니다.

LoTSS 조회가 끝나면 CDS XMatch에서 각 좌표의 5 arcsec 이내 가장 가까운 SIMBAD 위치 후보를 찾고,
SIMBAD TAP에서 선호 별칭과 유형 설명을 보강합니다. `crossmatch_separation_arcsec <= 2`이면 `high`,
2보다 크고 5 이하면 `caution`입니다. 이는 최근접 위치 후보에 대한 거리 구분이지 동일 천체의 확정
판정이나 확률이 아닙니다. `counterpart_name`, 별칭, `object_type_code`와 설명은 SIMBAD provenance를
유지합니다. XMatch가 실패하면 `enrichment_status=unavailable`과 원본 LoTSS 결과를, 후속 SIMBAD
별칭·유형 조회만 실패하면 `partial`과 이미 얻은 위치 후보를 반환하는 fail-soft 계약입니다.
보강 단계 제한시간은 `CATALOG_ENRICHMENT_TIMEOUT_SECONDS`로 별도 설정합니다.

한 API process 안에서 동일한 검색은 하나의 upstream job을 공유하며 성공 결과는 기본 300초 동안
최대 32개까지 캐시합니다. 서로 다른 upstream job은 기본 2개(설정 가능 범위 1~4개)까지만 동시에
실행합니다. 동시 상한에 도달한 새 검색은 `429`와 `Retry-After: 5`를 반환하지만, 이미 실행 중인
동일 검색은 그 job에 합류합니다. 캐시는 process-local이므로 여러 worker 사이에는 공유되지 않습니다.

## 과학적 경계

좌표는 ICRS에서 AltAz로 변환하고 동쪽 경도를 양수로 사용합니다. 고도는 대기 굴절을 적용하지 않은 기하학적 값입니다. `simultaneous_mask`는 모든 선택 위치의 고도가 같은 샘플에서 임계값 이상인지 나타내며, `visible_intervals`는 연속된 참 샘플을 묶은 결과입니다. 한 곳만 선택하면 그 관측지의 가시성과 같습니다.

요청 처리 중 IERS 네트워크 다운로드는 비활성화되어 있습니다. 현재 결과에는 밝기, 낮/밤, 달, 날씨, 지형, 장비 제한이 포함되지 않습니다.

Cone 중심과 LoTSS source 사이의 `separation_arcmin`과 LoTSS source와 SIMBAD 후보 사이의
`crossmatch_separation_arcsec`는 서로 다른 거리입니다. 후자는 최대 5 arcsec의 위치 기반 후보이며,
복잡하거나 확장된 전파원에서는 한 LoTSS component와 광학 천체의 관계를 단독으로 확정하지 못합니다.

공식 메타데이터와 코드표는 [ASTRON source table](https://vo.astron.nl/tableinfo/lotss_dr3.main_sources),
[ASTRON cone service](https://vo.astron.nl/lotss_dr3/q/src_cone/info),
[CDS XMatch API](https://cdsxmatch.u-strasbg.fr/xmatch/doc/cross-match-API.html),
[SIMBAD object types](https://simbad.cds.unistra.fr/Pages/guide/otypes_desc.htx)를 참고합니다.

## 검증

```powershell
uv run --project backend ruff check backend/app backend/tests
uv run --project backend ruff format --check backend/app backend/tests
uv run --project backend pytest backend/tests -q
```

테스트에는 1~3개 위치 API 검증, 모든 위치 순열 불변성, 위치 추가에 따른 공통 가시성의 단조성,
경도 정규화, `references_2026` 기준 시각의 3개 관측지 고도 golden fixture, 외부 좌표 snapshot 계산,
밝기 순·cone ADQL 생성, 형태 코드, TAP/UWS 상태 전이, redirect 검증, timeout·중단·삭제, SIMBAD
보강과 fail-soft 응답 검증이 포함됩니다.

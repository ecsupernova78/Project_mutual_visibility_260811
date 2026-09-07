# Mutual Visibility — 공통하늘

선택한 관측지에서 같은 시각에 볼 수 있는 천체를 찾는 웹 애플리케이션입니다. `references_2026`의 천문 좌표 변환 실험을 제품 코드로 직접 가져오지 않고, 검증 가능한 FastAPI 계산 모듈과 React 인터페이스로 다시 구현합니다.

## 첫 번째 기능

현재 구현된 첫 번째 수직 기능은 다음과 같습니다.

- Narrabri, Pyeongchang, Fushan과 사용자 저장 관측지 중 1–3개 선택 및 좌표 편집
- 별도 Observing Sites 탭에서 관측지 이름·위도·경도·고도를 브라우저에 저장하고 목록에서 수정·선택
- 선택한 관측지를 영문·라틴 표기 중심의 밝은 지도에 번호 핀·연결선으로 표시하고 모든 관측지 쌍의 대권거리 계산
- 중심 UTC, 전후 시간창, 샘플 간격, 최소 고도 설정
- 3C 123, 3C 273, 3C 433, 3C 295, 3C 134 선택
- 별도 Catalog Search 탭의 LOFAR DR3·VLASS 하위 탭에서 밝기 순 목록 또는 ICRS 좌표 주변 cone search를 실행하고 계산 대상으로 가져오기
- LoTSS/VLASS 형태 코드와, 이용 가능한 경우 SIMBAD의 친숙한 이름·물리 유형·위치 대응 거리 표시
- 관측지별 0–90° 시간–고도 곡선과 지평선·기준 UTC 표시
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

## 전파 카탈로그 연계

카탈로그 탭은 ASTRON의 공개 asynchronous TAP 서비스에 있는 `lotss_dr3.main_sources`를 서버에서
제한된 ADQL 템플릿으로 조회합니다. **밝기 순 목록**에서는 전역 목록 또는 선택적인 Source ID prefix를
조회하고 integrated/peak flux, 정렬 방향, 결과 수와 LoTSS `S_Code` 형태 분류(S/M/C)를 지정합니다.
분류 조건은 결과를 받은 뒤 브라우저에서 거르는 것이 아니라 TAP ADQL의 `WHERE` 절에 적용됩니다.
**Source cone search**에서는 ICRS
RA·Dec와 최대 60 arcmin 반경을 입력하고 중심 거리 또는 flux 순으로 결과를 정렬합니다. 두 모드에서
선택한 source의 ICRS 좌표 snapshot을 계산 요청에 포함하므로 고도 계산 중에는 외부 카탈로그를 다시
조회하지 않습니다. 공개 조회에는 계정이나 API 키가 필요하지 않습니다.

`ILTJ...`는 대부분 RA/Dec에서 자동 생성된 LoTSS의 전파 source 식별자이며, 일반 천체명이 아닙니다.
`S_Code`도 물리적 천체 유형이 아니라 PyBDSF 전파 형태 코드입니다. `S`는 단일 Gaussian, `M`은 복수
Gaussian, `C`는 다른 source와 같은 island 안의 단일 Gaussian source를 뜻합니다. 인터페이스는 이
형태 코드표를 SIMBAD 물리 유형과 분리해 제공합니다.

Observing Sites 지도는 API key 없이 MapLibre GL과 OpenFreeMap Positron vector style 한 종류를
사용합니다. 단순한 저채도 배경 위에 도시·국가 등의 지명을 영어 또는 라틴 문자로 표시하며, 영어·라틴
이름이 없는 지명은 현지 문자를 대신 표시하지 않고 생략합니다. 사용자가 저장한 관측지 이름과 선택 순서도 함께 표시됩니다. 선택 순서대로 번호를 부여하고 두 곳이면 1개·세 곳이면
중복 없는 3개의 조합을 표시합니다. 거리는 고도를 제외한 평균 지구 반지름 기반 대권거리이므로
지표상의 경로 길이이며 3차원 직선거리는 아닙니다. 배경 지도는 zoom 18까지 화면 해상도에 맞춰 vector
선과 글자를 다시 그리므로 raster 확대에 의한 픽셀화가 없습니다. Vite용 MapLibre worker URL을 명시해
개발·배포 빌드에서 동일하게 렌더링하며, 배경 지도 요청에 실패해도 관측지 pin과 거리선은 독립적으로
계속 표시됩니다. 지도 표시 시 브라우저가 OpenFreeMap으로 style·vector tile·font 요청과 함께 IP 주소 및
대략적인 지도 영역을 전송할 수 있습니다.

VLASS 하위 탭은 VizieR TAP의 `J/ApJS/255/30/comp`를 통해 Gordon et al. (2021)의
**VLASS Epoch 1 Quick Look component catalog**를 조회합니다. 이는 최신 VLASS 전체 릴리스가 아니라
공개된 Epoch 1 Quick Look 자료임을 화면과 API provenance에 명시합니다. 3 GHz total/peak flux 정렬,
component ID prefix, ICRS cone search, S/C/M/E component code를 지원합니다. 기본 권장 품질 필터는
`DupFlag < 2`, `QualFlag IN (0,4)`, `SCode <> 'E'`이며 해제할 수도 있습니다. Quick Look flux는
카탈로그 자체의 알려진 계통 오차가 있으므로 후보 선택용으로 해석해야 합니다.

각 LoTSS/VLASS 위치는 CDS XMatch를 통해 5 arcsec 안의 가장 가까운 SIMBAD 위치 후보와 대응합니다. 후보가
있으면 3C·NGC·IC 등의 별칭, SIMBAD 유형 코드와 설명, 각거리를 표시하고 친숙한 별칭을 우선 표시명으로
사용합니다. 2 arcsec 이하는 `high`, 2 arcsec 초과 5 arcsec 이하는 `caution`으로 구분하지만, 어느
경우에도 좌표 기반 후보일 뿐 동일 천체의 확정 식별은 아닙니다. 대응이 없으면 원래 `ILTJ...` ID를
유지합니다. XMatch 또는 SIMBAD 보강이 실패해도 원본 catalog 결과는 유지하며, 사용 불가 또는 일부
완료 상태를 함께 알립니다.

밝기 순 검색에서는 LoTSS `S_Code`를 S/M/C별로 선택하거나 모두 선택할 수 있고, SIMBAD 물리 유형은
Galaxy·AGN·Quasar·Blazar·Radio galaxy·Seyfert·Star·Pulsar·ISM·Radio source 범주를 OR 조건으로
선택할 수 있습니다. SIMBAD의 `All physical types`는 유형 제한을 적용하지 않으며 위치 대응이 없는
LoTSS source도 유지합니다. 특정 범주는 ASTRON의 밝기 순 `TOP N` 후보를 가져온 뒤 가장 가까운 5
arcsec SIMBAD 위치 후보의 confirmed primary `otype`에 적용되므로, 반환 행 수가 N보다 작을 수 있고
이는 선택 유형 전체에서 전역 밝기 상위 N개를 찾는 cross-catalog join은 아닙니다. 특정 유형 필터 중
XMatch가 실패하면 무필터 결과로 대체하지 않고 검색 오류를 반환합니다.

서버는 같은 검색 요청을 하나의 TAP job으로 합치고 성공 결과를 잠시 캐시합니다. 서로 다른
upstream 검색의 동시 실행 수도 제한하며, 용량을 초과한 새 검색에는 잠시 후 재시도하도록
안내합니다. 이 보호 상태는 API process별로 관리됩니다.

- [LoTSS DR3 공개 릴리스](https://lofar-surveys.org/dr3.html)
- [ASTRON LoTSS DR3 source table](https://vo.astron.nl/tableinfo/lotss_dr3.main_sources)
- [ASTRON LoTSS DR3 cone search](https://vo.astron.nl/lotss_dr3/q/src_cone/info)
- [ASTRON asynchronous TAP service](https://vo.astron.nl/__system__/tap/run/tap/async)
- [CDS XMatch API](https://cdsxmatch.u-strasbg.fr/xmatch/doc/cross-match-API.html)
- [SIMBAD](https://simbad.cds.unistra.fr/simbad/)
- [SIMBAD object type codebook](https://simbad.cds.unistra.fr/Pages/guide/otypes_desc.htx)
- [VLASS Epoch 1 Quick Look catalogue in VizieR](https://cdsarc.cds.unistra.fr/viz-bin/cat/J/ApJS/255/30)
- [CIRADA VLASS catalogue guidance](https://cirada.ca/vlasscatalogueql0)
- [OpenFreeMap](https://openfreemap.org/)
- [OpenFreeMap Quick Start](https://openfreemap.org/quick_start/)
- [MapLibre GL JS](https://maplibre.org/maplibre-gl-js/docs/)
- [OpenMapTiles](https://openmaptiles.org/)
- [OpenStreetMap](https://www.openstreetmap.org/copyright)

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

`main` 브랜치는 [GitHub 저장소](https://github.com/ecsupernova78/Project_mutual_visibility_260811)에 연결되어 있고, 푸시와 pull request마다 프런트엔드·백엔드 CI를 실행합니다.

공개 서비스는 두 부분으로 분리합니다.

- OpenAI Sites는 `dist`의 React 정적 파일을 전 세계에서 접근 가능한 HTTPS 주소로 제공합니다.
- Render Free Web Service는 `render.yaml`에 따라 `backend`를 Python 3.14 환경에 설치하고 FastAPI/Uvicorn을 실행합니다.

Render에는 `CORS_ORIGINS=https://mutual-visibility.kcic-researchers.chatgpt.site`가 설정되며, Sites용
프로덕션 빌드는 `VITE_API_BASE_URL`에 실제 Render HTTPS 주소를 넣어 생성합니다. 배포가 완료되면 로컬
`npm run dev`와 `npm run dev:api`는 실행할 필요가 없습니다. Sites가 프런트엔드를 제공하고 Render의 원격
컨테이너가 API process를 관리합니다.

Render 무료 API는 15분 동안 수신 요청이 없으면 sleep 상태로 전환됩니다. 링크가 삭제되는 것은 아니며,
다음 요청이 원격 instance를 자동으로 다시 시작합니다. 이 첫 요청은 약 1분 지연될 수 있습니다. 항상 즉시
응답하는 API가 필요하면 Render의 유료 instance 등 scale-to-zero를 사용하지 않는 compute가 필요합니다.

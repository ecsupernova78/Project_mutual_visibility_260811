# 공통하늘 프런트엔드

선택한 1–10개 관측지에서 함께 보이는 카탈로그 천체의 시간–고도 곡선을 비교하는 React 19 + TypeScript 단일 페이지 앱입니다.

개발 서버는 `/api` 요청을 `http://127.0.0.1:8000`으로 전달합니다. 저장소 루트에서 환경 활성화 후 아래 명령을 사용할 수 있습니다.

```powershell
npm run dev --workspace frontend
npm run build --workspace frontend
npm run lint --workspace frontend
npm run test --workspace frontend
```

Vite는 저장소 루트의 `.env.local`에서 `VITE_API_BASE_URL`을 읽습니다. 값을 생략하면 개발 서버의 `/api`
proxy를 사용하고, 공개 Render 정적 사이트 빌드에서는 실제 FastAPI HTTPS origin을 지정해야 합니다. 프로덕션 파일은
Render가 제공할 수 있도록 저장소 루트의 `dist`에 생성됩니다.

`Observation Visibility`와 `BURSTT FoV` 탭에는 같은 관측지·천체 선택, UTC 시간창, 계산 간격 및 최소 고도 입력이 있습니다. 한 곳부터 열 곳까지 선택할 수 있으며 모든 선택 관측지가 같은 샘플에서 기준 고도 이상일 때 공통 가시로 판정합니다. BURSTT 탭은 Astropy의 지평 좌표를 천정 중심의 방위 등거리 투영으로 변환하여 EW·NS 각도(도)를 표시합니다. 이 각도 좌표는 전파 간섭계의 무차원 방향 코사인 l,m과 구별됩니다. FoV 전체 폭은 기본 60° EW × 90° NS, ID 또는 이름에 LTN이 포함된 관측지는 70° EW × 80° NS입니다. 그래프 커서와 시각 슬라이더가 사이트별 FoV 그림에 동기화되며 사이트별 FoV 구간과 모든 사이트의 공통 FoV 구간이 시간–고도 그래프에 표시됩니다.

`Observing Sites` 탭에서는 관측지 이름, 위도, 경도, 고도를 입력해 최대 50개의 좌표 프로필을 저장하고 기존 프로필을 수정할 수 있습니다. 저장된 관측지 중 계산에 사용할 1–10개를 선택하면 두 분석 탭과 계산 요청에 즉시 반영됩니다. 선택된 관측지는 선택 순서 번호와 함께 MapLibre GL 기반 OpenFreeMap Positron vector 지도에 표시되고 모든 중복 없는 관측지 쌍의 대권거리를 계산합니다. 이 거리는 고도를 제외한 지표 거리입니다. 기본 세 관측지와 사용자 관측지, 선택 상태는 이 브라우저의 로컬 저장소에 보존되며 기기나 브라우저 사이에서 동기화되지는 않습니다.

지도는 key 없이 OpenFreeMap Positron vector style 한 종류를 사용해 차분한 저채도 배경과 영문·라틴 도시 및 국가 지명 label을 표시합니다. 모든 지명 layer는 `name:en`, `name_en`, `name:latin` 순으로 선택하며 이 값들이 없으면 현지 문자 fallback 대신 label을 생략합니다. zoom 18까지 vector 선과 글자를 현재 화면 해상도로 다시 그리므로 raster overzoom 픽셀화가 없고, Vite 전용 MapLibre worker asset을 명시적으로 연결해 production build에서도 타일 renderer가 시작됩니다. 배경 지도 요청이 실패해도 관측지 pin과 거리선은 제거되지 않으며 선택 변경 시 즉시 다시 그려집니다. 지도 안에는 OpenFreeMap, OpenMapTiles, OpenStreetMap attribution이 표시됩니다. 이 과정에서 브라우저의 IP 주소와 현재 지도 영역에 해당하는 style·vector tile·font 요청이 OpenFreeMap으로 전송될 수 있습니다.

`Catalog Search` 탭에는 상태가 독립적으로 유지되는 `LOFAR DR3`와 `VLASS` 하위 탭이 있습니다. LOFAR 탭은 ASTRON 비동기 TAP 서비스를 통해 `lotss_dr3.main_sources`를 조회합니다. 카탈로그 전체의 144 MHz 밝기 순 목록과 ICRS 중심 좌표·반경을 지정하는 cone search를 전환할 수 있으며, 밝기 순 검색에서는 `S_Code` S/M/C를 개별 또는 전체 선택해 TAP 쿼리 단계에서 형태 코드를 제한할 수 있습니다. SIMBAD 물리 유형은 별도의 `All physical types` 또는 Galaxy·AGN·Quasar·Blazar·Radio galaxy·Seyfert·Star·Pulsar·ISM·Radio source 범주로 선택합니다. 특정 물리 유형은 TOP N LoTSS 후보를 위치 대응한 뒤 confirmed primary type에 적용하므로 결과 수가 N보다 작을 수 있습니다. 정렬 기준·방향과 TOP 10–1000개 범위를 선택하고 실제 실행될 고정 LoTSS ADQL을 읽기 전용으로 미리 볼 수 있습니다.

VLASS 탭은 VizieR의 `J/ApJS/255/30/comp`에서 VLASS Epoch 1 Quick Look component catalog(Gordon et al. 2021)를 조회합니다. 3 GHz total/peak flux 밝기 순 목록과 ICRS cone search, S_Code S/C/M/E, SIMBAD 물리 유형, 정렬 방향과 TOP 결과 수를 선택할 수 있습니다. 기본 `Recommended sources only` 조건은 `DupFlag < 2`, `QualFlag` 0 또는 4를 적용하고, component가 없는 empty island인 S_Code E를 제외합니다. 결과에는 duplicate/quality flag와 main-sample 포함 여부가 표시됩니다. 두 카탈로그 모두 각 검색 방식의 입력·결과·페이지를 독립적으로 유지하고, 한 번 받은 결과는 브라우저에서 25개씩 나누어 표시하므로 페이지 이동은 TAP 작업을 다시 만들지 않습니다.

LoTSS의 `ILTJ...` 좌표 기반 ID와 `S/M/C` 전파 형태 코드는 항상 보존합니다. 5″ 이내 SIMBAD 위치 후보가 있으면 3C·NGC·IC 같은 친숙한 별칭을 우선 표시하고 SIMBAD 천체 유형, 대응 거리와 신뢰 구간을 함께 보여 줍니다. 이는 위치 기반 후보이지 확정 식별은 아닙니다. 외부 이름·유형 보강에 실패해도 원래 LoTSS 검색 결과와 선택 기능은 유지됩니다.

오래 걸리는 요청은 화면의 응답 대기를 중단하거나 같은 조건으로 재시도할 수 있습니다. 화면 대기 중단은 원격 job의 즉시 취소를 보장하지 않습니다. 서버 작업은 계속될 수 있으며, 완료되거나 제한시간에 도달하면 정리됩니다. 검색 결과에서 선택한 source는 좌표, 플럭스와 catalog metadata snapshot으로 관측 설정에 유지됩니다. 메인 탭에서는 기본 3C와 불러온 LOFAR/VLASS 천체를 모두 세로 목록에서 개별 선택·해제할 수 있고, 체크를 해제해도 목록에 남아 다시 선택할 수 있습니다. `Remove`를 눌렀을 때만 불러온 항목 자체가 사라집니다. 기본 3C와 모든 외부 catalog source를 합해 최대 25개까지 계산할 수 있습니다.

상세 target 그래프 아래에는 선택한 카탈로그 천체 중 전체 시간창의 하나 이상의 계산 샘플에서 모든 관측지가 동시에 기준 고도 이상인 target 전체의 시간–고도 개요가 이어집니다. 개요 패널의 체크 목록에서 플롯할 target을 개별 선택하거나 모두 표시·숨길 수 있습니다. 이 선택은 상세 target 카드와 API 계산 결과를 변경하지 않으며, 새 계산 결과를 받으면 관측 가능한 target 전체가 다시 기본 선택됩니다. 그래프에는 해당 천체의 전체 시간창 궤적을 표시하며, 시간창의 모든 샘플에서 보인다는 뜻은 아닙니다.

결과의 각 target 카드와 선택 target 상세 정보에는 시간창 내 최장 공통 가시 구간을 함께 표시합니다. 이 값은 연속 계산 샘플의 첫 시각과 마지막 시각 사이의 경과 길이이며, 샘플 사이 모든 순간의 가시성을 보장하는 값은 아닙니다. 단일 가시 샘플은 지속시간 미확정으로, 최장 구간이 시간창 경계에 닿으면 창 밖은 미계산으로 구분합니다.

# ADR 0002: LoTSS DR3 카탈로그 검색과 계산 좌표 snapshot

- 상태: 채택
- 날짜: 2026-08-12
- 수정: 2026-08-13 (밝기 순·cone 검색과 SIMBAD 위치 후보 보강)

## 맥락

기본 3C 다섯 천체 외에 LOFAR Two-metre Sky Survey Data Release 3(LoTSS DR3)의 source를
검색하고, 선택한 source를 동일한 시간–고도 및 공통 가시성 계산에 사용해야 합니다. 공개
source catalogue에는 약 1,366만 행이 있으므로 브라우저에서 전체 자료를 받거나 임의 ADQL을
실행하는 방식은 적합하지 않습니다.

## 결정

- 백엔드만 ASTRON의 공개 TAP endpoint와 `lotss_dr3.main_sources`를 조회합니다.
- 클라이언트는 밝기 순 목록과 source cone search 중 하나를 선택합니다. 밝기 순 목록은 선택적인
  LoTSS Source ID prefix, 밝기 정렬 기준·방향, 결과 수를 받으며 prefix를 생략하면 전역 상위 결과를
  조회합니다. Cone search는 ICRS RA·Dec와 최대 60 arcmin 반경을 받고 중심 거리 또는 밝기 순으로
  정렬합니다.
- 서버는 고정된 ADQL template과 ASTRON asynchronous TAP endpoint를 사용하며, 한 HTTP 요청의
  timeout, UWS job 전체 timeout, 최대 1,000행 상한을 각각 적용합니다.
- UWS job을 생성한 뒤 `PHASE=RUN`으로 실행하고 완료까지 상태를 확인합니다. 완료 결과를 받은 뒤
  job을 삭제하며, timeout이면 먼저 중단한 뒤 삭제합니다. 기본 job 제한시간은 90초이고 ASTRON
  서비스의 요청 부담을 제한하기 위해 1초에서 5초까지 점진적 간격으로 상태를 확인합니다.
- 한 process의 동일한 검색은 하나의 in-flight job으로 합치며, 한 waiter의 취소가 공유 job을
  취소하지 않습니다. 성공 응답은 기본 300초 동안 최대 32개까지 process-local cache에 저장하고
  오류는 cache하지 않습니다.
- 서로 다른 upstream job은 process마다 기본 2개, 최대 4개로 제한합니다. 한도에 도달한 새 고유
  검색은 `429 Too Many Requests`와 재시도 안내를 받고, 같은 in-flight 검색은 계속 합류합니다.
- 사용자가 선택한 source의 ID, ICRS RA/Dec, integrated/peak flux를 계산 요청의 snapshot으로
  전달합니다.
- 고도 계산은 snapshot 좌표만 사용하며 계산 중 외부 TAP를 다시 호출하지 않습니다.
- 기본 3C 대상과 외부 대상의 ID namespace를 분리하고 한 요청의 전체 target 수를 제한합니다.
- `Source_Name`은 대부분 좌표에서 자동 생성된 LoTSS 내부 `ILTJ...` 식별자로 간주하고, 외부에서
  얻은 친숙한 이름을 표시하더라도 원본 ID와 ICRS 좌표를 provenance로 보존합니다.
- `S_Code`는 물리적 천체 분류가 아닌 PyBDSF 형태 코드로 제공하며, `S`는 단일 Gaussian, `M`은
  복수 Gaussian, `C`는 다른 source와 같은 island 안의 단일 Gaussian source라는 코드표를 응답에
  포함합니다.
- LoTSS 결과를 CDS XMatch의 `simbad` catalogue와 5 arcsec, `best` 조건으로 위치 대응하고 SIMBAD
  TAP에서 선호 별칭과 object type 설명을 보강합니다. 각 LoTSS source당 가장 가까운 후보 하나만
  사용합니다.
- 대응 거리가 2 arcsec 이하이면 `high`, 2 arcsec 초과 5 arcsec 이하면 `caution`으로 표시합니다.
  이 값은 사용자 안내용 거리 구간이며 동일 천체의 확정 식별이나 통계적 확률을 뜻하지 않습니다.
- XMatch 위치 대응이 실패하면 원본 LoTSS 결과와 `unavailable` 상태를 반환합니다. 위치 대응 후
  SIMBAD 별칭·유형 조회만 실패하면 후보 정보와 `partial` 상태를 반환합니다. 보강 서비스 장애가
  ASTRON 검색 자체를 실패시키지 않는 fail-soft 계약입니다.
- 보강의 각 외부 단계에는 `CATALOG_ENRICHMENT_TIMEOUT_SECONDS` 제한시간을 별도로 적용합니다.

공개 ASTRON·CDS 조회에는 계정이나 API key가 필요하지 않습니다. ASTRON의 본 source 조회가
지연되거나 잘못된 응답을 반환하면 검색을 제어된 오류로 종료합니다. 반면 XMatch·SIMBAD 보강의
오류는 위 fail-soft 상태로 반환합니다. 어느 장애도 이미 가져온 좌표의 로컬 계산에는 영향을 주지
않습니다.

## 결과

검색 결과는 144 MHz `Total_flux`(mJy) 또는 `Peak_flux`(mJy/beam) 순으로 비교할 수 있습니다.
이 값은 검색과 표시용이며 현재의 가시성 판정에는 사용하지 않습니다. scientific use 시
[LoTSS DR3 릴리스](https://lofar-surveys.org/dr3.html)의 인용·acknowledgement 지침과
[ASTRON source table](https://vo.astron.nl/tableinfo/lotss_dr3.main_sources)의 라이선스를 따릅니다.

Cone 검색의 중심–LoTSS 거리는 `separation_arcmin`, LoTSS–SIMBAD 후보 거리는
`crossmatch_separation_arcsec`로 구분합니다. SIMBAD 이름·유형은 위치 대응으로 추가된 정보이며,
특히 확장 전파원·복수 component·혼잡 영역에서는 별도 과학적 확인이 필요합니다. 공식 계약은
[ASTRON cone service](https://vo.astron.nl/lotss_dr3/q/src_cone/info),
[CDS XMatch API](https://cdsxmatch.u-strasbg.fr/xmatch/doc/cross-match-API.html),
[SIMBAD object type codebook](https://simbad.cds.unistra.fr/Pages/guide/otypes_desc.htx)를 기준으로 합니다.

계산 API는 전달받은 snapshot의 형식·범위·namespace를 검증하지만 계산 시 원격 카탈로그와
다시 대조하지는 않습니다. 따라서 API를 웹 UI 밖에서 직접 호출하는 소비자는 provenance를
스스로 보존해야 합니다.

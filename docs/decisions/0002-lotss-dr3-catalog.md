# ADR 0002: LoTSS DR3 카탈로그 검색과 계산 좌표 snapshot

- 상태: 채택
- 날짜: 2026-08-12
- 수정: 2026-08-13 (asynchronous TAP 전역 목록 조회)

## 맥락

기본 3C 다섯 천체 외에 LOFAR Two-metre Sky Survey Data Release 3(LoTSS DR3)의 source를
검색하고, 선택한 source를 동일한 시간–고도 및 공통 가시성 계산에 사용해야 합니다. 공개
source catalogue에는 약 1,366만 행이 있으므로 브라우저에서 전체 자료를 받거나 임의 ADQL을
실행하는 방식은 적합하지 않습니다.

## 결정

- 백엔드만 ASTRON의 공개 TAP endpoint와 `lotss_dr3.main_sources`를 조회합니다.
- 클라이언트는 선택적인 LoTSS Source ID prefix, 허용된 밝기 정렬 기준·방향, 결과 수만 보냅니다.
  prefix를 생략하면 카탈로그 전체에서 정렬된 상위 결과를 조회합니다.
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

공개 ASTRON 조회에는 계정이나 API key가 필요하지 않습니다. 외부 서비스가 지연되거나 잘못된
응답을 반환하면 검색만 제어된 오류로 종료하고, 이미 가져온 좌표의 로컬 계산에는 영향을 주지
않습니다.

## 결과

검색 결과는 144 MHz `Total_flux`(mJy) 또는 `Peak_flux`(mJy/beam) 순으로 비교할 수 있습니다.
이 값은 검색과 표시용이며 현재의 가시성 판정에는 사용하지 않습니다. scientific use 시
[LoTSS DR3 릴리스](https://lofar-surveys.org/dr3.html)의 인용·acknowledgement 지침과
[ASTRON source table](https://vo.astron.nl/tableinfo/lotss_dr3.main_sources)의 라이선스를 따릅니다.

계산 API는 전달받은 snapshot의 형식·범위·namespace를 검증하지만 계산 시 원격 카탈로그와
다시 대조하지는 않습니다. 따라서 API를 웹 UI 밖에서 직접 호출하는 소비자는 provenance를
스스로 보존해야 합니다.

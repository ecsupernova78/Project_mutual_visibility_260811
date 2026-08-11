# ADR 0001: 초기 웹 기술 스택과 경계

- 상태: 채택
- 날짜: 2026-08-11

## 맥락

기존 연구는 Astropy의 `EarthLocation`, `Time`, `SkyCoord`, `AltAz` 변환을 중심으로 작성되었습니다. 새 제품은 임의의 두 위치와 시각을 입력받아 동시 가시 영역 및 카탈로그 천체를 반환하고, 브라우저에서 상호작용형으로 표시해야 합니다.

## 결정

하나의 Git 저장소 안에서 다음 두 런타임을 분리합니다.

- `backend`: Python 3.14, FastAPI, Astropy, NumPy, Uvicorn
- `frontend`: Node.js 24 LTS, React, TypeScript, Vite

Python 의존성은 `uv.lock`, JavaScript 의존성은 루트 `package-lock.json`으로 재현합니다. 브라우저는 카탈로그 서비스에 직접 연결하지 않고 백엔드를 거쳐 시간 제한, 행 제한, 캐시, 출처 메타데이터를 일관되게 적용합니다.

## 의존성 단계

- 기본: Astropy/NumPy 계산과 FastAPI 계약, React/Vite 화면 기반
- 첫 카탈로그 기능: `astroquery` 그룹 추가 동기화
- 과거 산출 재현: `matplotlib`, `imageio`, FFmpeg 연구 그룹 동기화
- 필요가 입증된 뒤: PyVO/TAP, Astroplan, 작업 큐, 데이터베이스, Playwright

Matplotlib/영상 생성은 초기 운영 API에 넣지 않습니다. 실시간은 우선 '현재 시각을 조회해 계산'하는 REST 요청으로 정의하며, transient alert 스트림이 필요할 때 공급원과 인증을 정한 후 SSE/WebSocket을 검토합니다.

## 운영 조건

- Astropy IERS 자동 다운로드/캐시/오프라인 정확도 정책을 배포 전 명시합니다.
- 대규모 격자 계산은 벤치마크와 요청 상한을 먼저 둡니다.
- 카탈로그 응답에는 카탈로그명, 데이터 릴리스, 질의시각, 좌표계, 행 제한을 포함합니다.
- 정적 프런트와 CPU 사용 Python API를 독립 배포할 수 있게 유지합니다.

## 배포 보류 사항

초기 후보는 Git 기반 자동 배포를 지원하는 정적 사이트 + 컨테이너 API 조합입니다. 원격 저장소 소유자/공개 범위와 배포 제공자를 사용자와 확정하기 전에는 공급자 전용 설정이나 자격증명을 추가하지 않습니다.

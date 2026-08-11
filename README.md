# Mutual Visibility

두 관측 위치에서 동시에 관측 가능한 천체와 하늘 영역을 탐색하는 웹 인터페이스 프로젝트입니다.

## 현재 상태

이 저장소는 **구현 전 준비 단계**입니다. 웹 화면, API 엔드포인트, 계산 모듈은 아직 만들지 않았습니다. 현재 포함된 것은 다음뿐입니다.

- 과거 실험 코드와 결과 이미지의 보존
- 프런트엔드/백엔드 작업공간 경계
- 재현 가능한 런타임 및 패키지 선언
- Git에 포함할 파일과 제외할 생성물·비밀정보 정책
- 초기 기술·배포 의사결정 문서

## 디렉터리

```text
.
├─ backend/          # 향후 FastAPI + Astropy 서비스
├─ frontend/         # 향후 React + TypeScript + Vite SPA
├─ references_2026/  # 수정하지 않는 과거 연구 코드
├─ docs/             # 기술 결정과 작업공간 운영 문서
└─ image.png         # 기존 참고 이미지(용도 확정 전 원위치 보존)
```

## 기준 런타임

- Python 3.14, `uv`, Astropy 8.0
- Node.js 24 LTS, npm, React 19, Vite 8
- Git for Windows 2.55 이상 권장

상세 설치와 검증 절차는 [docs/WORKSPACE_SETUP.md](docs/WORKSPACE_SETUP.md), 설계 근거는 [docs/decisions/0001-initial-stack.md](docs/decisions/0001-initial-stack.md)를 참고하십시오.

## 보존 원칙

`references_2026`는 동작 가능한 제품 코드가 아니라 설계 근거가 되는 원자료입니다. 새 백엔드가 이 파일들을 직접 import하지 않으며, 검증된 계산만 테스트와 함께 새 모듈로 옮깁니다. Git 속성도 기존 파일의 바이트와 개행을 자동 변환하지 않도록 설정했습니다.

## Git 및 배포

로컬 저장소는 `main` 브랜치이며 `origin`은 [GitHub 저장소](https://github.com/ecsupernova78/Project_mutual_visibility_260811)에 연결합니다. 인증정보는 추적 파일에 저장하지 않으며, 배포 서비스는 별도로 확정한 후 연동합니다.

# 공통하늘 프런트엔드

두 관측지에서 동시에 보이는 카탈로그 천체의 시간–고도 곡선을 비교하는 React 19 + TypeScript 단일 페이지 앱입니다.

개발 서버는 `/api` 요청을 `http://127.0.0.1:8000`으로 전달합니다. 저장소 루트에서 환경 활성화 후 아래 명령을 사용할 수 있습니다.

```powershell
npm run dev --workspace frontend
npm run build --workspace frontend
npm run lint --workspace frontend
npm run test --workspace frontend
```

첫 화면에는 두 관측지 좌표, UTC 시간창, 계산 간격, 최소 고도와 3C 카탈로그 선택이 있습니다. 계산 결과의 강조 영역은 API가 반환한 동시 가시 샘플 및 연속 샘플 묶음이며 샘플 사이 모든 순간을 보장하지 않습니다.

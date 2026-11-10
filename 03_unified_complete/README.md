# AVN 공장 검사라인 통합 시뮬레이터

index.html을 브라우저에서 열어 오프라인으로 실행합니다. CDN·ES module·외부 폰트를 사용하지 않습니다. 이 폴더 안의 7개 뷰는 하나의 시뮬레이션 인스턴스와 snapshot을 공유합니다.

## 시나리오와 조작

- single_line: 기존 8단계 AVN 검사 예시
- multi_line_example: 로봇 두 대, A/B/C/D, 비전, 라벨 공정의 예시
- 상단 컨트롤에서 용량 10/20, 속도, pause/resume, reset, 시나리오를 조작합니다.
- 용량 라벨은 단위를 확정하지 않는 예시 설정입니다.
- 01–06번은 평면도, 흐름 대시보드, 아이소메트릭, Three.js, 안돈, PC별 검사 이력입니다. 07번은 멀티라인 로봇 3D입니다.
- Three.js r159 classic build와 MIT 라이선스는 views/04_threejs_3d/vendor/three/에 포함되어 있습니다.
- AVN의 기존 샘플 소스는 저장소의 ../01_original_samples/에 있습니다.

## 미리보기 캡처

preview/에는 2D 평면도, 아이소메트릭, Three.js, 검사 간트, 로봇 3D의 대표 화면을 넣었습니다. 전체 7개 화면은 index.html에서 확인할 수 있습니다.

## 검증

    node tests/invariants.node.js
    sh qa/headless_qa.sh

헤드리스 브라우저 스크립트는 7개 뷰 화면, 멀티라인 로봇 동작, 카메라 입력, 공통 컨트롤을 점검하고 qa/screenshots/와 qa/browser_qa.log를 생성합니다.

## 예시 데이터와 미확정 사항

화면의 공정, 시간, 제품과 설비는 예시 데이터·가상 시뮬레이션입니다. 실제 AVN 실설비, PLC, MES에는 연결되지 않습니다. 용량의 단위와 물리적 정의, 상세 공정 조건, 장비 동작은 미확정입니다. A의 12개 동시 처리는 사용자 설명을 반영했고 다른 스테이션 용량과 모든 처리 시간은 예시 가정입니다.

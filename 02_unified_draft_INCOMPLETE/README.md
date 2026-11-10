# AVN 검사라인 통합 시뮬레이터

## 실행 방법

`index.html`을 Chrome 등 브라우저에서 열면 `file://`로 오프라인 실행됩니다. 외부 CDN, ES module, 외부 폰트를 사용하지 않습니다. 공통 상태와 결정적 난수 기반 시뮬레이션 엔진은 한 인스턴스로 유지되고, 탭 전환 시 활성 뷰만 mount/unmount 됩니다.

- 시나리오: `single_line`은 기존 AVN 8단계 검사, `multi_line_example`은 로봇 2대와 A/B/C/D/비전/라벨 흐름의 예시입니다.
- 컨트롤: pause/resume, reset, speed, capacity 10/20은 공통 엔진 상태를 조작합니다.
- 용량 라벨: “가정: capacity=구성 가능한 용량(예시)”는 capacity의 단위를 확정하지 않고 예시 설정임을 표시합니다.
- canonical 데이터: `data/factory.json`. 편집 후 `sh data/sync.sh`를 실행해 `data/factory.js`를 다시 만듭니다.
- 레거시 비교 샘플: `legacy_samples_preserved/01_topdown_2d`부터 `06_swimlane_gantt`까지 보존합니다.
- 로컬 Three.js: `views/04_threejs_3d/vendor/three.min.js` (MIT, 라이선스는 같은 폴더 `LICENSE`).

## 검증

```sh
node tests/invariants.node.js | tee qa/node_test.log
sh qa/headless_qa.sh
```

Headless QA는 설치된 `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`을 임시 프로필과 함께 실행합니다. 브라우저 콘솔 오류와 외부 네트워크 요청을 기록하고, 6개 뷰를 각각 `qa/screenshots/01.png` … `06.png`에 저장합니다. 컨트롤 조작 결과와 로그는 `qa/browser_qa.log`에 기록됩니다.

## 예시 및 미확정 사항

화면의 모든 데이터는 예시 데이터·가상 시뮬레이션입니다. capacity의 단위와 실제 설비 용량, 스테이션별 세부 공정, 제품/팔레트의 물리적 정의, 로봇 및 컨베이어 동작 조건은 미확정입니다. 실제 설비·PLC·MES에는 연결되지 않습니다. 멀티라인 흐름은 사용자 설명을 시각화하기 위한 예시 모델이며 실제 공정이라고 단정하지 않습니다.

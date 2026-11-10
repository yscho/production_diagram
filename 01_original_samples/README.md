# AVN 공장 검사라인 시각화 테스트 (샘플 6종)

가상 AVN(차량용 오디오·비디오·내비) 최종 검사라인 8단계를 서로 다른 표현 방식으로 시각화한 HTML 샘플 모음입니다.
모든 샘플은 인터넷 없이 `file://`로 더블클릭해 열립니다(CDN·외부 폰트·ES 모듈 없음). 비교 페이지: `index.html`.

## 공통 데이터 수정 방법
1. `data/line.json` 을 편집합니다 (라인 정보, `simulation`(배속·팔레트 수·투입 간격·시드 등), `statusColors`, `stages[]`).
   - 각 단계: `id, code, name, nameEn, palletSlots, testPcs, cycleTimeSec, failRate, items[]`
   - 단계를 추가/삭제해도 모든 샘플이 자동으로 따라갑니다.
2. `sh data/sync.sh` 실행 → `data/line.js`(`window.LINE_DATA = …`) 재생성.
   - 브라우저는 file:// 에서 JSON fetch가 막혀 있으므로 각 샘플은 `<script src="../data/line.js">` 로 읽습니다.
3. 샘플 페이지 새로고침.

## 단계 (가상)
| # | 코드 | 단계 | 슬롯 | PC | 사이클(s) | 불량률 |
|---|---|---|---|---|---|---|
| 1 | VER | 버전 검사 | 4 | 2 | 30 | 1% |
| 2 | BT | 블루투스 화면 검사 | 6 | 3 | 75 | 3% |
| 3 | RF | 라디오·와이파이 검사 | 6 | 3 | 90 | 4% |
| 4 | USB | USB 검사 | 4 | 2 | 40 | 2% |
| 5 | GPS | GPS·내비게이션 검사 | 6 | 3 | 80 | 3% |
| 6 | CAM | 카메라·AV 입력 검사 | 4 | 2 | 50 | 2% |
| 7 | AUD | 스피커·오디오 검사 | 6 | 3 | 70 | 3% |
| 8 | FQC | 최종 QC·플래시 | 4 | 2 | 45 | 1% |

## 샘플별 요약
제작: Paseo 0.15.3 (<REDACTED_DEVICE> 로컬 데몬)으로 에이전트를 병렬 실행. 각 폴더의 `NOTES.md`에 에이전트가 작성한 상세 설명이 있습니다.

| 폴더 | 표현 | 장점 | 단점 | 도구 / 모델 / Paseo agent id |
|---|---|---|---|---|
| `01_topdown_2d` | 2D 탑다운 평면도(SVG). 스테이션 블록에 슬롯 칸·PC 아이콘, 팔레트 이동, 하단 리젝트 레인, 우측 KPI·스테이션 상태 | 현장 배치와 비슷해 직관적, 가벼움 | 단계가 많아지면 카드가 작아짐, 팔레트 이동 연출은 단순 | Codex / gpt-6-luna (medium) / `c0d201af-f0bd-4f4d-8db3-bef37e9a07c5` |
| `02_flow_dashboard` | 좌→우 흐름도(노드·슬롯 점유·PC·대기열) + KPI·단계별 가동률·UPH 추이·병목·이벤트 로그 | 흐름과 지표·병목을 한 화면에서 연결, 관리자용 | 공간 배치감 없음, 초기 수 분은 데이터 수집 중 표시 | Claude Code / claude-sonnet-5-5 (Paseo mode acceptEdits) / `9b0b3afb-74ab-4d1b-b63e-6dec7790c8a8` |
| `03_isometric` | 아이소메트릭 2.5D(라이브러리 없음). 셀·지그·PC 랙, 팔레트 이동, 호버 툴팁, 하단 KPI | 입체감 있으면서 3D 엔진 불필요, 가벼움 | 시점 고정, 겹침 정렬 복잡 | Cursor Agent / Auto(모델 미표시, Paseo `Model -`) (mode agent) / `6d2a0d4e-b619-408c-a945-e1c4b42fb722` |
| `04_threejs_3d` | Three.js 3D 라인(로컬 r159 UMD, MIT, `vendor/three/LICENSE`). 지그·PC 모니터 상태 발광, 드래그 회전/휠 줌 | 디지털 트윈 느낌, 자유 시점 | 무거움(WebGL), 텍스트 가독성 낮음, three r159 UMD는 deprecated 경고 1건 출력 | Codex / gpt-6.1-sol (medium) / `7fa9b916-6cac-4fb4-9eb4-8c80aeeba668` (1차 gpt-6-luna `e3fd2756-88af-4f63-90f5-c1887aa2496f` 결과물은 카메라·UPH 문제로 대체) |
| `05_card_grid` | 카드/그리드 안돈 보드(CSS Grid). 단계 카드에 슬롯 셀·PC 타일(시리얼·진행률)·수율·대기열, 안돈 헤더·경보 | 현장 모니터용으로 정보 밀도·가독성 최고, 반응형 | 물리적 흐름은 안 보임 | Claude Code / claude-sonnet-5-5 (acceptEdits) / `cb86e262-7baa-47ac-b6a9-5e2983515607` |
| `06_swimlane_gantt` | 스윔레인 + 간트 타임라인(Canvas). 단계×PC 레인에 검사 막대, 슬롯 게이지·대기열, 팔레트 클릭 시 경로 하이라이트, 과거 탐색 | 시간축 병목·PC 가동 패턴 분석에 최적, 추적성 | 실시간 현황판으로는 덜 직관적, 화면 폭 필요 | Claude Code / claude-sonnet-5-5 (acceptEdits) / `fd6ec479-8fea-4f57-afd8-f22b65aec79a` |

## 비고
- Antigravity는 사용하지 않았습니다(사용자 지시). Paseo에서 Antigravity는 full-access 모드만 지원.
- 시뮬레이션은 모두 `simulation.randomSeed` 기반 의사난수로 재현 가능, 배속 기본값은 `simulation.speed`.
- 스크린샷: `screenshots/*.png` (헤드리스 Chrome 1600×1000, 로드 후 약 45초 시점).
- 가상 데이터이며 실제 설비/MES와 연결되지 않습니다.

import { DisassemblySimulation3D } from './scene3d.js';

const STORAGE_KEY = 'pcb_rework_sim_state_v1';

const DEFAULT_COMPONENT_LABELS = {
  housing: '스틸 박싱 하우징',
  screws: '체결 스크류 (하우징/PCB)',
  topPcb: '탑 PCB (Top PCB)',
  cpu: 'CPU',
  emmc: 'eMMC',
  connector: '결합 커넥터 (B2B)',
  prodBottomPcb: '양산용 바텀 PCB',
  devBottomPcb: '개발용 바텀 PCB',
  mcu: 'MCU',
  jtag: 'JTAG 선 (디버거 포트)'
};

// Preset 1: Core 3-Step Rework Flowchart (matching the user's exact 1-2-3 specification)
const CORE_3_STEPS = [
  {
    id: 'step-1',
    title: '스크류 해체 및 스틸 하우징 언박싱 분해',
    badgeText: 'STEP 1 · 언박싱 및 분해',
    badgeClass: 'badge-unbox',
    preset3d: 'unbox',
    desc: '스틸 박싱 하우징의 체결 스크류를 풀고 언박싱한 뒤, 내부에 장착된 PCB 어셈블리를 꺼내어 분해를 시작합니다.',
    note: '조립 상태에서는 스틸 하우징 내부에 탑 PCB와 바텀 PCB가 커넥터로 연결된 채 스크류로 체결되어 있습니다.',
    decisionText: '',
    tags: ['스틸 하우징 언박싱', '체결 스크류 해체', 'PCB 어셈블리 분리']
  },
  {
    id: 'step-2',
    title: '탑 PCB(CPU·eMMC) & 바텀 PCB(MCU) 분리',
    badgeText: 'STEP 2 · 보드 구조 확인 및 탈거',
    badgeClass: 'badge-inspect',
    preset3d: 'pcb_split',
    desc: '결합 커넥터를 분리하여 탑 PCB와 바텀 PCB를 떼어냅니다. 탑 PCB에는 CPU와 eMMC가 탑재되어 있고, 바텀 PCB에는 MCU와 JTAG 영역이 있습니다.',
    note: '⚠️ 생산 중인(양산용) 바텀 PCB에는 JTAG 선이 없으므로, 이 보드 상태로는 탑 PCB 소프트웨어를 업데이트할 수 없습니다.',
    decisionText: '분기 확인: 생산 중인 바텀 PCB에 JTAG 선이 있는가? ➔ ❌ 없음 (개발용 바텀 PCB로 교체 필요)',
    tags: ['탑 PCB: CPU + eMMC', '바텀 PCB: MCU', '양산용 바텀: JTAG 선 없음']
  },
  {
    id: 'step-3',
    title: '개발용 바텀 PCB 연결 및 탑 PCB SW 업데이트',
    badgeText: 'STEP 3 · JTAG 리워크 업데이트',
    badgeClass: 'badge-rework',
    preset3d: 'dev_rework',
    desc: '분리한 탑 PCB를 뽑아서 JTAG 선이 살아있는 "개발용 바텀 PCB"와 커넥터로 연결합니다. 이후 JTAG을 통해 탑 PCB(CPU/eMMC)의 소프트웨어를 업데이트(리워크)합니다.',
    note: '⚡ 신호 경로: JTAG 선 ➔ 개발용 바텀 PCB (MCU/JTAG) ➔ 결합 커넥터 ➔ 탑 PCB (CPU & eMMC 업데이트 완료)',
    decisionText: '',
    tags: ['탑 PCB + 개발용 바텀 PCB 결합', 'JTAG 선 연결', '탑 PCB(CPU/eMMC) 업데이트']
  }
];

// Preset 2: Full 5-Step Lifecycle (including initial assembled state in steel housing & final reassembly)
const FULL_5_STEPS = [
  {
    id: 'step-0',
    title: '조립 상태 (스틸 하우징 내 탑/바텀 PCB 결합) & SW 이상 감지',
    badgeText: '사전 상태 · 조립 구조 & SW 이상',
    badgeClass: 'badge-error',
    preset3d: 'sw_error',
    desc: '탑 PCB와 양산용 바텀 PCB가 커넥터로 이어진 채 스틸 계열 박싱 하우징 내부에 놓여 있고 스크류로 각각 체결되어 있습니다. 이때 탑 PCB(CPU/eMMC)에 SW 이상이 발생합니다.',
    note: '투시(X-Ray) 모드를 통해 스틸 하우징 내부에 두 PCB가 커넥터로 맞물려 안착된 구조를 확인할 수 있습니다.',
    decisionText: '',
    tags: ['스틸 박싱 하우징', '탑+바텀 커넥터 결합', 'SW 이상 발생']
  },
  ...CORE_3_STEPS.map((s) => ({ ...s })),
  {
    id: 'step-4',
    title: '양산용 바텀 PCB 재결합 및 스틸 하우징 스크류 체결',
    badgeText: '마무리 · 재조립 및 출고 대기',
    badgeClass: 'badge-assemble',
    preset3d: 'reassembled',
    desc: 'SW 업데이트가 완료된 탑 PCB를 개발용 바텀 PCB에서 분리한 후, 다시 원래의 양산용 바텀 PCB와 커넥터로 연결하고 스틸 하우징에 넣어 스크류로 체결합니다.',
    note: '✅ 리워크 완료: 정상 복구된 탑 PCB + 양산용 바텀 PCB 결합 후 스틸 박싱 스크류 체결 완료',
    decisionText: '',
    tags: ['양산용 바텀 PCB 재연결', '스틸 하우징 장착', '스크류 체결 완료']
  }
];

class AppController {
  constructor() {
    this.steps = JSON.parse(JSON.stringify(FULL_5_STEPS));
    this.componentLabels = { ...DEFAULT_COMPONENT_LABELS };
    this.activeStepIndex = 0;
    this.editingStepId = null;
    this.autoPlayTimer = null;
    this.activeTopTab = 'sim'; // 'sim' | 'diagram'

    this.loadSavedState();
    this.initDOMRefs();
    this.init3DScene();
    this.bindEvents();
    this.renderAll();
    this.selectStep(0);
  }

  loadSavedState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed.steps) && parsed.steps.length > 0) {
          this.steps = parsed.steps;
        }
        if (parsed.componentLabels) {
          this.componentLabels = { ...DEFAULT_COMPONENT_LABELS, ...parsed.componentLabels };
        }
      }
    } catch (e) {
      console.warn('Could not load saved state:', e);
    }
  }

  saveState() {
    try {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          steps: this.steps,
          componentLabels: this.componentLabels
        })
      );
    } catch (e) {
      console.warn('Could not save state:', e);
    }
  }

  initDOMRefs() {
    this.canvasWrapper = document.getElementById('canvas-wrapper');
    this.labelsContainer = document.getElementById('labels-container');
    this.flowchartList = document.getElementById('flowchart-list');

    // Top status banner in 3D viewport
    this.statusStepPill = document.getElementById('status-step-pill');
    this.statusTitle = document.getElementById('status-title');
    this.statusDesc = document.getElementById('status-desc');

    // Explode slider & value
    this.explodeRange = document.getElementById('explode-range');
    this.explodeValueBadge = document.getElementById('explode-value-badge');

    // Mini 2D Cross-section schematic container
    this.miniSchematicContent = document.getElementById('mini-schematic-content');
    this.schematicMiniCard = document.getElementById('schematic-mini-card');

    // Fullscreen diagram presentation view
    this.diagramView = document.getElementById('diagram-fullscreen-view');
    this.archCompareContainer = document.getElementById('arch-compare-container');
    this.visualFlowchartBoard = document.getElementById('visual-flowchart-board');

    // Component customizer modal
    this.specModal = document.getElementById('spec-modal');
  }

  init3DScene() {
    this.sim3d = new DisassemblySimulation3D(
      this.canvasWrapper,
      this.labelsContainer,
      (partId) => this.handlePartClick(partId)
    );
    this.sim3d.updateComponentLabels(this.componentLabels);
  }

  bindEvents() {
    // Top mode tabs ('3D 분해도 & 리워크 시뮬레이터' vs '한눈에 보는 구조도 & 순서도 보드')
    document.querySelectorAll('.mode-tab').forEach((btn) => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.mode-tab').forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        const mode = btn.dataset.mode;
        this.activeTopTab = mode;
        if (mode === 'diagram') {
          this.diagramView.classList.add('active');
          this.renderFullscreenDiagram();
        } else {
          this.diagramView.classList.remove('active');
          setTimeout(() => this.sim3d.onResize(), 50);
        }
      });
    });

    // Housing visibility mode toggles (X-Ray / 불투명 스틸 / 와이어프레임 / 하우징 숨김)
    document.querySelectorAll('[data-housing-mode]').forEach((btn) => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('[data-housing-mode]').forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        this.sim3d.setHousingMode(btn.dataset.housingMode);
      });
    });

    // Toggle 3D pin labels
    const toggleLabelsBtn = document.getElementById('btn-toggle-labels');
    toggleLabelsBtn.addEventListener('click', () => {
      this.sim3d.showLabels = !this.sim3d.showLabels;
      toggleLabelsBtn.classList.toggle('active', this.sim3d.showLabels);
    });

    // Explode slider
    this.explodeRange.addEventListener('input', (e) => {
      this.stopAutoPlay();
      const val = parseInt(e.target.value, 10);
      this.explodeValueBadge.textContent = `${val}%`;
      this.sim3d.setExplodeFactor(val / 100);
      this.updateMiniSchematic('exploded_custom', val);
    });

    // Bottom quick 3D state preset buttons
    document.querySelectorAll('[data-quick-preset]').forEach((btn) => {
      btn.addEventListener('click', () => {
        this.stopAutoPlay();
        const preset = btn.dataset.quickPreset;
        if (preset === 'assembled_zero') {
          this.explodeRange.value = 0;
          this.explodeValueBadge.textContent = '0%';
          this.sim3d.applyPreset('assembled');
          this.statusStepPill.textContent = '조립 완료 상태 (투시)';
          this.statusTitle.textContent = '스틸 하우징 내부 탑 PCB + 바텀 PCB 커넥터 결합 상태';
          this.statusDesc.textContent =
            '탑 PCB와 바텀 PCB가 B2B 커넥터로 연결된 채 스틸 박싱 하우징 내부에 안착되어 스크류로 체결된 상태입니다.';
          this.updateMiniSchematic('assembled');
        } else if (preset === 'exploded_full') {
          this.explodeRange.value = 100;
          this.explodeValueBadge.textContent = '100%';
          this.sim3d.setExplodeFactor(1.0);
          this.statusStepPill.textContent = '전체 분해도 (Exploded View)';
          this.statusTitle.textContent = '스틸 하우징 · 체결 스크류 · 탑 PCB · 바텀 PCB 수직 분해도';
          this.statusDesc.textContent =
            '상부 스틸 커버, 체결 스크류, 탑 PCB(CPU/eMMC), 결합 커넥터, 바텀 PCB(MCU), 하부 스틸 박싱의 적층 관계를 보여줍니다.';
          this.updateMiniSchematic('pcb_split');
        } else if (preset === 'dev_swap') {
          this.explodeRange.value = 50;
          this.explodeValueBadge.textContent = '리워크';
          this.sim3d.applyPreset('dev_rework');
          this.statusStepPill.textContent = '리워크 핵심 상태 (개발용 바텀 PCB 결합)';
          this.statusTitle.textContent = '탑 PCB + 개발용 바텀 PCB(JTAG 포함) 결합 및 SW 업데이트';
          this.statusDesc.textContent =
            'JTAG 선이 없는 양산용 바텀 PCB를 빼고, JTAG 선이 있는 개발용 바텀 PCB에 탑 PCB를 꽂아 CPU/eMMC를 업데이트합니다.';
          this.updateMiniSchematic('dev_rework');
        }
      });
    });

    // Schematic card collapse toggle
    document.getElementById('schematic-toggle-header').addEventListener('click', () => {
      this.schematicMiniCard.classList.toggle('collapsed');
      const icon = document.getElementById('schematic-collapse-icon');
      icon.textContent = this.schematicMiniCard.classList.contains('collapsed') ? '▲ 펼치기' : '▼ 접기';
    });

    // Playback controls in Flowchart sidebar
    document.getElementById('btn-prev-step').addEventListener('click', () => {
      this.stopAutoPlay();
      const nextIdx = (this.activeStepIndex - 1 + this.steps.length) % this.steps.length;
      this.selectStep(nextIdx);
    });

    document.getElementById('btn-next-step').addEventListener('click', () => {
      this.stopAutoPlay();
      const nextIdx = (this.activeStepIndex + 1) % this.steps.length;
      this.selectStep(nextIdx);
    });

    this.autoPlayBtn = document.getElementById('btn-autoplay');
    this.autoPlayBtn.addEventListener('click', () => {
      if (this.autoPlayTimer) {
        this.stopAutoPlay();
      } else {
        this.startAutoPlay();
      }
    });

    // Flowchart customization buttons
    document.getElementById('btn-add-step').addEventListener('click', () => {
      this.addNewStep();
    });

    document.getElementById('btn-preset-3step').addEventListener('click', () => {
      this.stopAutoPlay();
      this.steps = JSON.parse(JSON.stringify(CORE_3_STEPS));
      this.editingStepId = null;
      this.saveState();
      this.renderAll();
      this.selectStep(0);
    });

    document.getElementById('btn-preset-5step').addEventListener('click', () => {
      this.stopAutoPlay();
      this.steps = JSON.parse(JSON.stringify(FULL_5_STEPS));
      this.editingStepId = null;
      this.saveState();
      this.renderAll();
      this.selectStep(0);
    });

    // Hardware Component Spec Customizer Modal
    document.getElementById('btn-open-spec-modal').addEventListener('click', () => {
      this.openSpecModal();
    });
    document.getElementById('btn-close-spec-modal').addEventListener('click', () => {
      this.specModal.classList.remove('open');
    });
    document.getElementById('btn-save-spec-modal').addEventListener('click', () => {
      this.saveSpecModal();
    });
    document.getElementById('btn-reset-spec-modal').addEventListener('click', () => {
      this.componentLabels = { ...DEFAULT_COMPONENT_LABELS };
      this.sim3d.updateComponentLabels(this.componentLabels);
      this.saveState();
      this.openSpecModal();
      this.renderAll();
    });
  }

  startAutoPlay() {
    this.autoPlayBtn.textContent = '⏸ 자동 재생 중지';
    this.autoPlayBtn.classList.add('btn-primary');
    this.autoPlayTimer = setInterval(() => {
      const nextIdx = (this.activeStepIndex + 1) % this.steps.length;
      this.selectStep(nextIdx);
    }, 4200);
  }

  stopAutoPlay() {
    if (this.autoPlayTimer) {
      clearInterval(this.autoPlayTimer);
      this.autoPlayTimer = null;
    }
    if (this.autoPlayBtn) {
      this.autoPlayBtn.textContent = '▶ 단계별 자동 재생';
      this.autoPlayBtn.classList.remove('btn-primary');
    }
  }

  selectStep(index) {
    if (index < 0 || index >= this.steps.length) index = 0;
    this.activeStepIndex = index;
    const step = this.steps[index];

    // Sync 3D simulation state
    this.sim3d.applyPreset(step.preset3d);

    // Sync slider visual badge
    const presetExplodeMap = {
      assembled: 0,
      sw_error: 0,
      unbox: 65,
      pcb_split: 85,
      dev_rework: 50,
      reassembled: 0
    };
    const pct = presetExplodeMap[step.preset3d] ?? 50;
    this.explodeRange.value = pct;
    this.explodeValueBadge.textContent = step.preset3d === 'dev_rework' ? '리워크 결합' : `${pct}%`;

    // Update top HUD banner
    this.statusStepPill.textContent = `${step.badgeText} (${index + 1} / ${this.steps.length})`;
    this.statusTitle.textContent = step.title;
    this.statusDesc.textContent = step.desc;

    // Update 2D Mini Schematic
    this.updateMiniSchematic(step.preset3d);

    // Highlight active step card in flowchart
    this.renderFlowchart();
  }

  handlePartClick(partId) {
    const partInfoMap = {
      topHousing: {
        pill: '부품 상세 · 상부 스틸 하우징',
        title: `상부 ${this.componentLabels.housing}`,
        desc: '스틸 계열 박싱 구조의 상단 커버입니다. 4개의 모서리 체결 스크류로 하부 하우징과 결합되어 내부 PCB를 보호합니다.'
      },
      bottomHousing: {
        pill: '부품 상세 · 하부 스틸 하우징',
        title: `하부 ${this.componentLabels.housing}`,
        desc: '탑 PCB와 바텀 PCB가 연결된 채로 안착되는 스틸 박싱 케이스입니다. 내부에 고정용 스탠드오프(보스)가 형성되어 있습니다.'
      },
      housingScrews: {
        pill: '부품 상세 · 체결 스크류',
        title: this.componentLabels.screws,
        desc: '스틸 하우징 커버 및 내부 탑/바텀 PCB를 고정하는 스크류입니다. 리워크 1단계에서 스크류를 먼저 해체하여 언박싱합니다.'
      },
      topPcb: {
        pill: '부품 상세 · 탑 PCB (리워크 대상)',
        title: `${this.componentLabels.topPcb} (${this.componentLabels.cpu} + ${this.componentLabels.emmc} 탑재)`,
        desc: `상단에 위치하는 메인 PCB로 ${this.componentLabels.cpu}와 ${this.componentLabels.emmc}가 실장되어 있습니다. SW 이상 시 분리하여 개발용 바텀 PCB에 장착 후 업데이트합니다.`
      },
      cpu: {
        pill: '칩셋 상세 · 탑 PCB',
        title: `${this.componentLabels.cpu} (탑 PCB 메인 프로세서)`,
        desc: '탑 PCB 상단에 탑재된 중앙 연산 장치로, eMMC의 펌웨어를 로드하여 구동하며 하단 커넥터를 통해 바텀 PCB와 통신합니다.'
      },
      emmc: {
        pill: '칩셋 상세 · 탑 PCB (업데이트 타겟)',
        title: `${this.componentLabels.emmc} (소프트웨어/펌웨어 저장 메모리)`,
        desc: '탑 PCB에 탑재된 비휘발성 메모리입니다. 소프트웨어 이상 발생 시 개발용 바텀 PCB의 JTAG 경로를 통해 리워크(재플래싱)를 수행합니다.'
      },
      connector: {
        pill: '부품 상세 · 보드 간 결합 커넥터',
        title: this.componentLabels.connector,
        desc: '탑 PCB 하단과 바텀 PCB 상단을 수직으로 이어주는 커넥터입니다. 이 커넥터를 통해 양산용 바텀 PCB를 빼고 개발용 바텀 PCB를 연결할 수 있습니다.'
      },
      prodBottomPcb: {
        pill: '부품 상세 · 양산용 바텀 PCB',
        title: `${this.componentLabels.prodBottomPcb} (${this.componentLabels.mcu} 탑재 / ❌ JTAG 선 없음)`,
        desc: '생산(양산) 중인 제품에 들어가는 바텀 PCB입니다. MCU는 있으나 JTAG 인출선이 없어 단독으로는 탑 PCB 업데이트가 불가능합니다.'
      },
      devBottomPcb: {
        pill: '부품 상세 · 개발용 바텀 PCB (리워크용)',
        title: `${this.componentLabels.devBottomPcb} (${this.componentLabels.mcu} + ${this.componentLabels.jtag})`,
        desc: '리워크(재작업)를 위해 준비된 개발용 바텀 PCB입니다. JTAG 선과 디버거 인터페이스가 연결되어 있어 결합된 탑 PCB를 업데이트할 수 있습니다.'
      }
    };

    const info = partInfoMap[partId];
    if (info) {
      this.statusStepPill.textContent = info.pill;
      this.statusTitle.textContent = info.title;
      this.statusDesc.textContent = info.desc;
    }
  }

  // Render dynamic 2D Cross-Section Schematic in the bottom-left overlay card
  updateMiniSchematic(preset, customPct = null) {
    const L = this.componentLabels;
    const isRework = preset === 'dev_rework';
    const isSplit = preset === 'pcb_split' || preset === 'unbox' || (customPct && customPct > 30);

    if (isRework) {
      this.miniSchematicContent.innerHTML = `
        <div style="display:flex; flex-direction:column; gap:6px; font-size:11.5px;">
          <div style="padding:7px 10px; border-radius:7px; background:rgba(16,185,129,0.16); border:1px solid rgba(16,185,129,0.55); display:flex; justify-content:space-between; align-items:center;">
            <span><strong>${L.topPcb}</strong></span>
            <span style="color:#6ee7b7; font-weight:700;">[${L.cpu}] + [${L.emmc} ⚡업데이트]</span>
          </div>
          <div style="text-align:center; color:#fbbf24; font-weight:700; font-size:11px;">
            ⇅ ${L.connector} 결합 완료 (신호 연결)
          </div>
          <div style="padding:7px 10px; border-radius:7px; background:rgba(168,85,247,0.22); border:1.5px solid #c084fc; display:flex; justify-content:space-between; align-items:center;">
            <span><strong>🔧 ${L.devBottomPcb}</strong></span>
            <span style="color:#e9d5ff; font-weight:700;">[${L.mcu}] + [⚡ ${L.jtag}]</span>
          </div>
          <div style="margin-top:2px; padding:5px 8px; border-radius:6px; background:rgba(14,165,233,0.1); border:1px dashed #475569; color:#94a3b8; font-size:10.5px; display:flex; justify-content:space-between;">
            <span>분리 대기: ${L.prodBottomPcb}</span>
            <span>(JTAG 선 없음)</span>
          </div>
        </div>
      `;
    } else {
      this.miniSchematicContent.innerHTML = `
        <div style="border:1.5px dashed #64748b; border-radius:8px; padding:8px; background:rgba(148,163,184,0.05); display:flex; flex-direction:column; gap:5px; font-size:11.5px;">
          <div style="display:flex; justify-content:space-between; color:#94a3b8; font-size:10.5px; font-weight:700;">
            <span>🔩 ${L.housing} (상/하 박싱)</span>
            <span>${isSplit ? '🔓 스크류 해체 / 분해됨' : '🔒 스크류 체결 완료'}</span>
          </div>
          <div style="padding:6px 9px; border-radius:6px; background:rgba(16,185,129,0.15); border:1px solid rgba(16,185,129,0.5); display:flex; justify-content:space-between;">
            <span><strong>${L.topPcb}</strong></span>
            <span style="color:#6ee7b7; font-weight:700;">[${L.cpu}] · [${L.emmc}]</span>
          </div>
          <div style="text-align:center; color:#fbbf24; font-weight:700; font-size:10.5px;">
            ${isSplit ? '↕ (분리됨) ' : '⇅ (연결됨) '}${L.connector}
          </div>
          <div style="padding:6px 9px; border-radius:6px; background:rgba(14,165,233,0.15); border:1px solid rgba(14,165,233,0.5); display:flex; justify-content:space-between;">
            <span><strong>${L.prodBottomPcb}</strong></span>
            <span style="color:#fca5a5; font-weight:700;">[${L.mcu}] · [❌ JTAG 없음]</span>
          </div>
        </div>
      `;
    }
  }

  renderFlowchart() {
    this.flowchartList.innerHTML = '';

    this.steps.forEach((step, idx) => {
      const wrapper = document.createElement('div');
      wrapper.className = 'flow-node-wrapper';

      // Connector line from previous step
      if (idx > 0) {
        const prevStep = this.steps[idx - 1];
        if (prevStep.decisionText) {
          const decBox = document.createElement('div');
          decBox.className = 'flow-decision-box';
          decBox.innerHTML = `
            <span>💠 ${prevStep.decisionText}</span>
          `;
          wrapper.appendChild(decBox);
        }

        const conn = document.createElement('div');
        conn.className = 'flow-connector';
        conn.innerHTML = `
          <div class="flow-connector-line ${idx <= this.activeStepIndex ? 'active' : ''}"></div>
          <span class="flow-connector-arrow">▼</span>
        `;
        wrapper.appendChild(conn);
      }

      const node = document.createElement('div');
      const isActive = idx === this.activeStepIndex;
      const isCompleted = idx < this.activeStepIndex;
      node.className = `flow-node ${isActive ? 'active' : ''} ${isCompleted ? 'completed' : ''}`;

      const tagsHtml = (step.tags || [])
        .map((t) => `<span class="part-tag">${t}</span>`)
        .join('');

      const isEditing = this.editingStepId === step.id;

      node.innerHTML = `
        <div class="flow-node-header">
          <div class="flow-step-title-group">
            <span class="flow-step-number">${idx + 1}</span>
            <span class="flow-type-badge ${step.badgeClass || 'badge-inspect'}">${step.badgeText || `STEP ${idx + 1}`}</span>
          </div>
          <div class="flow-node-actions">
            <button class="icon-btn" data-action="up" title="위로 이동" ${idx === 0 ? 'disabled' : ''}>▲</button>
            <button class="icon-btn" data-action="down" title="아래로 이동" ${idx === this.steps.length - 1 ? 'disabled' : ''}>▼</button>
            <button class="icon-btn" data-action="edit" title="단계 내용 커스터마이징">✏️</button>
            <button class="icon-btn danger" data-action="delete" title="단계 삭제">✕</button>
          </div>
        </div>
        <div class="flow-node-title" style="margin-bottom:6px;">${step.title}</div>
        <div class="flow-node-desc">${step.desc}</div>
        ${step.note ? `<div class="flow-node-note">${step.note}</div>` : ''}
        <div class="flow-node-tags">${tagsHtml}</div>
      `;

      // Click card to activate step in 3D simulator
      node.addEventListener('click', (e) => {
        if (e.target.closest('.flow-node-actions') || e.target.closest('.node-editor-form')) {
          return;
        }
        this.stopAutoPlay();
        this.selectStep(idx);
      });

      // Action buttons (Move Up, Move Down, Edit, Delete)
      node.querySelectorAll('[data-action]').forEach((btn) => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          const action = btn.dataset.action;
          if (action === 'up' && idx > 0) {
            const tmp = this.steps[idx - 1];
            this.steps[idx - 1] = this.steps[idx];
            this.steps[idx] = tmp;
            this.activeStepIndex = idx - 1;
            this.saveState();
            this.renderAll();
          } else if (action === 'down' && idx < this.steps.length - 1) {
            const tmp = this.steps[idx + 1];
            this.steps[idx + 1] = this.steps[idx];
            this.steps[idx] = tmp;
            this.activeStepIndex = idx + 1;
            this.saveState();
            this.renderAll();
          } else if (action === 'edit') {
            this.editingStepId = isEditing ? null : step.id;
            this.renderFlowchart();
          } else if (action === 'delete') {
            if (this.steps.length <= 1) return;
            this.steps.splice(idx, 1);
            if (this.activeStepIndex >= this.steps.length) {
              this.activeStepIndex = this.steps.length - 1;
            }
            this.saveState();
            this.renderAll();
            this.selectStep(this.activeStepIndex);
          }
        });
      });

      // Inline customization form when editing
      if (isEditing) {
        const editor = document.createElement('div');
        editor.className = 'node-editor-form';
        editor.innerHTML = `
          <div class="form-row">
            <label>단계 제목</label>
            <input type="text" class="form-input" data-field="title" value="${step.title.replace(/"/g, '&quot;')}" />
          </div>
          <div class="form-row-inline">
            <div class="form-row">
              <label>배지 라벨</label>
              <input type="text" class="form-input" data-field="badgeText" value="${(step.badgeText || '').replace(/"/g, '&quot;')}" />
            </div>
            <div class="form-row">
              <label>연동할 3D 시뮬레이션 동작</label>
              <select class="form-select" data-field="preset3d">
                <option value="sw_error" ${step.preset3d === 'sw_error' ? 'selected' : ''}>조립 상태 (스틸 하우징 내 결합 + SW 이상)</option>
                <option value="unbox" ${step.preset3d === 'unbox' ? 'selected' : ''}>1단계: 스크류 해체 및 스틸 하우징 언박싱</option>
                <option value="pcb_split" ${step.preset3d === 'pcb_split' ? 'selected' : ''}>2단계: 탑 PCB & 양산 바텀 PCB 커넥터 분리</option>
                <option value="dev_rework" ${step.preset3d === 'dev_rework' ? 'selected' : ''}>3단계: 개발용 바텀 PCB(JTAG) 결합 & 업데이트</option>
                <option value="reassembled" ${step.preset3d === 'reassembled' ? 'selected' : ''}>완료: 양산용 바텀 PCB 재결합 & 스크류 체결</option>
              </select>
            </div>
          </div>
          <div class="form-row">
            <label>상세 작업 설명</label>
            <textarea class="form-textarea" data-field="desc">${step.desc}</textarea>
          </div>
          <div class="form-row">
            <label>핵심 강조 노트 (선택)</label>
            <input type="text" class="form-input" data-field="note" value="${(step.note || '').replace(/"/g, '&quot;')}" />
          </div>
          <div class="form-row">
            <label>다음 단계 전 조건/분기 문구 (비워두면 일반 화살표)</label>
            <input type="text" class="form-input" data-field="decisionText" placeholder="예: 양산용 바텀 PCB에 JTAG 선 유무? -> 없음" value="${(step.decisionText || '').replace(/"/g, '&quot;')}" />
          </div>
          <div class="form-row">
            <label>관련 부품 태그 (쉼표로 구분)</label>
            <input type="text" class="form-input" data-field="tags" value="${(step.tags || []).join(', ').replace(/"/g, '&quot;')}" />
          </div>
          <div style="display:flex; justify-content:flex-end; gap:6px; margin-top:4px;">
            <button class="btn btn-sm" data-editor-cancel>닫기</button>
            <button class="btn btn-sm btn-primary" data-editor-save>적용 및 저장</button>
          </div>
        `;

        editor.querySelector('[data-editor-cancel]').addEventListener('click', (e) => {
          e.stopPropagation();
          this.editingStepId = null;
          this.renderFlowchart();
        });

        editor.querySelector('[data-editor-save]').addEventListener('click', (e) => {
          e.stopPropagation();
          step.title = editor.querySelector('[data-field="title"]').value.trim() || step.title;
          step.badgeText = editor.querySelector('[data-field="badgeText"]').value.trim();
          step.preset3d = editor.querySelector('[data-field="preset3d"]').value;
          step.desc = editor.querySelector('[data-field="desc"]').value.trim();
          step.note = editor.querySelector('[data-field="note"]').value.trim();
          step.decisionText = editor.querySelector('[data-field="decisionText"]').value.trim();
          const rawTags = editor.querySelector('[data-field="tags"]').value;
          step.tags = rawTags
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean);

          this.editingStepId = null;
          this.saveState();
          this.renderAll();
          this.selectStep(idx);
        });

        node.appendChild(editor);
      }

      wrapper.appendChild(node);
      this.flowchartList.appendChild(wrapper);
    });
  }

  addNewStep() {
    const newId = `step-${Date.now()}`;
    const newStep = {
      id: newId,
      title: '새 리워크 작업 단계',
      badgeText: `STEP ${this.steps.length + 1} · 커스텀 단계`,
      badgeClass: 'badge-rework',
      preset3d: 'dev_rework',
      desc: '여기에 작업 순서 설명을 입력하세요.',
      note: '세부 체크 포인트나 JTAG/커넥터 작업 유의사항을 기록할 수 있습니다.',
      decisionText: '',
      tags: ['탑 PCB', '개발용 바텀 PCB', 'JTAG']
    };
    this.steps.push(newStep);
    this.editingStepId = newId;
    this.saveState();
    this.renderAll();
    this.selectStep(this.steps.length - 1);
  }

  renderFullscreenDiagram() {
    const L = this.componentLabels;

    // 1. Architecture Comparison (Production Assembly vs JTAG Rework Configuration)
    this.archCompareContainer.innerHTML = `
      <div class="arch-box">
        <div style="display:flex; justify-content:space-between; align-items:center;">
          <span class="flow-type-badge badge-error">양산 조립 상태 (SW 이상 발생 시)</span>
          <span style="font-size:12px; color:#f87171; font-weight:700;">❌ JTAG 선 없음 ➔ 직접 업데이트 불가</span>
        </div>
        <div class="arch-stack-diagram">
          <div class="arch-housing-label">
            <span>🔩 상/하부 ${L.housing} (스크류 체결됨)</span>
            <span>밀폐 박싱 구조</span>
          </div>
          <div class="arch-pcb-layer arch-pcb-top">
            <div>
              <div style="font-size:13.5px; font-weight:700; color:#6ee7b7;">${L.topPcb}</div>
              <div style="font-size:11.5px; color:#cbd5e1;">메인 연산 및 타겟 펌웨어 보드</div>
            </div>
            <div class="chip-box-group">
              <span class="chip-pill">🔲 ${L.cpu}</span>
              <span class="chip-pill error">⚠️ ${L.emmc} (SW 이상)</span>
            </div>
          </div>
          <div class="arch-b2b-bridge">
            <span>⇅ ${L.connector}로 상호 결합됨</span>
          </div>
          <div class="arch-pcb-layer arch-pcb-bottom-prod">
            <div>
              <div style="font-size:13.5px; font-weight:700; color:#7dd3fc;">${L.prodBottomPcb} (생산 중 보드)</div>
              <div style="font-size:11.5px; color:#cbd5e1;">양산 원가/보안상 JTAG 인출선 미실장</div>
            </div>
            <div class="chip-box-group">
              <span class="chip-pill">🔲 ${L.mcu}</span>
              <span class="chip-pill error">🚫 JTAG 선 없음</span>
            </div>
          </div>
        </div>
      </div>

      <div class="arch-box rework-arch">
        <div style="display:flex; justify-content:space-between; align-items:center;">
          <span class="flow-type-badge badge-rework">리워크(재작업) 결합 상태 (분해 후 교체 연결)</span>
          <span style="font-size:12px; color:#67e8f9; font-weight:700;">⚡ 개발용 바텀 PCB(JTAG) 경유 업데이트</span>
        </div>
        <div class="arch-stack-diagram" style="border-color:#a855f7;">
          <div class="arch-housing-label" style="color:#d8b4fe;">
            <span>🔓 1. 스크류 해체 & 스틸 하우징 언박싱 완료</span>
            <span>2. 탑 PCB 분리 후 교체 장착</span>
          </div>
          <div class="arch-pcb-layer arch-pcb-top">
            <div>
              <div style="font-size:13.5px; font-weight:700; color:#6ee7b7;">분리한 ${L.topPcb}</div>
              <div style="font-size:11.5px; color:#cbd5e1;">기존 제품에서 뽑아낸 타겟 보드</div>
            </div>
            <div class="chip-box-group">
              <span class="chip-pill">🔲 ${L.cpu}</span>
              <span class="chip-pill jtag-ok">⚡ ${L.emmc} (업데이트 진행)</span>
            </div>
          </div>
          <div class="arch-b2b-bridge" style="color:#67e8f9;">
            <span>⬆️ ${L.connector} 경유 업데이트 신호 전달 ⬆️</span>
          </div>
          <div class="arch-pcb-layer arch-pcb-bottom-dev">
            <div>
              <div style="font-size:13.5px; font-weight:700; color:#e9d5ff;">🔧 ${L.devBottomPcb} (리워크용 보드)</div>
              <div style="font-size:11.5px; color:#cbd5e1;">JTAG 선이 살아있는 개발용 바텀 보드</div>
            </div>
            <div class="chip-box-group">
              <span class="chip-pill">🔲 ${L.mcu}</span>
              <span class="chip-pill jtag-ok">🔌 ${L.jtag} 연결됨</span>
            </div>
          </div>
        </div>
      </div>
    `;

    // 2. Full Customized Flowchart Cards
    this.visualFlowchartBoard.innerHTML = '';
    this.steps.forEach((step, idx) => {
      if (idx > 0) {
        const arrow = document.createElement('div');
        arrow.className = 'visual-flow-arrow';
        arrow.innerHTML = '➔';
        this.visualFlowchartBoard.appendChild(arrow);
      }

      const card = document.createElement('div');
      card.className = 'visual-flow-card';
      const tagsHtml = (step.tags || [])
        .map((t) => `<span class="part-tag">${t}</span>`)
        .join('');

      card.innerHTML = `
        <div>
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px;">
            <span class="flow-step-number" style="background:var(--accent-blue);">${idx + 1}</span>
            <span class="flow-type-badge ${step.badgeClass || 'badge-inspect'}">${step.badgeText || `STEP ${idx + 1}`}</span>
          </div>
          <h4 style="font-size:15px; font-weight:700; margin-bottom:8px; color:var(--text-primary);">${step.title}</h4>
          <p style="font-size:12.5px; color:var(--text-secondary); line-height:1.55; margin-bottom:10px;">${step.desc}</p>
          ${step.note ? `<div class="flow-node-note">${step.note}</div>` : ''}
          ${step.decisionText ? `<div class="flow-decision-box" style="margin:8px 0;">💠 ${step.decisionText}</div>` : ''}
        </div>
        <div class="flow-node-tags" style="margin-top:8px;">${tagsHtml}</div>
      `;

      card.addEventListener('click', () => {
        // Jump to 3D simulator at this step
        document.querySelector('[data-mode="sim"]').click();
        this.selectStep(idx);
      });

      this.visualFlowchartBoard.appendChild(card);
    });
  }

  openSpecModal() {
    const L = this.componentLabels;
    document.getElementById('spec-input-housing').value = L.housing;
    document.getElementById('spec-input-screws').value = L.screws;
    document.getElementById('spec-input-topPcb').value = L.topPcb;
    document.getElementById('spec-input-cpu').value = L.cpu;
    document.getElementById('spec-input-emmc').value = L.emmc;
    document.getElementById('spec-input-connector').value = L.connector;
    document.getElementById('spec-input-prodBottomPcb').value = L.prodBottomPcb;
    document.getElementById('spec-input-devBottomPcb').value = L.devBottomPcb;
    document.getElementById('spec-input-mcu').value = L.mcu;
    document.getElementById('spec-input-jtag').value = L.jtag;
    this.specModal.classList.add('open');
  }

  saveSpecModal() {
    this.componentLabels = {
      housing: document.getElementById('spec-input-housing').value.trim() || DEFAULT_COMPONENT_LABELS.housing,
      screws: document.getElementById('spec-input-screws').value.trim() || DEFAULT_COMPONENT_LABELS.screws,
      topPcb: document.getElementById('spec-input-topPcb').value.trim() || DEFAULT_COMPONENT_LABELS.topPcb,
      cpu: document.getElementById('spec-input-cpu').value.trim() || DEFAULT_COMPONENT_LABELS.cpu,
      emmc: document.getElementById('spec-input-emmc').value.trim() || DEFAULT_COMPONENT_LABELS.emmc,
      connector: document.getElementById('spec-input-connector').value.trim() || DEFAULT_COMPONENT_LABELS.connector,
      prodBottomPcb:
        document.getElementById('spec-input-prodBottomPcb').value.trim() || DEFAULT_COMPONENT_LABELS.prodBottomPcb,
      devBottomPcb:
        document.getElementById('spec-input-devBottomPcb').value.trim() || DEFAULT_COMPONENT_LABELS.devBottomPcb,
      mcu: document.getElementById('spec-input-mcu').value.trim() || DEFAULT_COMPONENT_LABELS.mcu,
      jtag: document.getElementById('spec-input-jtag').value.trim() || DEFAULT_COMPONENT_LABELS.jtag
    };

    this.sim3d.updateComponentLabels(this.componentLabels);
    this.saveState();
    this.specModal.classList.remove('open');
    this.renderAll();
    this.selectStep(this.activeStepIndex);
  }

  renderAll() {
    this.renderFlowchart();
    if (this.activeTopTab === 'diagram') {
      this.renderFullscreenDiagram();
    }
  }
}

window.addEventListener('DOMContentLoaded', () => {
  window.app = new AppController();
});

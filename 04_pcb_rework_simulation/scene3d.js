import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

export class DisassemblySimulation3D {
  constructor(containerEl, labelsContainerEl, onPartClick) {
    this.container = containerEl;
    this.labelsContainer = labelsContainerEl;
    this.onPartClick = onPartClick;

    this.scene = new THREE.Scene();
    this.clock = new THREE.Clock();

    // State parameters
    this.explodeFactor = 0.0; // 0 = assembled, 1 = fully exploded
    this.targetExplodeFactor = 0.0;
    this.housingMode = 'xray'; // 'xray' | 'solid' | 'wireframe' | 'hidden'
    this.visualPreset = 'assembled'; // 'assembled' | 'unbox' | 'pcb_split' | 'dev_rework' | 'reassembled' | 'exploded_custom'
    this.swState = 'normal'; // 'normal' | 'error' | 'updating' | 'updated'
    this.showLabels = true;
    this.showGuideLines = true;

    // Animated transform targets for groups
    this.parts = {};
    this.partTargets = {};
    this.screwMeshes = [];
    this.signalParticles = [];
    this.labelItems = [];

    // Custom component names (syncs with UI customizer)
    this.componentLabels = {
      housing: '스틸 박싱 하우징 (Steel Housing)',
      screws: '체결 스크류 (Fastening Screws)',
      topPcb: '탑 PCB (Top PCB)',
      cpu: 'CPU (메인 연산 프로세서)',
      emmc: 'eMMC (타겟 SW/펌웨어 메모리)',
      connector: '보드 간 결합 커넥터 (B2B Connector)',
      prodBottomPcb: '양산용 바텀 PCB (JTAG 선 없음)',
      devBottomPcb: '개발용 바텀 PCB (JTAG 탑재)',
      mcu: 'MCU (서브 컨트롤러)',
      jtag: 'JTAG 인터페이스 & 디버거 선'
    };

    this.initRenderer();
    this.initLights();
    this.buildEnvironment();
    this.buildProductModel();
    this.initLabels();
    this.initInteraction();

    this.applyPreset('assembled', true);
    this.animate();
  }

  initRenderer() {
    const width = this.container.clientWidth || 800;
    const height = this.container.clientHeight || 600;

    this.camera = new THREE.PerspectiveCamera(40, width / height, 0.1, 200);
    this.camera.position.set(13, 11, 15);

    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setSize(width, height);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.15;

    this.container.appendChild(this.renderer.domElement);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.07;
    this.controls.maxPolarAngle = Math.PI * 0.85;
    this.controls.minDistance = 5;
    this.controls.maxDistance = 40;
    this.controls.target.set(0, 1.2, 0);

    this.cameraTargetGoal = new THREE.Vector3(0, 1.2, 0);
    this.cameraPosGoal = null;

    window.addEventListener('resize', () => this.onResize());
  }

  initLights() {
    const ambient = new THREE.AmbientLight(0xdbeafe, 0.85);
    this.scene.add(ambient);

    const hemi = new THREE.HemisphereLight(0x93c5fd, 0x1e293b, 0.7);
    hemi.position.set(0, 20, 0);
    this.scene.add(hemi);

    const dirLight1 = new THREE.DirectionalLight(0xffffff, 1.6);
    dirLight1.position.set(12, 22, 14);
    dirLight1.castShadow = true;
    dirLight1.shadow.mapSize.width = 2048;
    dirLight1.shadow.mapSize.height = 2048;
    dirLight1.shadow.camera.near = 2;
    dirLight1.shadow.camera.far = 50;
    const d = 12;
    dirLight1.shadow.camera.left = -d;
    dirLight1.shadow.camera.right = d;
    dirLight1.shadow.camera.top = d;
    dirLight1.shadow.camera.bottom = -d;
    this.scene.add(dirLight1);

    const dirLight2 = new THREE.DirectionalLight(0x38bdf8, 0.75);
    dirLight2.position.set(-14, 10, -10);
    this.scene.add(dirLight2);

    const rimLight = new THREE.DirectionalLight(0xc084fc, 0.5);
    rimLight.position.set(0, -10, -12);
    this.scene.add(rimLight);
  }

  buildEnvironment() {
    // Subtle industrial grid floor
    const grid = new THREE.GridHelper(32, 32, 0x334155, 0x1e293b);
    grid.position.y = -2.2;
    this.scene.add(grid);

    // Workmat platform under the assembly
    const matGeo = new THREE.BoxGeometry(14, 0.12, 10);
    const matMat = new THREE.MeshStandardMaterial({
      color: 0x0f172a,
      roughness: 0.85,
      metalness: 0.1
    });
    const workmat = new THREE.Mesh(matGeo, matMat);
    workmat.position.y = -2.14;
    workmat.receiveShadow = true;
    this.scene.add(workmat);

    const matEdges = new THREE.LineSegments(
      new THREE.EdgesGeometry(matGeo),
      new THREE.LineBasicMaterial({ color: 0x334155 })
    );
    workmat.add(matEdges);
  }

  // Helper to add crisp CAD edge outlines to any mesh
  addCadEdges(mesh, color = 0x64748b, opacity = 0.55) {
    const edgesGeo = new THREE.EdgesGeometry(mesh.geometry, 15);
    const edgesMat = new THREE.LineBasicMaterial({
      color,
      transparent: opacity < 1,
      opacity
    });
    const line = new THREE.LineSegments(edgesGeo, edgesMat);
    mesh.add(line);
    return line;
  }

  // Helper to create a 3D Phillips screw with head, washer, and threaded shaft
  createScrewMesh(color = 0xe2e8f0, headRadius = 0.22, shaftLength = 0.55) {
    const group = new THREE.Group();

    const metalMat = new THREE.MeshStandardMaterial({
      color,
      metalness: 0.85,
      roughness: 0.25
    });

    // Screw head
    const headGeo = new THREE.CylinderGeometry(headRadius, headRadius * 0.9, 0.14, 20);
    const head = new THREE.Mesh(headGeo, metalMat);
    head.position.y = 0.07;
    group.add(head);

    // Washer flange
    const washerGeo = new THREE.CylinderGeometry(headRadius * 1.22, headRadius * 1.22, 0.04, 20);
    const washer = new THREE.Mesh(washerGeo, metalMat);
    washer.position.y = 0.02;
    group.add(washer);

    // Cross slot on top of screw head
    const slotMat = new THREE.MeshBasicMaterial({ color: 0x1e293b });
    const slot1 = new THREE.Mesh(new THREE.BoxGeometry(headRadius * 1.3, 0.03, 0.045), slotMat);
    slot1.position.y = 0.141;
    const slot2 = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.03, headRadius * 1.3), slotMat);
    slot2.position.y = 0.141;
    group.add(slot1, slot2);

    // Threaded shaft
    const shaftGeo = new THREE.CylinderGeometry(headRadius * 0.48, headRadius * 0.42, shaftLength, 16);
    const shaft = new THREE.Mesh(shaftGeo, metalMat);
    shaft.position.y = -shaftLength / 2;
    group.add(shaft);

    return group;
  }

  // Helper to create BGA / IC Chip with pins & label pad
  createChipMesh({ width, depth, height = 0.18, color = 0x1e293b, capColor = null, pinCount = 0 }) {
    const group = new THREE.Group();

    // Substrate
    const subGeo = new THREE.BoxGeometry(width, height * 0.45, depth);
    const subMat = new THREE.MeshStandardMaterial({
      color: 0x064e3b,
      roughness: 0.5,
      metalness: 0.2
    });
    const sub = new THREE.Mesh(subGeo, subMat);
    sub.position.y = height * 0.225;
    group.add(sub);

    // Package mold
    const bodyGeo = new THREE.BoxGeometry(width * 0.92, height * 0.65, depth * 0.92);
    const bodyMat = new THREE.MeshStandardMaterial({
      color,
      roughness: 0.35,
      metalness: 0.25
    });
    const body = new THREE.Mesh(bodyGeo, bodyMat);
    body.position.y = height * 0.65;
    body.castShadow = true;
    group.add(body);
    this.addCadEdges(body, 0x475569, 0.5);

    // Optional metallic Integrated Heat Spreader (IHS) for CPU
    if (capColor) {
      const capGeo = new THREE.BoxGeometry(width * 0.78, height * 0.25, depth * 0.78);
      const capMat = new THREE.MeshStandardMaterial({
        color: capColor,
        metalness: 0.85,
        roughness: 0.2
      });
      const cap = new THREE.Mesh(capGeo, capMat);
      cap.position.y = height * 1.02;
      group.add(cap);
      this.addCadEdges(cap, 0x94a3b8, 0.7);
    }

    // QFP gull-wing leads if pinCount > 0
    if (pinCount > 0) {
      const leadMat = new THREE.MeshStandardMaterial({
        color: 0xe2e8f0,
        metalness: 0.9,
        roughness: 0.2
      });
      const perSide = Math.floor(pinCount / 4);
      for (let i = 0; i < perSide; i++) {
        const offset = ((i + 0.5) / perSide - 0.5) * (width * 0.8);
        const lead1 = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, 0.14), leadMat);
        lead1.position.set(offset, 0.04, depth / 2 + 0.03);
        const lead2 = lead1.clone();
        lead2.position.set(offset, 0.04, -depth / 2 - 0.03);
        group.add(lead1, lead2);
      }
    }

    return group;
  }

  // Helper to create Board-to-Board (B2B) high-density connector
  createB2BConnector(isPlug = true) {
    const group = new THREE.Group();
    const length = 2.2;
    const width = 0.58;
    const height = isPlug ? 0.34 : 0.38;

    const housingMat = new THREE.MeshStandardMaterial({
      color: 0x1e293b,
      roughness: 0.4,
      metalness: 0.2
    });
    const goldMat = new THREE.MeshStandardMaterial({
      color: 0xfbbf24,
      metalness: 0.92,
      roughness: 0.18
    });

    const outerGeo = new THREE.BoxGeometry(length, height, width);
    const outer = new THREE.Mesh(outerGeo, housingMat);
    outer.position.y = isPlug ? -height / 2 : height / 2;
    group.add(outer);
    this.addCadEdges(outer, 0xf59e0b, 0.65);

    // Center mating ridge / slot
    const innerGeo = new THREE.BoxGeometry(length * 0.86, height * 0.4, width * 0.46);
    const innerMat = new THREE.MeshStandardMaterial({
      color: isPlug ? 0xd97706 : 0x0f172a,
      roughness: 0.3
    });
    const inner = new THREE.Mesh(innerGeo, innerMat);
    inner.position.y = isPlug ? -height * 0.85 : height * 0.85;
    group.add(inner);

    // Gold contact pins along both sides
    const pinCount = 16;
    for (let i = 0; i < pinCount; i++) {
      const x = ((i + 0.5) / pinCount - 0.5) * (length * 0.84);
      const pinGeo = new THREE.BoxGeometry(0.055, height * 0.78, width + 0.12);
      const pin = new THREE.Mesh(pinGeo, goldMat);
      pin.position.set(x, isPlug ? -height * 0.5 : height * 0.5, 0);
      group.add(pin);
    }

    return group;
  }

  buildProductModel() {
    this.housingMaterials = [];
    this.housingEdgeLines = [];

    // =========================================================================
    // 1. BOTTOM STEEL HOUSING (하부 스틸 계열 박싱 하우징)
    // =========================================================================
    const bottomHousingGroup = new THREE.Group();
    bottomHousingGroup.name = 'bottomHousing';

    const steelMat = new THREE.MeshPhysicalMaterial({
      color: 0x94a3b8,
      metalness: 0.78,
      roughness: 0.28,
      transparent: true,
      opacity: 0.42,
      depthWrite: false
    });
    this.housingMaterials.push(steelMat);

    // Base plate (7.8 x 0.22 x 5.4)
    const basePlate = new THREE.Mesh(new THREE.BoxGeometry(7.8, 0.22, 5.4), steelMat);
    basePlate.position.y = -0.9;
    bottomHousingGroup.add(basePlate);
    this.housingEdgeLines.push(this.addCadEdges(basePlate, 0xcbd5e1, 0.85));

    // 4 Side walls of the steel box (back, left, right, and lower front lip for clear interior visibility)
    const wallHeight = 2.05;
    const wallY = -0.9 + wallHeight / 2;

    const backWall = new THREE.Mesh(new THREE.BoxGeometry(7.8, wallHeight, 0.18), steelMat);
    backWall.position.set(0, wallY, -2.61);
    bottomHousingGroup.add(backWall);
    this.housingEdgeLines.push(this.addCadEdges(backWall, 0xcbd5e1, 0.85));

    const frontWall = new THREE.Mesh(new THREE.BoxGeometry(7.8, wallHeight, 0.18), steelMat);
    frontWall.position.set(0, wallY, 2.61);
    bottomHousingGroup.add(frontWall);
    this.housingEdgeLines.push(this.addCadEdges(frontWall, 0xcbd5e1, 0.85));

    const leftWall = new THREE.Mesh(new THREE.BoxGeometry(0.18, wallHeight, 5.04), steelMat);
    leftWall.position.set(-3.81, wallY, 0);
    bottomHousingGroup.add(leftWall);
    this.housingEdgeLines.push(this.addCadEdges(leftWall, 0xcbd5e1, 0.85));

    const rightWall = new THREE.Mesh(new THREE.BoxGeometry(0.18, wallHeight, 5.04), steelMat);
    rightWall.position.set(3.81, wallY, 0);
    bottomHousingGroup.add(rightWall);
    this.housingEdgeLines.push(this.addCadEdges(rightWall, 0xcbd5e1, 0.85));

    // Corner mounting pillars (for Top Housing Cover screws) + inner brass standoffs for PCBs
    const standoffMat = new THREE.MeshStandardMaterial({
      color: 0xd97706,
      metalness: 0.85,
      roughness: 0.25
    });
    const steelBossMat = new THREE.MeshStandardMaterial({
      color: 0x64748b,
      metalness: 0.8,
      roughness: 0.3
    });

    this.housingCornerCoords = [
      [-3.45, -2.3],
      [3.45, -2.3],
      [-3.45, 2.3],
      [3.45, 2.3]
    ];

    this.housingCornerCoords.forEach(([x, z]) => {
      const pillar = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.24, wallHeight, 16), steelBossMat);
      pillar.position.set(x, wallY, z);
      bottomHousingGroup.add(pillar);
    });

    // Bottom PCB Standoffs (short brass standoffs on the base plate)
    this.bottomPcbScrewCoords = [
      [-2.85, -1.75],
      [2.85, -1.75],
      [-2.85, 1.75],
      [2.85, 1.75]
    ];
    this.bottomPcbScrewCoords.forEach(([x, z]) => {
      const standoff = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.22, 0.45, 6), standoffMat);
      standoff.position.set(x, -0.58, z);
      bottomHousingGroup.add(standoff);
    });

    // Tall standoffs supporting Top PCB
    this.topPcbScrewCoords = [
      [-2.85, -1.1],
      [2.85, -1.1],
      [-2.85, 1.1],
      [2.85, 1.1]
    ];
    this.topPcbScrewCoords.forEach(([x, z]) => {
      const tallStandoff = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, 1.22, 6), standoffMat);
      tallStandoff.position.set(x, -0.18, z);
      bottomHousingGroup.add(tallStandoff);
    });

    this.scene.add(bottomHousingGroup);
    this.parts.bottomHousing = bottomHousingGroup;

    // =========================================================================
    // 2. TOP STEEL HOUSING COVER (상부 스틸 하우징 커버)
    // =========================================================================
    const topHousingGroup = new THREE.Group();
    topHousingGroup.name = 'topHousing';

    const topCoverMat = steelMat.clone();
    this.housingMaterials.push(topCoverMat);

    // Top plate (7.84 x 0.2 x 5.44)
    const topPlate = new THREE.Mesh(new THREE.BoxGeometry(7.84, 0.2, 5.44), topCoverMat);
    topPlate.position.y = 1.25;
    topHousingGroup.add(topPlate);
    this.housingEdgeLines.push(this.addCadEdges(topPlate, 0xe2e8f0, 0.9));

    // Side folded flanges on the top cover
    const flangeFront = new THREE.Mesh(new THREE.BoxGeometry(7.84, 0.36, 0.14), topCoverMat);
    flangeFront.position.set(0, 1.07, 2.66);
    const flangeBack = flangeFront.clone();
    flangeBack.position.set(0, 1.07, -2.66);
    topHousingGroup.add(flangeFront, flangeBack);
    this.housingEdgeLines.push(this.addCadEdges(flangeFront, 0xe2e8f0, 0.8));
    this.housingEdgeLines.push(this.addCadEdges(flangeBack, 0xe2e8f0, 0.8));

    // Ventilation slot accents on top cover
    const slotMat = new THREE.MeshBasicMaterial({
      color: 0x334155,
      transparent: true,
      opacity: 0.65
    });
    for (let i = -3; i <= 3; i++) {
      const vent = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.22, 2.2), slotMat);
      vent.position.set(i * 0.55 - 1.0, 1.25, 0);
      topHousingGroup.add(vent);
    }

    this.scene.add(topHousingGroup);
    this.parts.topHousing = topHousingGroup;

    // =========================================================================
    // 3. HOUSING & PCB FASTENING SCREWS (체결 스크류 그룹)
    // =========================================================================
    const housingScrewsGroup = new THREE.Group();
    housingScrewsGroup.name = 'housingScrews';
    this.housingCornerCoords.forEach(([x, z]) => {
      const screw = this.createScrewMesh(0xf8fafc, 0.22, 0.6);
      screw.position.set(x, 1.36, z);
      housingScrewsGroup.add(screw);
      this.screwMeshes.push(screw);
    });
    this.scene.add(housingScrewsGroup);
    this.parts.housingScrews = housingScrewsGroup;

    const topPcbScrewsGroup = new THREE.Group();
    topPcbScrewsGroup.name = 'topPcbScrews';
    this.topPcbScrewCoords.forEach(([x, z]) => {
      const screw = this.createScrewMesh(0xfbbf24, 0.18, 0.45);
      screw.position.set(x, 0.58, z);
      topPcbScrewsGroup.add(screw);
      this.screwMeshes.push(screw);
    });
    this.scene.add(topPcbScrewsGroup);
    this.parts.topPcbScrews = topPcbScrewsGroup;

    const bottomPcbScrewsGroup = new THREE.Group();
    bottomPcbScrewsGroup.name = 'bottomPcbScrews';
    this.bottomPcbScrewCoords.forEach(([x, z]) => {
      const screw = this.createScrewMesh(0x38bdf8, 0.18, 0.42);
      screw.position.set(x, -0.22, z);
      bottomPcbScrewsGroup.add(screw);
      this.screwMeshes.push(screw);
    });
    this.scene.add(bottomPcbScrewsGroup);
    this.parts.bottomPcbScrews = bottomPcbScrewsGroup;

    // =========================================================================
    // 4. TOP PCB (탑 PCB: CPU + eMMC + 하단 결합 커넥터 탑재)
    // =========================================================================
    const topPcbGroup = new THREE.Group();
    topPcbGroup.name = 'topPcb';

    const topBoardGeo = new THREE.BoxGeometry(6.3, 0.16, 4.1);
    const topBoardMat = new THREE.MeshStandardMaterial({
      color: 0x059669, // Emerald green high-grade PCB
      roughness: 0.38,
      metalness: 0.18
    });
    const topBoard = new THREE.Mesh(topBoardGeo, topBoardMat);
    topBoard.position.y = 0.48;
    topBoard.castShadow = true;
    topBoard.receiveShadow = true;
    topPcbGroup.add(topBoard);
    this.addCadEdges(topBoard, 0x34d399, 0.85);

    // Gold mounting rings on Top PCB
    const goldRingMat = new THREE.MeshStandardMaterial({
      color: 0xfbbf24,
      metalness: 0.9,
      roughness: 0.2
    });
    [...this.topPcbScrewCoords, ...this.bottomPcbScrewCoords].forEach(([x, z]) => {
      const ring = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 0.17, 16), goldRingMat);
      ring.position.set(x, 0.48, z);
      topPcbGroup.add(ring);
    });

    // CPU on Top PCB (left-center)
    const cpuMesh = this.createChipMesh({
      width: 1.55,
      depth: 1.55,
      height: 0.24,
      color: 0x1e293b,
      capColor: 0xe2e8f0
    });
    cpuMesh.position.set(-1.35, 0.56, 0.1);
    cpuMesh.name = 'cpu';
    topPcbGroup.add(cpuMesh);
    this.parts.cpu = cpuMesh;

    // eMMC on Top PCB (center-right, target of SW rework)
    const emmcMesh = this.createChipMesh({
      width: 1.15,
      depth: 0.95,
      height: 0.2,
      color: 0x0f172a
    });
    emmcMesh.position.set(0.55, 0.56, 0.15);
    emmcMesh.name = 'emmc';

    // Glow indicator frame around eMMC to visualize SW Error / Updating / Normal
    const emmcHaloGeo = new THREE.BoxGeometry(1.28, 0.08, 1.08);
    this.emmcHaloMat = new THREE.MeshBasicMaterial({
      color: 0x10b981,
      transparent: true,
      opacity: 0.85
    });
    const emmcHalo = new THREE.Mesh(emmcHaloGeo, this.emmcHaloMat);
    emmcHalo.position.y = 0.05;
    emmcMesh.add(emmcHalo);

    topPcbGroup.add(emmcMesh);
    this.parts.emmc = emmcMesh;

    // Additional realistic SMD components on Top PCB (PMIC, inductors, capacitors)
    const smdMat = new THREE.MeshStandardMaterial({ color: 0x334155, roughness: 0.5 });
    for (let i = 0; i < 6; i++) {
      const cap = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.1, 0.1), goldRingMat);
      cap.position.set(-2.35, 0.6, -0.8 + i * 0.32);
      topPcbGroup.add(cap);
    }
    const pmic = this.createChipMesh({ width: 0.65, depth: 0.65, height: 0.14, color: 0x1e293b });
    pmic.position.set(-0.35, 0.56, -1.2);
    topPcbGroup.add(pmic);

    // Copper traces connecting B2B connector -> CPU & eMMC on Top PCB
    const traceMat = new THREE.MeshBasicMaterial({ color: 0x34d399 });
    const trace1 = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.015, 0.06), traceMat);
    trace1.position.set(1.2, 0.565, 0.15);
    const trace2 = new THREE.Mesh(new THREE.BoxGeometry(3.1, 0.015, 0.06), traceMat);
    trace2.position.set(0.3, 0.565, -0.35);
    topPcbGroup.add(trace1, trace2);

    // Top PCB Underside Board-to-Board (B2B) Plug Connector
    const topB2B = this.createB2BConnector(true);
    topB2B.position.set(1.85, 0.4, 0.0);
    topB2B.rotation.y = Math.PI / 2;
    topB2B.name = 'topConnector';
    topPcbGroup.add(topB2B);
    this.parts.topConnector = topB2B;

    // Top-side silkscreen outline showing where the underside B2B connector sits
    const b2bIndicatorGeo = new THREE.BoxGeometry(0.68, 0.02, 2.3);
    const b2bIndicatorMat = new THREE.MeshBasicMaterial({
      color: 0xfbbf24,
      transparent: true,
      opacity: 0.45
    });
    const b2bIndicator = new THREE.Mesh(b2bIndicatorGeo, b2bIndicatorMat);
    b2bIndicator.position.set(1.85, 0.565, 0.0);
    topPcbGroup.add(b2bIndicator);

    this.scene.add(topPcbGroup);
    this.parts.topPcb = topPcbGroup;

    // =========================================================================
    // 5. PRODUCTION BOTTOM PCB (양산용 바텀 PCB: MCU 탑재, JTAG 선 없음)
    // =========================================================================
    const prodBottomPcbGroup = new THREE.Group();
    prodBottomPcbGroup.name = 'prodBottomPcb';

    const prodBoardGeo = new THREE.BoxGeometry(6.5, 0.16, 4.3);
    const prodBoardMat = new THREE.MeshStandardMaterial({
      color: 0x0369a1, // Industrial blue-teal PCB for Production Bottom PCB
      roughness: 0.4,
      metalness: 0.18
    });
    const prodBoard = new THREE.Mesh(prodBoardGeo, prodBoardMat);
    prodBoard.position.y = -0.32;
    prodBoard.castShadow = true;
    prodBoard.receiveShadow = true;
    prodBottomPcbGroup.add(prodBoard);
    this.addCadEdges(prodBoard, 0x38bdf8, 0.85);

    // Mounting rings on Production Bottom PCB
    this.bottomPcbScrewCoords.forEach(([x, z]) => {
      const ring = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 0.17, 16), goldRingMat);
      ring.position.set(x, -0.32, z);
      prodBottomPcbGroup.add(ring);
    });

    // MCU on Production Bottom PCB
    const prodMcu = this.createChipMesh({
      width: 1.25,
      depth: 1.25,
      height: 0.2,
      color: 0x0f172a,
      pinCount: 32
    });
    prodMcu.position.set(-0.75, -0.24, 0.1);
    prodMcu.name = 'prodMcu';
    prodBottomPcbGroup.add(prodMcu);
    this.parts.prodMcu = prodMcu;

    // B2B Receptacle Connector on Production Bottom PCB (mates with Top PCB's B2B plug)
    const prodB2B = this.createB2BConnector(false);
    prodB2B.position.set(1.85, -0.24, 0.0);
    prodB2B.rotation.y = Math.PI / 2;
    prodBottomPcbGroup.add(prodB2B);
    this.parts.prodConnector = prodB2B;

    // Unpopulated JTAG Pad Area on Production Bottom PCB (shows why rework is needed!)
    const unpopJtagGroup = new THREE.Group();
    unpopJtagGroup.position.set(2.85, -0.23, 0.0);
    const padZoneGeo = new THREE.BoxGeometry(0.55, 0.02, 1.45);
    const padZoneMat = new THREE.MeshBasicMaterial({
      color: 0xef4444,
      transparent: true,
      opacity: 0.32
    });
    const padZone = new THREE.Mesh(padZoneGeo, padZoneMat);
    unpopJtagGroup.add(padZone);
    this.addCadEdges(padZone, 0xef4444, 0.9);

    // Empty solder pads (no header / no JTAG cable)
    for (let r = 0; r < 5; r++) {
      for (let c = 0; c < 2; c++) {
        const pad = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.03, 12), goldRingMat);
        pad.position.set((c - 0.5) * 0.2, 0.015, (r - 2) * 0.24);
        unpopJtagGroup.add(pad);
      }
    }
    prodBottomPcbGroup.add(unpopJtagGroup);
    this.parts.prodJtagMissing = unpopJtagGroup;

    this.scene.add(prodBottomPcbGroup);
    this.parts.prodBottomPcb = prodBottomPcbGroup;

    // =========================================================================
    // 6. DEVELOPMENT BOTTOM PCB (개발용 바텀 PCB: MCU + JTAG 커넥터 & 디버거 인출선 탑재)
    // =========================================================================
    const devBottomPcbGroup = new THREE.Group();
    devBottomPcbGroup.name = 'devBottomPcb';

    const devBoardGeo = new THREE.BoxGeometry(6.5, 0.16, 4.3);
    const devBoardMat = new THREE.MeshStandardMaterial({
      color: 0x581c87, // Distinct Engineering Purple PCB for Development/Rework Bottom PCB
      roughness: 0.35,
      metalness: 0.22
    });
    const devBoard = new THREE.Mesh(devBoardGeo, devBoardMat);
    devBoard.position.y = -0.32;
    devBoard.castShadow = true;
    devBoard.receiveShadow = true;
    devBottomPcbGroup.add(devBoard);
    this.addCadEdges(devBoard, 0xc084fc, 0.95);

    // Dev MCU
    const devMcu = this.createChipMesh({
      width: 1.25,
      depth: 1.25,
      height: 0.2,
      color: 0x1e1b4b,
      pinCount: 32
    });
    devMcu.position.set(-0.75, -0.24, 0.1);
    devBottomPcbGroup.add(devMcu);

    // Dev B2B Receptacle Connector (mates with Top PCB!)
    const devB2B = this.createB2BConnector(false);
    devB2B.position.set(1.85, -0.24, 0.0);
    devB2B.rotation.y = Math.PI / 2;
    devBottomPcbGroup.add(devB2B);

    // Populated JTAG Shrouded Header + External JTAG Debugger Probe & Cable
    const jtagGroup = new THREE.Group();
    jtagGroup.position.set(2.85, -0.1, 0.0);

    const jtagHeaderGeo = new THREE.BoxGeometry(0.62, 0.32, 1.55);
    const jtagHeaderMat = new THREE.MeshStandardMaterial({
      color: 0x06b6d4,
      roughness: 0.3,
      metalness: 0.3
    });
    const jtagHeader = new THREE.Mesh(jtagHeaderGeo, jtagHeaderMat);
    jtagGroup.add(jtagHeader);
    this.addCadEdges(jtagHeader, 0x67e8f9, 0.95);

    // Gold JTAG pins inside header
    for (let r = 0; r < 5; r++) {
      for (let c = 0; c < 2; c++) {
        const pin = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.04, 0.04), goldRingMat);
        pin.position.set(0.22, (c - 0.5) * 0.1, (r - 2) * 0.24);
        jtagGroup.add(pin);
      }
    }

    // JTAG Ribbon / Cable extending to external JTAG Debugger Pod
    const cableGeo = new THREE.BoxGeometry(1.9, 0.08, 1.15);
    const cableMat = new THREE.MeshStandardMaterial({
      color: 0x22d3ee,
      roughness: 0.4,
      metalness: 0.2,
      emissive: 0x0891b2,
      emissiveIntensity: 0.35
    });
    const cable = new THREE.Mesh(cableGeo, cableMat);
    cable.position.set(1.2, 0.0, 0.0);
    jtagGroup.add(cable);

    // External JTAG Debugger Box
    const podGeo = new THREE.BoxGeometry(1.4, 0.45, 1.75);
    const podMat = new THREE.MeshStandardMaterial({
      color: 0x0f172a,
      roughness: 0.3,
      metalness: 0.5
    });
    const pod = new THREE.Mesh(podGeo, podMat);
    pod.position.set(2.6, 0.05, 0.0);
    jtagGroup.add(pod);
    this.addCadEdges(pod, 0x22d3ee, 0.9);

    // High-visibility traces on Dev Bottom PCB connecting JTAG -> MCU -> B2B Connector
    const devTraceMat = new THREE.MeshBasicMaterial({ color: 0x22d3ee });
    const devTrace1 = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.02, 0.12), devTraceMat);
    devTrace1.position.set(2.35, -0.23, 0.0);
    const devTrace2 = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.02, 0.12), devTraceMat);
    devTrace2.position.set(0.55, -0.23, 0.0);
    devBottomPcbGroup.add(devTrace1, devTrace2);

    devBottomPcbGroup.add(jtagGroup);
    this.parts.devJtag = jtagGroup;

    // Start with Dev Bottom PCB parked off to the right and hidden in normal assembled state
    devBottomPcbGroup.position.set(12, 0, 0);
    devBottomPcbGroup.visible = false;

    this.scene.add(devBottomPcbGroup);
    this.parts.devBottomPcb = devBottomPcbGroup;

    // =========================================================================
    // 7. ALIGNMENT GUIDE LINES & JTAG SIGNAL PULSE PARTICLES
    // =========================================================================
    this.guideLinesGroup = new THREE.Group();
    const dashMat = new THREE.LineDashedMaterial({
      color: 0x60a5fa,
      dashSize: 0.18,
      gapSize: 0.12,
      transparent: true,
      opacity: 0.65
    });

    // Screw axis guide lines
    this.housingCornerCoords.forEach(([x, z]) => {
      const pts = [new THREE.Vector3(x, -0.9, z), new THREE.Vector3(x, 6.2, z)];
      const lineGeo = new THREE.BufferGeometry().setFromPoints(pts);
      const line = new THREE.Line(lineGeo, dashMat);
      line.computeLineDistances();
      this.guideLinesGroup.add(line);
    });

    // B2B Connector mating guide lines (Gold dashed lines between Top PCB B2B and Bottom PCB B2B)
    const b2bDashMat = new THREE.LineDashedMaterial({
      color: 0xfbbf24,
      dashSize: 0.15,
      gapSize: 0.1,
      transparent: true,
      opacity: 0.85
    });
    [
      [1.85, -0.95],
      [1.85, 0.0],
      [1.85, 0.95]
    ].forEach(([x, z]) => {
      const pts = [new THREE.Vector3(x, -0.3, z), new THREE.Vector3(x, 3.0, z)];
      const lineGeo = new THREE.BufferGeometry().setFromPoints(pts);
      const line = new THREE.Line(lineGeo, b2bDashMat);
      line.computeLineDistances();
      this.guideLinesGroup.add(line);
    });

    this.scene.add(this.guideLinesGroup);

    // Signal particles for JTAG -> Dev Bottom PCB -> B2B Connector -> Top PCB (CPU / eMMC)
    this.signalGroup = new THREE.Group();
    const sphereGeo = new THREE.SphereGeometry(0.11, 12, 12);
    const sphereMat = new THREE.MeshBasicMaterial({ color: 0x22d3ee });
    for (let i = 0; i < 8; i++) {
      const p = new THREE.Mesh(sphereGeo, sphereMat);
      p.userData.offset = i / 8;
      this.signalGroup.add(p);
      this.signalParticles.push(p);
    }
    this.signalGroup.visible = false;
    this.scene.add(this.signalGroup);

    // Initialize default part targets
    Object.keys(this.parts).forEach((key) => {
      this.partTargets[key] = {
        pos: this.parts[key].position.clone(),
        rotY: 0
      };
    });
  }

  initLabels() {
    this.labelsContainer.innerHTML = '';
    this.labelItems = [];

    const defs = [
      {
        id: 'topHousing',
        getTitle: () => `상부 ${this.componentLabels.housing}`,
        getSub: () => '스크류 4점 체결 보호 커버',
        color: '#94a3b8',
        targetObj: () => this.parts.topHousing,
        localOffset: new THREE.Vector3(-2.2, 1.55, -1.6)
      },
      {
        id: 'housingScrews',
        getTitle: () => this.componentLabels.screws,
        getSub: () => '하우징 및 내부 PCB 고정 스크류',
        color: '#f8fafc',
        targetObj: () => this.parts.housingScrews,
        localOffset: new THREE.Vector3(3.45, 1.65, 2.3)
      },
      {
        id: 'topPcb',
        getTitle: () => this.componentLabels.topPcb,
        getSub: () => 'CPU + eMMC 탑재 메인 보드',
        color: '#10b981',
        targetObj: () => this.parts.topPcb,
        localOffset: new THREE.Vector3(-2.6, 0.85, 1.6)
      },
      {
        id: 'cpu',
        getTitle: () => this.componentLabels.cpu,
        getSub: () => 'Top PCB 탑재 프로세서',
        color: '#34d399',
        targetObj: () => this.parts.topPcb,
        localOffset: new THREE.Vector3(-1.35, 1.05, 0.1)
      },
      {
        id: 'emmc',
        getTitle: () => this.componentLabels.emmc,
        getSub: () => {
          if (this.swState === 'error') return '⚠️ SW 이상 발생 (리워크 필요)';
          if (this.swState === 'updating') return '⚡ JTAG 경유 펌웨어 업데이트 중...';
          if (this.swState === 'updated') return '✅ 펌웨어 업데이트 완료 (정상)';
          return 'Top PCB 펌웨어 저장 메모리';
        },
        color: '#10b981',
        targetObj: () => this.parts.topPcb,
        localOffset: new THREE.Vector3(0.55, 1.05, 0.15)
      },
      {
        id: 'connector',
        getTitle: () => this.componentLabels.connector,
        getSub: () => 'Top PCB ↔ Bottom PCB 수직 결합',
        color: '#fbbf24',
        targetObj: () => this.parts.topPcb,
        localOffset: new THREE.Vector3(1.85, 0.2, 0.9)
      },
      {
        id: 'prodBottomPcb',
        getTitle: () => this.componentLabels.prodBottomPcb,
        getSub: () => `내부 ${this.componentLabels.mcu} 탑재 / ❌ JTAG 미실장`,
        color: '#38bdf8',
        targetObj: () => this.parts.prodBottomPcb,
        localOffset: new THREE.Vector3(-1.1, -0.05, 1.8)
      },
      {
        id: 'devBottomPcb',
        getTitle: () => `🔧 ${this.componentLabels.devBottomPcb}`,
        getSub: () => `${this.componentLabels.mcu} + ${this.componentLabels.jtag} 연결됨`,
        color: '#c084fc',
        targetObj: () => this.parts.devBottomPcb,
        localOffset: new THREE.Vector3(1.5, 0.35, 1.2)
      },
      {
        id: 'bottomHousing',
        getTitle: () => `하부 ${this.componentLabels.housing}`,
        getSub: () => '내부 스탠드오프 및 박싱 케이스',
        color: '#94a3b8',
        targetObj: () => this.parts.bottomHousing,
        localOffset: new THREE.Vector3(-2.5, -0.7, 2.7)
      }
    ];

    defs.forEach((def) => {
      const el = document.createElement('div');
      el.className = 'label-3d';
      el.dataset.partId = def.id;
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        if (this.onPartClick) this.onPartClick(def.id);
      });
      this.labelsContainer.appendChild(el);
      this.labelItems.push({ ...def, el });
    });

    this.refreshLabelContents();
  }

  refreshLabelContents() {
    this.labelItems.forEach((item) => {
      item.el.classList.remove('highlight-error', 'highlight-active', 'highlight-dev', 'highlight-ok');
      if (item.id === 'emmc') {
        if (this.swState === 'error') item.el.classList.add('highlight-error');
        else if (this.swState === 'updating') item.el.classList.add('highlight-active');
        else if (this.swState === 'updated') item.el.classList.add('highlight-ok');
      }
      if (item.id === 'devBottomPcb') {
        item.el.classList.add('highlight-dev');
      }

      item.el.innerHTML = `
        <div class="label-title">
          <span class="label-dot" style="background:${item.color}"></span>
          <span>${item.getTitle()}</span>
        </div>
        <div class="label-sub">${item.getSub()}</div>
      `;
    });
  }

  updateComponentLabels(newLabels) {
    this.componentLabels = { ...this.componentLabels, ...newLabels };
    this.refreshLabelContents();
  }

  setHousingMode(mode) {
    this.housingMode = mode;
    const isVisible = mode !== 'hidden';
    this.parts.topHousing.visible = isVisible;
    this.parts.bottomHousing.visible = isVisible;

    this.housingMaterials.forEach((mat) => {
      if (mode === 'xray') {
        mat.transparent = true;
        mat.opacity = 0.36;
        mat.wireframe = false;
        mat.depthWrite = false;
      } else if (mode === 'solid') {
        mat.transparent = false;
        mat.opacity = 1.0;
        mat.wireframe = false;
        mat.depthWrite = true;
      } else if (mode === 'wireframe') {
        mat.transparent = true;
        mat.opacity = 0.22;
        mat.wireframe = true;
        mat.depthWrite = false;
      }
      mat.needsUpdate = true;
    });
  }

  setSwState(state) {
    this.swState = state;
    if (this.emmcHaloMat) {
      if (state === 'error') this.emmcHaloMat.color.setHex(0xef4444);
      else if (state === 'updating') this.emmcHaloMat.color.setHex(0x06b6d4);
      else this.emmcHaloMat.color.setHex(0x10b981);
    }
    this.refreshLabelContents();
  }

  // Set continuous explode slider factor (0.0 to 1.0)
  setExplodeFactor(factor) {
    this.visualPreset = 'exploded_custom';
    this.targetExplodeFactor = Math.max(0, Math.min(1, factor));

    const f = this.targetExplodeFactor;
    this.parts.devBottomPcb.visible = false;
    this.signalGroup.visible = false;

    this.partTargets.housingScrews.pos.set(0, f * 5.2, 0);
    this.partTargets.topHousing.pos.set(0, f * 3.8, 0);
    this.partTargets.topPcbScrews.pos.set(0, f * 2.5, 0);
    this.partTargets.topPcb.pos.set(0, f * 1.65, 0);
    this.partTargets.bottomPcbScrews.pos.set(0, f * 0.55, 0);
    this.partTargets.prodBottomPcb.pos.set(0, f * -0.15, 0);
    this.partTargets.bottomHousing.pos.set(0, f * -1.45, 0);

    this.guideLinesGroup.visible = this.showGuideLines && f > 0.08;
  }

  // Apply named 3D preset for Flowchart steps or Quick buttons
  applyPreset(presetName, immediate = false) {
    this.visualPreset = presetName;

    // Reset baseline positions
    const setTarget = (partKey, x, y, z) => {
      if (this.partTargets[partKey]) {
        this.partTargets[partKey].pos.set(x, y, z);
      }
    };

    if (presetName === 'assembled' || presetName === 'sw_error') {
      // Top PCB and Bottom PCB mated via B2B connector inside the Steel Housing
      this.targetExplodeFactor = 0.0;
      this.parts.devBottomPcb.visible = false;
      this.signalGroup.visible = false;
      this.guideLinesGroup.visible = false;

      setTarget('housingScrews', 0, 0, 0);
      setTarget('topHousing', 0, 0, 0);
      setTarget('topPcbScrews', 0, 0, 0);
      setTarget('topPcb', 0, 0, 0);
      setTarget('bottomPcbScrews', 0, 0, 0);
      setTarget('prodBottomPcb', 0, 0, 0);
      setTarget('bottomHousing', 0, 0, 0);
      setTarget('devBottomPcb', 11, 0, 0);

      this.setSwState(presetName === 'sw_error' ? 'error' : 'normal');
      this.cameraTargetGoal.set(0, 0.3, 0);
      this.cameraPosGoal = new THREE.Vector3(11.5, 9.5, 13.5);
    } else if (presetName === 'unbox') {
      // Step 1: Unscrew housing & PCB screws, open steel housing, lift out PCB assembly
      this.targetExplodeFactor = 0.65;
      this.parts.devBottomPcb.visible = false;
      this.signalGroup.visible = false;
      this.guideLinesGroup.visible = this.showGuideLines;

      setTarget('housingScrews', 0, 4.8, 0);
      setTarget('topHousing', 0, 3.4, -1.8);
      setTarget('topPcbScrews', 0, 2.2, 0);
      setTarget('topPcb', 0, 1.0, 0);
      setTarget('bottomPcbScrews', 0, 1.3, 0);
      setTarget('prodBottomPcb', 0, 0.6, 0);
      setTarget('bottomHousing', 0, -1.3, 0);
      setTarget('devBottomPcb', 11, 0, 0);

      this.setSwState('error');
      this.cameraTargetGoal.set(0, 1.1, 0);
      this.cameraPosGoal = new THREE.Vector3(13.5, 10.5, 15.0);
    } else if (presetName === 'pcb_split') {
      // Step 2: Top PCB (CPU, eMMC) and Production Bottom PCB (MCU, no JTAG) separated from B2B connector
      this.targetExplodeFactor = 0.85;
      this.parts.devBottomPcb.visible = false;
      this.signalGroup.visible = false;
      this.guideLinesGroup.visible = this.showGuideLines;

      setTarget('housingScrews', 0, 5.5, -2.5);
      setTarget('topHousing', 0, 4.2, -2.5);
      setTarget('topPcbScrews', 0, 3.1, 0);
      setTarget('topPcb', 0, 1.85, 0);
      setTarget('bottomPcbScrews', 0, 0.65, 0);
      setTarget('prodBottomPcb', 0, 0.0, 0);
      setTarget('bottomHousing', 0, -1.5, 0);
      setTarget('devBottomPcb', 11, 0, 0);

      this.setSwState('error');
      this.cameraTargetGoal.set(0, 0.8, 0);
      this.cameraPosGoal = new THREE.Vector3(10.5, 8.8, 12.5);
    } else if (presetName === 'dev_rework') {
      // Step 3: Production Bottom PCB moved aside to the left; Dev Bottom PCB (with JTAG) mated with Top PCB!
      this.targetExplodeFactor = 0.5;
      this.parts.devBottomPcb.visible = true;
      this.signalGroup.visible = true;
      this.guideLinesGroup.visible = false;

      // Park steel housing and production bottom PCB neatly on the left
      setTarget('housingScrews', -6.2, 3.6, -2.2);
      setTarget('topHousing', -6.2, 2.4, -2.2);
      setTarget('bottomHousing', -6.2, -0.5, -1.5);
      setTarget('bottomPcbScrews', -6.2, 1.2, 1.2);
      setTarget('prodBottomPcb', -6.2, 0.2, 1.2);

      // Center stage: Top PCB mated onto Development Bottom PCB (with JTAG cable active!)
      setTarget('topPcbScrews', 0, 2.4, 0);
      setTarget('devBottomPcb', 0, 0.5, 0);
      setTarget('topPcb', 0, 0.5, 0); // Mated directly via B2B connector with Dev Bottom PCB!

      this.setSwState('updating');
      this.cameraTargetGoal.set(0.8, 0.6, 0);
      this.cameraPosGoal = new THREE.Vector3(9.5, 8.5, 12.0);
    } else if (presetName === 'reassembled') {
      // Step 4: Rework complete, Top PCB re-mated with Production Bottom PCB inside Steel Housing
      this.targetExplodeFactor = 0.0;
      this.parts.devBottomPcb.visible = false;
      this.signalGroup.visible = false;
      this.guideLinesGroup.visible = false;

      setTarget('housingScrews', 0, 0, 0);
      setTarget('topHousing', 0, 0, 0);
      setTarget('topPcbScrews', 0, 0, 0);
      setTarget('topPcb', 0, 0, 0);
      setTarget('bottomPcbScrews', 0, 0, 0);
      setTarget('prodBottomPcb', 0, 0, 0);
      setTarget('bottomHousing', 0, 0, 0);
      setTarget('devBottomPcb', 11, 0, 0);

      this.setSwState('updated');
      this.cameraTargetGoal.set(0, 0.3, 0);
      this.cameraPosGoal = new THREE.Vector3(11.5, 9.5, 13.5);
    }

    if (immediate) {
      Object.keys(this.partTargets).forEach((k) => {
        if (this.parts[k]) {
          this.parts[k].position.copy(this.partTargets[k].pos);
        }
      });
    }
  }

  initInteraction() {
    this.raycaster = new THREE.Raycaster();
    this.pointer = new THREE.Vector2();

    let downPos = { x: 0, y: 0 };
    this.renderer.domElement.addEventListener('pointerdown', (e) => {
      downPos = { x: e.clientX, y: e.clientY };
    });

    this.renderer.domElement.addEventListener('pointerup', (e) => {
      const dist = Math.hypot(e.clientX - downPos.x, e.clientY - downPos.y);
      if (dist > 5) return; // Dragged orbit controls

      const rect = this.renderer.domElement.getBoundingClientRect();
      this.pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      this.pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;

      this.raycaster.setFromCamera(this.pointer, this.camera);
      const intersects = this.raycaster.intersectObjects(this.scene.children, true);
      if (intersects.length > 0 && this.onPartClick) {
        let obj = intersects[0].object;
        while (obj && obj !== this.scene) {
          if (obj.name) {
            this.onPartClick(obj.name);
            break;
          }
          obj = obj.parent;
        }
      }
    });

    // Cancel automatic camera glide if user grabs controls
    this.controls.addEventListener('start', () => {
      this.cameraPosGoal = null;
    });
  }

  updateLabelsProjection() {
    if (!this.showLabels) {
      this.labelItems.forEach((item) => {
        item.el.style.display = 'none';
      });
      return;
    }

    const width = this.container.clientWidth;
    const height = this.container.clientHeight;
    const tempV = new THREE.Vector3();

    this.labelItems.forEach((item) => {
      const targetGroup = item.targetObj();
      if (!targetGroup || !targetGroup.visible) {
        item.el.style.display = 'none';
        return;
      }

      tempV.copy(item.localOffset).add(targetGroup.position);
      tempV.project(this.camera);

      // Hide if behind camera
      if (tempV.z > 1) {
        item.el.style.display = 'none';
        return;
      }

      const x = (tempV.x * 0.5 + 0.5) * width;
      const y = (-(tempV.y * 0.5) + 0.5) * height;

      item.el.style.display = 'flex';
      item.el.style.left = `${x}px`;
      item.el.style.top = `${y}px`;
    });
  }

  onResize() {
    if (!this.container) return;
    const width = this.container.clientWidth;
    const height = this.container.clientHeight;
    if (width === 0 || height === 0) return;

    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height);
  }

  animate() {
    requestAnimationFrame(() => this.animate());

    const dt = Math.min(this.clock.getDelta(), 0.1);
    const elapsed = this.clock.getElapsedTime();

    // Smoothly interpolate part positions
    const lerpSpeed = 6.0 * dt;
    Object.keys(this.partTargets).forEach((key) => {
      const part = this.parts[key];
      const target = this.partTargets[key];
      if (part && target) {
        part.position.lerp(target.pos, lerpSpeed);
      }
    });

    this.explodeFactor += (this.targetExplodeFactor - this.explodeFactor) * lerpSpeed;

    // Spin screws slightly when they are elevated/unscrewing
    const screwElevated = this.parts.housingScrews.position.y > 0.3;
    if (screwElevated) {
      this.screwMeshes.forEach((s) => {
        s.rotation.y += dt * 3.2;
      });
    } else {
      this.screwMeshes.forEach((s) => {
        s.rotation.y = 0;
      });
    }

    // Pulse eMMC halo & animate JTAG signal particles during Rework (dev_rework)
    if (this.emmcHaloMat) {
      if (this.swState === 'error') {
        this.emmcHaloMat.opacity = 0.45 + 0.45 * Math.sin(elapsed * 6.0);
      } else if (this.swState === 'updating') {
        this.emmcHaloMat.opacity = 0.45 + 0.5 * Math.sin(elapsed * 10.0);
      } else {
        this.emmcHaloMat.opacity = 0.75;
      }
    }

    // Animate JTAG -> Dev Bottom PCB -> B2B Connector -> Top PCB (eMMC & CPU) signal flow
    if (this.signalGroup.visible) {
      const devPos = this.parts.devBottomPcb.position;
      const topPos = this.parts.topPcb.position;
      // Path waypoints:
      // 0: JTAG Debugger Pod (x=5.2, y=0.4)
      // 1: Dev Bottom PCB JTAG Header (x=2.85, y=0.35)
      // 2: Dev Bottom PCB MCU / B2B Connector (x=1.85, y=0.35)
      // 3: Up through B2B Connector into Top PCB (x=1.85, y=1.05)
      // 4: Top PCB eMMC & CPU (x=0.55, y=1.08) -> (x=-1.35, y=1.08)
      const waypoints = [
        new THREE.Vector3(devPos.x + 5.2, devPos.y - 0.05, 0),
        new THREE.Vector3(devPos.x + 2.85, devPos.y - 0.1, 0),
        new THREE.Vector3(devPos.x + 1.85, devPos.y - 0.1, 0),
        new THREE.Vector3(topPos.x + 1.85, topPos.y + 0.55, 0),
        new THREE.Vector3(topPos.x + 0.55, topPos.y + 0.65, 0.15),
        new THREE.Vector3(topPos.x - 1.35, topPos.y + 0.65, 0.1)
      ];

      this.signalParticles.forEach((p) => {
        const t = (elapsed * 0.55 + p.userData.offset) % 1.0;
        const totalSegs = waypoints.length - 1;
        const segFloat = t * totalSegs;
        const segIdx = Math.min(Math.floor(segFloat), totalSegs - 1);
        const segT = segFloat - segIdx;
        p.position.lerpVectors(waypoints[segIdx], waypoints[segIdx + 1], segT);
      });
    }

    // Smooth camera transition
    this.controls.target.lerp(this.cameraTargetGoal, lerpSpeed);
    if (this.cameraPosGoal) {
      this.camera.position.lerp(this.cameraPosGoal, lerpSpeed * 0.85);
      if (this.camera.position.distanceTo(this.cameraPosGoal) < 0.15) {
        this.cameraPosGoal = null;
      }
    }

    this.controls.update();
    this.renderer.render(this.scene, this.camera);
    this.updateLabelsProjection();
  }
}

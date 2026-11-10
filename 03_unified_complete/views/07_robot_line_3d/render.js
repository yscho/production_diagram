(function (root) {
  'use strict';
  root.AVNViews = root.AVNViews || {};

  function mount(el, api) {
    const THREE = root.THREE;
    el.innerHTML = `
      <section class="robot-line">
        <header class="robot-toolbar">
          <div><div class="robot-eyebrow">ROBOT TRANSFER / 3D LIVE</div><h1>로봇 멀티라인 검사 셀</h1>
          <p>A 12개 동시 처리 · A → B → 컨베이어 → C → D → 후속 검사·라벨</p></div>
          <div class="camera-presets" aria-label="카메라 시점">
            <button data-camera="perspective">전체 보기</button><button data-camera="front">작업자 시점</button>
            <button data-camera="top">위에서</button><button data-camera="robot1">로봇 1</button><button data-camera="robot2">로봇 2</button>
          </div>
        </header>
        <div class="robot-scene-wrap">
          <canvas aria-label="제품을 집어 A B C D로 옮기는 로봇 팔 2대와 컨베이어 3D 장면" tabindex="0"></canvas>
          <div class="robot-scenario-note" hidden>멀티라인 시나리오를 불러오면 로봇 이송이 시작됩니다.<button class="load-multi">멀티라인 예시 시작</button></div>
          <div class="robot-live"><span class="live-dot"></span><span class="live-time"></span><span class="live-wip"></span></div>
          <div class="robot-detail" hidden></div>
          <div class="robot-camera-help">왼쪽 드래그: 360° 회전 · 오른쪽 드래그: 이동 · 휠: 확대/축소 · 더블클릭: 전체 보기</div>
          <div class="robot-error" hidden></div>
        </div>
        <div class="robot-process-strip"></div>
        <div class="robot-status-row"></div>
        <footer class="robot-assumptions">A의 동시 처리 12개는 사용자 설명 반영 · B/C/D 12개, 처리 시간, 후속 비전 검사 등은 예시 가정 · 실제 설비 연결 없음</footer>
      </section>`;
    const canvas = el.querySelector('canvas');
    const wrap = el.querySelector('.robot-scene-wrap');
    const error = el.querySelector('.robot-error');
    let renderer;
    try {
      if (!THREE) throw new Error('로컬 Three.js를 읽지 못했습니다.');
      renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    } catch (reason) {
      error.hidden = false;
      error.textContent = `3D 화면을 열 수 없습니다: ${reason.message}`;
      return () => {};
    }
    renderer.setPixelRatio(Math.min(root.devicePixelRatio || 1, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    const scene = new THREE.Scene();
    scene.background = new THREE.Color('#0b1723');
    scene.fog = new THREE.Fog('#0b1723', 115, 230);
    const camera = new THREE.PerspectiveCamera(43, 1, .1, 400);
    const world = new THREE.Group(); scene.add(world);
    scene.add(new THREE.HemisphereLight(0xdcefff, 0x213545, 2.4));
    const sun = new THREE.DirectionalLight(0xffecd4, 3.2); sun.position.set(-20, 40, 30); scene.add(sun);
    const rim = new THREE.DirectionalLight(0x5ebdff, 1.4); rim.position.set(0, 14, -24); scene.add(rim);
    const geometries = new Set(), materials = new Set(), textures = new Set();
    const stageViews = new Map(), robotViews = new Map(), products = new Map();
    const config = root.FACTORY_DATA.multiLineExample;
    const layout = config.layout;
    const point = (x, y, z) => new THREE.Vector3(x, y, z);
    const mat = (color, extras) => {
      const value = new THREE.MeshStandardMaterial({ color, roughness: .56, metalness: .22, ...extras });
      materials.add(value); return value;
    };
    const palette = {
      floor: mat('#142936'), frame: mat('#314d60'), belt: mat('#202d37'), metal: mat('#8da7b7', { metalness: .65 }),
      cell: mat('#224758'), jig: mat('#36596b'), amber: mat('#efa82e'), orange: mat('#ed7d24'), black: mat('#16232c'),
      glass: mat('#66b7da'), product: mat('#f4d072'), screen: mat('#4ac8bb', { emissive: '#30a392', emissiveIntensity: .4 }),
      busy: mat('#ffcc52', { emissive: '#bd7b10', emissiveIntensity: .7 }), ready: mat('#51dfad', { emissive: '#20aa7d', emissiveIntensity: .7 })
    };
    function mesh(geometry, material, parent = world) {
      geometries.add(geometry);
      const object = new THREE.Mesh(geometry, material); parent.add(object); return object;
    }
    function box(x, y, z, width, height, depth, material, parent = world) {
      const object = mesh(new THREE.BoxGeometry(width, height, depth), material, parent);
      object.position.set(x, y, z); return object;
    }
    function cylinder(x, y, z, radius, height, material, parent = world) {
      const object = mesh(new THREE.CylinderGeometry(radius, radius, height, 16), material, parent);
      object.position.set(x, y, z); return object;
    }
    function label(text, x, y, z, width, color = '#cbe7f3') {
      const board = document.createElement('canvas'); board.width = 640; board.height = 128;
      const ctx = board.getContext('2d');
      ctx.fillStyle = '#112b3b'; ctx.fillRect(0, 0, 640, 128);
      ctx.strokeStyle = '#3a6b80'; ctx.lineWidth = 4; ctx.strokeRect(2, 2, 636, 124);
      ctx.fillStyle = color; ctx.textAlign = 'center'; ctx.font = '700 45px system-ui, sans-serif'; ctx.fillText(text, 320, 81);
      const texture = new THREE.CanvasTexture(board); texture.colorSpace = THREE.SRGBColorSpace; textures.add(texture);
      const material = new THREE.SpriteMaterial({ map: texture, depthTest: false }); materials.add(material);
      const object = new THREE.Sprite(material); object.position.set(x, y, z); object.scale.set(width, width / 5, 1); world.add(object);
      return { object, ctx, texture, update(text) { ctx.fillStyle = '#112b3b'; ctx.fillRect(4, 4, 632, 120); ctx.fillStyle = color; ctx.fillText(text, 320, 81); texture.needsUpdate = true; } };
    }

    // The worker stands at +Z: A / robot1 / B and C / robot2 / D sit behind the belt.
    box(9, -.25, -2, 104, .45, 38, palette.floor);
    const grid = new THREE.GridHelper(104, 52, '#2c4a5c', '#203b4b'); grid.position.set(9, .01, -2); world.add(grid);
    geometries.add(grid.geometry); materials.add(grid.material);
    box(9, 1.6, layout.conveyorZ, 98, .55, layout.conveyorWidth, palette.belt);
    for (const side of [-1, 1]) {
      const z = layout.conveyorZ + side * (layout.conveyorWidth / 2 + layout.railOffset);
      box(9, 2.03, z, 98, .18, layout.railThickness, palette.metal);
    }
    for (let x = -38; x < 58; x += 1.4) {
      const roller = cylinder(x, 1.95, 6, .12, 2.8, palette.metal);
      roller.rotation.x = Math.PI / 2;
    }
    for (let x = -35; x < 57; x += 8) {
      for (const z of [5, 7]) box(x, .8, z, .35, 1.6, .35, palette.frame);
      // Repeated direction arrows on the front rail establish the actual conveyor direction.
      const arrow = mesh(new THREE.ConeGeometry(.27, .8, 3), palette.amber);
      arrow.rotation.z = -Math.PI / 2; arrow.position.set(x, 2.05, 7.9);
    }
    label('투입 →', -35, 3.7, 9, 5.2);
    label('후속 검사·라벨 → 출구', 45, 5.5, 10.5, 13);

    function slotPosition(id, index, count) {
      const center = layout.stations[id];
      const columns = Math.min(4, count), rows = Math.ceil(count / columns);
      return point(center[0] + (index % columns - (columns - 1) / 2) * 2.05,
        2.25, center[1] + (Math.floor(index / columns) - (rows - 1) / 2) * 1.85);
    }
    function endpoint(location) {
      if (location.kind === 'station') {
        const count = stageViews.get(location.stationId).slots.length;
        return slotPosition(location.stationId, location.slotIndex, count);
      }
      return point(layout.conveyorPoints[location.point], 2.35, layout.conveyorZ);
    }
    let structure = '';
    function buildStations(state) {
      const definitions = state.scenarioId === 'multi_line_example' ? state.stations : config.stations.map(station => ({ ...station, capacity: station.defaultCapacity }));
      const signature = definitions.map(station => `${station.id}:${station.capacity}`).join('|');
      if (structure === signature) return;
      structure = signature;
      stageViews.forEach(view => {
        world.remove(view.group); world.remove(view.label.object);
        view.group.traverse(object => { if (object.geometry) { object.geometry.dispose(); geometries.delete(object.geometry); } });
        view.label.texture.dispose(); textures.delete(view.label.texture);
        view.label.object.material.dispose(); materials.delete(view.label.object.material);
      });
      stageViews.clear();
      definitions.forEach(station => {
        const [x, z] = layout.stations[station.id], downstream = ['VISION', 'LABEL'].includes(station.id);
        const group = new THREE.Group(); world.add(group);
        const width = downstream ? 6 : layout.stationWidth, depth = downstream ? 3.8 : layout.stationDepth;
        box(x, .2, z, width + 1, .2, depth + 1, palette.cell, group);
        box(x, 1.5, z, width, .35, depth, palette.frame, group);
        for (const dx of [-width / 2 + .4, width / 2 - .4]) for (const dz of [-depth / 2 + .4, depth / 2 - .4]) box(x + dx, .8, z + dz, .34, 1.5, .34, palette.metal, group);
        const slots = [];
        for (let index = 0; index < station.capacity; index += 1) {
          const pos = slotPosition(station.id, index, station.capacity);
          if (downstream) { pos.x = x + (index - (station.capacity - 1) / 2) * 1.8; pos.z = z; }
          const jig = box(pos.x, 1.91, pos.z, 1.65, .35, 1.38, palette.jig, group);
          const light = box(pos.x, 2.11, pos.z - .65, .8, .06, .08, palette.screen, group);
          jig.userData.stationId = station.id;
          slots.push({ pos, jig, light });
        }
        // Inspection rack and status stack light, with the rear kept visually distinct from the conveyor.
        if (!downstream) {
          box(x + width / 2 - .8, 2.45, z - depth / 2 - .3, 1.3, 3.7, 1.2, palette.black, group);
          box(x + width / 2 - .8, 3.2, z - depth / 2 + .33, 1.05, .8, .08, palette.screen, group);
          cylinder(x - width / 2 + .4, 3.2, z - depth / 2 + .4, .11, 2.7, palette.metal, group);
          cylinder(x - width / 2 + .4, 4.5, z - depth / 2 + .4, .23, .4, palette.ready, group);
        } else {
          for (const dx of [-2.4, 2.4]) box(x + dx, 3.1, z, .25, 3, .25, palette.frame, group);
          box(x, 4.6, z, 5, .28, .5, palette.frame, group);
          box(x, 4.1, z, .8, .7, .7, station.id === 'LABEL' ? palette.amber : palette.glass, group);
        }
        const name = station.id === 'VISION' ? '비전 검사 · 예시' : station.id === 'LABEL' ? '라벨 부착 · 예시' : `${station.id} 스테이션`;
        const title = label(`${name} · 0/${station.capacity}`, x, downstream ? 6.4 : 6.5, z - 1, downstream ? 8 : 10.5);
        stageViews.set(station.id, { group, slots, label: title, name });
      });
    }

    const yAxis = point(0, 1, 0);
    function makeRobot(id) {
      const [x, z] = layout.robots[id];
      const base = point(x, 2.2, z), group = new THREE.Group(); world.add(group);
      cylinder(x, .35, z, 1.55, .7, palette.black, group);
      cylinder(x, 1.1, z, 1.05, 1.3, palette.orange, group);
      const shoulder = mesh(new THREE.SphereGeometry(.78, 18, 12), palette.black, group); shoulder.position.copy(base);
      const upper = cylinder(0, 0, 0, .43, 1, palette.orange, group);
      const lower = cylinder(0, 0, 0, .34, 1, palette.amber, group);
      const elbowMesh = mesh(new THREE.SphereGeometry(.62, 18, 12), palette.black, group);
      const wrist = mesh(new THREE.SphereGeometry(.43, 16, 10), palette.black, group);
      const gripper = new THREE.Group(); group.add(gripper);
      box(0, -.12, 0, 1, .3, .65, palette.metal, gripper);
      const left = box(-.49, -.38, 0, .12, .5, .6, palette.black, gripper);
      const right = box(.49, -.38, 0, .12, .5, .6, palette.black, gripper);
      label(`${id === 'R1' ? '로봇 1 · A ↔ B' : '로봇 2 · C ↔ D'}`, x, 2.7, 1.2, 8, '#ffd18b');
      const home = point(x, 5, 2.6);
      return { base, group, upper, lower, elbowMesh, wrist, gripper, left, right, home, tip: home.clone() };
    }
    robotViews.set('R1', makeRobot('R1')); robotViews.set('R2', makeRobot('R2'));
    function link(object, from, to) {
      const direction = to.clone().sub(from);
      object.position.copy(from).add(to).multiplyScalar(.5);
      object.scale.y = direction.length();
      object.quaternion.setFromUnitVectors(yAxis, direction.normalize());
    }
    function solveArm(view, target, carrying) {
      const length1 = 10, length2 = 10;
      const delta = target.clone().sub(view.base), horizontal = Math.hypot(delta.x, delta.z);
      const distance = Math.min(19.98, Math.max(.1, delta.length()));
      const along = (length1 * length1 - length2 * length2 + distance * distance) / (2 * distance);
      const height = Math.sqrt(Math.max(0, length1 * length1 - along * along));
      const direction = delta.clone().normalize();
      const normal = point(-direction.x * direction.y, 1 - direction.y * direction.y, -direction.z * direction.y).normalize();
      const elbow = view.base.clone().addScaledVector(direction, along).addScaledVector(normal, height);
      link(view.upper, view.base, elbow); link(view.lower, elbow, target);
      view.elbowMesh.position.copy(elbow); view.wrist.position.copy(target); view.gripper.position.copy(target);
      view.left.position.x = carrying ? -.56 : -.75; view.right.position.x = carrying ? .56 : .75;
      view.tip.copy(target);
    }
    const smooth = value => value * value * (3 - 2 * value);
    function robotPose(robot, time) {
      const view = robotViews.get(robot.id);
      if (robot.state !== 'moving' || !robot.from || !robot.to) return { tip: view.home, product: null, carrying: false };
      const from = endpoint(robot.from), to = endpoint(robot.to);
      const highFrom = from.clone().setY(7.7), highTo = to.clone().setY(7.7);
      const path = [view.home, highFrom, from.clone().add(point(0, .75, 0)), highFrom, highTo, to.clone().add(point(0, .75, 0)), highTo, view.home];
      const times = [0, .14, .25, .36, .64, .76, .87, 1];
      const progress = THREE.MathUtils.clamp((time - robot.startedAt) / (robot.completesAt - robot.startedAt), 0, 1);
      let segment = times.length - 2;
      for (let index = 0; index < times.length - 1; index += 1) if (progress <= times[index + 1]) { segment = index; break; }
      const amount = smooth((progress - times[segment]) / (times[segment + 1] - times[segment]));
      const tip = path[segment].clone().lerp(path[segment + 1], amount);
      return { tip, carrying: progress >= .25 && progress < .76, product: progress < .25 ? from : progress < .76 ? tip.clone().add(point(0, -.75, 0)) : to };
    }

    const productGeometry = new THREE.BoxGeometry(1.2, .46, .88); geometries.add(productGeometry);
    let currentState = api.getState();
    function receive(state) {
      currentState = state; buildStations(state);
      const multi = state.scenarioId === 'multi_line_example';
      el.querySelector('.robot-scenario-note').hidden = multi;
      const aCapacity = multi ? state.stations.find(station => station.id === 'A').capacity : 12;
      el.querySelector('.robot-toolbar p').textContent = `A ${aCapacity}개 동시 처리${aCapacity === 12 ? '' : ' (용량 가정 변경)'} · A → B → 컨베이어 → C → D → 후속 검사·라벨`;
      el.querySelector('.live-time').textContent = `${state.paused ? '일시정지' : '가동 중'} · ${state.simTimeSec.toFixed(1)}초`;
      el.querySelector('.live-wip').textContent = `WIP ${state.kpis.wip} · 완료 ${state.kpis.passed}`;
      el.querySelector('.robot-process-strip').innerHTML = (multi ? state.stations : []).map(station => {
        const busy = station.pcs.filter(pc => pc.state === 'busy').length;
        const occupied = station.slots.filter(slot => slot.productId).length;
        const view = stageViews.get(station.id);
        view.label.update(`${view.name} · ${occupied}/${station.capacity}`);
        view.slots.forEach((slot, index) => {
          const content = station.slots[index];
          const product = state.products.find(item => item.id === content.productId);
          slot.light.material = product && product.state === 'inspection_complete' ? palette.ready : content.productId ? palette.busy : palette.screen;
        });
        return `<div class="process-stage"><span>${station.name}</span><b>${occupied}<small> / ${station.capacity}</small></b><div><i style="width:${100 * occupied / station.capacity}%"></i></div><small>검사 중 ${busy} · ${station.id === 'A' && station.capacity === 12 ? '사용자 설명: 12개' : '예시 용량'}</small></div>`;
      }).join('');
      el.querySelector('.robot-status-row').innerHTML = multi ? state.robots.map(robot => `<span class="robot-status"><i class="${robot.state === 'moving' ? 'moving' : ''}"></i><b>${robot.id === 'R1' ? '로봇 1' : '로봇 2'}</b> ${robot.state === 'moving' ? `${robot.from.kind === 'station' ? robot.from.stationId : '컨베이어'} → ${robot.target === 'CONVEYOR' ? '컨베이어 복귀' : robot.target} · ${robot.productId}` : '대기 · 다음 작업 준비'}</span>`).join('') : '';
      const ids = new Set(multi ? state.products.map(product => product.id) : []);
      products.forEach((object, id) => { if (!ids.has(id)) { world.remove(object); products.delete(id); } });
      if (multi) state.products.forEach(product => {
        if (products.has(product.id)) return;
        const object = new THREE.Mesh(productGeometry, palette.product); object.userData.productId = product.id;
        world.add(object); products.set(product.id, object);
      });
    }
    function productPosition(product, time, poses) {
      if (product.state === 'robot_transfer') return poses.get(product.robotId)?.product;
      if (product.conveyor) {
        const journey = product.conveyor;
        const p = THREE.MathUtils.clamp((time - journey.startedAt) / (journey.completesAt - journey.startedAt), 0, 1);
        return point(THREE.MathUtils.lerp(layout.conveyorPoints[journey.from], layout.conveyorPoints[journey.to], p), 2.35, layout.conveyorZ);
      }
      if (product.slotIndex != null && stageViews.has(product.stageId)) return stageViews.get(product.stageId).slots[product.slotIndex]?.pos;
      return null;
    }

    // Camera orbit, pitch, pan and dolly are independent of simulation updates.
    const target = point(8, 0, -1);
    let radius = 84, theta = .12, phi = .79, drag = null;
    function updateCamera() {
      camera.position.set(target.x + radius * Math.sin(phi) * Math.sin(theta), target.y + radius * Math.cos(phi), target.z + radius * Math.sin(phi) * Math.cos(theta));
      camera.lookAt(target); camera.updateMatrixWorld();
    }
    function preset(name) {
      if (name === 'robot1' || name === 'robot2') {
        target.set(name === 'robot1' ? -16 : 16, 2, -4); radius = 34; theta = .35; phi = .85;
      } else {
        target.set(8, 0, -1); radius = name === 'front' ? 74 : 84;
        theta = name === 'perspective' ? .12 : 0; phi = name === 'top' ? .07 : name === 'front' ? 1.3 : .79;
      }
      updateCamera();
    }
    function down(event) { canvas.focus(); drag = { x: event.clientX, y: event.clientY, pan: event.button !== 0 || event.shiftKey }; canvas.setPointerCapture(event.pointerId); }
    function move(event) {
      if (!drag) return;
      const dx = event.clientX - drag.x, dy = event.clientY - drag.y;
      if (drag.pan) {
        const right = point(1, 0, 0).applyQuaternion(camera.quaternion);
        const up = point(0, 1, 0).applyQuaternion(camera.quaternion);
        target.addScaledVector(right, -dx * radius / 800).addScaledVector(up, dy * radius / 800);
      } else { theta -= dx * .006; phi = THREE.MathUtils.clamp(phi - dy * .006, .04, Math.PI - .1); }
      drag.x = event.clientX; drag.y = event.clientY; updateCamera();
    }
    function up() { drag = null; }
    function wheel(event) { event.preventDefault(); radius = THREE.MathUtils.clamp(radius * Math.exp(event.deltaY * .001), 9, 185); updateCamera(); }
    function context(event) { event.preventDefault(); }
    function fit() { preset('perspective'); }
    const onPreset = event => { const name = event.target.dataset.camera; if (name) preset(name); };
    const onLoad = () => api.getSim().setScenario('multi_line_example');
    canvas.addEventListener('pointerdown', down); canvas.addEventListener('pointermove', move); canvas.addEventListener('pointerup', up);
    canvas.addEventListener('pointercancel', up); canvas.addEventListener('lostpointercapture', up);
    canvas.addEventListener('wheel', wheel, { passive: false }); canvas.addEventListener('contextmenu', context); canvas.addEventListener('dblclick', fit);
    el.querySelector('.camera-presets').addEventListener('click', onPreset); el.querySelector('.load-multi').addEventListener('click', onLoad);
    function resize() {
      const rect = wrap.getBoundingClientRect(); renderer.setSize(Math.max(1, rect.width), Math.max(1, rect.height), false);
      camera.aspect = rect.width / Math.max(1, rect.height); camera.updateProjectionMatrix();
    }
    const observer = new ResizeObserver(resize); observer.observe(wrap);
    const unsubscribe = api.subscribe(receive);
    receive(currentState); resize(); updateCamera();
    let raf;
    function animate() {
      raf = requestAnimationFrame(animate);
      const time = api.getSim().getRenderTime(), poses = new Map();
      currentState.robots.forEach(robot => {
        const pose = robotPose(robot, time); poses.set(robot.id, pose); solveArm(robotViews.get(robot.id), pose.tip, pose.carrying);
      });
      if (currentState.scenarioId !== 'multi_line_example') robotViews.forEach(view => solveArm(view, view.home, false));
      currentState.products.forEach(product => {
        const object = products.get(product.id); if (!object) return;
        const position = productPosition(product, time, poses);
        object.visible = !!position; if (position) object.position.copy(position);
      });
      renderer.render(scene, camera);
      // Read-only evidence for headless QA, without creating any second runtime.
      canvas.dataset.camera = camera.position.toArray().map(value => value.toFixed(2)).join(',');
      canvas.dataset.robot1 = robotViews.get('R1').tip.toArray().map(value => value.toFixed(2)).join(',');
    }
    animate();
    return () => {
      unsubscribe(); cancelAnimationFrame(raf); observer.disconnect();
      canvas.removeEventListener('pointerdown', down); canvas.removeEventListener('pointermove', move); canvas.removeEventListener('pointerup', up);
      canvas.removeEventListener('pointercancel', up); canvas.removeEventListener('lostpointercapture', up); canvas.removeEventListener('wheel', wheel);
      canvas.removeEventListener('contextmenu', context); canvas.removeEventListener('dblclick', fit);
      el.querySelector('.camera-presets').removeEventListener('click', onPreset); el.querySelector('.load-multi').removeEventListener('click', onLoad);
      textures.forEach(texture => texture.dispose()); geometries.forEach(geometry => geometry.dispose()); materials.forEach(material => material.dispose());
      renderer.dispose(); renderer.forceContextLoss();
    };
  }

  root.AVNViews['07'] = {
    mount(el, api) { this.cleanup = mount(el, api); },
    unmount() { if (this.cleanup) { this.cleanup(); this.cleanup = null; } }
  };
})(window);

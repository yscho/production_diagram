(function (root) {
  function mount(el, api) {
    el.innerHTML = '<section class="three-migrated"><header><div><small>3D SIMULATION · SHARED ENGINE</small><h2>공장 검사라인 3D 씬</h2></div><span class="clock">0초</span></header><div class="stats"><span>통과<b class="pass">0</b></span><span>불량<b class="fail">0</b></span><span>UPH<b class="uph">0</b></span><span>WIP<b class="wip">0</b></span></div><div class="scene-wrap"><canvas aria-label="Three.js 검사라인 3D scene"></canvas><div class="error" hidden></div></div><footer>드래그 회전 · 휠 확대 · 회색 슬롯: 비어 있음 / 청록 슬롯: 점유</footer></section>';
    const canvas = el.querySelector("canvas");
    const message = el.querySelector(".error");
    if (!root.THREE) { message.hidden = false; message.textContent = "Three.js 로컬 라이브러리를 로드하지 못했습니다."; return () => {}; }
    const THREE = root.THREE;
    let renderer;
    try { renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false }); }
    catch (error) { message.hidden = false; message.textContent = `WebGL 초기화 실패: ${error.message}`; return () => {}; }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    const scene = new THREE.Scene(); scene.background = new THREE.Color("#09131f");
    const camera = new THREE.PerspectiveCamera(42, 1, .1, 1500);
    camera.position.set(0, 17, 30); camera.lookAt(0, 0, 0);
    scene.add(new THREE.HemisphereLight(0xd5eaff, 0x334455, 2.0));
    const sun = new THREE.DirectionalLight(0xffffff, 2.2); sun.position.set(-20, 36, 24); scene.add(sun);
    const world = new THREE.Group(); scene.add(world);
    const slotMeshes = new Map(); const productMeshes = new Map();
    function material(color, roughness) { return new THREE.MeshStandardMaterial({ color, roughness: roughness == null ? .62 : roughness }); }
    function box(parent, x, y, z, w, h, d, mat) {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
      mesh.position.set(x, y, z); parent.add(mesh); return mesh;
    }
    function labelTexture(text) {
      const board = document.createElement("canvas"); board.width = 512; board.height = 128;
      const context = board.getContext("2d"); context.fillStyle = "#142b40"; context.fillRect(0, 0, 512, 128);
      context.fillStyle = "#f2f7fa"; context.font = "bold 34px sans-serif"; context.textAlign = "center"; context.fillText(text.slice(0, 22), 256, 78);
      const texture = new THREE.CanvasTexture(board); texture.colorSpace = THREE.SRGBColorSpace; return texture;
    }
    function build(state) {
      world.traverse((object) => {
        if (object.geometry) object.geometry.dispose();
        if (object.material) {
          const materials = Array.isArray(object.material) ? object.material : [object.material];
          materials.forEach((item) => {
            if (item.map) item.map.dispose();
            item.dispose();
          });
        }
      });
      world.clear(); slotMeshes.clear();
      productMeshes.clear();
      const stations = state.stations; const gap = 7.8; const total = stations.length * gap;
      box(world, 0, -.35, 0, total + 5, .5, 12, material("#142535"));
      box(world, 0, .1, 2.1, total + 3, .22, 1.5, material("#263c4b"));
      box(world, 0, .05, 5, total + 3, .18, .9, material("#522e38"));
      stations.forEach((station, index) => {
        const x = (index - (stations.length - 1) / 2) * gap;
        box(world, x, .03, -.4, gap - .4, .12, 7, material(index % 2 ? "#213c50" : "#1c3447"));
        const texture = labelTexture(station.name);
        const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, depthTest: false }));
        sprite.position.set(x, 4.2, -2.8); sprite.scale.set(gap - .5, 1.25, 1); world.add(sprite);
        const slots = station.slots;
        slots.forEach((slot, slotIndex) => {
          const columns = Math.min(5, Math.ceil(Math.sqrt(slots.length)));
          const rows = Math.ceil(slots.length / columns);
          const sx = x + (slotIndex % columns - (columns - 1) / 2) * 1.12;
          const sz = -.3 - Math.floor(slotIndex / columns) * Math.min(.9, 3 / rows);
          const mesh = box(world, sx, .72, sz, .92, .22, .8, material(slot.productId ? "#34b7ad" : "#667780"));
          slotMeshes.set(`${station.id}:${slotIndex}`, mesh);
        });
        station.pcs.forEach((pc, pcIndex) => {
          const px = x + (pcIndex - (station.pcs.length - 1) / 2) * 1.7;
          box(world, px, .65, -4.1, .48, 1.2, .65, material("#344f60"));
          const monitor = box(world, px, 1.45, -4.08, .84, .55, .12, material(pc.state === "busy" ? "#f0bd49" : "#43b5c1"));
          monitor.userData.pcId = pc.id;
        });
      });
      state.products.forEach((product) => {
        const stationIndex = Math.max(0, stations.findIndex((station) => station.id === product.stageId));
        const x = (stationIndex - (stations.length - 1) / 2) * gap;
        let mesh = productMeshes.get(product.id);
        if (!mesh) { mesh = box(world, x, 1.16, 2.1, 1.1, .42, .8, material("#f4c85c")); productMeshes.set(product.id, mesh); }
        mesh.position.x = x; mesh.position.z = product.state === "robot_transfer" ? 0.8 : 2.1;
      });
      for (const [id, mesh] of productMeshes) if (!state.products.some((product) => product.id === id)) { mesh.geometry.dispose(); mesh.material.dispose(); productMeshes.delete(id); }
      const bounds = new THREE.Box3().setFromObject(world); const size = bounds.getSize(new THREE.Vector3());
      camera.position.set(0, Math.max(12, size.x * .38), Math.max(25, size.x * .68)); camera.lookAt(bounds.getCenter(new THREE.Vector3()));
    }
    function renderState(state) {
      build(state);
      el.querySelector(".clock").textContent = `${state.simTimeSec.toFixed(1)}초`;
      el.querySelector(".pass").textContent = state.kpis.passed; el.querySelector(".fail").textContent = state.kpis.failed;
      el.querySelector(".uph").textContent = state.kpis.uph.toFixed(1); el.querySelector(".wip").textContent = state.kpis.wip;
    }
    function resize() { const bounds = canvas.getBoundingClientRect(); renderer.setSize(Math.max(1, bounds.width), Math.max(1, bounds.height), false); camera.aspect = bounds.width / Math.max(1, bounds.height); camera.updateProjectionMatrix(); }
    const observer = new ResizeObserver(resize); observer.observe(el.querySelector(".scene-wrap"));
    let yaw = 0, drag = null;
    canvas.addEventListener("pointerdown", (event) => { drag = event.clientX; canvas.setPointerCapture(event.pointerId); });
    canvas.addEventListener("pointermove", (event) => { if (drag == null) return; yaw += (event.clientX - drag) * .008; drag = event.clientX; world.rotation.y = yaw; });
    const wheel = (event) => { event.preventDefault(); camera.position.multiplyScalar(Math.exp(event.deltaY * .0008)); camera.lookAt(0, 0, 0); };
    canvas.addEventListener("wheel", wheel, { passive: false });
    let raf = 0; function animate() { raf = requestAnimationFrame(animate); renderer.render(scene, camera); }
    resize(); renderState(api.getState()); animate();
    const unsubscribe = api.subscribe(renderState);
    return () => { unsubscribe(); observer.disconnect(); cancelAnimationFrame(raf); canvas.removeEventListener("wheel", wheel); renderer.dispose(); world.traverse((object) => { if (object.geometry) object.geometry.dispose(); if (object.material) { if (Array.isArray(object.material)) object.material.forEach((material) => material.dispose()); else object.material.dispose(); } }); };
  }
  root.AVNViews = root.AVNViews || {};
  root.AVNViews["04"] = { mount(el, api) { this.cleanup = mount(el, api); }, unmount() { this.cleanup && this.cleanup(); } };
})(window);

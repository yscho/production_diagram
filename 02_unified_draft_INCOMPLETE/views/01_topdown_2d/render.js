(function (root) {
  const NS = "http://www.w3.org/2000/svg";
  function mount(el, api) {
    el.innerHTML = '<section class="topdown"><header><b>FACTORY OPERATIONS · 2D FLOOR</b><span>🟢 슬롯　🟡 팔레트　🔴 리젝트</span></header><div class="top-layout"><svg viewBox="0 0 1000 650" role="img" aria-label="검사라인 탑다운 공장 배치도"></svg><aside><h2>라인 KPI</h2><div class="metrics"></div><h2>스테이션 상태</h2><div class="states"></div></aside></div></section>';
    const svg = el.querySelector("svg");
    const metrics = el.querySelector(".metrics");
    const states = el.querySelector(".states");
    function add(tag, attrs, parent, text) {
      const node = document.createElementNS(NS, tag);
      Object.entries(attrs || {}).forEach(([key, value]) => node.setAttribute(key, value));
      if (text != null) node.textContent = text;
      (parent || svg).appendChild(node);
      return node;
    }
    function render(state) {
      const stations = state.stations;
      svg.replaceChildren();
      add("rect", { x: 14, y: 14, width: 972, height: 622, rx: 18, class: "floor" });
      add("path", { d: "M55 48 H945 V590 H55 Z", class: "belt" });
      add("path", { d: "M55 48 H945 V590 H55 Z", class: "belt-dash" });
      add("path", { d: "M500 590 V620 H940", class: "reject-lane" });
      const columns = Math.min(4, Math.ceil(Math.sqrt(stations.length)));
      const rows = Math.ceil(stations.length / columns);
      const cellWidth = 900 / columns;
      const cellHeight = 440 / rows;
      const points = [];
      stations.forEach((station, index) => {
        const x = 50 + (index % columns) * cellWidth;
        const y = 82 + Math.floor(index / columns) * cellHeight;
        points.push({ x, y, width: cellWidth - 18, height: cellHeight - 18 });
        const group = add("g", {});
        add("rect", { x, y, width: cellWidth - 18, height: cellHeight - 18, rx: 9, class: "stage-box" }, group);
        add("text", { x: x + 10, y: y + 20, class: "stage-name" }, group, `${station.id}  ${station.name}`);
        add("text", { x: x + 10, y: y + 38, class: "stage-meta" }, group, `${station.slots.filter((slot) => slot.productId).length}/${station.capacity} 점유 · ${station.pcs.length} PC`);
        station.slots.forEach((slot, slotIndex) => {
          const sx = x + 10 + (slotIndex % 10) * 22;
          const sy = y + 52 + Math.floor(slotIndex / 10) * 18;
          add("rect", { x: sx, y: sy, width: 17, height: 13, rx: 2, class: slot.productId ? "slot occupied" : "slot" }, group);
        });
        station.pcs.forEach((pc, pcIndex) => {
          const px = x + cellWidth - 82 - (pcIndex % 2) * 34;
          const py = y + 50 + Math.floor(pcIndex / 2) * 34;
          add("rect", { x: px, y: py + 13, width: 26, height: 4, rx: 2, class: "desk" }, group);
          add("rect", { x: px + 5, y: py, width: 16, height: 11, rx: 2, class: pc.state === "busy" ? "monitor busy" : "monitor" }, group);
          add("text", { x: px - 1, y: py + 27, class: "pc-label" }, group, `PC${pcIndex + 1}`);
        });
      });
      state.products.slice(0, 60).forEach((product, index) => {
        const location = points[Math.max(0, stations.findIndex((station) => station.id === product.stageId))] || points[0];
        const slotIndex = Math.max(0, product.slotIndex || index % Math.max(1, state.capacity));
        const x = location.x + 12 + (slotIndex % 10) * 22;
        const y = location.y + 54 + Math.floor(slotIndex / 10) * 18;
        const pallet = add("g", { transform: `translate(${x} ${y})` });
        add("rect", { width: 17, height: 12, rx: 2, class: product.state === "failed" ? "pallet fail" : "pallet" }, pallet);
        add("text", { x: 1, y: 9, class: "serial" }, pallet, product.id.slice(-3));
      });
      metrics.innerHTML = `<div>통과 <b>${state.kpis.passed}</b></div><div>불량 <b>${state.kpis.failed}</b></div><div>UPH <b>${state.kpis.uph.toFixed(1)}</b></div><div>WIP <b>${state.kpis.wip}</b></div>`;
      states.innerHTML = stations.map((station) => `<div>${station.id} · ${station.name}<b>${station.slots.filter((slot) => slot.productId).length}/${station.capacity}</b></div>`).join("");
    }
    const unsubscribe = api.subscribe(render);
    render(api.getState());
    return () => unsubscribe();
  }
  root.AVNViews = root.AVNViews || {};
  root.AVNViews["01"] = { mount(el, api) { this.cleanup = mount(el, api); }, unmount() { this.cleanup && this.cleanup(); } };
})(window);

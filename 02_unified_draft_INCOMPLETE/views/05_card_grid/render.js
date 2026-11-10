(function (root) {
  function mount(el, api) {
    el.innerHTML = '<section class="andon"><header class="hdr"><div class="hdr-title"><span class="lamp"></span><div><h1>검사라인 안돈 보드</h1><div class="sub">실시간 공정 상태 · 공통 시뮬레이션</div></div></div><div class="board-kpis"></div></header><div class="legend">청록: 여유　금색: 검사 중　빨강: 경보 / 불량</div><main class="board"></main><footer class="ticker">최근 공정 제품 <span class="recent"></span></footer></section>';
    const board = el.querySelector(".board");
    function render(state) {
      const yieldRate = state.kpis.passed + state.kpis.failed ? state.kpis.passed / (state.kpis.passed + state.kpis.failed) * 100 : 0;
      const alarmCount = state.stations.reduce((total, station) => total + station.queue.length, 0);
      el.querySelector(".board-kpis").innerHTML = `<span>UPH / 목표 <b>${state.kpis.uph.toFixed(1)} / ${window.FACTORY_DATA.line.targetUph}</b></span><span>수율 <b>${yieldRate.toFixed(1)}%</b></span><span>통과 <b>${state.kpis.passed}</b></span><span>불량 <b>${state.kpis.failed}</b></span><span>WIP <b>${state.kpis.wip}</b></span><span>대기 경보 <b>${alarmCount}</b></span><span>시계 <b>${state.simTimeSec.toFixed(0)}초</b></span>`;
      board.innerHTML = state.stations.map((station) => {
        const occupied = station.slots.filter((slot) => slot.productId).length;
        const busy = station.pcs.filter((pc) => pc.state === "busy").length;
        const meter = Math.min(100, occupied / station.capacity * 100);
        return `<article class="station-card"><header><span class="code">${station.code}</span><strong>${station.name}</strong><span class="state ${station.queue.length ? "alarm" : busy ? "busy" : "idle"}">${station.queue.length ? "대기열 경보" : busy ? "검사 중" : "대기"}</span></header><div class="card-stats"><span>슬롯 점유 ${occupied}/${station.capacity}</span><span>PC 가동 ${busy}/${station.pcs.length}</span><span>대기열 ${station.queue.length}</span><span>가동률 ${meter.toFixed(0)}%</span></div><div class="slot-grid">${station.slots.map((slot, index) => `<span class="slot-tile ${slot.productId ? "occupied" : ""}" title="${slot.productId || "빈 슬롯"}">${slot.productId ? slot.productId.slice(-3) : String(index + 1).padStart(2, "0")}</span>`).join("")}</div><div class="pc-grid">${station.pcs.map((pc) => `<span class="pc-tile ${pc.state === "busy" ? "busy" : ""}"><i></i>${pc.id}${pc.productId ? ` · ${pc.productId}` : ""}</span>`).join("")}</div><div class="occupancy"><i style="width:${meter}%"></i></div></article>`;
      }).join("");
      el.querySelector(".recent").textContent = state.products.slice(-7).map((product) => `${product.id}(${product.stageId})`).join("　·　") || "대기 중";
    }
    const unsubscribe = api.subscribe(render); render(api.getState());
    return () => unsubscribe();
  }
  root.AVNViews = root.AVNViews || {};
  root.AVNViews["05"] = { mount(el, api) { this.cleanup = mount(el, api); }, unmount() { this.cleanup && this.cleanup(); } };
})(window);

(function (root) {
  const NS = "http://www.w3.org/2000/svg";
  function mount(el, api) {
    el.innerHTML = '<div class="flow-migrated"><header class="top"><div><div class="eyebrow">FACTORY FLOW · LIVE SNAPSHOT</div><h1>AVN 공정 흐름 및 생산 지표</h1><div class="sub">공통 엔진 snapshot 기반 · 예시 데이터</div></div></header><section class="panel flow"><div class="panel-h"><h2>라인 흐름</h2></div><svg class="flowSvg" role="img" aria-label="검사라인 흐름 노드"></svg></section><section class="kpis"></section><section class="grid"><div class="panel"><div class="panel-h"><h2>스테이션 점유율</h2></div><svg class="utilSvg" viewBox="0 0 520 250"></svg></div><div class="panel"><div class="panel-h"><h2>UPH 추이 / 목표</h2></div><svg class="uphSvg" viewBox="0 0 520 250"></svg></div><div class="panel side"><h2>공정 이벤트</h2><ul class="log"></ul></div></section></div>';
    const flow = el.querySelector(".flowSvg");
    let history = [];
    let events = [];
    let previous = null;
    function svg(tag, attrs, parent, text) {
      const node = document.createElementNS(NS, tag);
      Object.entries(attrs || {}).forEach(([key, value]) => node.setAttribute(key, value));
      if (text != null) node.textContent = text;
      parent.appendChild(node);
      return node;
    }
    function renderChart(element, stations) {
      element.replaceChildren();
      const row = 26;
      stations.forEach((station, index) => {
        const y = 24 + index * row;
        svg("text", { x: 8, y: y + 12, fill: "#a8bbc9", "font-size": 10 }, element, station.code);
        svg("rect", { x: 66, y, width: 360, height: 13, rx: 5, fill: "#243848" }, element);
        svg("rect", { x: 66, y, width: 360 * station.slots.filter((slot) => slot.productId).length / station.capacity, height: 13, rx: 5, fill: "#51d1b1" }, element);
        svg("text", { x: 438, y: y + 11, fill: "#d9e5eb", "font-size": 10 }, element, `${station.slots.filter((slot) => slot.productId).length}/${station.capacity}`);
      });
    }
    function render(state) {
      history.push({ t: state.simTimeSec, uph: state.kpis.uph });
      if (history.length > 45) history.shift();
      if (previous && state.kpis.wip !== previous.kpis.wip) {
        events.unshift({ time: state.simTimeSec, label: state.kpis.wip > previous.kpis.wip ? "제품 투입" : "공정 이동/완료", wip: state.kpis.wip });
        events = events.slice(0, 12);
      }
      const stations = state.stations;
      const width = Math.max(900, 210 + stations.length * 190);
      flow.setAttribute("viewBox", `0 0 ${width} 250`);
      flow.replaceChildren();
      const defs = svg("defs", {}, flow);
      const marker = svg("marker", { id: "arrow", viewBox: "0 0 10 10", refX: 9, refY: 5, markerWidth: 7, markerHeight: 7, orient: "auto" }, defs);
      svg("path", { d: "M0 0 L10 5 L0 10 z", fill: "#60758a" }, marker);
      stations.forEach((station, index) => {
        const x = 30 + index * 190;
        if (index < stations.length - 1) svg("line", { x1: x + 156, y1: 120, x2: x + 182, y2: 120, stroke: "#60758a", "stroke-width": 3, "marker-end": "url(#arrow)" }, flow);
        const group = svg("g", { transform: `translate(${x},30)` }, flow);
        svg("rect", { width: 155, height: 180, rx: 12, fill: "#1d2633", stroke: "#33425a", "stroke-width": 2 }, group);
        svg("circle", { cx: 18, cy: 20, r: 11, fill: "#2a3648" }, group);
        svg("text", { x: 18, y: 24, "text-anchor": "middle", fill: "white", "font-size": 10 }, group, station.code);
        svg("text", { x: 12, y: 52, fill: "white", "font-size": 12, "font-weight": 700 }, group, station.name.slice(0, 17));
        svg("text", { x: 12, y: 78, fill: "#9aadb8", "font-size": 11 }, group, `점유 ${station.slots.filter((slot) => slot.productId).length}/${station.capacity}`);
        const slots = station.slots.slice(0, 12);
        slots.forEach((slot, i) => svg("rect", { x: 12 + (i % 6) * 21, y: 95 + Math.floor(i / 6) * 17, width: 16, height: 12, rx: 2, fill: slot.productId ? "#51d1b1" : "#2d4355" }, group));
        svg("text", { x: 12, y: 155, fill: "#9aadb8", "font-size": 10 }, group, `대기 ${station.queue.length} · PC ${station.pcs.filter((pc) => pc.state === "busy").length}/${station.pcs.length}`);
      });
      const kpis = el.querySelector(".kpis");
      kpis.innerHTML = [["통과", state.kpis.passed], ["불량", state.kpis.failed], ["WIP", state.kpis.wip], ["UPH", state.kpis.uph.toFixed(1)]].map(([key, value]) => `<div class="kpi"><span>${key}</span><b>${value}</b></div>`).join("");
      renderChart(el.querySelector(".utilSvg"), stations);
      const chart = el.querySelector(".uphSvg");
      chart.replaceChildren();
      [0, 1, 2, 3, 4].forEach((tick) => svg("line", { x1: 44, y1: 20 + tick * 42, x2: 500, y2: 20 + tick * 42, stroke: "#2b3e4e" }, chart));
      const points = history.map((item, index) => `${48 + index * 10},${218 - Math.min(180, item.uph / Math.max(1, window.FACTORY_DATA.line.targetUph) * 180)}`).join(" ");
      if (points) svg("polyline", { points, fill: "none", stroke: "#51d1b1", "stroke-width": 3 }, chart);
      svg("line", { x1: 44, y1: 218 - 180, x2: 500, y2: 218 - 180, stroke: "#e1a94b", "stroke-dasharray": "5 4" }, chart);
      const bottleneck = stations.reduce((best, station) => station.queue.length > (best ? best.queue.length : -1) ? station : best, null);
      el.querySelector(".log").innerHTML = `<li class="bn-row">병목 후보 · ${bottleneck ? `${bottleneck.name} (대기 ${bottleneck.queue.length})` : "없음"}</li>` + (events.map((event) => `<li>${event.time.toFixed(0)}초 · ${event.label} · WIP ${event.wip}</li>`).join("") || "<li>최근 이벤트 없음</li>");
      previous = state;
    }
    const unsubscribe = api.subscribe(render);
    render(api.getState());
    return () => unsubscribe();
  }
  root.AVNViews = root.AVNViews || {};
  root.AVNViews["02"] = { mount(el, api) { this.cleanup = mount(el, api); }, unmount() { this.cleanup && this.cleanup(); } };
})(window);

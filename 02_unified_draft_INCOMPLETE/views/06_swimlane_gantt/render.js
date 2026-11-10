(function (root) {
  function mount(el, api) {
    el.innerHTML = '<section class="gantt-migrated"><header><div><b>SWIMLANE · 검사 PC별 시간축</b><small>선택한 공통 snapshot을 기준으로 현재 WIP와 단계 점유를 표시합니다.</small></div><div class="window-control"><label>표시 구간 <select><option value="300">5분</option><option value="900" selected>15분</option><option value="1800">30분</option></select></label></div></header><div class="timeline-wrap"><canvas></canvas><div class="tip" hidden></div></div><footer class="gantt-legend">청록 막대: 공정 점유　금색: PC 검사 중　회색: 유휴</footer></section>';
    const canvas = el.querySelector("canvas");
    const ctx = canvas.getContext("2d");
    let selected = null, range = 900, hitBars = [];
    function draw(state) {
      const box = canvas.getBoundingClientRect(); const dpr = window.devicePixelRatio || 1;
      const rowH = 30, headerH = 44, stationHeaderH = 44; const height = headerH + state.stations.reduce((sum, station) => sum + stationHeaderH + Math.max(1, station.pcs.length) * rowH + 8, 0);
      canvas.width = Math.max(1, box.width * dpr); canvas.height = height * dpr; canvas.style.height = `${height}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, box.width, height);
      ctx.fillStyle = "#111b25"; ctx.fillRect(0, 0, box.width, height);
      const labelW = 220, timeW = Math.max(120, box.width - labelW - 20), now = state.simTimeSec;
      hitBars = [];
      ctx.font = "11px system-ui"; ctx.fillStyle = "#a9bac8";
      for (let mark = 0; mark <= 6; mark += 1) {
        const x = labelW + mark * timeW / 6;
        ctx.strokeStyle = "#2c3d4c"; ctx.beginPath(); ctx.moveTo(x, headerH - 12); ctx.lineTo(x, height); ctx.stroke();
        ctx.fillText(`${Math.max(0, now - range + range * mark / 6).toFixed(0)}s`, x + 3, 20);
      }
      let y = headerH;
      state.stations.forEach((station) => {
        ctx.fillStyle = "#d9e5eb"; ctx.font = "bold 11px system-ui"; ctx.fillText(`${station.code} · ${station.name}`, 8, y + 16);
        const occupied = station.slots.filter((slot) => slot.productId).length;
        ctx.fillStyle = "#263945"; ctx.fillRect(8, y + 21, 126, 5);
        ctx.fillStyle = "#48c8bd"; ctx.fillRect(8, y + 21, 126 * occupied / station.capacity, 5);
        ctx.fillStyle = "#91a6b2"; ctx.font = "9px system-ui"; ctx.fillText(`용량 ${occupied}/${station.capacity} · 대기 ${station.queue.length}`, 8, y + 38);
        station.pcs.forEach((pc, pcIndex) => {
          const rowY = y + stationHeaderH + pcIndex * rowH;
          ctx.fillStyle = "#9aadb8"; ctx.font = "10px system-ui"; ctx.fillText(pc.id, 16, rowY + 27);
          ctx.fillStyle = "#1e2d39"; ctx.fillRect(labelW, rowY + 7, timeW, 14);
          if (pc.state === "busy" && pc.productId) {
            const product = state.products.find((item) => item.id === pc.productId);
            const remaining = product ? Math.max(.12, Math.min(1, (product.cycleTimeSec || 30) / range)) : .35;
            const barW = Math.max(22, timeW * remaining);
            ctx.fillStyle = selected === pc.productId ? "#ffd36c" : "#48c8bd";
            const barX = Math.max(labelW, labelW + timeW - barW);
            ctx.fillRect(barX, rowY + 7, barW, 14);
            hitBars.push({ x: barX, y: rowY + 7, width: barW, height: 14, productId: pc.productId });
            ctx.fillStyle = "#10202a"; ctx.fillText(pc.productId, Math.max(labelW + 4, labelW + timeW - barW + 4), rowY + 18);
          }
        });
        y += stationHeaderH + Math.max(1, station.pcs.length) * rowH + 8;
      });
      ctx.fillStyle = "#8ea2b2"; ctx.fillText(`현재 ${now.toFixed(1)}초 · WIP ${state.kpis.wip} · 선택 ${selected || "없음"}`, 8, height - 8);
    }
    function resize() { draw(api.getState()); }
    function click(event) {
      const rect = canvas.getBoundingClientRect(); const x = event.clientX - rect.left, y = event.clientY - rect.top;
      const bar = hitBars.find((item) => x >= item.x && x <= item.x + item.width && y >= item.y && y <= item.y + item.height);
      selected = bar ? (selected === bar.productId ? null : bar.productId) : null;
      draw(api.getState());
    }
    const select = el.querySelector("select"); const onRange = () => { range = Number(select.value); draw(api.getState()); };
    select.addEventListener("change", onRange); canvas.addEventListener("click", click);
    const observer = new ResizeObserver(resize); observer.observe(canvas.parentElement);
    const unsubscribe = api.subscribe(draw); draw(api.getState());
    return () => { unsubscribe(); observer.disconnect(); select.removeEventListener("change", onRange); canvas.removeEventListener("click", click); };
  }
  root.AVNViews = root.AVNViews || {};
  root.AVNViews["06"] = { mount(el, api) { this.cleanup = mount(el, api); }, unmount() { this.cleanup && this.cleanup(); } };
})(window);

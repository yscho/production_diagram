(function (root) {
  function mount(el, api) {
    el.innerHTML = '<section class="iso-migrated"><header><b>ISOMETRIC FACTORY CELLS</b><span class="meta">2.5D 사선 투영 · 드래그로 이동 · 휠 확대</span></header><div class="iso-stage"><canvas></canvas><div class="tooltip" hidden></div></div><div class="kpi-cards"></div><div class="stage-strip"></div></section>';
    const canvas = el.querySelector("canvas");
    const ctx = canvas.getContext("2d");
    const tip = el.querySelector(".tooltip");
    let scale = 1, panX = 0, panY = 0, drag = null, hitRegions = [];
    function draw(state) {
      const rect = canvas.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.max(1, rect.width * dpr);
      canvas.height = Math.max(1, rect.height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, rect.width, rect.height);
      ctx.fillStyle = "#111c25"; ctx.fillRect(0, 0, rect.width, rect.height);
      const stations = state.stations;
      const cols = Math.min(4, Math.ceil(Math.sqrt(stations.length)));
      const cellW = 210, cellH = 145, originX = rect.width / 2 - cols * cellW / 2 + panX, originY = 54 + panY;
      hitRegions = [];
      ctx.save(); ctx.translate(originX, originY); ctx.scale(scale, scale);
      stations.forEach((station, index) => {
        const col = index % cols, row = Math.floor(index / cols);
        const x = (col - row) * 72, y = (col + row) * 37;
        hitRegions.push({ station, x: originX + scale * x, y: originY + scale * (y + 70), radius: scale * 100 });
        const occupied = station.slots.filter((slot) => slot.productId).length;
        ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + 128, y + 32); ctx.lineTo(x, y + 64); ctx.lineTo(x - 128, y + 32); ctx.closePath();
        ctx.fillStyle = "#1e394b"; ctx.fill(); ctx.strokeStyle = "#4e8494"; ctx.lineWidth = 2; ctx.stroke();
        ctx.beginPath(); ctx.moveTo(x - 128, y + 32); ctx.lineTo(x - 128, y + 112); ctx.lineTo(x, y + 146); ctx.lineTo(x, y + 64); ctx.closePath(); ctx.fillStyle = "#152b39"; ctx.fill(); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(x, y + 64); ctx.lineTo(x + 128, y + 32); ctx.lineTo(x + 128, y + 112); ctx.lineTo(x, y + 146); ctx.closePath(); ctx.fillStyle = "#1b3040"; ctx.fill(); ctx.stroke();
        ctx.fillStyle = "#edf4f7"; ctx.font = "bold 12px system-ui"; ctx.textAlign = "center"; ctx.fillText(station.name, x, y + 31);
        ctx.fillStyle = "#9bb2c2"; ctx.font = "11px system-ui"; ctx.fillText(`${occupied} / ${station.capacity} 용량`, x, y + 52);
        station.slots.slice(0, 10).forEach((slot, slotIndex) => {
          const sx = x - 72 + slotIndex * 15, sy = y + 82 + Math.abs(4 - slotIndex) * 2;
          ctx.fillStyle = slot.productId ? "#56cfb4" : "#526572";
          ctx.fillRect(sx, sy, 11, 9);
          if (slot.productId) {
            ctx.fillStyle = "#f4c85c";
            ctx.beginPath(); ctx.moveTo(sx + 5, sy - 7); ctx.lineTo(sx + 11, sy - 3); ctx.lineTo(sx + 5, sy + 1); ctx.lineTo(sx - 1, sy - 3); ctx.closePath(); ctx.fill();
          }
        });
        station.pcs.forEach((pc, pcIndex) => {
          const px = x + 42 + pcIndex * 16;
          ctx.fillStyle = pc.state === "busy" ? "#f5b942" : "#83a4b7";
          ctx.fillRect(px, y + 5, 13, 9); ctx.fillRect(px + 2, y + 14, 9, 5);
        });
      });
      ctx.restore();
      el.querySelector(".kpi-cards").innerHTML = `<span>통과 <b>${state.kpis.passed}</b></span><span>불량 <b>${state.kpis.failed}</b></span><span>WIP <b>${state.kpis.wip}</b></span><span>UPH <b>${state.kpis.uph.toFixed(1)}</b></span>`;
      el.querySelector(".stage-strip").textContent = stations.map((station) => `${station.code}: ${station.slots.filter((slot) => slot.productId).length}/${station.capacity}`).join("　·　");
    }
    function pointerDown(event) { drag = { x: event.clientX, y: event.clientY }; canvas.setPointerCapture(event.pointerId); }
    function pointerMove(event) {
      if (drag) { panX += event.clientX - drag.x; panY += event.clientY - drag.y; drag = { x: event.clientX, y: event.clientY }; draw(api.getState()); return; }
      const rect = canvas.getBoundingClientRect(); const x = event.clientX - rect.left, y = event.clientY - rect.top;
      const hit = hitRegions.find((item) => Math.hypot(item.x - x, item.y - y) < item.radius);
      if (hit) {
        const occupied = hit.station.slots.filter((slot) => slot.productId).length;
        tip.hidden = false; tip.style.left = `${Math.min(rect.width - 210, x + 14)}px`; tip.style.top = `${Math.max(8, y - 20)}px`;
        tip.innerHTML = `<b>${hit.station.name}</b><br>점유 ${occupied}/${hit.station.capacity}<br>PC ${hit.station.pcs.filter((pc) => pc.state === "busy").length}/${hit.station.pcs.length} 가동 · 대기 ${hit.station.queue.length}`;
      } else tip.hidden = true;
    }
    function pointerUp() { drag = null; }
    function wheel(event) { event.preventDefault(); scale = Math.max(.55, Math.min(1.8, scale * Math.exp(-event.deltaY * .001))); draw(api.getState()); }
    canvas.addEventListener("pointerdown", pointerDown); canvas.addEventListener("pointermove", pointerMove); canvas.addEventListener("pointerup", pointerUp); canvas.addEventListener("pointercancel", pointerUp); canvas.addEventListener("wheel", wheel, { passive: false });
    const unsubscribe = api.subscribe(draw);
    const resize = () => draw(api.getState()); window.addEventListener("resize", resize); draw(api.getState());
    return () => { unsubscribe(); window.removeEventListener("resize", resize); canvas.removeEventListener("pointerdown", pointerDown); canvas.removeEventListener("pointermove", pointerMove); canvas.removeEventListener("pointerup", pointerUp); canvas.removeEventListener("pointercancel", pointerUp); canvas.removeEventListener("wheel", wheel); };
  }
  root.AVNViews = root.AVNViews || {};
  root.AVNViews["03"] = { mount(el, api) { this.cleanup = mount(el, api); }, unmount() { this.cleanup && this.cleanup(); } };
})(window);

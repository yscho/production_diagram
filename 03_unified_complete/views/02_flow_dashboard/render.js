(function(root) {
  'use strict';
  const U = root.AVNUI, S = U.svg;
  U.register('02', function(el, api) {
    el.innerHTML = `<section class="av-view av-flow">
      ${U.header('02 / FLOW & PERFORMANCE', '공정 흐름과 생산 지표', '좌→우 공정 순서 · 누적 PC 가동률 · 공통 검사 이력')}
      <div class="av-kpis"></div>
      <div class="flow-overview"><svg class="flow-map" role="img" aria-label="공정별 슬롯 PC 대기열"></svg></div>
      ${U.legend}
      <div class="flow-panels">
        <section class="av-panel"><h2>PC 가동률 <small>가동 시간 / 전체 PC 시간</small></h2><svg class="flow-util" role="img" aria-label="공정별 누적 PC 가동률"></svg></section>
        <section class="av-panel"><h2>생산량 추이 <small>누적 통과 / 경과 시간 · UPH</small></h2><svg class="flow-trend" viewBox="0 0 450 256" role="img" aria-label="시간당 생산량 추이와 예시 목표"></svg></section>
        <section class="av-panel flow-events"><h2>최근 공정 이벤트</h2><p class="flow-queue"></p><ol></ol></section>
      </div><footer class="av-footer">시뮬레이션 실적 · 가동률은 슬롯 점유율과 별개입니다. 목표값과 공정 조건은 예시입니다.</footer>
    </section>`;
    function render(state) {
      el.querySelector('.av-kpis').innerHTML = U.kpis(state);
      const flow = el.querySelector('.flow-map'), step = 186, width = state.stations.length * step + 8;
      flow.replaceChildren(); flow.setAttribute('viewBox', `0 0 ${width} 286`);
      state.stations.forEach((station, i) => {
        const x = 14 + i * step, y = 14, active = U.busy(station);
        if (i) S('path', { d: `M${x-26} 143 h18 m-6 -5 l6 5 -6 5`, fill:'none', stroke:'#5f8c9d', 'stroke-width':2 }, flow);
        S('rect', { x, y, width:160, height:257, rx:9, fill:'#193241', stroke:active?'#62918c':'#355465' }, flow);
        S('rect', { x:x+12, y:27, width:31, height:23, rx:5, fill:'#315264' }, flow);
        S('text', { x:x+27.5, y:43, 'text-anchor':'middle', fill:'#deebf2', 'font-size':11, 'font-weight':700 }, flow, station.code);
        S('text', { x:x+149, y:43, 'text-anchor':'end', fill:active?U.colors.busy:U.colors.muted, 'font-size':10 }, flow, active?'검사 중':'대기');
        S('text', { x:x+12, y:69, fill:'#e1edf3', 'font-size':12, 'font-weight':650 }, flow, station.name);
        S('text', { x:x+12, y:90, fill:U.colors.muted, 'font-size':10 }, flow, `슬롯 점유 ${U.occupied(station)} / ${station.capacity}`);
        station.slots.forEach((slot,j) => {
          const sx=x+12+(j%5)*27, sy=102+Math.floor(j/5)*22;
          S('rect',{x:sx,y:sy,width:22,height:17,rx:3,fill:slot.productId?U.slotColor(slot,state):'#274453',stroke:slot.reservedProductId?U.colors.waiting:'#486578','stroke-dasharray':slot.reservedProductId?'2 2':'none'},flow);
          S('text',{x:sx+11,y:sy+12,'text-anchor':'middle',fill:slot.productId?'#102432':'#8da8bb','font-size':8},flow,slot.productId?.slice(-3)||j+1);
        });
        S('text',{x:x+12,y:203,fill:U.colors.muted,'font-size':10},flow,`PC ${active} / ${station.pcs.length} 가동`);
        station.pcs.forEach((pc,j)=>S('rect',{x:x+12+(j%10)*13.5,y:214+Math.floor(j/10)*10,width:10,height:6,rx:1,fill:pc.state==='busy'?U.colors.busy:'#476274'},flow));
        S('text',{x:x+12,y:254,fill:station.queue.length?U.colors.waiting:U.colors.muted,'font-size':11},flow,`진입 대기 ${station.queue.length}`);
      });
      const util=el.querySelector('.flow-util'); util.replaceChildren(); util.setAttribute('viewBox','0 0 430 256');
      state.stations.forEach((station,i)=>{
        const y=10+i*29, ratio=station.utilization||0;
        S('text',{x:0,y:y+13,fill:'#c0d4df','font-size':11},util,station.code);
        S('rect',{x:55,y,width:310,height:16,rx:4,fill:'#284150'},util);
        S('rect',{x:55,y,width:310*ratio,height:16,rx:4,fill:'#5cc6b0'},util);
        S('text',{x:421,y:y+13,'text-anchor':'end',fill:'#bad0dd','font-size':11},util,`${(ratio*100).toFixed(1)}%`);
      });
      const chart=el.querySelector('.flow-trend'); chart.replaceChildren();
      const target=root.FACTORY_DATA.line.targetUph, history=state.metrics;
      const max=Math.ceil(Math.max(target,...history.map(p=>p.uph),1)/50)*50;
      const end=Math.max(60,state.simTimeSec),start=Math.max(0,end-1800);
      const X=t=>44+(t-start)/(end-start)*390, Y=v=>220-v/max*190;
      for(let t=0;t<=4;t++){
        const value=max*t/4,y=Y(value);
        S('line',{x1:44,y1:y,x2:434,y2:y,stroke:'#2b4557'},chart);
        S('text',{x:37,y:y+4,'text-anchor':'end',fill:U.colors.muted,'font-size':10},chart,Math.round(value));
        S('text',{x:X(start+(end-start)*t/4),y:244,'text-anchor':'middle',fill:U.colors.muted,'font-size':10},chart,U.clock(start+(end-start)*t/4));
      }
      S('line',{x1:44,y1:Y(target),x2:434,y2:Y(target),stroke:'#a68a56','stroke-dasharray':'4 5'},chart);
      S('text',{x:433,y:Y(target)-7,'text-anchor':'end',fill:'#c4aa78','font-size':10},chart,`예시 목표 ${target}`);
      const visible=history.filter(p=>p.time>=start);
      if(visible.length>1){
        const points=visible.map(p=>`${X(p.time)},${Y(p.uph)}`).join(' ');
        S('polygon',{points:`${X(visible[0].time)},220 ${points} ${X(visible.at(-1).time)},220`,fill:'#4dc5ab',opacity:.09},chart);
        S('polyline',{points,fill:'none',stroke:'#65d7be','stroke-width':2.5},chart);
      }
      if(!state.kpis.passed) S('text',{x:235,y:142,'text-anchor':'middle',fill:'#8da8bb','font-size':12},chart,'최종 공정 통과 후 생산량이 집계됩니다');
      const queues=state.stations.filter(s=>s.queue.length).sort((a,b)=>b.queue.length-a.queue.length);
      el.querySelector('.flow-queue').textContent=queues.length?`진입 대기 최다 · ${queues[0].code} ${queues[0].queue.length}개`:'진입 대기열 없음';
      el.querySelector('.flow-events ol').innerHTML=state.events.slice(0,10).map(e=>`<li><time>${U.clock(e.time)}</time><i class="${e.type}"></i><span>${U.escape(e.message)}</span></li>`).join('')||'<li class="av-empty">첫 제품 투입을 기다립니다</li>';
    }
    const unsubscribe=api.subscribe(render); render(api.getState()); return unsubscribe;
  });
})(window);

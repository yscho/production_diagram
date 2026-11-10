(function(root) {
  'use strict';
  const U=root.AVNUI;
  U.register('05',function(el,api){
    el.innerHTML=`<section class="av-view av-andon">${U.header('05 / LIVE ANDON','검사라인 안돈 보드','슬롯별 점유 · PC별 검사 진행 · 공정별 검사 수율','<span class="andon-live"><i></i>공통 라인 상태</span>')}<div class="av-kpis"></div>${U.legend}<div class="andon-board"></div><footer class="av-footer andon-event"></footer></section>`;
    function render(state){
      el.querySelector('.av-kpis').innerHTML=U.kpis(state);
      el.querySelector('.andon-live').classList.toggle('paused',state.paused);
      el.querySelector('.andon-live').lastChild.textContent=`${state.paused?'일시정지':'시뮬레이션 진행'} · ${U.clock(state.simTimeSec)}`;
      el.querySelector('.andon-board').innerHTML=state.stations.map(station=>{
        const used=U.occupied(station),busy=U.busy(station),reserved=station.slots.filter(s=>s.reservedProductId).length;
        const recent=state.inspections.filter(r=>r.stationId===station.id&&r.end!==null).at(-1);
        const failure=recent?.result==='fail'&&state.simTimeSec-recent.end<4;
        const status=failure?'최근 검사 불량':busy?'검사 중':used?'이송·검사 대기':'대기';
        return `<article class="andon-card ${failure?'has-failure':''}">
          <header><span class="andon-code">${U.escape(station.code)}</span><div><h2>${U.escape(station.name)}</h2><small>기준 검사 시간 ${station.cycleTimeSec}초 · 예시</small></div><span class="andon-state ${failure?'fail':busy?'busy':'idle'}"><i></i>${status}</span></header>
          <div class="andon-stats"><div><span>슬롯 점유</span><b>${used}<small> / ${station.capacity}</small></b></div><div><span>PC 검사 중</span><b>${busy}<small> / ${station.pcs.length}</small></b></div><div><span>진입 대기</span><b>${station.queue.length}</b></div><div><span>검사 수율</span><b>${U.yieldText(station.completed,station.failed)}</b></div></div>
          <div class="andon-section-title">슬롯 배치 <span>${reserved?`이송 예약 ${reserved}`:'번호: 점유 제품 / 빈 슬롯'}</span></div>
          <div class="andon-slots">${station.slots.map((slot,j)=>{
            const color=slot.productId?U.slotColor(slot,state):'#47697c';
            return `<div class="andon-slot ${slot.productId?'occupied':''} ${slot.reservedProductId?'reserved':''}" style="--slot:${color}" title="슬롯 ${j+1}: ${U.escape(slot.productId||slot.reservedProductId||'비어 있음')}"><small>${String(j+1).padStart(2,'0')}</small><b>${slot.productId?slot.productId.slice(-4):slot.reservedProductId?'예약':'—'}</b></div>`;
          }).join('')}</div>
          <div class="andon-section-title">검사 PC <span>실제 경과 / 예정 시간</span></div>
          <div class="andon-pcs">${station.pcs.map((pc,j)=>{
            const active=pc.state==='busy',percent=U.progress(pc,state.simTimeSec)*100;
            return `<div class="andon-pc ${active?'active':''}" title="${U.escape(pc.id)}"><span><i></i>PC ${j+1}</span><b>${active?U.escape(pc.productId.slice(-4)):'대기'}</b><div class="pc-progress"><i style="width:${percent}%"></i></div><small>${active?`${Math.max(0,Math.ceil(pc.completesAt-state.simTimeSec))}초 남음`:'검사 준비'}</small></div>`;
          }).join('')}</div>
          <footer><span>검사 통과 <b>${station.completed}</b> · 불량 <b>${station.failed}</b></span><span>누적 PC 가동률 <b>${(station.utilization*100).toFixed(1)}%</b></span></footer>
        </article>`;
      }).join('');
      const event=state.events[0];
      el.querySelector('.andon-event').textContent=event?`최근 이벤트  ${U.clock(event.time)} · ${event.message}`:'첫 제품 투입을 기다립니다. 수율은 검사 실적이 생긴 뒤 표시됩니다.';
    }
    const unsubscribe=api.subscribe(render);render(api.getState());return unsubscribe;
  });
})(window);

(function(root){
  'use strict';
  const U=root.AVNUI;
  U.register('06',function(el,api){
    el.innerHTML=`<section class="av-view av-gantt">${U.header('06 / INSPECTION TIMELINE','PC별 검사 이력','막대 클릭: 제품 경로 강조 · 좌우 드래그: 시간 이동 · 목록을 스크롤해 전체 PC 확인','<label>표시 구간 <select class="gantt-range"><option value="60">1분</option><option value="300" selected>5분</option><option value="900">15분</option><option value="1800">30분</option></select></label><button class="gantt-live">현재 시각</button><button class="gantt-clear">선택 해제</button>')}<div class="gantt-summary"></div><div class="gantt-axis-wrap"><canvas class="gantt-axis" aria-label="검사 시간축"></canvas></div><div class="gantt-scroll"><canvas class="gantt-body" aria-label="단계별 PC 검사 간트 막대"></canvas></div><div class="gantt-legend"><span style="--dot:#e9b956">검사 중</span><span style="--dot:#5bd4b1">통과</span><span style="--dot:#f27f84">불량</span><span style="--dot:#e1f2fa">선택 제품</span><p class="gantt-selection">막대를 선택하면 같은 제품의 공정 이동을 확인할 수 있습니다.</p></div><footer class="av-footer">공통 엔진의 검사 시작·종료 시각으로 그립니다. 최근 3,000회 검사를 보관하며 탭 전환 중에도 기록됩니다.</footer><div class="av-tip" hidden></div></section>`;
    const canvas=el.querySelector('.gantt-body'),axis=el.querySelector('.gantt-axis'),ctx=canvas.getContext('2d'),ax=axis.getContext('2d'),scroll=canvas.parentElement,tip=el.querySelector('.av-tip');
    let state=api.getState(),width=1,labelW=200,range=300,endTime=null,selected=null,hitBars=[],drag=null,wasDrag=false;
    function setup(c,context,w,h){const dpr=Math.min(2,devicePixelRatio||1);if(c.width!==Math.round(w*dpr)||c.height!==Math.round(h*dpr)){c.width=Math.round(w*dpr);c.height=Math.round(h*dpr);c.style.height=h+'px';}context.setTransform(dpr,0,0,dpr,0,0);context.clearRect(0,0,w,h);}
    function truncate(text,max){let result=text;while(ctx.measureText(result).width>max&&result.length)result=result.slice(0,-1);return result===text?text:result+'…';}
    function draw(){
      width=Math.max(1,scroll.clientWidth);labelW=width<700?155:205;
      const end=endTime??Math.max(range,state.simTimeSec),start=Math.max(0,end-range),timeW=Math.max(80,width-labelW-18),X=t=>labelW+(t-start)/range*timeW;
      const height=state.stations.reduce((sum,st)=>sum+36+st.pcs.length*25+8,0)+24;
      setup(canvas,ctx,width,height);setup(axis,ax,width,40);
      ctx.fillStyle='#0f2230';ctx.fillRect(0,0,width,height);ax.fillStyle='#1b3445';ax.fillRect(0,0,width,40);
      ax.font='11px system-ui';ax.textAlign='left';ax.fillStyle='#aac4d2';ax.fillText('공정 / 검사 PC',14,25);
      ctx.font='10px system-ui';
      for(let tick=0;tick<=6;tick++){
        const t=start+range*tick/6,x=X(t);
        ax.fillStyle='#a5bfce';ax.textAlign=tick===0?'left':tick===6?'right':'center';ax.fillText(U.clock(t),x,25);
        ctx.strokeStyle='#284252';ctx.beginPath();ctx.moveTo(x,0);ctx.lineTo(x,height);ctx.stroke();
      }
      let y=0;hitBars=[];
      const byPC=new Map();state.inspections.forEach(record=>{const key=record.stationId+':'+record.pcId;if(!byPC.has(key))byPC.set(key,[]);byPC.get(key).push(record);});
      state.stations.forEach(st=>{
        ctx.fillStyle='#1c3647';ctx.fillRect(0,y,width,34);
        ctx.font='600 11px system-ui';ctx.fillStyle='#cfdfE8';ctx.fillText(truncate(`${st.code} · ${st.name}`,labelW-22),12,y+14);
        ctx.fillStyle='#385466';ctx.fillRect(12,y+22,labelW-85,4);ctx.fillStyle='#60cbb4';ctx.fillRect(12,y+22,(labelW-85)*U.occupied(st)/st.capacity,4);
        ctx.font='9px system-ui';ctx.fillStyle='#8eacbd';ctx.fillText(`${U.occupied(st)}/${st.capacity}`,labelW-62,y+27);
        ctx.fillText(`PC ${U.busy(st)}/${st.pcs.length} 가동  ·  누적 가동률 ${(st.utilization*100).toFixed(0)}%`,labelW+8,y+21);
        y+=36;
        st.pcs.forEach((pc,index)=>{
          ctx.fillStyle=index%2?'#132938':'#112532';ctx.fillRect(labelW,y,timeW,24);
          ctx.fillStyle='#19303f';ctx.fillRect(0,y,labelW-1,24);
          ctx.font='10px system-ui';ctx.fillStyle=pc.state==='busy'?'#e2bf72':'#8aa8ba';ctx.fillText(`PC ${String(index+1).padStart(2,'0')}`,22,y+16);
          ctx.fillStyle=pc.state==='busy'?'#e9b956':'#456779';ctx.beginPath();ctx.arc(12,y+12,2.5,0,Math.PI*2);ctx.fill();
          ctx.save();ctx.beginPath();ctx.rect(labelW,y,timeW,24);ctx.clip();
          (byPC.get(st.id+':'+pc.id)||[]).forEach(record=>{
            const stop=record.end??state.simTimeSec;if(stop<start||record.start>end)return;
            const x=Math.max(labelW,X(record.start)),right=Math.min(labelW+timeW,X(stop)),w=Math.max(2,right-x),chosen=selected===record.productId;
            const color=record.end===null?U.colors.busy:record.result==='fail'?U.colors.fail:U.colors.pass;
            ctx.globalAlpha=selected && !chosen ? .25 : 1;
            ctx.fillStyle=color;ctx.beginPath();ctx.roundRect(x,y+4,w,16,3);ctx.fill();
            if(chosen){ctx.strokeStyle='#e1f2fa';ctx.lineWidth=2;ctx.strokeRect(x,y+3,w,18);}
            if(w>46){ctx.font='9px system-ui';ctx.fillStyle='#112936';ctx.fillText(record.productId.slice(-4)+(record.retest?' ↻':''),x+4,y+16);}
            if(record.end===null&&record.plannedEnd>state.simTimeSec){ctx.strokeStyle=color;ctx.setLineDash([3,3]);ctx.strokeRect(right,y+5,Math.max(0,Math.min(labelW+timeW,X(record.plannedEnd))-right),14);ctx.setLineDash([]);}
            ctx.globalAlpha=1;hitBars.push({x,y:y+3,w,h:19,record});
          });
          ctx.restore();y+=25;
        });y+=8;
      });
      if(state.simTimeSec>=start&&state.simTimeSec<=end){const x=X(state.simTimeSec);ctx.strokeStyle='#bdd8e5';ctx.setLineDash([3,4]);ctx.beginPath();ctx.moveTo(x,0);ctx.lineTo(x,height);ctx.stroke();ctx.setLineDash([]);ax.fillStyle='#80d5c1';ax.beginPath();ax.moveTo(x-4,33);ax.lineTo(x+4,33);ax.lineTo(x,39);ax.fill();}
      if(!state.inspections.length){ctx.fillStyle='#b3c8d5';ctx.font='12px system-ui';ctx.fillText('첫 검사가 시작되면 시간축에 기록됩니다.',labelW+20,64);}
      const busy=state.pcs.filter(pc=>pc.state==='busy').length,used=state.stations.reduce((n,st)=>n+U.occupied(st),0),capacity=state.stations.reduce((n,st)=>n+st.capacity,0);
      el.querySelector('.gantt-summary').innerHTML=`<span>검사 PC <b>${busy} / ${state.pcs.length}</b><i style="--ratio:${100*busy/Math.max(1,state.pcs.length)}%"></i></span><span>슬롯 점유 <b>${used} / ${capacity}</b><i style="--ratio:${100*used/Math.max(1,capacity)}%"></i></span><span>기록 <b>${state.inspections.length}회</b></span><span class="gantt-mode">${endTime===null?'현재 시각 추적':'이전 구간 탐색'} · ${U.clock(start)}–${U.clock(end)}</span>`;
      const records=state.inspections.filter(r=>r.productId===selected),route=[...new Set(records.map(r=>state.stations.find(st=>st.id===r.stationId)?.code||r.stationId))];
      el.querySelector('.gantt-selection').textContent=selected?`${selected} · ${route.join(' → ')} · ${records.length}회 검사`:'막대를 선택하면 같은 제품의 공정 이동을 확인할 수 있습니다.';
      canvas.dataset.barCount=hitBars.length;canvas.dataset.selectedProduct=selected||'';
    }
    function hit(e){const r=canvas.getBoundingClientRect(),x=e.clientX-r.left,y=e.clientY-r.top;return hitBars.findLast(b=>x>=b.x&&x<=b.x+b.w&&y>=b.y&&y<=b.y+b.h);}
    const down=e=>{drag={x:e.clientX,end:endTime??Math.max(range,state.simTimeSec)};wasDrag=false;canvas.setPointerCapture(e.pointerId);};
    const move=e=>{
      if(drag){const dx=e.clientX-drag.x;if(Math.abs(dx)>4){wasDrag=true;endTime=Math.max(range,Math.min(Math.max(range,state.simTimeSec),drag.end-dx/(width-labelW-18)*range));tip.hidden=true;draw();}return;}
      const bar=hit(e);tip.hidden=!bar;canvas.style.cursor=bar?'pointer':'ew-resize';
      if(bar){const record=bar.record,r=el.firstElementChild.getBoundingClientRect();tip.innerHTML=`<b>${U.escape(record.productId)} · ${U.escape(record.pcId)}</b><br>${U.clock(record.start)} → ${record.end===null?'검사 중':U.clock(record.end)}<br>${(Math.max(0,(record.end??state.simTimeSec)-record.start)).toFixed(1)}초 · ${record.end===null?'진행':record.result==='fail'?'불량':'통과'}${record.retest?' · 재검사':''}`;tip.style.left=Math.min(r.width-235,e.clientX-r.left+12)+'px';tip.style.top=Math.max(0,e.clientY-r.top-80)+'px';}
    };
    const up=()=>drag=null;
    const click=e=>{if(wasDrag)return;const bar=hit(e);selected=bar?(selected===bar.record.productId?null:bar.record.productId):null;draw();};
    canvas.addEventListener('pointerdown',down);canvas.addEventListener('pointermove',move);canvas.addEventListener('pointerup',up);canvas.addEventListener('pointercancel',up);canvas.addEventListener('click',click);canvas.addEventListener('pointerleave',()=>tip.hidden=true);
    el.querySelector('.gantt-range').addEventListener('change',e=>{range=Number(e.target.value);if(endTime!==null)endTime=Math.max(range,endTime);draw();});el.querySelector('.gantt-live').addEventListener('click',()=>{endTime=null;draw();});el.querySelector('.gantt-clear').addEventListener('click',()=>{selected=null;draw();});
    const observer=U.observeSize(scroll,draw);
    const unsubscribe=api.subscribe(s=>{if(s.simTimeSec<state.simTimeSec){selected=null;endTime=null;}state=s;draw();});draw();
    return ()=>{unsubscribe();observer.disconnect();};
  });
})(window);

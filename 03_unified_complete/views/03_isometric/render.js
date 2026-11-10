(function(root) {
  'use strict';
  const U=root.AVNUI;
  U.register('03',function(el,api){
    el.innerHTML=`<section class="av-view av-iso">${U.header('03 / ISOMETRIC FACTORY','검사 셀 입체 배치','드래그로 이동 · 휠로 확대 · 셀 위에 마우스를 올려 상세 확인','<button class="iso-fit">전체 보기</button>')}<div class="av-canvas-wrap"><canvas aria-label="지그와 PC 랙을 표시하는 아이소메트릭 공장"></canvas><div class="av-tip" hidden></div></div>${U.legend}<div class="av-kpis"></div><footer class="av-footer">셀·지그·PC 랙의 배치는 공정 상태를 설명하기 위한 예시입니다. 7번에서 로봇의 실제 이송 순서를 볼 수 있습니다.</footer></section>`;
    const canvas=el.querySelector('canvas'),ctx=canvas.getContext('2d'),wrap=canvas.parentElement,tip=el.querySelector('.av-tip');
    let state=api.getState(),width=1,height=1,scale=1,originX=0,originY=0,zoom=1,panX=0,panY=0,drag=null,hover=null,cells=[],hits=[];
    // Legacy 03 projection and three-face cuboids; independent simulation removed.
    function P(x,y,z=0){return [originX+(x-y)*scale,originY+(x+y)*scale*.5-z*scale*1.2];}
    function shade(hex,f){const n=parseInt(hex.slice(1),16);return `rgb(${[n>>16,(n>>8)&255,n&255].map(v=>Math.round(f>0?v+(255-v)*f:v*(1+f))).join(',')})`;}
    function poly(points,fill,stroke){ctx.beginPath();points.forEach((p,i)=>i?ctx.lineTo(...p):ctx.moveTo(...p));ctx.closePath();if(fill){ctx.fillStyle=fill;ctx.fill();}if(stroke){ctx.strokeStyle=stroke;ctx.lineWidth=.8;ctx.stroke();}}
    function quad(x,y,w,d,z){return [P(x,y,z),P(x+w,y,z),P(x+w,y+d,z),P(x,y+d,z)];}
    function line(a,b,color,lw=1){ctx.beginPath();ctx.moveTo(...P(...a));ctx.lineTo(...P(...b));ctx.strokeStyle=color;ctx.lineWidth=lw;ctx.stroke();}
    function box(x,y,z,w,d,h,col){poly([P(x,y+d,z),P(x+w,y+d,z),P(x+w,y+d,z+h),P(x,y+d,z+h)],col,'#0e1d2880');poly([P(x+w,y,z),P(x+w,y+d,z),P(x+w,y+d,z+h),P(x+w,y,z+h)],shade(col,-.28),'#0e1d2880');poly(quad(x,y,w,d,z+h),shade(col,.14),'#0e1d2880');}
    function inside(point,polygon){let c=false;for(let i=0,j=polygon.length-1;i<polygon.length;j=i++){const a=polygon[i],b=polygon[j];if((a[1]>point[1])!==(b[1]>point[1])&&point[0]<(b[0]-a[0])*(point[1]-a[1])/(b[1]-a[1])+a[0])c=!c;}return c;}
    function draw(){
      const cols=Math.ceil(state.stations.length/2),maxX=cols*13,maxY=25;
      cells=state.stations.map((station,i)=>({station,x:(i%cols)*13,y:i<cols?0:15}));
      scale=Math.min((width-95)/(maxX+maxY+3),(height-95)/((maxX+maxY+3)*.5+6))*zoom;
      originX=width/2-(maxX-maxY)*scale*.5+panX;originY=height/2-(maxX+maxY)*scale*.25+35+panY;
      ctx.clearRect(0,0,width,height);ctx.fillStyle='#0d1d29';ctx.fillRect(0,0,width,height);
      poly(quad(-2,-2,maxX+3,maxY+2,0),'#152c3b','#2a4a5c');
      for(let x=-2;x<=maxX+1;x+=2)line([x,-2,0],[x,maxY,0],'#274454',.5);
      for(let y=-2;y<=maxY;y+=2)line([-2,y,0],[maxX+1,y,0],'#274454',.5);
      const objects=[]; const add=(x,y,z,w,d,h,c)=>objects.push({order:x+y+(w+d)*.5,draw:()=>box(x,y,z,w,d,h,c)});
      // A continuous raised conveyor, moving rollers locked to simulation time.
      add(-1,10,.05,maxX,3,.8,'#314959');
      objects.push({order:maxX*.5+11.5,draw:()=>{
        for(let x=-.5+(state.simTimeSec*.8)%1;x<maxX-1;x++)line([x,10.15,.87],[x,12.85,.87],'#64838f',1);
        line([-1,10,.98],[maxX-1,10,.98],'#a5b9c2',2);line([-1,13,.98],[maxX-1,13,.98],'#a5b9c2',2);
      }});
      hits=[];
      cells.forEach(({station,x,y})=>{
        poly(quad(x-.5,y-.7,11.5,9.4,.01),hover===station.id?'#2a575d':'#1f3b4c',hover===station.id?'#81d4c3':'#477083');
        line([x,y+8.3,.02],[x+10.5,y+8.3,.02],'#bfa65c',2);
        hits.push({station,polygon:quad(x-.5,y-.7,11.5,9.4,0)});
        objects.push({order:-1000+x+y,draw:()=>box(x,y+2.8,0,10.5,4.9,.7,'#324d5b')});
        station.slots.forEach((slot,j)=>{
          const sx=x+.3+j%5*2.05,sy=y+3.1+Math.floor(j/5)*1.1;
          add(sx,sy,.7,1.65,.83,.22,'#5a7380');
          objects.push({order:sx+sy+1.4,draw:()=>{
            poly(quad(sx+.1,sy+.1,1.45,.63,.93),slot.productId?'#1a303d':'#233c49',slot.reservedProductId?U.colors.waiting:'#7494a4');
            box(sx+.1,sy+.1,.94,.12,.12,.08,'#becbd0');box(sx+1.4,sy+.6,.94,.12,.12,.08,'#becbd0');
            if(slot.productId){box(sx+.15,sy+.12,.94,1.35,.6,.11,'#9a8869');box(sx+.3,sy+.2,1.05,1,.4,.22,U.slotColor(slot,state));}
          }});
        });
        objects.push({order:-900+x+y,draw:()=>box(x+.3,y+.2,0,9.8,1.5,1.1,'#3c5363')});
        station.pcs.forEach((pc,j)=>{
          const columns=Math.min(10,station.pcs.length),px=x+.45+j%columns*(9.4/columns),pz=1.3+Math.floor(j/columns)*1.05,pw=Math.min(1.5,8.6/columns);
          add(px,y+.8,pz,pw,.2,.83,'#192f3b');
          objects.push({order:px+y+2,draw:()=>{
            poly([P(px+.06,y+1.01,pz+.12),P(px+pw-.06,y+1.01,pz+.12),P(px+pw-.06,y+1.01,pz+.7),P(px+.06,y+1.01,pz+.7)],pc.state==='busy'?shade(U.colors.busy,-.35):'#405f70');
            if(pc.state==='busy')line([px+.06,y+1.02,pz+.2],[px+.06+(pw-.12)*U.progress(pc,state.simTimeSec),y+1.02,pz+.2],U.colors.busy,2);
          }});
        });
        // Reject tote and feeder junction are kept from the legacy cell vocabulary.
        add(x+10,y+7.4,0,.7,.8,.6,'#70424b');
        const junctionY=y===0?8.2:13; add(x+4.5,junctionY,0,1.6,1.8,.65,'#425d6b');
      });
      const moving=state.products.filter(p=>p.slotIndex==null && p.state!=='queued');
      moving.forEach((product,i)=>{
        let x=(i+1)/(moving.length+1)*(maxX-2),y=11.3;
        if(product.transfer){const a=cells.find(c=>c.station.id===product.transfer.from),b=cells.find(c=>c.station.id===product.transfer.to);if(a&&b){const t=Math.min(1,(state.simTimeSec-product.transfer.startedAt)/(product.transfer.completesAt-product.transfer.startedAt));x=a.x+5+(b.x-a.x)*t;}}
        add(x,y,.9,1.2,.75,.15,'#a08e6c');add(x+.13,y+.1,1.05,.94,.55,.3,U.colors.waiting);
      });
      objects.sort((a,b)=>a.order-b.order).forEach(o=>o.draw());
      cells.forEach(({station,x,y})=>{
        const p=P(x+5,y-.2,3.2),text=`${station.code} · ${station.name}`;
        ctx.font='600 12px system-ui';const w=Math.max(ctx.measureText(text).width+22,120);
        ctx.fillStyle='#102a39ed';ctx.strokeStyle=hover===station.id?'#7fd7c4':'#426577';ctx.beginPath();ctx.roundRect(p[0]-w/2,p[1]-22,w,41,5);ctx.fill();ctx.stroke();
        ctx.fillStyle='#dcebf2';ctx.textAlign='center';ctx.fillText(text,p[0],p[1]-6);ctx.font='10px system-ui';ctx.fillStyle='#9db7c7';ctx.fillText(`점유 ${U.occupied(station)}/${station.capacity}   PC ${U.busy(station)}/${station.pcs.length}`,p[0],p[1]+10);
      });
      ctx.textAlign='left';ctx.fillStyle='#88a8b9';ctx.font='11px system-ui';ctx.fillText(`확대 ${Math.round(zoom*100)}% · ${U.clock(state.simTimeSec)}`,16,height-15);
      canvas.dataset.cells=String(cells.length);canvas.dataset.fit=zoom===1&&panX===0&&panY===0?'true':'false';
    }
    function resize(){const rect=wrap.getBoundingClientRect();width=Math.max(1,rect.width);height=Math.max(1,rect.height);const dpr=Math.min(2,devicePixelRatio||1);canvas.width=width*dpr;canvas.height=height*dpr;ctx.setTransform(dpr,0,0,dpr,0,0);draw();}
    function fit(){zoom=1;panX=panY=0;draw();}
    const move=event=>{const rect=canvas.getBoundingClientRect(),x=event.clientX-rect.left,y=event.clientY-rect.top;if(drag){panX+=event.clientX-drag.x;panY+=event.clientY-drag.y;drag={x:event.clientX,y:event.clientY};tip.hidden=true;draw();return;}const hit=hits.findLast(h=>inside([x,y],h.polygon));const next=hit?.station.id||null;if(next!==hover){hover=next;draw();}tip.hidden=!hit;if(hit){const s=hit.station;tip.innerHTML=`<b>${U.escape(s.name)}</b><br>점유 ${U.occupied(s)}/${s.capacity} · 검사 ${U.busy(s)}/${s.pcs.length}<br>통과 ${s.completed} · 불량 ${s.failed} · 진입 대기 ${s.queue.length}`;tip.style.left=Math.min(width-230,x+14)+'px';tip.style.top=Math.max(0,Math.min(height-95,y+14))+'px';}};
    const down=e=>{drag={x:e.clientX,y:e.clientY};canvas.setPointerCapture(e.pointerId);};
    const up=()=>{drag=null;};const leave=()=>{tip.hidden=true;hover=null;if(!drag)draw();};
    const wheel=e=>{e.preventDefault();zoom=Math.min(3,Math.max(.6,zoom*Math.exp(-e.deltaY*.001)));draw();};
    canvas.addEventListener('pointerdown',down);canvas.addEventListener('pointermove',move);canvas.addEventListener('pointerup',up);canvas.addEventListener('pointercancel',up);canvas.addEventListener('pointerleave',leave);canvas.addEventListener('wheel',wheel,{passive:false});canvas.addEventListener('dblclick',fit);el.querySelector('.iso-fit').addEventListener('click',fit);
    const observer=U.observeSize(wrap,resize);
    const render=s=>{state=s;el.querySelector('.av-kpis').innerHTML=U.kpis(s);draw();};const unsubscribe=api.subscribe(render);render(state);resize();
    return ()=>{unsubscribe();observer.disconnect();canvas.removeEventListener('wheel',wheel);};
  });
})(window);

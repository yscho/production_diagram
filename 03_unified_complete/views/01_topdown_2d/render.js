(function(root){
  'use strict';
  const U=root.AVNUI, S=U.svg;
  U.register('01',function(el,api){
    el.innerHTML=`<section class="av-view av-topdown">${U.header('01 / FLOOR OPERATIONS','검사라인 평면도','슬롯 안의 번호는 실제 점유 제품입니다. 이송 중인 제품은 중앙 레인에 표시합니다.')}${U.legend}<div class="td-layout"><svg role="img" aria-label="스테이션 슬롯과 검사 PC 평면도"></svg><aside class="av-panel"><h2>라인 현황</h2><div class="td-kpis"></div><h2>스테이션 상태</h2><div class="td-status"></div></aside></div></section>`;
    const svg=el.querySelector('svg');
    function render(state){
      svg.replaceChildren();
      const cols=Math.ceil(state.stations.length/2),width=cols*300+40;
      svg.setAttribute('viewBox',`0 0 ${width} 650`);
      S('rect',{x:8,y:8,width:width-16,height:634,rx:14,fill:'#122735',stroke:'#355063'},svg);
      S('rect',{x:22,y:284,width:width-44,height:66,rx:9,fill:'#263e4c',stroke:'#577282'},svg);
      S('path',{d:`M36 317 H${width-36}`,stroke:'#97b1bf','stroke-dasharray':'8 12','stroke-width':2},svg);
      for(let x=70;x<width-30;x+=140)S('path',{d:`M${x} 307 l12 10 -12 10`,fill:'none',stroke:'#607f91','stroke-width':2},svg);
      S('text',{x:30,y:274,fill:U.colors.muted,'font-size':11},svg,'컨베이어 · 이송 중인 제품');
      state.stations.forEach((station,index)=>{
        const x=26+(index%cols)*300,y=index<cols?36:380,w=280;
        const g=S('g',{},svg), used=U.occupied(station), active=U.busy(station);
        S('rect',{x,y,width:w,height:216,rx:9,fill:'#1a3242',stroke:active?'#5c948e':'#355365'},g);
        S('text',{x:x+14,y:y+24,fill:'#e3f0f5','font-size':13,'font-weight':700},g,`${station.code} · ${station.name}`);
        S('text',{x:x+14,y:y+43,fill:U.colors.muted,'font-size':10},g,`점유 ${used}/${station.capacity}  ·  검사 ${active}/${station.pcs.length}  ·  대기 ${station.queue.length}`);
        station.slots.forEach((slot,j)=>{
          const sx=x+14+(j%5)*28,sy=y+63+Math.floor(j/5)*26;
          S('rect',{x:sx,y:sy,width:23,height:19,rx:3,fill:slot.productId?U.slotColor(slot,state):'#223f50',stroke:slot.reservedProductId?'#83b9ee':'#506c7e','stroke-dasharray':slot.reservedProductId?'3 2':'none'},g);
          S('text',{x:sx+11.5,y:sy+13,'text-anchor':'middle','font-size':8,fill:slot.productId?'#142736':'#7b99aa'},g,slot.productId?.slice(-3)||String(j+1).padStart(2,'0'));
        });
        const pcCols=station.pcs.length>12?4:3;
        const pcGap=pcCols===4?22:29, pcRow=pcCols===4?26:31, pcW=pcCols===4?17:22, pcH=pcCols===4?11:14;
        station.pcs.forEach((pc,j)=>{
          const px=x+177+(j%pcCols)*pcGap,py=y+64+Math.floor(j/pcCols)*pcRow;
          S('rect',{x:px,y:py,width:pcW,height:pcH,rx:2,fill:'#0e1d28',stroke:'#5d7e91','data-pc-id':pc.id},g);
          S('rect',{x:px+3,y:py+3,width:pcW-6,height:pcH-6,fill:pc.state==='busy'?U.colors.busy:'#466575'},g);
          S('path',{d:`M${px+pcW/2} ${py+pcH} v4 m-7 0 h14`,stroke:'#718f9f','stroke-width':2},g);
          S('text',{x:px+pcW/2,y:py+pcH+12,'text-anchor':'middle','font-size':7,fill:U.colors.muted},g,`PC${j+1}`);
        });
        S('text',{x:x+14,y:y+197,fill:'#79c5b5','font-size':10},g,`통과 ${station.completed} · 불량 ${station.failed}`);
        S('line',{x1:x+w/2,y1:index<cols?y+216:350,x2:x+w/2,y2:index<cols?284:y,stroke:'#5a8295','stroke-width':3},svg);
      });
      const moving=state.products.filter(p=>p.slotIndex==null && ['conveyor','robot_transfer','waiting_pickup'].includes(p.state));
      moving.forEach((product,index)=>{
        let position=(index+1)/(moving.length+1);
        if(product.transfer){const from=state.stations.findIndex(st=>st.id===product.transfer.from),to=state.stations.findIndex(st=>st.id===product.transfer.to);const t=Math.min(1,(state.simTimeSec-product.transfer.startedAt)/(product.transfer.completesAt-product.transfer.startedAt));position=((from%cols)*(1-t)+(to%cols)*t+.5)/cols;}
        const x=35+(width-100)*position, palletW=Math.min(44,(width-100)/Math.max(1,moving.length)*.85);
        S('rect',{x,y:302,width:palletW,height:28,rx:4,fill:U.colors.waiting,stroke:'#c0dff5'},svg);
        S('text',{x:x+palletW/2,y:320,'text-anchor':'middle',fill:'#123042','font-size':10},svg,product.id.slice(-4));
      });
      S('text',{x:30,y:627,fill:'#b98992','font-size':11},svg,`리젝트 배출 · 누적 ${state.kpis.failed}개`);
      S('path',{d:`M240 623 H${width-30}`,stroke:'#61404b','stroke-width':14,'stroke-dasharray':'14 7'},svg);
      el.querySelector('.td-kpis').innerHTML=U.kpis(state);
      el.querySelector('.td-status').innerHTML=state.stations.map(st=>`<div><b>${U.escape(st.code)}</b><span>${U.busy(st)?'검사 중':'대기'}</span><strong>${U.occupied(st)}/${st.capacity}</strong></div>`).join('');
    }
    const unsubscribe=api.subscribe(render);render(api.getState());return unsubscribe;
  });
})(window);

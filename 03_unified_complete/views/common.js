(function(root) {
  'use strict';
  const colors={idle:'#526b7c',busy:'#e9b956',pass:'#5bd4b1',fail:'#f27f84',waiting:'#83b9ee',panel:'#192d3d',line:'#355063',text:'#e0edf4',muted:'#8da8bb'};
  const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const clock=value=>`${Math.floor(value/60).toString().padStart(2,'0')}:${Math.floor(value%60).toString().padStart(2,'0')}`;
  const occupied=station=>station.slots.filter(slot=>slot.productId).length;
  const busy=station=>station.pcs.filter(pc=>pc.state==='busy').length;
  function progress(pc,time){return pc.state==='busy'?Math.min(1,Math.max(0,(time-pc.startedAt)/Math.max(.01,pc.completesAt-pc.startedAt))):0;}
  function yieldText(passed,failed){return passed+failed?(100*passed/(passed+failed)).toFixed(1)+'%':'—';}
  function kpis(state){return [['누적 통과',state.kpis.passed],['누적 불량',state.kpis.failed],['라인 내 제품',state.kpis.wip],['시간당 생산',state.kpis.uph.toFixed(1)+' UPH'],['완료 수율',yieldText(state.kpis.passed,state.kpis.failed)]].map(([name,value])=>`<div class="av-metric"><span>${name}</span><b>${value}</b></div>`).join('');}
  function header(kicker,title,hint,tools=''){return `<header class="av-heading"><div><small>${kicker}</small><h1>${title}</h1><p>${hint}</p></div><div class="av-tools">${tools}</div></header>`;}
  const legend='<div class="av-legend"><span style="--dot:#e9b956">검사 중</span><span style="--dot:#5bd4b1">검사 완료</span><span style="--dot:#83b9ee">대기·이송</span><span style="--dot:#526b7c">빈 슬롯</span></div>';
  function svg(tag,attrs,parent,text){const node=document.createElementNS('http://www.w3.org/2000/svg',tag);Object.entries(attrs||{}).forEach(([k,v])=>node.setAttribute(k,v));if(text!=null)node.textContent=text;parent.appendChild(node);return node;}
  function slotColor(slot,state){if(!slot.productId)return slot.reservedProductId?colors.waiting:colors.idle;const product=state.products.find(p=>p.id===slot.productId);return product?.state==='inspection_complete'?colors.pass:state.pcs.some(pc=>pc.productId===slot.productId)?colors.busy:colors.waiting;}
  function observeSize(element, callback) {
    let frame = 0;
    const observer = new ResizeObserver(() => {
      if (!frame) frame = requestAnimationFrame(() => { frame = 0; callback(); });
    });
    observer.observe(element);
    return { disconnect() { observer.disconnect(); cancelAnimationFrame(frame); } };
  }
  function register(id, mount) {
    root.AVNViews = root.AVNViews || {};
    root.AVNViews[id] = {
      mount(el, api) {
        const pending = new Set();
        const visualApi = { ...api, subscribe(fn) {
          let frame = 0, latest;
          const cancel = () => { cancelAnimationFrame(frame); frame = 0; };
          pending.add(cancel);
          const unsubscribe = api.subscribe(state => {
            latest = state;
            if (!frame) frame = requestAnimationFrame(() => { frame = 0; fn(latest); });
          });
          return () => { unsubscribe(); cancel(); pending.delete(cancel); };
        }};
        const cleanup = mount(el, visualApi);
        this.cleanup = () => { cleanup?.(); pending.forEach(cancel => cancel()); };
      },
      unmount() { this.cleanup?.(); this.cleanup = null; }
    };
  }
  root.AVNUI={colors,escape,clock,occupied,busy,progress,yieldText,kpis,header,legend,svg,slotColor,register,observeSize};
})(window);

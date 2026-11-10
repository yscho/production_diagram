(function(root) {
  'use strict';
  const U=root.AVNUI;
  U.register('04',function(el,api){
    el.innerHTML=`<section class="av-view av-three">${U.header('04 / SPATIAL OPERATIONS','검사라인 3D','왼쪽 드래그: 회전 · 오른쪽 드래그: 이동 · 휠: 확대/축소','<button data-camera="fit">전체 보기</button><button data-camera="front">정면</button><button data-camera="top">위에서</button>')}<div class="av-canvas-wrap"><canvas aria-label="검사 셀 지그 PC 컨베이어의 Three.js 3D 장면" tabindex="0"></canvas><div class="three-caption">공정 배치 예시 · 로봇 동작은 07번에서 확인</div><div class="av-tip" hidden></div></div>${U.legend}<div class="av-kpis"></div></section>`;
    const THREE=root.THREE,canvas=el.querySelector('canvas'),wrap=canvas.parentElement,tip=el.querySelector('.av-tip');
    let renderer;
    try {if(!THREE)throw new Error('로컬 Three.js를 찾을 수 없습니다.');renderer=new THREE.WebGLRenderer({canvas,antialias:true});}
    catch(error){wrap.innerHTML=`<p class="av-empty">3D 화면을 열 수 없습니다: ${U.escape(error.message)}</p>`;return ()=>{};}
    renderer.setPixelRatio(Math.min(devicePixelRatio||1,2));renderer.outputColorSpace=THREE.SRGBColorSpace;
    renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFSoftShadowMap;
    const scene=new THREE.Scene();scene.background=new THREE.Color('#0c1c29');
    scene.add(new THREE.HemisphereLight(0xd9f2ff,0x20333f,2.3));
    const sun=new THREE.DirectionalLight(0xffedd4,3);sun.position.set(-12,35,24);sun.castShadow=true;sun.shadow.mapSize.set(1024,1024);Object.assign(sun.shadow.camera,{left:-36,right:36,top:28,bottom:-28,near:.5,far:110});sun.shadow.bias=-.001;scene.add(sun);
    const rim=new THREE.DirectionalLight(0x79baff,1.2);rim.position.set(10,20,-20);scene.add(rim);
    const camera=new THREE.PerspectiveCamera(40,1,.1,400),world=new THREE.Group();scene.add(world);
    const target=new THREE.Vector3(0,1,0),bounds=new THREE.Box3();
    let yaw=-.18,pitch=.8,distance=70,fitDistance=70,drag=null,raf=0,dirty=true,signature='',builds=0,state=api.getState();
    let resources=new Set(),geometries=new Map(),palette={},cells=new Map(),products=new Map(),rollers=[],rayTargets=[];
    function material(color,extra={}){const m=new THREE.MeshStandardMaterial({color,roughness:.58,metalness:.25,...extra});resources.add(m);return m;}
    function geometry(w,h,d){const key=`${w}:${h}:${d}`;if(!geometries.has(key)){const g=new THREE.BoxGeometry(w,h,d);resources.add(g);geometries.set(key,g);}return geometries.get(key);}
    function box(x,y,z,w,h,d,mat,parent=world){const m=new THREE.Mesh(geometry(w,h,d),mat);m.position.set(x,y,z);m.castShadow=true;m.receiveShadow=true;parent.add(m);return m;}
    function makeLabel(station,x,z){
      const board=document.createElement('canvas');board.width=640;board.height=170;const ctx=board.getContext('2d');
      const texture=new THREE.CanvasTexture(board);texture.colorSpace=THREE.SRGBColorSpace;resources.add(texture);
      const mat=new THREE.SpriteMaterial({map:texture,depthTest:false});resources.add(mat);const sprite=new THREE.Sprite(mat);sprite.position.set(x,5.4,z-3.8);sprite.scale.set(9.8,2.6,1);world.add(sprite);
      let last='';return current=>{const key=`${U.occupied(current)}:${U.busy(current)}:${current.capacity}`;if(key===last)return;last=key;ctx.fillStyle='#142e40';ctx.fillRect(0,0,640,170);ctx.strokeStyle='#436d83';ctx.lineWidth=4;ctx.strokeRect(2,2,636,166);ctx.textAlign='center';ctx.fillStyle='#e0f0f7';ctx.font='600 37px system-ui';ctx.fillText(`${current.code} · ${current.name}`,320,66);ctx.fillStyle='#9fc6d7';ctx.font='29px system-ui';ctx.fillText(`점유 ${U.occupied(current)}/${current.capacity}    PC ${U.busy(current)}/${current.pcs.length}`,320,127);texture.needsUpdate=true;};
    }
    function disposeWorld(){resources.forEach(r=>r.dispose());resources.clear();geometries.clear();world.clear();cells.clear();products.clear();rollers=[];rayTargets=[];}
    function build(s){
      disposeWorld();builds++;canvas.dataset.sceneBuilds=builds;
      palette={floor:material('#152e3e'),frame:material('#345666'),metal:material('#8ca6af',{metalness:.65}),belt:material('#203240'),cell:material('#244859'),jig:material('#4b6e7f'),black:material('#152a36'),pallet:material('#a18d6b'),idle:material('#496b7d'),busy:material(U.colors.busy,{emissive:'#956025',emissiveIntensity:.4}),pass:material(U.colors.pass,{emissive:'#237b63',emissiveIntensity:.3}),waiting:material(U.colors.waiting),reject:material('#643b48')};
      const cols=Math.ceil(s.stations.length/2),total=cols*13;
      box(0,-.28,0,total+4,.5,29,palette.floor);
      const grid=new THREE.GridHelper(total+4,Math.ceil((total+4)/2),'#315264','#233f51');grid.scale.z=29/(total+4);grid.position.y=.01;world.add(grid);resources.add(grid.geometry);resources.add(grid.material);
      box(0,1,0,total+1,.65,3,palette.belt);
      [-1,1].forEach(sign=>box(0,1.45,sign*1.55,total+1,.16,.14,palette.metal));
      for(let x=-total/2;x<total/2;x+=1){const m=box(x,1.34,0,.09,.06,2.8,palette.frame);rollers.push({m,x});}
      box(0,.6,13,total+1,.3,.8,palette.reject);
      s.stations.forEach((station,i)=>{
        const x=(i%cols-(cols-1)/2)*13,z=i<cols?-7:7;
        const base=box(x,.1,z,11.6,.18,10.5,palette.cell);base.userData.stationId=station.id;rayTargets.push(base);
        box(x,1,z,10.8,.3,5.8,palette.frame);
        for(const dx of [-4.9,4.9])for(const dz of [-2.5,2.5])box(x+dx,.5,z+dz,.22,1,.22,palette.metal);
        box(x,1,Math.sign(z)*2.5,1.8,.22,2,palette.frame);
        const slots=station.slots.map((slot,j)=>{
          const pos=new THREE.Vector3(x+(j%5-2)*2,1.48,z-1.85+Math.floor(j/5)*1.22);
          const mesh=box(pos.x,1.25,pos.z,1.7,.2,1,palette.jig);
          for(const d of [-1,1])box(pos.x+d*.7,1.4,pos.z+d*.32,.1,.12,.1,palette.metal);
          return {pos,mesh};
        });
        box(x,.85,z-4,10,1.6,1.2,palette.frame);
        const monitors=station.pcs.map((pc,j)=>{
          const cols=Math.min(10,station.pcs.length),px=x+(j%cols-(cols-1)/2)*(9.2/cols),py=2.1+Math.floor(j/cols)*1.1,pw=Math.min(1.5,8.4/cols);
          box(px,py,z-3.6,pw,.8,.18,palette.black);
          return box(px,py,z-3.49,pw-.1,.62,.025,palette.idle);
        });
        box(x+5.4,.4,z+4,.6,.8,.8,palette.reject);
        cells.set(station.id,{x,z,slots,monitors,label:makeLabel(station,x,z)});
      });
      bounds.set(new THREE.Vector3(-total/2-2,-.5,-14.5),new THREE.Vector3(total/2+2,7,14.5));
      fit();
    }
    // The legacy camera fit considers every bounding corner. Updates never reset it.
    function moveCamera(){camera.position.set(target.x+Math.sin(yaw)*Math.cos(pitch)*distance,target.y+Math.sin(pitch)*distance,target.z+Math.cos(yaw)*Math.cos(pitch)*distance);camera.lookAt(target);camera.updateMatrixWorld();dirty=true;canvas.dataset.cameraPosition=JSON.stringify(camera.position.toArray().map(n=>+n.toFixed(5)));}
    function fit(){target.set(0,1,0);distance=1;moveCamera();const rotation=new THREE.Matrix4().extractRotation(camera.matrixWorldInverse),tanY=Math.tan(THREE.MathUtils.degToRad(camera.fov/2)),tanX=tanY*camera.aspect;let needed=1;for(const x of [bounds.min.x,bounds.max.x])for(const y of [bounds.min.y,bounds.max.y])for(const z of [bounds.min.z,bounds.max.z]){const v=new THREE.Vector3(x,y,z).sub(target).applyMatrix4(rotation);needed=Math.max(needed,v.z+Math.abs(v.x)/(tanX*.93),v.z+Math.abs(v.y)/(tanY*.9));}distance=fitDistance=needed;moveCamera();}
    function endpoint(point){if(point?.stationId){const cell=cells.get(point.stationId);return cell?.slots[point.slotIndex]?.pos.clone()||new THREE.Vector3(cell?.x||0,1.5,cell?.z||0);}const name=point?.point||'entry';const ordered=[...cells.values()];const index=name.includes('2')?2:0;const cell=ordered[index]||ordered[0];return new THREE.Vector3(name==='entry'?bounds.min.x+1:cell.x,1.55,0);}
    function productPosition(product,s){
      const cell=cells.get(product.stageId);
      if(product.slotIndex!=null&&cell)return cell.slots[product.slotIndex].pos;
      const robot=s.robots.find(r=>r.productId===product.id);
      if(robot){const t=Math.min(1,(s.simTimeSec-robot.startedAt)/(robot.completesAt-robot.startedAt));const pos=endpoint(robot.from).lerp(endpoint(robot.to),t);pos.y+=Math.sin(Math.PI*t)*3;return pos;}
      if(product.transfer){const a=cells.get(product.transfer.from),b=cells.get(product.transfer.to),t=Math.min(1,(s.simTimeSec-product.transfer.startedAt)/(product.transfer.completesAt-product.transfer.startedAt));return new THREE.Vector3(a.x+(b.x-a.x)*t,1.55,0);}
      if(product.conveyor){const tr=product.conveyor,to=cells.get(tr.to),from=cells.get(tr.from),a=from?new THREE.Vector3(from.x,1.55,0):endpoint({point:tr.from}),b=to?new THREE.Vector3(to.x,1.55,0):endpoint({point:tr.to});if(tr.to==='exit')b.x=bounds.max.x-1;const t=Math.max(0,Math.min(1,(s.simTimeSec-tr.startedAt)/(tr.completesAt-tr.startedAt)));return a.lerp(b,t);}
      return new THREE.Vector3(cell?.x||bounds.min.x+1,1.55,0);
    }
    function update(s){
      state=s;const key=s.scenarioId+':'+s.stations.map(st=>`${st.id}/${st.capacity}/${st.pcs.length}`).join(',');
      if(key!==signature){signature=key;build(s);}
      s.stations.forEach(st=>{const cell=cells.get(st.id);cell.label(st);st.slots.forEach((slot,j)=>cell.slots[j].mesh.material=slot.productId?palette[s.pcs.some(pc=>pc.productId===slot.productId)?'busy':'pass']:slot.reservedProductId?palette.waiting:palette.jig);st.pcs.forEach((pc,j)=>cell.monitors[j].material=pc.state==='busy'?palette.busy:palette.idle);});
      const live=new Set(s.products.map(p=>p.id));products.forEach((group,id)=>{if(!live.has(id)){world.remove(group);products.delete(id);}});
      s.products.forEach(p=>{let group=products.get(p.id);if(!group){group=new THREE.Group();world.add(group);box(0,0,0,1.32,.13,.8,palette.pallet,group);box(0,.22,0,.98,.3,.55,palette.black,group);const lamp=box(0,.38,0,.72,.035,.35,palette.waiting,group);group.userData.lamp=lamp;products.set(p.id,group);}group.position.copy(productPosition(p,s));group.userData.lamp.material=s.pcs.some(pc=>pc.productId===p.id)?palette.busy:p.state==='inspection_complete'?palette.pass:palette.waiting;});
      rollers.forEach(({m,x})=>m.position.x=x+(s.simTimeSec*.8)%1);
      el.querySelector('.av-kpis').innerHTML=U.kpis(s);canvas.dataset.productCount=products.size;dirty=true;
    }
    function resize(){const rect=wrap.getBoundingClientRect();renderer.setSize(Math.max(1,rect.width),Math.max(1,rect.height),false);camera.aspect=rect.width/Math.max(1,rect.height);camera.updateProjectionMatrix();if(!drag)fit();}
    const down=e=>{drag={x:e.clientX,y:e.clientY,pan:e.button===2||e.shiftKey};canvas.setPointerCapture(e.pointerId);tip.hidden=true;};
    const raycaster=new THREE.Raycaster();
    const move=e=>{
      if(drag){const dx=e.clientX-drag.x,dy=e.clientY-drag.y;if(drag.pan){const f=distance*.0016;target.x-=dx*Math.cos(yaw)*f;target.z+=dx*Math.sin(yaw)*f;target.x+=dy*Math.sin(yaw)*f;target.z+=dy*Math.cos(yaw)*f;}else{yaw-=dx*.006;pitch=THREE.MathUtils.clamp(pitch+dy*.006,.12,1.52);}drag={...drag,x:e.clientX,y:e.clientY};moveCamera();return;}
      const r=canvas.getBoundingClientRect();raycaster.setFromCamera({x:(e.clientX-r.left)/r.width*2-1,y:1-(e.clientY-r.top)/r.height*2},camera);const hit=raycaster.intersectObjects(rayTargets)[0];tip.hidden=!hit;if(hit){const st=state.stations.find(s=>s.id===hit.object.userData.stationId);tip.innerHTML=`<b>${U.escape(st.name)}</b><br>슬롯 ${U.occupied(st)}/${st.capacity} · PC ${U.busy(st)}/${st.pcs.length}`;tip.style.left=Math.min(r.width-225,e.clientX-r.left+12)+'px';tip.style.top=Math.min(r.height-70,e.clientY-r.top+12)+'px';}
    };
    const up=()=>drag=null,wheel=e=>{e.preventDefault();distance=THREE.MathUtils.clamp(distance*Math.exp(e.deltaY*.001),fitDistance*.2,fitDistance*3);moveCamera();};
    canvas.addEventListener('pointerdown',down);canvas.addEventListener('pointermove',move);['pointerup','pointercancel','lostpointercapture'].forEach(name=>canvas.addEventListener(name,up));canvas.addEventListener('contextmenu',e=>e.preventDefault());canvas.addEventListener('wheel',wheel,{passive:false});canvas.addEventListener('dblclick',fit);canvas.addEventListener('pointerleave',()=>tip.hidden=true);
    el.querySelectorAll('[data-camera]').forEach(button=>button.addEventListener('click',()=>{yaw=button.dataset.camera==='fit'?-.18:0;pitch=button.dataset.camera==='top'?1.5:button.dataset.camera==='front'?.32:.8;fit();}));
    const unsubscribe=api.subscribe(update);update(state);const observer=U.observeSize(wrap,resize);resize();
    function animate(){raf=requestAnimationFrame(animate);if(dirty){renderer.render(scene,camera);dirty=false;}}animate();canvas.dataset.webgl=String(!!renderer.getContext());canvas.dataset.threeRevision=THREE.REVISION;
    return ()=>{unsubscribe();observer.disconnect();cancelAnimationFrame(raf);canvas.removeEventListener('wheel',wheel);disposeWorld();sun.shadow.dispose();renderer.dispose();renderer.forceContextLoss();};
  });
})(window);

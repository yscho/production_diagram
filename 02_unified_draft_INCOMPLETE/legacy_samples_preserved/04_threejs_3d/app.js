/* Three.js r159 global, classic script. Simulation uses fixed 0.05 s steps. */
(() => {
'use strict';
const $ = id => document.getElementById(id);
const D = window.LINE_DATA;
function error(message) { $('error').style.display = 'grid'; $('error').textContent = message; }
if (!D || !window.THREE || !D.stages.length) { error('공통 데이터 또는 Three.js를 읽을 수 없습니다. 로컬 파일 경로를 확인해 주세요.'); return; }
const C = D.statusColors, S = D.simulation;
$('title').textContent = D.line.name;
$('meta').textContent = `${D.line.product} · ${D.line.shift} · 목표 ${D.line.targetUph} UPH`;
for (const [key, name] of Object.entries({idle:'대기',busy:'검사 중',pass:'통과',fail:'불량',waiting:'이송 대기'})) {
 const span = document.createElement('span'), dot = document.createElement('i'); dot.className='dot'; dot.style.background=C[key]; span.append(dot, name); $('legend').append(span);
}
let speed = Number(S.speed), paused = false;
for (const value of [...new Set([1,2,5,10,20,50,speed])].sort((a,b)=>a-b)) { const o=document.createElement('option'); o.value=value; o.textContent=`${value}×`; $('speed').append(o); }
$('speed').value=String(speed); $('speed').onchange=e=>{speed=Number(e.target.value);};
$('toggle').onclick=()=>{paused=!paused; $('toggle').textContent=paused?'▶ 재생':'Ⅱ 일시정지';};
let renderer;
try { renderer=new THREE.WebGLRenderer({canvas:$('scene'),antialias:true}); } catch (_) { error('WebGL을 사용할 수 없습니다. WebGL 지원 브라우저로 열어 주세요.'); return; }
renderer.setPixelRatio(Math.min(devicePixelRatio,2)); renderer.outputColorSpace=THREE.SRGBColorSpace;
const scene=new THREE.Scene(); scene.background=new THREE.Color('#09131f');
const camera=new THREE.PerspectiveCamera(38,1,.1,2000), assembly=new THREE.Group(); scene.add(assembly);
scene.add(new THREE.HemisphereLight(0xd5eaff,0x334455,2.3)); const sun=new THREE.DirectionalLight(0xffffff,2);sun.position.set(-20,40,25);scene.add(sun);
const material=c=>new THREE.MeshStandardMaterial({color:c,roughness:.65});
const frameMat=material('#284458'), beltMat=material('#162b3b'), emptyMat=material(C.idle), occupiedMat=material(C.busy);
function box(x,y,z,w,h,d,m,parent=assembly) {const o=new THREE.Mesh(new THREE.BoxGeometry(w,h,d),m);o.position.set(x,y,z);parent.add(o);return o;}
const gap=8.4, total=D.stages.length*gap;
box(0,-.22,0,total+7,.3,13,material('#142535'));
box(0,.6,1.9,total+5,.35,1.45,beltMat);box(0,.6,5,total+5,.22,.85,material('#522e38'));
for(let x=-total/2-2;x<total/2+2;x+=1) box(x,.8,1.9,.09,.04,1.3,frameMat);
function label(st,x,width) {
 const canvas=document.createElement('canvas');canvas.width=512;canvas.height=320; const ctx=canvas.getContext('2d');
 ctx.fillStyle='#142b40';ctx.fillRect(0,0,512,320);ctx.strokeStyle='#527992';ctx.lineWidth=3;ctx.strokeRect(2,2,508,316);
 ctx.textAlign='center';ctx.fillStyle='#ffffff';ctx.font='700 60px sans-serif';
 const title=`${st.id} ${st.name}`, lines=[];let line='';
 for(const ch of title){if(ctx.measureText(line+ch).width>478){lines.push(line);line=ch;}else line+=ch;}lines.push(line);
 lines.forEach((text,i)=>ctx.fillText(text,256,lines.length===1?130:90+i*76));
 ctx.font='52px sans-serif';ctx.fillStyle='#b9d9ef';ctx.fillText(`슬롯 ${st.palletSlots} · PC ${st.testPcs}`,256,272);
 const texture=new THREE.CanvasTexture(canvas);texture.colorSpace=THREE.SRGBColorSpace;
 const sprite=new THREE.Sprite(new THREE.SpriteMaterial({map:texture,depthTest:false}));sprite.scale.set(width,width*320/512,1);sprite.position.set(x,6,-3.4);assembly.add(sprite);
}
const stations=D.stages.map((st,i)=>{
 const x=(i-(D.stages.length-1)/2)*gap, width=gap-.5;
 box(x,.05,-.65,width,.16,8,material(i%2?'#213c50':'#1c3447'));
 label(st,x,width);
 const slots=Array.from({length:st.palletSlots},(_,j)=>{
  const cols=Math.min(3,st.palletSlots), rows=Math.ceil(st.palletSlots/cols);
  const pos=new THREE.Vector3(x+(j%cols-(cols-1)/2)*1.95,1,-.25-Math.floor(j/cols)*Math.min(1.6,3.2/rows));
  const mesh=box(pos.x,.76,pos.z,1.65,.18,1.15,emptyMat);
  return {pos,mesh,pallet:null};
 });
 const pcs=Array.from({length:st.testPcs},(_,j)=>{
  const px=x+(j-(st.testPcs-1)/2)*Math.min(2.1,7/st.testPcs);
  box(px,.5,-4.2,.48,1,.65,frameMat);box(px+.55,1.25,-4.2,.09,.6,.1,frameMat);
  box(px+.55,1.65,-4.2,1.02,.72,.17,frameMat);
  const mat=new THREE.MeshStandardMaterial({color:C.idle,emissive:C.idle,emissiveIntensity:.7});
  box(px+.55,1.65,-4.09,.88,.57,.04,mat);
  return {mat,pallet:null,status:'idle',until:0};
 });
 return {st,x,slots,pcs};
});
// Fit all eight corners in the camera frame, including billboard label extents.
const bounds=new THREE.Box3().setFromObject(assembly), target=bounds.getCenter(new THREE.Vector3());
let yaw=0,pitch=40*Math.PI/180,distance=1,fitDistance=1;
function moveCamera(){camera.position.set(target.x+Math.sin(yaw)*Math.cos(pitch)*distance,target.y+Math.sin(pitch)*distance,target.z+Math.cos(yaw)*Math.cos(pitch)*distance);camera.lookAt(target);camera.updateMatrixWorld();}
function fit(){
 distance=1;moveCamera();const inv=camera.matrixWorldInverse, tanY=Math.tan(THREE.MathUtils.degToRad(camera.fov/2)),tanX=tanY*camera.aspect;
 const rotation=new THREE.Matrix4().extractRotation(inv);let needed=0;
 for(const x of [bounds.min.x,bounds.max.x])for(const y of [bounds.min.y,bounds.max.y])for(const z of [bounds.min.z,bounds.max.z]){
  const v=new THREE.Vector3(x,y,z).sub(target).applyMatrix4(rotation);
  needed=Math.max(needed,v.z+Math.abs(v.x)/(tanX*.94),v.z+Math.abs(v.y)/(tanY*.85));
 }
 distance=fitDistance=needed;moveCamera();
}
function resize(){const r=$('viewport').getBoundingClientRect();renderer.setSize(r.width,r.height,false);camera.aspect=r.width/r.height;camera.updateProjectionMatrix();fit();}
new ResizeObserver(resize).observe($('viewport'));$('fit').onclick=()=>{yaw=0;pitch=40*Math.PI/180;fit();};
let drag=null;const canvas=renderer.domElement;
canvas.onpointerdown=e=>{drag={x:e.clientX,y:e.clientY};canvas.setPointerCapture(e.pointerId);};
canvas.onpointermove=e=>{if(!drag)return;yaw-=(e.clientX-drag.x)*.006;pitch=THREE.MathUtils.clamp(pitch+(e.clientY-drag.y)*.006,.2,1.4);drag={x:e.clientX,y:e.clientY};moveCamera();};
canvas.onpointerup=canvas.onpointercancel=canvas.onlostpointercapture=()=>{drag=null;};
canvas.addEventListener('wheel',e=>{e.preventDefault();distance=THREE.MathUtils.clamp(distance*Math.exp(e.deltaY*.001),fitDistance*.22,fitDistance*3);moveCamera();},{passive:false});
let seed=Number(S.randomSeed)>>>0;const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
let elapsed=0,passed=0,failed=0,nextArrival=0,serial=0;const pallets=[];
const transfer=Math.max(.05,Number(S.conveyorTransferSec));
function pcState(pc,state){pc.status=state;pc.mat.color.set(C[state]);pc.mat.emissive.set(C[state]);}
function travel(p,points,done){p.route=points.map(v=>v.clone());p.route.unshift(p.mesh.position.clone());p.progress=0;p.state='moving';p.done=done;}
function enter(p,index){const station=stations[index],slot=station.slots.find(s=>!s.pallet);if(!slot)return false;
 p.index=index;p.slot=slot;slot.pallet=p;slot.mesh.material=occupiedMat;
 travel(p,[new THREE.Vector3(station.x,1.12,1.9),slot.pos],()=>{p.state='waiting';});return true;
}
function release(p){if(p.slot){p.slot.pallet=null;p.slot.mesh.material=emptyMat;p.slot=null;}}
function exit(p,bad){release(p);p.mesh.material.color.set(C[bad?'fail':'pass']);
 travel(p,bad?[new THREE.Vector3(p.mesh.position.x,1.12,5),new THREE.Vector3(total/2+2,1.12,5)]:[new THREE.Vector3(p.mesh.position.x,1.12,1.9),new THREE.Vector3(total/2+2,1.12,1.9)],()=>{p.state='done';bad?failed++:passed++;});
}
function step(dt){
 elapsed+=dt;
 if(elapsed>=nextArrival && pallets.length<Number(S.palletCount)){
  const mesh=box(-total/2-2,1.12,1.9,1.1,.45,.8,material(C.waiting));
  pallets.push({mesh,state:'arrival',index:-1,retries:0,id:++serial});nextArrival=elapsed+Math.max(.05,Number(S.arrivalIntervalSec));
 }
 for(const p of pallets){
  if(p.state==='moving'){
   p.progress=Math.min(1,p.progress+dt/transfer);const v=p.progress*(p.route.length-1),i=Math.min(Math.floor(v),p.route.length-2);p.mesh.position.lerpVectors(p.route[i],p.route[i+1],v-i);
   if(p.progress>=1)p.done();
  }else if(p.state==='arrival'){enter(p,0);
  }else if(p.state==='ready'){
   if(p.index===stations.length-1)exit(p,false);
   else if(stations[p.index+1].slots.some(s=>!s.pallet)){release(p);p.retries=0;enter(p,p.index+1);}
  }
 }
 for(const station of stations){
  for(const pc of station.pcs){
   if(pc.pallet && elapsed>=pc.until){
    const p=pc.pallet,bad=random()<Number(station.st.failRate);pc.pallet=null;pcState(pc,bad?'fail':'pass');pc.until=elapsed+transfer;
    if(bad && S.retestOnFail && p.retries<Number(S.maxRetest)){p.retries++;p.state='waiting';p.mesh.material.color.set(C.waiting);}
    else if(bad)exit(p,true);else{p.state='ready';p.mesh.material.color.set(C.pass);}
   }
   if(!pc.pallet && elapsed>=pc.until){pcState(pc,'idle');const slot=station.slots.find(s=>s.pallet && s.pallet.state==='waiting');
    if(slot){const p=slot.pallet;pc.pallet=p;p.state='testing';p.mesh.material.color.set(C.busy);pc.until=elapsed+Number(station.st.cycleTimeSec);pcState(pc,'busy');}
   }
  }
 }
 for(let i=pallets.length-1;i>=0;i--)if(pallets[i].state==='done'){const m=pallets[i].mesh;assembly.remove(m);m.geometry.dispose();m.material.dispose();pallets.splice(i,1);}
}
function updateUI(){
 $('passed').textContent=passed;$('failed').textContent=failed;$('uph').textContent=elapsed>0?(passed/elapsed*3600).toFixed(1):'—';
 $('yield').textContent=passed+failed?(100*passed/(passed+failed)).toFixed(1)+'%':'—';$('wip').textContent=pallets.length;
 $('clock').textContent=`시뮬 경과 ${Math.floor(elapsed/60)}분 ${Math.floor(elapsed%60)}초`;
}
let last=null,accumulator=0;
function animate(now){requestAnimationFrame(animate);const dt=last===null?0:Math.max(0,Math.min((now-last)/1000,.25));last=now;
 if(!paused){accumulator+=dt*speed;while(accumulator>=.05){step(.05);accumulator-=.05;}}
 updateUI();renderer.render(scene,camera);
}
resize();updateUI();requestAnimationFrame(animate);
})();

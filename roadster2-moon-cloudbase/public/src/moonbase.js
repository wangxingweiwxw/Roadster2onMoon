// Reference-driven, procedural lunar habitat. No external model or texture needed.
import * as THREE from '../lib/three.module.min.js';
import { mergeGeometries } from '../lib/utils/BufferGeometryUtils.js';
import { BASE, WALL_LENGTH, RAIL_END, railPose, inBaseLane, baseFloor } from './base-layout.js';
import { isBaseAttached } from './base-physics.js';
const G=BASE.ground, TAU=Math.PI*2;

export class MoonBase {
  constructor(scene) {
    this.root=new THREE.Group();this.root.name='SELENE / pressurised lunar habitat';scene.add(this.root);
    this.batches=new Map();this.dynamic=[];
    this.materials={
      hull:new THREE.MeshStandardMaterial({color:0xd4dce3,metalness:.58,roughness:.31}),
      pearl:new THREE.MeshStandardMaterial({color:0xf1eee8,metalness:.32,roughness:.36}),
      dark:new THREE.MeshStandardMaterial({color:0x152633,metalness:.64,roughness:.4}),
      floor:new THREE.MeshStandardMaterial({color:0x283b49,metalness:.65,roughness:.47}),
      steel:new THREE.MeshStandardMaterial({color:0x6e889b,metalness:.86,roughness:.27}),
      warm:new THREE.MeshStandardMaterial({color:0xffe6bc,emissive:0xffcf86,emissiveIntensity:2.2,roughness:.4}),
      cyan:new THREE.MeshStandardMaterial({color:0x93edff,emissive:0x57dfff,emissiveIntensity:3.2,roughness:.3}),
      blue:new THREE.MeshStandardMaterial({color:0x123e68,metalness:.7,roughness:.3}),
      soil:new THREE.MeshStandardMaterial({color:0x3e5141,roughness:1}),
      leaf:new THREE.MeshStandardMaterial({color:0x397f4a,roughness:.95}),
      leaf2:new THREE.MeshStandardMaterial({color:0x6f9d55,roughness:.95}),
      bark:new THREE.MeshStandardMaterial({color:0x61503e,roughness:1}),
    };
    this.buildHabitat();this.buildTower();this.buildAirlock();this.buildUtilities();this.flush();
    this.buildGlass();this.buildDock();
    // Local lights have finite reach and no shadow maps; the sun provides shadows.
    for(const [x,y,z,c,power,range] of [[51,7,0,0xc6eaff,180,24],[38,15,4,0x99dfff,160,25],[38,39,0,0xc0e7ff,190,25],[0,17,0,0xffd69e,600,65]]){
      const light=new THREE.PointLight(c,power,range,2);light.position.set(x,G+y,z);this.root.add(light);
    }
  }
  add(geo,mat,x,y,z,rx=0,ry=0,rz=0) {
    const m=new THREE.Matrix4().compose(new THREE.Vector3(x,G+y,z),new THREE.Quaternion().setFromEuler(new THREE.Euler(rx,ry,rz)),new THREE.Vector3(1,1,1));
    const g=geo.index?geo.toNonIndexed():geo.clone();g.applyMatrix4(m);
    // Compatible attributes for static material batches.
    for(const k of Object.keys(g.attributes))if(!['position','normal','uv'].includes(k))g.deleteAttribute(k);
    if(!g.attributes.uv)g.setAttribute('uv',new THREE.BufferAttribute(new Float32Array(g.attributes.position.count*2),2));
    if(!this.batches.has(mat))this.batches.set(mat,[]);this.batches.get(mat).push(g);geo.dispose();
  }
  box(w,h,d,x,y,z,mat='hull',ry=0){this.add(new THREE.BoxGeometry(w,h,d),mat,x,y,z,0,ry);}
  cyl(rt,rb,h,x,y,z,mat='hull',segments=32){this.add(new THREE.CylinderGeometry(rt,rb,h,segments),mat,x,y,z);}
  ring(r,t,x,y,z,mat='hull'){
    if(x===0&&z===0&&r>31){
      const gap=Math.asin(9/r),points=[];
      for(let i=0;i<=96;i++){const a=gap+(TAU-2*gap)*i/96;points.push([r*Math.cos(a),y,r*Math.sin(a)]);}
      this.pipe(points,t,mat);
    }else this.add(new THREE.TorusGeometry(r,t,8,96),mat,x,y,z,Math.PI/2);
  }
  pipe(points,r=.08,mat='steel'){
    const curve=new THREE.CatmullRomCurve3(points.map(p=>new THREE.Vector3(...p)));
    this.add(new THREE.TubeGeometry(curve,Math.max(12,points.length*8),r,6,false),mat,0,0,0);
  }
  label(text,sub,x,y,z,w,h,ry=Math.PI/2,color='#a8f4ff') {
    const canvas=document.createElement('canvas');canvas.width=1024;canvas.height=256;
    const ctx=canvas.getContext('2d');ctx.fillStyle='#0a1b27';ctx.fillRect(0,0,1024,256);
    ctx.strokeStyle='#3c7485';ctx.lineWidth=5;ctx.strokeRect(8,8,1008,240);
    ctx.textAlign='center';ctx.fillStyle=color;ctx.font='600 65px sans-serif';ctx.fillText(text,512,112);
    ctx.fillStyle='#d4e5e9';ctx.font='27px sans-serif';ctx.fillText(sub,512,185);
    const tex=new THREE.CanvasTexture(canvas);tex.colorSpace=THREE.SRGBColorSpace;
    const m=new THREE.Mesh(new THREE.PlaneGeometry(w,h),new THREE.MeshBasicMaterial({map:tex,side:THREE.DoubleSide}));
    m.position.set(x,G+y,z);m.rotation.y=ry;this.root.add(m);return m;
  }
  buildHabitat(){
    // Wide white layered annulus, with an opening facing the arrival lane (+X).
    for(const [r,h,y,mat] of [[46,6,4.3,'hull'],[46.6,.55,1.6,'dark'],[46.3,.7,7.7,'pearl']])
      this.add(new THREE.CylinderGeometry(r,r,h,112,1,true,Math.PI/2+.155,TAU-.31),mat,0,y,0);
    this.add(new THREE.RingGeometry(41.6,47.3,112), 'pearl',0,8.15,0,-Math.PI/2);
    this.ring(46.2,.36,0,8.2,0,'steel');this.ring(43.0,.44,0,9,0,'hull');
    this.ring(43.05,.095,0,9.5,0,'cyan');this.ring(46.45,.10,0,7.2,0,'warm');
    // Exterior module seams, structural ribs and warm habitable windows.
    for(let i=0;i<72;i++){
      const a=i*TAU/72;if(Math.abs(Math.atan2(Math.sin(a),Math.cos(a)))<.18)continue;
      const x=Math.cos(a)*46.18,z=Math.sin(a)*46.18,ry=Math.PI/2-a;
      this.box(2.45,2.1,.18,x,4.8,z,'dark',ry);
      this.box(1.95,1.45,.22,x*1.001,4.8,z*1.001,'warm',ry);
      this.box(.12,2.1,.28,x*1.003,4.8,z*1.003,'steel',ry);
      this.box(.16,5.1,.22,Math.cos(a+.043)*46.3,4.3,Math.sin(a+.043)*46.3,'steel',ry);
      this.box(2.1,.14,3.2,Math.cos(a)*44.6,8.28,Math.sin(a)*44.6,'hull',ry);
    }
    // The greenhouse has garden islands, circular footpaths and a central habitat.
    this.cyl(41.8,41.8,.45,0,1,0,'soil',96);
    for(const r of [12,24,35]){
      this.add(new THREE.RingGeometry(r-1.5,r+1.5,80),'pearl',0,1.29,0,-Math.PI/2);
      this.ring(r+1.5,.055,0,1.34,0,'warm');
    }
    this.cyl(8,8,5,0,4,0,'hull',48);this.cyl(10,10,.7,0,7,0,'pearl',64);
    this.ring(9,.12,0,7.4,0,'warm');this.cyl(4,4,8,0,11,0,'dark',32);this.ring(7,.42,0,15,0,'hull');
    let seed=142;const rand=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
    for(let i=0;i<115;i++){
      const a=rand()*TAU,r=13+rand()*26,x=Math.cos(a)*r,z=Math.sin(a)*r;
      if(x>24&&Math.abs(z)<10)continue;
      const h=2.4+rand()*3.3;
      this.cyl(.13,.22,h,x,1.4+h/2,z,'bark',6);
      const geo=new THREE.IcosahedronGeometry(1,1);geo.scale(1.2+rand(),h*.52,1.2+rand());
      this.add(geo,i%3?'leaf':'leaf2',x,1.4+h,z);
      if(i%7===0){this.cyl(.06,.06,3,x+2,2.8,z,'steel',6);this.cyl(.3,.3,.12,x+2,4.3,z,'warm',10);}
    }
    // Dome meridians and latitude rings follow exactly the stretched glass surface.
    for(let i=0;i<24;i++){
      const a=i*TAU/24,points=[];
      for(let j=0;j<=22;j++){const t=j*Math.PI/2/22,x=Math.cos(a)*42*Math.cos(t),z=Math.sin(a)*42*Math.cos(t);if(x>30&&Math.abs(z)<9)continue;points.push([x,9+23*Math.sin(t),z]);}
      this.pipe(points,.105,'steel');
    }
    for(const a of [.22,.48,.75,1.05,1.3])this.ring(42*Math.cos(a),.08,0,9+23*Math.sin(a),0,'hull');
    this.ring(6,.3,0,32,0,'hull');this.ring(5.8,.09,0,32.2,0,'cyan');
    this.label('SELENE / 01','LUNAR HABITAT · LIFE SUPPORT ONLINE',33,10,24,12,3,Math.PI/4);
  }
  buildTower(){
    // Front ascent tower, matching the visual reference. Back wall is driveable.
    this.box(1.2,48,15,BASE.wallX-.6,25.2,0,'floor');
    for(const z of [-7.6,7.6]){
      this.box(19,49,1,40,25.4,z,'hull');
      this.box(1.1,52,1.8,48.8,27,z,'pearl');
      this.box(.22,48,.15,48.9,26,z-Math.sign(z)*.6,'cyan');
      this.box(1.4,49,1.4,32,25.4,z,'steel');
      // Panel joints, recessed louvers and illuminated structural spines.
      for(const y of [12,21,30,39,48]){
        this.box(16,.14,.16,40,y,z+Math.sign(z)*.55,'steel');
        this.box(5,2.3,.18,40,y-2,z+Math.sign(z)*.57,'dark');
        for(let j=0;j<4;j++)this.box(4.5,.12,.22,40,y-2.7+j*.45,z+Math.sign(z)*.7,'steel');
      }
      this.box(.14,45,.18,34,25,z+Math.sign(z)*.6,'cyan');
      this.box(.7,9,.7,35,54,z,'steel');
      this.box(.7,9,.7,44,54,z,'steel');
    }
    for(const y of [4,13,22,31,40,49]){
      this.box(1,1.2,15.5,31.8,y,0,'hull');
      for(const z of [-6.1,6.1])this.box(.2,.1,1.5,32.1,y+.7,z,'warm');
    }
    // Vertical magnetic rails continue around the roof bend to the outbound lip.
    for(const z of [-1.25,1.25]){
      const path=[];for(let s=3;s<=RAIL_END;s+=.4){const p=railPose(s);path.push([p.x,p.y-G,z]);}
      this.pipe(path,.16,'steel');this.pipe(path.map(p=>[p[0]+.07,p[1],p[2]]),.055,'cyan');
    }
    // Dock brackets and stacked wall-service panels.
    for(const y of [12.2,23,34,45]){
      this.box(.25,5.5,4.2,32.1,y,0,'dark');
      for(const z of [-2.35,2.35])this.box(.24,5.7,.16,32.3,y,z,'cyan');
      this.box(.25,.16,4.7,32.3,y-2.9,0,'warm');
    }
    this.box(12,.5,15,40,54.8,0,'dark');
    // Side-open launch slot under the crown: inverted car clears the open +X lip.
    this.ring(10,.8,39,58,0,'pearl');this.ring(10.4,.18,39,58.4,0,'cyan');
    this.ring(8.5,.35,39,57.4,0,'steel');
    for(let i=0;i<12;i++){const a=i*TAU/12;this.box(2.1,.36,.9,39+Math.cos(a)*9.2,58.6,Math.sin(a)*9.2,'hull',-a);}
    for(const z of [-6.2,6.2])this.box(8,.6,.55,45,55,z,'pearl');
    this.label('ASCENT / 01','MAGNETIC DOCK · ROOF DEPARTURE',49.5,45,0,10,2.5);
    this.label('101.3 kPa','O₂ 21% · PRESSURISED SERVICE SHAFT',32.8,20,-4.6,5.7,1.5);
  }
  buildAirlock(){
    this.box(32,.45,12.6,48,1.0,0,'floor');
    // Recessed service tunnel and visible repeating pressure bulkheads.
    for(const z of [-6.4,6.4])this.box(30,8.8,.8,48,5.4,z,'hull');
    this.box(15,.6,13,56,10,0,'pearl');
    for(const x of [63,59,55,51]){
      for(const z of [-5.9,5.9]){
        this.box(.7,8.7,.55,x,5.2,z,'steel');this.box(.1,7,.13,x+.4,5.2,z-Math.sign(z)*.32,'warm');
      }
      this.box(.8,.8,12.2,x,9.55,0,'hull');this.box(.12,.1,10.8,x+.45,9.1,0,'warm');
    }
    for(const z of [-3.6,3.6])this.box(30,.05,.09,48,1.25,z,'cyan');
    for(let x=35;x<64;x+=1.2)for(const z of [-4.9,4.9])this.box(.14,.05,1.1,x,1.26,z,'steel');
    // Sloped approach: same profile used by baseFloor().
    const slope=Math.atan2(BASE.floor-BASE.ground,BASE.rampEndX-BASE.entranceX);
    this.add(new THREE.BoxGeometry(14,.22,12),'floor',71,.6,0,0,0,-slope);
    for(const z of [-5.7,5.7])this.pipe([[64,1.35,z],[78,.15,z]],.07,'cyan');
    // A bright outer portal reads as an entrance from the approach road.
    for(const z of [-6.65,6.65]){
      this.box(1.15,10.8,.8,64.4,5.8,z,'dark');
      this.box(.16,10.1,.26,65.02,5.8,z,'cyan');
      this.box(.18,1.4,.55,65.04,1.9,z,'warm');
    }
    this.box(1.15,.9,14.1,64.4,11.1,0,'dark');
    this.box(.16,.22,13.4,65.02,10.75,0,'cyan');
    this.label('入口气闸 / 01','SELENE ENTRY · 沿箭头驶入 · 减速慢行',65.1,13,0,15,3.1);
    this.label('气闸入口 / OPEN','人工大气隔离场 · 可直接穿过',64.9,8.9,0,8,1.6);
    for(const x of [68,72,76]){
      const y=(baseFloor(x,0,()=>BASE.ground)-G)+.15;
      this.pipe([[x+1,y,-1.3],[x-1,y,0],[x+1,y,1.3]],.13,'cyan');
    }
    this.label('E  /  WALL DOCK','STOP · ATTACH · REFILL',32.8,6,0,6.8,1.9);
    // Fictional pressure-retention curtains, transparent enough to read the corridor.
    this.curtains=[];
    for(const x of [63.7,52]){
      const mat=new THREE.ShaderMaterial({transparent:true,depthWrite:false,side:THREE.DoubleSide,blending:THREE.AdditiveBlending,
        uniforms:{time:{value:0},strength:{value:.12}},
        vertexShader:'varying vec2 vUv;void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',
        fragmentShader:'varying vec2 vUv;uniform float time;uniform float strength;void main(){float rim=pow(abs(vUv.x-.5)*2.,8.)+pow(abs(vUv.y-.5)*2.,8.);float scan=.5+.5*sin(vUv.y*95.-time*1.2);float grid=pow(.5+.5*cos(vUv.x*100.),18.);gl_FragColor=vec4(.15,.72,1.,strength*(.09+rim*.7+scan*.10+grid*.08));}' });
      const m=new THREE.Mesh(new THREE.PlaneGeometry(11,8.2),mat);m.position.set(x,G+5.4,0);m.rotation.y=Math.PI/2;this.root.add(m);this.curtains.push(m);
    }
  }
  buildUtilities(){
    for(const side of [-1,1]){
      // Attached life-support pod beside the main entrance.
      this.box(9,7,8,48,4.8,side*15,'hull');this.box(9.2,1,8.2,48,8.7,side*15,'steel');
      this.label(side>0?'LIFE SUPPORT':'AIR / 300 BAR','RECYCLE · COMPRESS · STORE',52.55,5.8,side*15,6.7,1.8);
      for(let i=0;i<4;i++){
        const z=side*(10.7+i*2.8);this.cyl(.85,.85,4.7,54,3.1,z,'steel');
        this.ring(.86,.1,54,2,z,'dark');this.ring(.86,.08,54,4.2,z,'cyan');
        this.pipe([[54,5.5,z],[54,6.5,z],[48,6.5,z]],.12,'steel');
      }
      // Solar arrays, a short mast and comms dish.
      for(let i=0;i<3;i++){
        const x=-12+i*11,z=side*58;
        this.cyl(.25,.35,4,x,2,z,'steel');
        this.add(new THREE.BoxGeometry(9,.18,6),'blue',x,4,z,side*.35,0,0);
        for(let c=-3;c<=3;c++)this.add(new THREE.BoxGeometry(.07,.21,6),'steel',x+c*1.15,4,z,side*.35,0,0);
      }
      const x=-38,z=side*40;
      this.cyl(.3,.6,6,x,3,z,'steel');
      this.add(new THREE.SphereGeometry(3,24,12,0,TAU,0,Math.PI/3),'pearl',x,7,z,.4,0,0);
      this.pipe([[x,7,z],[x+.6,10,z]],.09,'steel');
    }
    for(let i=0;i<14;i++){
      const x=83+i*4.5;
      for(const z of [-7,7]){this.cyl(.10,.13,.6,x,.35,z,'steel',8);this.cyl(.18,.18,.08,x,.7,z,'cyan',10);}
    }
  }
  flush(){
    for(const [name,parts] of this.batches){
      const geo=mergeGeometries(parts,false),mesh=new THREE.Mesh(geo,this.materials[name]);
      mesh.castShadow=!['warm','cyan'].includes(name);mesh.receiveShadow=true;mesh.name=`Base / ${name}`;
      this.root.add(mesh);for(const g of parts)g.dispose();
    }
    this.batches.clear();
  }
  buildGlass(){
    const glass=new THREE.MeshPhysicalMaterial({color:0x9cd1e5,metalness:.1,roughness:.12,transparent:true,opacity:.16,side:THREE.DoubleSide,depthWrite:false,envMapIntensity:.7});
    const geo=new THREE.SphereGeometry(1,96,36,0,TAU,0,Math.PI/2);geo.scale(BASE.domeR,BASE.domeRise,BASE.domeR);
    const dome=new THREE.Mesh(geo,glass);dome.position.set(0,BASE.domeRim,0);dome.renderOrder=2;this.root.add(dome);
    // Blue glazing on the tower front; it fades locally when the chase camera enters.
    this.frontGlass=new THREE.Mesh(new THREE.PlaneGeometry(13,39),glass.clone());
    this.frontGlass.position.set(49.4,G+30,0);this.frontGlass.rotation.y=Math.PI/2;this.root.add(this.frontGlass);
  }
  buildDock(){
    const m=this.materials;
    this.hose=new THREE.Group();this.root.add(this.hose);
    for(const z of [-3.6,3.6]){
      const arm=new THREE.Mesh(new THREE.CylinderGeometry(.16,.16,2.7,12),m.steel);
      arm.rotation.x=Math.PI/2;arm.position.set(33.15,BASE.dockY,z/2);this.hose.add(arm);
      const coupler=new THREE.Mesh(new THREE.SphereGeometry(.27,12,8),m.cyan);coupler.position.set(33.15,BASE.dockY,Math.sign(z)*.65);this.hose.add(coupler);
      for(let i=0;i<3;i++){
        const tank=new THREE.Mesh(new THREE.CylinderGeometry(.38,.38,4.3,16),m.steel);
        tank.position.set(33,BASE.dockY,z+Math.sign(z)*i*.85);this.root.add(tank);
        const cap=new THREE.Mesh(new THREE.TorusGeometry(.4,.07,6,16),m.cyan);cap.rotation.x=Math.PI/2;cap.position.copy(tank.position);cap.position.y+=1.5;this.root.add(cap);
      }
    }
    this.hose.visible=false;
    this.dockStatus=this.label('AUTO REFILL','MAGNETIC LOCK / EXTERNAL POWER',32.8,16.8,0,5.7,1.6);
  }
  update(dt,time,car,state){
    const docked=state.mode==='base_wall'&&Math.abs(car.group.position.y-BASE.dockY)<3&&Math.abs(car.base.speed)<.4;
    this.hose.visible=docked;this.hose.scale.z=THREE.MathUtils.lerp(this.hose.scale.z,docked?1:.05,1-Math.exp(-8*dt));
    this.frontGlass.material.opacity=(isBaseAttached(state)||inBaseLane(car.group.position)) ? .025 : .17;
    for(const m of this.curtains){m.material.uniforms.time.value=time;m.material.uniforms.strength.value=state.atmosphere?.48:.7;}
  }
}

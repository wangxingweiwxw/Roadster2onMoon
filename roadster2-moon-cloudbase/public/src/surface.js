import * as THREE from '../lib/three.module.min.js';

export async function loadSurface(renderer) {
  const loader=new THREE.TextureLoader();
  const [map,normalMap,roughnessMap]=await Promise.all(['regolith-color.jpg','regolith-normal.webp','regolith-roughness.jpg'].map(name=>loader.loadAsync(`./assets/textures/${name}`)));
  map.colorSpace=THREE.SRGBColorSpace;
  for(const t of [map,normalMap,roughnessMap]) {t.wrapS=t.wrapT=THREE.RepeatWrapping;t.repeat.set(104,104);t.anisotropy=Math.min(8,renderer.capabilities.getMaxAnisotropy());}
  return {map,normalMap,roughnessMap,normalScale:new THREE.Vector2(.34,.34)};
}

export function breakTextureTiling(material) {
  material.onBeforeCompile=shader=>{
    shader.fragmentShader=shader.fragmentShader.replace('#include <map_fragment>', `
    #ifdef USE_MAP
      vec2 secondary=mat2(.8,-.6,.6,.8)*vMapUv*.619+vec2(.231,.837);
      vec4 sampledDiffuseColor=mix(texture2D(map,vMapUv),texture2D(map,secondary),.5);
      diffuseColor*=sampledDiffuseColor;
    #endif`);
  };
  material.customProgramCacheKey=()=> 'lunar-antitile-v2';
}

export function addReflectionEnvironment(scene,renderer) {
  const env=new THREE.Scene();env.background=new THREE.Color(0x101b2b);
  const moon=new THREE.Mesh(new THREE.SphereGeometry(70,24,12),new THREE.MeshBasicMaterial({color:0x777978,side:THREE.BackSide}));
  moon.position.y=-71;env.add(moon);
  for(const [x,y,z,w,h,c] of [[-25,28,12,18,30,0xfff6e7],[15,7,-30,10,18,0x718aa8],[0,-8,10,50,10,0x7b7e80]]) {
    const panel=new THREE.Mesh(new THREE.PlaneGeometry(w,h),new THREE.MeshBasicMaterial({color:c,side:THREE.DoubleSide}));
    panel.position.set(x,y,z);panel.lookAt(0,0,0);env.add(panel);
  }
  const generator=new THREE.PMREMGenerator(renderer);
  const target=generator.fromScene(env,.04,.1,150);scene.environment=target.texture;generator.dispose();
  env.traverse(o=>{if(o.isMesh){o.geometry.dispose();o.material.dispose();}});
}

export function addSurfaceDetails(scene,height,config,surface) {
  let seed=7421;
  const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
  // Small stones are visual only, and deliberately kept off the marked tube lane.
  const mat=new THREE.MeshStandardMaterial({color:0x707274,roughness:.97});
  const rocks=new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1,1),mat,3400);
  const o=new THREE.Object3D();
  for(let i=0;i<3400;i++) {
    const a=random()*Math.PI*2,r=40+Math.sqrt(random())*1200;
    let x=Math.cos(a)*r,z=Math.sin(a)*r;
    if(Math.hypot(x,z)<86){x*=2.5;z*=2.5;}
    if(x>350&&x<760&&Math.abs(z)<26)z+=Math.sign(z||1)*35;
    const s=.12+Math.pow(random(),3)*1.4;
    o.position.set(x,height(x,z)+s*.17,z);o.rotation.set(random()*3,random()*6,random()*3);o.scale.set(s,s*(.3+random()*.5),s*(.7+random()*.5));o.updateMatrix();rocks.setMatrixAt(i,o.matrix);
    rocks.setColorAt(i,new THREE.Color().setScalar(.38+random()*.32));
  }
  rocks.receiveShadow=true;scene.add(rocks);
  const t=config.tube,center=(t.x0+t.x1)/2;
  // The driving ceiling is explicit geometry, matching the physics contact plane.
  const ceilingMat=new THREE.MeshStandardMaterial({color:0x434d58,roughness:.86,metalness:.18});
  const ceiling=new THREE.Mesh(new THREE.BoxGeometry(t.x1-t.x0,1,24),ceilingMat);
  ceiling.position.set(center,t.ceilY+.5,t.zc);ceiling.receiveShadow=true;ceiling.castShadow=true;scene.add(ceiling);
  const ribMat=new THREE.MeshStandardMaterial({color:0x293640,roughness:.52,metalness:.65});
  const lampMat=new THREE.MeshStandardMaterial({color:0x70dfef,emissive:0x3dbdd7,emissiveIntensity:3});
  for(let x=t.x0+5;x<t.x1;x+=16) {
    for(const side of [-1,1]) {
      const rib=new THREE.Mesh(new THREE.BoxGeometry(.4,13,.5),ribMat);rib.position.set(x,t.floorY+6.5,side*11.5);scene.add(rib);
      const lamp=new THREE.Mesh(new THREE.BoxGeometry(4,.07,.18),lampMat);lamp.position.set(x,t.floorY+.04,side*8.9);scene.add(lamp);
    }
    const bar=new THREE.Mesh(new THREE.BoxGeometry(.35,.3,23),ribMat);bar.position.set(x,t.ceilY-.15,0);scene.add(bar);
  }
  for(const x of [t.x0+20,center,t.x1-20]) {
    const light=new THREE.PointLight(0x9ccfe1,20,36,1.5);light.position.set(x,t.floorY+7,0);scene.add(light);
  }
  for(const x of [t.x0-12,t.x1+12]) {
    const canvas=document.createElement('canvas');canvas.width=1024;canvas.height=256;
    const ctx=canvas.getContext('2d');ctx.fillStyle='#09131c';ctx.fillRect(0,0,1024,256);
    ctx.strokeStyle='#65ddea';ctx.lineWidth=9;ctx.strokeRect(8,8,1008,240);
    ctx.textAlign='center';ctx.fillStyle='#d7f8ff';ctx.font='bold 64px sans-serif';ctx.fillText('E  /  INVERT',512,105);
    ctx.fillStyle='#f0bd73';ctx.font='30px sans-serif';ctx.fillText('LAVA TUBE  ·  CEILING DRIVE',512,178);
    const tex=new THREE.CanvasTexture(canvas);tex.colorSpace=THREE.SRGBColorSpace;
    const sign=new THREE.Mesh(new THREE.PlaneGeometry(12,3),new THREE.MeshBasicMaterial({map:tex,side:THREE.DoubleSide}));
    sign.position.set(x,t.ceilY+3.4,0);sign.rotation.y=Math.PI/2;scene.add(sign);
  }
  return rocks;
}

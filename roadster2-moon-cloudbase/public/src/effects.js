// Continuous cold-gas plumes adapted from openracing/src/fx/plumes.ts.
// Speed post shader adapted from openracing/src/fx/post.ts. MPL-2.0.
import * as THREE from '../lib/three.module.min.js';
const clamp = THREE.MathUtils.clamp;
const vertex = `varying vec2 vUv; void main(){vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`;

export function beaconMaterial() {
  return new THREE.ShaderMaterial({transparent:true,depthWrite:false,side:THREE.DoubleSide,blending:THREE.AdditiveBlending,
    vertexShader:`varying vec2 vUv;varying vec3 vN;varying vec3 vV;void main(){vUv=uv;vec4 p=modelViewMatrix*vec4(position,1.);vN=normalMatrix*normal;vV=-p.xyz;gl_Position=projectionMatrix*p;}`,
    fragmentShader:`varying vec2 vUv;varying vec3 vN;varying vec3 vV;void main(){float edge=pow(abs(dot(normalize(vN),normalize(vV))),1.4);float fade=pow(1.-vUv.y,2.8);gl_FragColor=vec4(.25,.8,.9,.13*edge*fade);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
    }`});
}

export class LunarParticles {
  constructor(scene, max = 2400) {
    this.max = max; this.cursor = 0;
    this.positions = new Float32Array(max*3); this.colors = new Float32Array(max*3);
    this.sizes = new Float32Array(max); this.alphas = new Float32Array(max);
    this.life = new Float32Array(max); this.total = new Float32Array(max);
    this.baseSize = new Float32Array(max); this.vel = new Float32Array(max*3);
    const g = new THREE.BufferGeometry();
    for (const [name, arr, width] of [['position',this.positions,3],['color',this.colors,3],['aSize',this.sizes,1],['aAlpha',this.alphas,1]])
      g.setAttribute(name,new THREE.BufferAttribute(arr,width).setUsage(THREE.DynamicDrawUsage));
    this.material = new THREE.ShaderMaterial({transparent:true, depthWrite:false,
      uniforms:{uScale:{value:600}}, vertexColors:true,
      vertexShader:`attribute float aSize; attribute float aAlpha; uniform float uScale; varying vec3 vColor; varying float vAlpha;
      void main(){vColor=color;vAlpha=aAlpha;vec4 mv=modelViewMatrix*vec4(position,1.);gl_Position=projectionMatrix*mv;gl_PointSize=clamp(aSize*uScale/max(1.,-mv.z),1.,180.);}`,
      fragmentShader:`varying vec3 vColor; varying float vAlpha;
      void main(){float r=length(gl_PointCoord-.5)*2.;if(r>1.)discard; float a=exp(-r*r*4.)*smoothstep(1.,.65,r)*vAlpha;gl_FragColor=vec4(vColor,a);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
      }`});
    this.points = new THREE.Points(g,this.material); this.points.frustumCulled=false; scene.add(this.points);
  }
  emit(p,v,c,life,size=.3) {
    const i=this.cursor++%this.max;
    this.positions.set([p.x,p.y,p.z],i*3);this.vel.set([v.x,v.y,v.z],i*3);
    this.colors.set([c.r,c.g,c.b],i*3);this.life[i]=this.total[i]=life;this.baseSize[i]=size;
  }
  update(dt,height) {
    this.material.uniforms.uScale.value=height*.72;
    for(let i=0;i<this.max;i++) {
      this.life[i]=Math.max(0,this.life[i]-dt);
      if(!this.life[i]){this.alphas[i]=0;this.sizes[i]=0;continue;}
      const age=1-this.life[i]/this.total[i],j=i*3;
      this.vel[j+1]-=1.62*dt;
      for(let k=0;k<3;k++)this.positions[j+k]+=this.vel[j+k]*dt;
      this.sizes[i]=this.baseSize[i]*(1+age*3.3);this.alphas[i]=.42*(1-age)*(1-age);
    }
    for(const a of Object.values(this.points.geometry.attributes))a.needsUpdate=true;
  }
  clear(){this.life.fill(0);this.alphas.fill(0);}
}

const plumeGeo=new THREE.CylinderGeometry(.055,.30,1,20,10,true).translate(0,-.5,0);
function plumeMaterial(seed) {
  return new THREE.ShaderMaterial({transparent:true,depthWrite:false,side:THREE.DoubleSide,blending:THREE.AdditiveBlending,
    uniforms:{uTime:{value:0},uI:{value:0},uSeed:{value:seed}},
    vertexShader:`varying vec2 vUv;varying vec3 vN;varying vec3 vV;
    void main(){vUv=uv;vec4 mv=modelViewMatrix*vec4(position,1.);vN=normalize(normalMatrix*normal);vV=normalize(-mv.xyz);gl_Position=projectionMatrix*mv;}`,
    fragmentShader:`uniform float uTime;uniform float uI;uniform float uSeed;varying vec2 vUv;varying vec3 vN;varying vec3 vV;
    float hash(vec2 p){return fract(sin(dot(p,vec2(41.3,289.1)))*43758.5);}
    float noise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x),f.y);}
    void main(){float along=clamp(1.-vUv.y,0.,1.);vec3 nn=vN/max(length(vN),.0001);vec3 vv=vV/max(length(vV),.0001);
    float rim=pow(clamp(abs(dot(nn,vv)),0.,1.),1.4);
    float n=noise(vec2(vUv.x*9.+uSeed,along*7.-uTime*16.));
    float diamonds=.7+.3*sin(along*29.-uTime*35.)*(1.-along);
    float a=uI*pow(1.-along,1.5)*rim*(.45+.75*n)*diamonds;
    gl_FragColor=vec4(mix(vec3(1.),vec3(.55,.78,1.),along)*(1.8+1.7*uI),a*.55);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
    }`});
}

export class ThrusterFX {
  constructor(root,particles) {
    this.root=root;this.particles=particles;this.sockets=[];this.spawn=0;
    root.updateMatrixWorld(true);
    root.traverse(o=>{
      if(!/^ThrusterNozzle_0[1-8]$/.test(o.name))return;
      const down=Number(o.name.slice(-2))<=4;
      // GLB 01–04 are underbody; 05–08 are rear. Exactly one space conversion.
      const pos=root.worldToLocal(o.getWorldPosition(new THREE.Vector3()));
      this.sockets.push({pos,dir:new THREE.Vector3(0,down?-1:0,down?0:-1),kind:down?'down':'main',k:0});
    });
    for(const x of [-.87,.87])for(const z of [-1.35,1.35]) {
      this.sockets.push({pos:new THREE.Vector3(x,.55,z),dir:new THREE.Vector3(Math.sign(x),0,0),kind:'rcs',k:0});
      this.sockets.push({pos:new THREE.Vector3(x,.62,z),dir:new THREE.Vector3(0,1,0),kind:'grip',k:0});
      const vent=new THREE.Mesh(new THREE.CylinderGeometry(.085,.10,.07,12),new THREE.MeshStandardMaterial({color:0x26343b,metalness:.8,roughness:.28}));
      vent.position.set(x,.62,z);root.add(vent);
    }
    this.meshes=this.sockets.map((s,i)=>{
      const mesh=new THREE.Mesh(plumeGeo,plumeMaterial(i*1.37));
      mesh.position.copy(s.pos).addScaledVector(s.dir,.10);
      mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0,-1,0),s.dir);
      mesh.visible=false;root.add(mesh);return mesh;
    });
    this.light=new THREE.PointLight(0x8bcfff,0,8,2);this.light.position.set(0,.4,-2.5);root.add(this.light);
    this.ring=new THREE.Mesh(new THREE.RingGeometry(.38,.46,48),new THREE.MeshBasicMaterial({color:0x67e2e9,side:THREE.DoubleSide,transparent:true,opacity:0,depthWrite:false}));
    this.ring.rotation.x=-Math.PI/2;this.ring.position.y=.025;root.add(this.ring);
  }
  update(dt,time,car,state,input) {
    this.root.updateMatrixWorld(true);this.spawn+=dt*50;
    const count=Math.floor(this.spawn);this.spawn-=count;
    const color=new THREE.Color(0xbad9ec),q=this.root.quaternion;
    this.sockets.forEach((s,i)=>{
      let target=s.kind==='main'?car.mainThrust:s.kind==='down'?car.downThrust:s.kind==='grip'?car.gripThrust*.65:0;
      if(s.kind==='down'&&state.mode==='air')target=Math.min(1,target+car.rcs*.35*Math.max(0,Math.sign(s.pos.z)*input.throttle));
      if(s.kind==='rcs'&&state.mode==='air')target=car.rcs*.7*Math.max(0,Math.sign(s.pos.x)*input.steer);
      s.k+=(target-s.k)*(1-Math.exp(-(target>s.k?24:9)*dt));
      const m=this.meshes[i];m.visible=s.k>.015;
      if(!m.visible)return;
      const len=(s.kind==='main'?4.8:s.kind==='down'?3.1:1.4)*(.25+.75*s.k)*(1+.06*Math.sin(time*85+i));
      m.scale.set(.65+s.k*.5,len,.65+s.k*.5);m.material.uniforms.uTime.value=time;m.material.uniforms.uI.value=s.k;
      for(let j=0;j<count;j++)if(Math.random()<s.k){
        const p=this.root.localToWorld(s.pos.clone().addScaledVector(s.dir,.45+Math.random()*len*.7));
        const v=s.dir.clone().applyQuaternion(q).multiplyScalar(10+Math.random()*8).addScaledVector(car.vel,.85);
        v.x+=(Math.random()-.5)*1.5;v.z+=(Math.random()-.5)*1.5;
        this.particles.emit(p,v,color,.35+Math.random()*.5,.16+Math.random()*.18);
      }
    });
    this.light.intensity=car.mainThrust*4;
    this.ring.material.opacity=car.gripThrust*(.45+.2*Math.sin(time*18));
    this.ring.scale.setScalar(1+.12*Math.sin(time*10));
  }
  reset(){for(const s of this.sockets)s.k=0;for(const m of this.meshes)m.visible=false;this.light.intensity=0;this.ring.material.opacity=0;}
}

export class LunarPost {
  constructor(renderer) {
    this.renderer=renderer;renderer.info.autoReset=false;
    this.supported=renderer.capabilities.isWebGL2&&renderer.extensions.has('EXT_color_buffer_float');
    this.enabled=this.supported;this.bloom=true;this.motion=true;
    this.camera=new THREE.OrthographicCamera(-1,1,1,-1,0,1);
    this.scene=new THREE.Scene();this.quad=new THREE.Mesh(new THREE.PlaneGeometry(2,2));this.scene.add(this.quad);
    this.target=new THREE.WebGLRenderTarget(1,1,{type:THREE.HalfFloatType,depthBuffer:true});
    this.a=new THREE.WebGLRenderTarget(1,1,{type:THREE.HalfFloatType,depthBuffer:false});this.b=this.a.clone();
    this.blur=new THREE.ShaderMaterial({depthTest:false,depthWrite:false,toneMapped:false,uniforms:{tex:{value:null},direction:{value:new THREE.Vector2()},extract:{value:0}},vertexShader:vertex,
      fragmentShader:`uniform sampler2D tex;uniform vec2 direction;uniform float extract;varying vec2 vUv;
      vec3 tap(vec2 uv){vec3 c=clamp(texture2D(tex,uv).rgb,0.,30.);return mix(c,max(c-1.25,0.),extract);}
      void main(){vec3 c=tap(vUv)*.227027;c+=(tap(vUv+direction*1.384615)+tap(vUv-direction*1.384615))*.316216;c+=(tap(vUv+direction*3.230769)+tap(vUv-direction*3.230769))*.070270;gl_FragColor=vec4(c,1.);}`});
    this.final=new THREE.ShaderMaterial({depthTest:false,depthWrite:false,uniforms:{tex:{value:this.target.texture},glow:{value:this.b.texture},speed:{value:0},boost:{value:0},bloom:{value:.18},tint:{value:0}},vertexShader:vertex,
      fragmentShader:`uniform sampler2D tex;uniform sampler2D glow;uniform float speed;uniform float boost;uniform float bloom;uniform float tint;varying vec2 vUv;
      void main(){vec2 d=vUv-vec2(.5,.54);float r=length(d);float amt=(speed*.014+boost*.018)*smoothstep(.2,.7,r);vec3 c=vec3(0.);
      for(int i=0;i<6;i++){c+=texture2D(tex,vUv-d*amt*float(i)/5.).rgb;}c/=6.;
      float ca=boost*.002*r;c.r=mix(c.r,texture2D(tex,vUv+d*ca).r,.4);c.b=mix(c.b,texture2D(tex,vUv-d*ca).b,.4);
      c+=texture2D(glow,vUv).rgb*bloom;c*=1.-.25*smoothstep(.3,.82,r);c+=vec3(.015,.055,.065)*tint*smoothstep(.4,.8,r);
      gl_FragColor=vec4(max(c,0.),1.);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
      }`});
    this.resize();
  }
  resize(){const s=this.renderer.getDrawingBufferSize(new THREE.Vector2());this.target.setSize(s.x,s.y);this.a.setSize(Math.max(1,s.x>>2),Math.max(1,s.y>>2));this.b.setSize(this.a.width,this.a.height);}
  pass(material,target){this.quad.material=material;this.renderer.setRenderTarget(target);this.renderer.render(this.scene,this.camera);}
  render(scene,camera,car,state){
    const r=this.renderer;r.info.reset();if(!this.enabled){r.setRenderTarget(null);r.render(scene,camera);return;}
    r.setRenderTarget(this.target);r.render(scene,camera);
    if(this.bloom){this.blur.uniforms.tex.value=this.target.texture;this.blur.uniforms.extract.value=1;this.blur.uniforms.direction.value.set(1/this.a.width,0);this.pass(this.blur,this.a);
      this.blur.uniforms.tex.value=this.a.texture;this.blur.uniforms.extract.value=0;this.blur.uniforms.direction.value.set(0,1/this.a.height);this.pass(this.blur,this.b);}
    const u=this.final.uniforms;u.speed.value=this.motion?clamp(car.vel.length()/95,0,1):0;u.boost.value=this.motion?car.mainThrust:0;u.bloom.value=this.bloom?.22:0;u.tint.value=state.mode==='inverted'?1:0;
    this.pass(this.final,null);
  }
}

// Bounded reusable wheel marks; all trails share one draw call.
export class WheelTracks {
  constructor(scene,height) {
    this.height=height;this.cursor=0;this.last=null;
    this.mesh=new THREE.InstancedMesh(new THREE.PlaneGeometry(.24,1),new THREE.MeshBasicMaterial({color:0x282b30,transparent:true,opacity:.30,depthWrite:false,polygonOffset:true,polygonOffsetFactor:-2}),900);
    this.mesh.count=0;this.mesh.frustumCulled=false;scene.add(this.mesh);this.dummy=new THREE.Object3D();
  }
  update(car,state){
    const p=car.group.position;
    if(state.mode!=='ground'||car.vel.length()<2){this.last=null;return;}
    if(this.last&&p.distanceTo(this.last)<.65)return;
    const d=this.dummy;
    for(const x of [-.9,.9]){
      const at=car.group.localToWorld(new THREE.Vector3(x,0,-1.4));d.position.set(at.x,this.height(at.x,at.z)+.025,at.z);
      d.quaternion.copy(car.group.quaternion).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1,0,0),-Math.PI/2));d.updateMatrix();
      this.mesh.setMatrixAt(this.cursor++%900,d.matrix);this.mesh.count=Math.min(900,this.cursor);
    }
    this.mesh.instanceMatrix.needsUpdate=true;this.last=p.clone();
  }
  reset(){this.cursor=0;this.mesh.count=0;this.last=null;}
}

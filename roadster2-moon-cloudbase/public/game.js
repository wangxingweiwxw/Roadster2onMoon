import { CameraRig } from './src/camera-rig.js';
import { initVideoLibrary } from './src/video-library.js';
import { MoonBase } from './src/moonbase.js';
import { BASE, inBaseLane, inAtmosphere } from './src/base-layout.js';
import { resetBase, stepBase, resolveBaseCollision, baseFloor, isBaseAttached } from './src/base-physics.js';
import { CONFIG } from './src/config.js';
import { terrainHeight, terrainNormal } from './src/terrain.js';
// ============================================================
// Roadster2 月球探索 · game.js
// ruleset_id: roadster2-moon-v2
// 三大核心机制：压缩空气加速 / 腾空 / 倒挂
// 物理：月面 1.62 m/s² 低重力 arcade 模型
// ============================================================
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { stepVehicle, resetDynamics } from './src/vehicle.js?v=3';
import { LunarParticles, ThrusterFX, LunarPost, WheelTracks, beaconMaterial } from './src/effects.js';
import { loadSurface, addReflectionEnvironment, addSurfaceDetails, breakTextureTiling } from './src/surface.js';

// ---------------- 配置（单一来源） ----------------
// ---------------- 渲染基础 ----------------
const canvas = document.getElementById('view');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x03050a);
scene.fog = new THREE.Fog(0x05080f, 600, 2600);

const camera = new THREE.PerspectiveCamera(66, window.innerWidth / window.innerHeight, 0.1, 6000);
camera.position.set(14, 7, 22);

const sun = new THREE.DirectionalLight(0xfff3e0, 2.2);
sun.position.set(-500, 380, 300);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.left = -65; sun.shadow.camera.right = 65;
sun.shadow.camera.top = 65; sun.shadow.camera.bottom = -65;
sun.shadow.camera.near = 10;  sun.shadow.camera.far = 1400;
scene.add(sun); scene.add(sun.target);
scene.add(new THREE.AmbientLight(0x3a4a66, 0.55));
const fill = new THREE.DirectionalLight(0x4a6a9a, 0.5);
fill.position.set(300, 200, -400);
scene.add(fill);

// ---------------- 工具 ----------------
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (t) => t * t * (3 - 2 * t);
const now = () => performance.now();
const $ = (sel) => document.querySelector(sel);

// ---------------- 地形（程序化月面） ----------------
// 地形网格
let surfaceMaps;
function buildTerrain() {
  const S = 440, R = CONFIG.worldR;
  const geo = new THREE.PlaneGeometry(R * 2, R * 2, S - 1, S - 1);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position;
  const colors = new Float32Array(pos.count * 3);
  const cMoon = new THREE.Color(0xa5a6a7);
  const cDark = new THREE.Color(0x74777b);
  const cHi = new THREE.Color(0xb8b9bc);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i);
    const y = terrainHeight(x, z);
    pos.setY(i, y);
    const t = clamp((y + 60) / 130, 0, 1);
    const col = cDark.clone().lerp(cMoon, clamp(t, 0.15, 1));
    // 山脊顶略亮
    const ridgeZ = -320 + Math.sin(x * 0.004) * 42;
    const rw = Math.exp(-Math.pow((z - ridgeZ) / 58, 2));
    col.lerp(cHi, rw * 0.22);
    colors[i * 3] = col.r; colors[i * 3 + 1] = col.g; colors[i * 3 + 2] = col.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.computeVertexNormals();
  const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ ...surfaceMaps, vertexColors: true, roughness: 1, metalness: 0, flatShading: false }));
  breakTextureTiling(mesh.material);
  mesh.receiveShadow = true;
  scene.add(mesh);
  return mesh;
}

// ---------------- 环境：星空 / 地球 / 太阳光晕 / 基地 / 岩石 ----------------
function buildStars() {
  const N = 2600;
  const p = new Float32Array(N * 3);
  for (let i = 0; i < N; i++) {
    const th = Math.random() * Math.PI * 2, ph = Math.acos(Math.random() * 2 - 1);
    const r = 2600;
    p[i * 3] = r * Math.sin(ph) * Math.cos(th);
    p[i * 3 + 1] = r * Math.cos(ph);
    p[i * 3 + 2] = r * Math.sin(ph) * Math.sin(th);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(p, 3));
  const m = new THREE.PointsMaterial({ color: 0xcfe2ff, size: 2.2, sizeAttenuation: false, transparent: true, opacity: 0.9 });
  scene.add(new THREE.Points(g, m));
}

function buildEarth() {
  // 程序化地球贴图
  const c = document.createElement('canvas');
  c.width = c.height = 512;
  const ctx = c.getContext('2d');
  const grd = ctx.createLinearGradient(0, 0, 512, 512);
  grd.addColorStop(0, '#1a4d8f'); grd.addColorStop(0.5, '#2f74b8'); grd.addColorStop(1, '#1a4d8f');
  ctx.fillStyle = grd; ctx.fillRect(0, 0, 512, 512);
  ctx.globalAlpha = 0.9;
  ctx.fillStyle = '#2e7d4f';
  const blobs = [[120,140,70],[330,90,55],[260,300,90],[90,360,45],[400,260,60],[430,420,50],[180,220,40]];
  for (const [bx, by, br] of blobs) {
    ctx.beginPath();
    for (let a = 0; a <= Math.PI * 2 + 0.2; a += 0.35) {
      const rr = br * (0.8 + 0.3 * Math.sin(a * 3) * Math.cos(a * 2));
      const px = bx + Math.cos(a) * rr, py = by + Math.sin(a) * rr * 0.7;
      a === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
    }
    ctx.fill();
  }
  ctx.globalAlpha = 0.55;
  ctx.fillStyle = '#e8f2ff';
  for (let i = 0; i < 26; i++) {
    ctx.beginPath();
    ctx.arc(Math.random() * 512, Math.random() * 512, 12 + Math.random() * 34, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
  const tex = new THREE.CanvasTexture(c);
  const earth = new THREE.Mesh(
    new THREE.SphereGeometry(120, 48, 32),
    new THREE.MeshBasicMaterial({ map: tex })
  );
  earth.position.set(1900, 620, -1650);
  scene.add(earth);
  const halo = new THREE.Mesh(
    new THREE.SphereGeometry(124, 32, 24),
    new THREE.MeshBasicMaterial({ color: 0x2a5ca0, transparent: true, opacity: 0.12 })
  );
  halo.position.copy(earth.position);
  scene.add(halo);
}

function buildSunGlow() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(64, 64, 4, 64, 64, 64);
  g.addColorStop(0, 'rgba(255,250,230,1)');
  g.addColorStop(0.25, 'rgba(255,230,160,0.75)');
  g.addColorStop(1, 'rgba(255,210,120,0)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, 128, 128);
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
  sprite.position.copy(sun.position).multiplyScalar(1.6);
  sprite.scale.setScalar(420);
  scene.add(sprite);
}

function buildRocks() {
  const rockMat = new THREE.MeshStandardMaterial({ color: 0x5a5751, roughness: 1 });
  for (let i = 0; i < 220; i++) {
    const a = Math.random() * Math.PI * 2, r = 120 + Math.random() * (CONFIG.worldR - 180);
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    const s = 0.6 + Math.random() * 3.2;
    const m = new THREE.Mesh(new THREE.DodecahedronGeometry(s, 0), rockMat);
    m.position.set(x, terrainHeight(x, z) + s * 0.25, z);
    m.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, Math.random() * Math.PI);
    m.scale.y = 0.5 + Math.random() * 0.8;
    m.castShadow = true;
    scene.add(m);
  }
}

// ---------------- 熔岩管（倒挂区） ----------------
function buildTube() {
  const t = CONFIG.tube;
  const g = new THREE.Group();
  const rockMat = new THREE.MeshStandardMaterial({ color: 0x55534e, roughness: 1 });
  // 顶盖（半圆拱）
  const coverGeo = new THREE.CylinderGeometry(13, 13, t.x1 - t.x0 + 20, 26, 1, true, 0, Math.PI);
  const cover = new THREE.Mesh(coverGeo, new THREE.MeshStandardMaterial({ color: 0x4d4b46, roughness: 1, side: THREE.DoubleSide }));
  cover.rotation.z = Math.PI / 2;
  cover.position.set((t.x0 + t.x1) / 2, t.ceilY + 2.2, t.zc);
  cover.castShadow = true; cover.receiveShadow = true;
  g.add(cover);
  // 侧壁
  for (const side of [-1, 1]) {
    const wall = new THREE.Mesh(new THREE.BoxGeometry(t.x1 - t.x0 + 20, 14, 2.6), rockMat);
    wall.position.set((t.x0 + t.x1) / 2, t.floorY + 7, side * 13);
    wall.castShadow = true; wall.receiveShadow = true;
    g.add(wall);
  }
  // 管内地板
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(t.x1 - t.x0 + 30, 26), rockMat);
  floor.rotation.x = -Math.PI / 2;
  floor.position.set((t.x0 + t.x1) / 2, t.floorY - 0.15, t.zc);
  floor.receiveShadow = true;
  g.add(floor);
  // 顶内灯带（提示倒挂区）
  const glowMat = new THREE.MeshBasicMaterial({ color: 0xff9a5c, transparent: true, opacity: 0.85 });
  for (const side of [-1, 1]) {
    const strip = new THREE.Mesh(new THREE.BoxGeometry(t.x1 - t.x0, 0.3, 0.3), glowMat);
    strip.position.set((t.x0 + t.x1) / 2, t.ceilY - 0.4, side * 4.5);
    g.add(strip);
  }
  g.position.set(0, 0, 0);
  scene.add(g);
}

// ---------------- 氦-3 晶体 ----------------
const CRYSTALS = [
  { x: 60, z: 6, name: '基地补给站晶体' },
  { x: -300, z: 80, name: '静海平原晶体' },
  { x: -620, z: 520, name: '环形山内壁晶体' },
  { x: 310, z: -330, name: '山脊腾空点晶体' },
  { x: 500, z: 0, name: '熔岩管入口晶体' },
  { x: 600, z: 0, name: '熔岩管倒挂顶晶体' },
  { x: -200, z: 640, name: '高地悬崖晶体' },
  { x: 780, z: -430, name: '远月海晶体' },
];
const crystals = [];
let crystalsLeft = CRYSTALS.length;

function crystalBaseY(def) {
  if (def.name === '熔岩管倒挂顶晶体') return CONFIG.tube.ceilY - 2.2;
  return terrainHeight(def.x, def.z) + 2.6;
}

function buildCrystals() {
  const mat = new THREE.MeshStandardMaterial({ color: 0x7ff5e4, emissive: 0x0f6f6b, emissiveIntensity: 1.2, roughness: 0.2, metalness: 0.1, transparent: true, opacity: 0.95 });
  for (const c of CRYSTALS) {
    const y = crystalBaseY(c);
    const mesh = new THREE.Mesh(new THREE.OctahedronGeometry(1.5, 0), mat);
    mesh.position.set(c.x, y, c.z);
    mesh.castShadow = true;
    scene.add(mesh);
    // 光柱
    const glow = new THREE.Mesh(new THREE.CylinderGeometry(.25, 1.7, 26, 32, 1, true), beaconMaterial());
    glow.position.set(c.x, y + 8, c.z);
    scene.add(glow);
    crystals.push({ def: c, mesh, glow, taken: false, bob: Math.random() * 6.28 });
  }
}

// ---------------- 粒子系统 ----------------
// ---------------- 音频（WebAudio 合成） ----------------
class AudioFX {
  constructor() { this.ctx = null; this.muted = false; this.master = null; }
  init() {
    if (this.ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.55;
    this.master.connect(this.ctx.destination);
    this._noiseBuf = null;
    const len = this.ctx.sampleRate * 1;
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this._noiseBuf = buf;
  }
  resume() { if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume(); }
  setMuted(m) { this.muted = m; if (this.master) this.master.gain.value = m ? 0 : 0.55; }
  _noiseSrc() {
    const s = this.ctx.createBufferSource();
    s.buffer = this._noiseBuf; s.loop = true;
    return s;
  }
  tone(freq, dur, type = 'sine', vol = 0.2, slideTo = null) {
    if (!this.ctx || this.muted) return;
    const o = this.ctx.createOscillator(), g = this.ctx.createGain();
    o.type = type; o.frequency.value = freq;
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, this.ctx.currentTime + dur);
    g.gain.setValueAtTime(vol, this.ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + dur);
    o.connect(g); g.connect(this.master);
    o.start(); o.stop(this.ctx.currentTime + dur + 0.02);
  }
  noise(dur, freq, q = 1, vol = 0.2, slideTo = null) {
    if (!this.ctx || this.muted) return;
    const s = this._noiseSrc(), f = this.ctx.createBiquadFilter(), g = this.ctx.createGain();
    f.type = 'bandpass'; f.frequency.value = freq; f.Q.value = q;
    if (slideTo) f.frequency.exponentialRampToValueAtTime(slideTo, this.ctx.currentTime + dur);
    g.gain.setValueAtTime(vol, this.ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + dur);
    s.connect(f); f.connect(g); g.connect(this.master);
    s.start(); s.stop(this.ctx.currentTime + dur + 0.02);
  }
  engine() {
    if (!this.ctx || this.muted) return;
    if (this._eng) return this._eng;
    const o = this.ctx.createOscillator(), g = this.ctx.createGain(), f = this.ctx.createBiquadFilter();
    o.type = 'sawtooth'; o.frequency.value = 55;
    f.type = 'lowpass'; f.frequency.value = 420; f.Q.value = 1.2;
    g.gain.value = 0;
    o.connect(f); f.connect(g); g.connect(this.master);
    o.start();
    this._eng = { o, g, f };
    return this._eng;
  }
  engineUpdate(speed, throttle) {
    const e = this._eng; if (!e) return;
    const f = 50 + speed * 1.6;
    e.o.frequency.setTargetAtTime(f, this.ctx.currentTime, 0.08);
    e.f.frequency.setTargetAtTime(300 + speed * 6, this.ctx.currentTime, 0.1);
    e.g.gain.setTargetAtTime(0.028 + throttle * 0.05 + Math.min(speed, 60) * 0.0011, this.ctx.currentTime, 0.1);
  }
  boost(active, amount) {
    if (!this.ctx || this.muted) return;
    if (active && !this._boost) {
      const s = this._noiseSrc(), f = this.ctx.createBiquadFilter(), g = this.ctx.createGain();
      f.type = 'bandpass'; f.frequency.value = 900; f.Q.value = 0.7;
      g.gain.setValueAtTime(0.0001, this.ctx.currentTime);
      g.gain.exponentialRampToValueAtTime(0.28, this.ctx.currentTime + 0.12);
      s.connect(f); f.connect(g); g.connect(this.master);
      s.start();
      this._boost = { s, g };
    } else if (this._boost && !active) {
      try {
        this._boost.g.gain.exponentialRampToValueAtTime(0.0001, this.ctx.currentTime + 0.2);
        this._boost.s.stop(this.ctx.currentTime + 0.25);
      } catch (e) {}
      this._boost = null;
    }
  }
  wind(active, speed) {
    if (!this.ctx || this.muted) return;
    if (active && !this._wind) {
      const s = this._noiseSrc(), f = this.ctx.createBiquadFilter(), g = this.ctx.createGain();
      f.type = 'highpass'; f.frequency.value = 900;
      g.gain.setValueAtTime(0.0001, this.ctx.currentTime);
      g.gain.exponentialRampToValueAtTime(0.1, this.ctx.currentTime + 0.2);
      s.connect(f); f.connect(g); g.connect(this.master);
      s.start();
      this._wind = { s, g, f };
    } else if (this._wind && !active) {
      try {
        this._wind.g.gain.exponentialRampToValueAtTime(0.0001, this.ctx.currentTime + 0.3);
        this._wind.s.stop(this.ctx.currentTime + 0.35);
      } catch (e) {}
      this._wind = null;
    }
  }
  pickup() { this.tone(880, 0.12, 'sine', 0.22); setTimeout(() => this.tone(1318, 0.18, 'sine', 0.2), 90); }
  flip() { this.noise(0.5, 500, 2, 0.18, 1800); }
  land(hard) { if (hard) { this.tone(70, 0.28, 'sine', 0.4, 45); this.noise(0.3, 220, 1.5, 0.25, 80); } else { this.tone(90, 0.12, 'sine', 0.15, 60); } }
  jump() { this.noise(0.35, 700, 3, 0.14, 1600); this.tone(320, 0.3, 'sine', 0.1, 120); }
  invert(on) { if (on) { this.tone(180, 0.6, 'sawtooth', 0.12, 520); this.noise(0.6, 400, 1.5, 0.14, 1500); } else { this.tone(420, 0.5, 'sawtooth', 0.1, 150); } }
  canister() { this.tone(660, 0.1, 'square', 0.14); setTimeout(() => this.tone(990, 0.16, 'square', 0.14), 80); }
  finish() {
    const seq = [[523,0],[659,0.16],[784,0.32],[1046,0.48]];
    for (const [f, t] of seq) setTimeout(() => this.tone(f, 0.5, 'sine', 0.24), t * 1000);
  }
}

// ---------------- 主状态 ----------------
const state = {
  started: false, finished: false, paused: false,
  camMode: 0, // 0 追尾 1 座舱
  mode: 'ground', // ground / air / inverted
  airTime: 0, bestAirTime: 0,
  flipAccum: 0, flipCount: 0,
  invertDist: 0,
  maxSpeedKMH: 0,
  collected: 0,
  score: 0,
  time: 0,
  shake: 0,
};

const input = { throttle: 0, steer: 0, boost: false, jump: false, jumpPressed: false, invertKey: false, invertPressed: false, settlePressed: false };

const audio = new AudioFX();
let particles = null, thrusterFX, post, tracks;
let moonBase;
let detailRocks, quality = 'high';
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// ---------------- Roadster2 车辆 ----------------
const car = {
  group: new THREE.Group(),
  vel: new THREE.Vector3(),
  yaw: 0,
  pitch: 0, roll: 0,        // 空中姿态
  up: new THREE.Vector3(0, 1, 0),
  grounded: true,
  airTank: CONFIG.airTankMax,
  spinSpeed: 0,
  steerAngle: 0,
  inverted: false,
  invertAnim: 0, // 0=正常 1=倒挂（插值）
  wingMode: 0,
  doorsOpen: false,
};
const carRefs = { spin: [], pivots: [], nozzles: [], frontNozzles: [], lowNozzles: [], mixer: null, actions: {} };

const MODEL_PATH = './assets/Roadster2.glb';

function loadRoadster() {
  return new Promise((resolve, reject) => {
    const loader = new GLTFLoader();
    loader.load(MODEL_PATH, (gltf) => {
      const m = gltf.scene;
      m.traverse((o) => {
        if (o.isMesh) {
          o.castShadow = true; o.receiveShadow = true;
          if (o.material) o.material.envMapIntensity = .8;
        }
      });
      // 收集引用
      m.traverse((o) => {
        if (!o.name) return;
        if (/^WheelSpin_/.test(o.name)) carRefs.spin.push(o);
        if (/^WheelPivot_FL$/.test(o.name) || /^WheelPivot_FR$/.test(o.name)) carRefs.pivots.push(o);
        if (/^ThrusterNozzle_0[5-8]$/.test(o.name)) carRefs.nozzles.push(o);
        if (/^ThrusterNozzle_0[1-4]$/.test(o.name)) carRefs.lowNozzles.push(o);
        if (/^Front braking cold-gas nozzle/.test(o.name)) carRefs.frontNozzles.push(o);
      });
      // 动画
      carRefs.mixer = new THREE.AnimationMixer(m);
      for (const clip of gltf.animations) {
        carRefs.actions[clip.name] = carRefs.mixer.clipAction(clip);
      }
      car.group.add(m);
      scene.add(car.group);
      resolve(gltf);
    }, undefined, (err) => reject(err));
  });
}

function carWorldPos(offset) {
  const v = new THREE.Vector3(offset[0], offset[1], offset[2]);
  return car.group.localToWorld(v);
}

function emitNozzle(dt) {
  thrusterFX.update(dt, state.time, car, state, input);
  const speed = Math.hypot(car.vel.x, car.vel.z);
  if (state.mode === 'ground' && speed > 3 && !state.atmosphere) {
    dustAcc += dt * Math.min(90, speed * 2);
    const n = Math.floor(dustAcc); dustAcc -= n;
    for (let i=0;i<n;i++) {
      const p = carWorldPos([Math.random() < .5 ? -.9 : .9, .12, -1.4]);
      particles.emit(p, new THREE.Vector3((Math.random()-.5)*3, .5+Math.random()*1.4, (Math.random()-.5)*3).addScaledVector(car.vel,.08), new THREE.Color(0x8d9197), 1+Math.random(), .18);
    }
  }
  if(!state.atmosphere)tracks.update(car,state);
}
let dustAcc = 0;

function physics(dt) {
  const previous=car.group.position.clone();
  const baseStep=stepBase(car,state,input,dt);
  const events=baseStep.events;
  if(!baseStep.handled){
    const floor=(x,z)=>baseFloor(x,z,terrainHeight);
    const normal=(x,z)=>inBaseLane({x,z})?new THREE.Vector3(0,1,0):terrainNormal(x,z);
    events.push(...stepVehicle(car,state,input,dt,CONFIG,floor,normal));
    resolveBaseCollision(car,state,previous);
  }
  state.atmosphere=inAtmosphere(car.group.position);
  if(state.baseLanded&&!car.base.landingAnnounced){car.base.landingAnnounced=true;msg('基地出舱完成 · 已安全返回月面','sub');}

  for(const event of events) {
    const baseMessages={
      'base-fast':'请减速后按 E 停靠（低于 43 km/h）',
      'base-attach':'外部供能吸附 · 正在转入墙面泊位',
      'base-parked':'墙面停稳 · 自动补气中 · 空格启动出舱',
      'base-refilled':'高压气罐已充满 · 空格辅助出舱 / W 手动爬升',
      'base-ascent':'出舱轨道已接管 · 正在爬升发射塔',
      'base-charge-first':'请先在泊位补气至 25% 以上',
      'base-hatch':'顶部气闸开启 · 保持倒姿出舱',
      'base-launched':'已离开基地 · 自动翻正快速下降 · WASD / 空格接管',
      'base-release':'已解除墙面吸附 · 注意离地高度'
    };
    if(baseMessages[event.type]){msg(baseMessages[event.type],'sub');if(event.type==='base-parked'||event.type==='base-refilled')audio.canister();}

    if(event.type==='takeoff') { audio.jump(); particlesBurst(car.group.position,38,0x9fa5ae); }
    if(event.type==='land') {
      audio.land(event.impact>6);
      state.shake=Math.min(.8,event.impact/18);
      particlesBurst(car.group.position,Math.min(70,Math.round(event.impact*4)),0xa0a3a6);
      if(event.airTime>1) msg(`着陆 · 腾空 ${event.airTime.toFixed(1)}s`, 'sub');
    }
    if(event.type==='flip') {audio.flip();msg(`360° 空翻 ×${event.count}`,'sub');completeObj('air');}
    if(event.type==='attach') {audio.invert(true);msg('吸附推进启动 · 正在接近管顶','sub');}
    if(event.type==='detach') {audio.invert(false);msg(car.airTank<1?'空气耗尽 · 脱离管顶':'脱离管顶 · 松开方向键自动回正','sub');}
    if(event.type==='unavailable') msg(event.reason==='air'?'空气不足，倒挂需要至少 15%':'请进入熔岩管内再按 E','warn');
  }
  if(state.bestAirTime>=4)completeObj('air');
  if(state.invertDist>=50)completeObj('invert');
  const kmh=Math.hypot(car.vel.x,car.vel.z)*3.6;
  state.maxSpeedKMH=Math.max(state.maxSpeedKMH,kmh);
  if(kmh>=300)completeObj('speed');
  const pos=car.group.position,dist=Math.hypot(pos.x,pos.z);
  if(dist>CONFIG.worldR){pos.x*=.995*CONFIG.worldR/dist;pos.z*=.995*CONFIG.worldR/dist;car.vel.x*=-.15;car.vel.z*=-.15;msg('已到月面边界，请折返','warn');}
  for(const w of carRefs.spin)w.rotation.x+=car.spinSpeed*dt;
  for(const p of carRefs.pivots)p.rotation.y=car.steerAngle;
}

function particlesBurst(pos, n, color) {
  const c = new THREE.Color(color);
  for (let i = 0; i < n; i++) {
    const v = new THREE.Vector3((Math.random() - 0.5) * 10, Math.random() * 6, (Math.random() - 0.5) * 10);
    particles.emit(pos.clone(), v, c, 0.5 + Math.random() * 0.5, 0.7);
  }
}

// ---------------- 晶体收集 ----------------
function updateCrystals(dt) {
  const pos = car.group.position;
  for (const c of crystals) {
    if (c.taken) continue;
    c.bob += dt * 2;
    c.mesh.position.y = crystalBaseY(c.def) + Math.sin(c.bob) * 0.5;
    c.mesh.rotation.y += dt * 1.5;
    c.glow.rotation.y += dt * 0.5;
    const dx = pos.x - c.def.x, dz = pos.z - c.def.z;
    const dy = Math.abs(pos.y - crystalBaseY(c.def));
    if (Math.hypot(dx, dz) < 4.2 && dy < 5) {
      c.taken = true;
      scene.remove(c.mesh); scene.remove(c.glow);
      state.collected++;
      crystalsLeft--;
      audio.pickup();
      particlesBurst(c.mesh.position, 22, 0x5ff0dc);
      msg(`氦-3 收集 ${state.collected}/8 · ${c.def.name}`, 'sub');
      if (state.collected >= CRYSTALS.length) completeObj('crystal');
      // 倒挂顶晶体奖励
      if (c.def.name === '熔岩管倒挂顶晶体') completeObj('invertTop');
    }
  }
  // 补给罐（基地 + 山脊）
  updateCanisters(dt);
}

// ---------------- 补给罐 ----------------
const canisters = [
  { x: 6, z: 4 }, { x: 9.4, z: 4 }, { x: 12.8, z: 4 },
  { x: 280, z: -300 },
];
const canisterMeshes = [];
function buildCanisters() {
  const mat = new THREE.MeshStandardMaterial({ color: 0x2aa8c4, emissive: 0x0c4a5e, emissiveIntensity: 1.4, roughness: 0.3 });
  for (const c of canisters) {
    const y = terrainHeight(c.x, c.z) + 1.6;
    const m = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 0.9, 2, 12), mat);
    m.position.set(c.x, y, c.z);
    m.castShadow = true;
    scene.add(m);
    canisterMeshes.push({ def: c, mesh: m, taken: false });
  }
}
function updateCanisters(dt) {
  const pos = car.group.position;
  for (const c of canisterMeshes) {
    if (c.taken) continue;
    c.mesh.rotation.y += dt * 1.2;
    if (Math.hypot(pos.x - c.def.x, pos.z - c.def.z) < 3.5 && Math.abs(pos.y - terrainHeight(c.def.x, c.def.z)) < 4) {
      c.taken = true;
      scene.remove(c.mesh);
      car.airTank = Math.min(CONFIG.airTankMax, car.airTank + CONFIG.canisterGain);
      audio.canister();
      msg(`压缩空气补充 +${CONFIG.canisterGain}`, 'sub');
    }
  }
}

// ---------------- 目标系统 ----------------
const OBJECTIVES = [
  { id: 'crystal', label: '收集 8 颗氦-3 晶体', done: false, hot: true },
  { id: 'speed', label: '极速 ≥ 300 km/h', done: false },
  { id: 'air', label: '单次腾空 ≥ 4s 或 360° 空翻', done: false },
  { id: 'invert', label: '倒挂行驶 ≥ 50 米', done: false },
  { id: 'return', label: '返回基地结算', done: false },
];
function completeObj(id) {
  const o = OBJECTIVES.find((x) => x.id === id);
  if (!o || o.done) return;
  o.done = true;
  renderObjectives();
  if (id !== 'return') audio.tone(1046, 0.15, 'sine', 0.15);
  // 全部完成提示
  if (OBJECTIVES.slice(0, 4).every((x) => x.done) && !state.finished) {
    msg('全部挑战完成！返回基地结算', '');
  }
}
function renderObjectives() {
  const box = $('#objBox');
  box.innerHTML = '';
  for (const o of OBJECTIVES) {
    const d = document.createElement('div');
    d.className = 'obj' + (o.done ? ' done' : '');
    d.innerHTML = `<span class="dot"></span><span>${o.label}</span>`;
    box.appendChild(d);
  }
}

// ---------------- 消息 ----------------
function msg(text, cls = '') {
  const feed = $('#msgFeed');
  const d = document.createElement('div');
  d.className = 'msg' + (cls ? ' ' + cls : '');
  d.textContent = text;
  feed.appendChild(d);
  while (feed.children.length > 4) feed.removeChild(feed.firstChild);
  setTimeout(() => { if (d.parentNode) d.parentNode.removeChild(d); }, 3600);
}

// ---------------- 相机 ----------------
let cameraYaw = -Math.PI/2;
const cameraRig = new CameraRig();
function updateCamera(dt) {
  cameraRig.update(camera,car,state,dt,{config:CONFIG,height:terrainHeight,motion:post.motion,reducedMotion});
  cameraYaw=cameraRig.yaw;
  sun.position.copy(car.group.position).add(new THREE.Vector3(-500,380,300));sun.target.position.copy(car.group.position);
}

// ---------------- 指南针 ----------------
function updateCompass() {
  const pos = car.group.position;
  let tx = CONFIG.base.x, tz = CONFIG.base.z, label = '基地';
  const nearest = crystals.filter(c=>!c.taken).sort((a,b)=>Math.hypot(a.def.x-pos.x,a.def.z-pos.z)-Math.hypot(b.def.x-pos.x,b.def.z-pos.z))[0];
  if (nearest) { tx = nearest.def.x; tz = nearest.def.z; label = '最近氦-3'; }
  const dx = tx - pos.x, dz = tz - pos.z;
  const dist = Math.hypot(dx, dz);
  const fwd = new THREE.Vector3(0, 0, 1).applyQuaternion(car.group.quaternion);
  let ang = Math.atan2(dx, dz) - Math.atan2(fwd.x, fwd.z);
  while (ang > Math.PI) ang -= Math.PI * 2;
  while (ang < -Math.PI) ang += Math.PI * 2;
  $('#compassArrow').style.transform = `rotate(${ang}rad)`;
  $('#compass').textContent = `${label} · ${Math.round(dist)}m`;
}

// ---------------- HUD 更新 ----------------
function updateHUD(dt) {
  const pct = Math.round(car.airTank);
  $('#airPct').textContent = pct + '%';
  $('#airFill').style.width = pct + '%';
  $('#airFill').classList.toggle('low', pct < 25);
  const invLine = $('#invLine');
  invLine.style.display = state.mode === 'inverted' ? 'block' : 'none';
  $('#modeLine').textContent =
    state.mode === 'inverted' ? '倒挂模式 · 熔岩管顶部' :
    state.mode === 'air' ? '腾空模式 · 低重力' : '探索模式 · 月面';
  // 腾空计时
  if (state.mode === 'air') {
    const el = $('#modeLine');
    el.textContent = `腾空模式 · ${state.airTime.toFixed(1)}s`;
  }
  $('#speedNum').textContent = Math.round(Math.hypot(car.vel.x,car.vel.z)*3.6);
  const altitude=Math.max(0,car.group.position.y-terrainHeight(car.group.position.x,car.group.position.z));
  $('#altitude').textContent=altitude.toFixed(1)+' m';
  $('#flightTime').textContent=state.airTime.toFixed(1)+' s';
  $('#flipCount').textContent=state.flipCount;
  $('#gripDistance').textContent=state.invertDist.toFixed(0)+' m';
  $('#thrustMode').textContent=car.mainThrust>.1?'MAIN THRUST':car.downThrust>.1?'LIFT THRUST':state.mode==='inverted'?'CEILING LOCK':state.mode==='air'?'FREE FLIGHT':'LUNAR CRUISE';
  $('#flightPanel').classList.toggle('active',state.mode!=='ground');
  if(isBaseAttached(state)){
    $('#modeLine').textContent=state.mode==='base_wall'?'基地 · 垂直墙面吸附':state.mode==='base_attach'?'基地 · 停靠对接':state.mode==='base_roof'?'基地 · 管顶倒挂出舱':'基地 · 倒姿发射';
    $('#thrustMode').textContent=state.mode==='base_wall'&&Math.abs(car.base.speed)<.4?'DOCKED / REFILL':'ASCENT CONTROL';
    $('#speedNum').textContent=Math.round(car.vel.length()*3.6);
  }
  const nearBase=Math.hypot(car.group.position.x,car.group.position.z)<135;
  $('#basePanel').classList.toggle('hidden',!nearBase&&!isBaseAttached(state)&&!car.base.launchPending);
  $('#basePressure').textContent=state.atmosphere?'101.3 kPa · O₂ 21% · 舱内':'真空 · 舱外';
  $('#baseSteps').textContent=`${state.baseDocked?'●':'○'} 墙面停靠   ${state.baseRefilled?'●':'○'} 气罐补满   ${state.baseLaunched?'●':'○'} 顶部出舱   ${state.baseLanded?'●':'○'} 月面着陆`;
  $('#baseHint').textContent=state.mode==='base_attach'?'供能轨道对接中…':state.mode==='base_wall'?'松开 W/S 停车补气 · 空格出舱 · Enter 结算':state.mode==='base_roof'||state.mode==='base_launch'?'顶部倒姿出舱中 · S 取消辅助爬升':state.mode==='air'?(car.base.descentAssist?'快速降落辅助中 · WASD / 空格接管':'松开方向键自动回正 · WASD 控制姿态'):inBaseLane(car.group.position)?'沿蓝色灯带驶向内墙，低速按 E 吸附':'沿前方蓝色灯带，从底部气闸驶入';
  updateCompass();
  window.__carProbe={x:car.group.position.x,y:car.group.position.y,z:car.group.position.z,mode:state.mode,speed:car.vel.length(),air:car.airTank,flips:state.flipCount,airTime:state.airTime,invertDist:state.invertDist,mainThrust:car.mainThrust,downThrust:car.downThrust,drawCalls:renderer.info.render.calls,baseDocked:state.baseDocked,baseRefilled:state.baseRefilled,baseLaunched:state.baseLaunched,baseLanded:state.baseLanded,atmosphere:state.atmosphere};
}

// ---------------- 结算 ----------------
function finishRun() {
  if (state.finished) return;
  state.finished = true;
  audio.finish();
  const crystalPts = state.collected * 100;
  const speedPts = state.maxSpeedKMH >= 300 ? 300 : Math.round(state.maxSpeedKMH * 0.6);
  const airPts = Math.round(state.bestAirTime * 60) + state.flipCount * 150;
  const invertPts = Math.round(state.invertDist * 2.5);
  const basePts = 200;
  state.score = crystalPts + speedPts + airPts + invertPts + basePts;
  let rating = 'C';
  if (state.score >= 2400) rating = 'SSS';
  else if (state.score >= 2000) rating = 'SS';
  else if (state.score >= 1600) rating = 'S';
  else if (state.score >= 1200) rating = 'A';
  else if (state.score >= 800) rating = 'B';
  const rows = [
    ['氦-3 晶体', `${state.collected} × 100 = ${crystalPts}`],
    ['极速', `${Math.round(state.maxSpeedKMH)} km/h → ${speedPts}`],
    ['腾空', `最长 ${state.bestAirTime.toFixed(1)}s · 空翻 ×${state.flipCount} → ${airPts}`],
    ['倒挂行驶', `${Math.round(state.invertDist)}m → ${invertPts}`],
    ['基地返航', `+${basePts}`],
    ['总得分', `${state.score}`],
  ];
  $('#finishStats').innerHTML = rows.map((r) => `<tr><td>${r[0]}</td><td>${r[1]}</td></tr>`).join('');
  $('#ratingText').textContent = `评分：${rating}${rating === 'SSS' ? ' — 月面传奇车手！' : rating === 'S' ? ' — 优秀的探险家。' : rating === 'A' ? ' — 干得不错。' : ' — 继续探索月面吧。'}`;
  $('#finishOv').classList.remove('hidden');
  $('#hud').classList.remove('on');
  renderObjectives();
}

function resetRun() {
  baseWarned = false;
  $('#msgFeed').replaceChildren();
  state.finished = false;
  state.mode = 'ground';
  state.airTime = 0; state.bestAirTime = 0;
  state.flipAccum = 0; state.flipCount = 0;
  state.invertDist = 0;
  state.maxSpeedKMH = 0;
  state.collected = 0; crystalsLeft = CRYSTALS.length;
  state.time = 0; state.score = 0; state.shake = 0;
  car.inverted = false; car.invertAnim = 0;
  resetDynamics(car); resetBase(car,state); clearInput(); particles?.clear(); thrusterFX?.reset(); tracks?.reset();
  car.vel.set(0, 0, 0);
  car.yaw = -Math.PI / 2; // 朝向 -X（面朝基地）
  car.pitch = 0; car.roll = 0; cameraYaw=car.yaw;cameraRig.reset(car.yaw);
  car.group.position.set(CONFIG.base.x + 95, terrainHeight(CONFIG.base.x + 95, 0), 0);
  car.airTank = CONFIG.airTankMax;
  car.group.quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), car.yaw);
  // 重置晶体
  for (const c of crystals) {
    if (!c.taken) continue;
    c.taken = false;
    c.mesh.visible = true; c.glow.visible = true;
    scene.add(c.mesh); scene.add(c.glow);
  }
  for (const c of canisterMeshes) {
    if (!c.taken) continue;
    c.taken = false; scene.add(c.mesh);
  }
  for (const o of OBJECTIVES) o.done = false;
  renderObjectives();
  msg('任务已重置，出发！', '');
  $('#hud').classList.add('on');
  $('#finishOv').classList.add('hidden');
}

// ---------------- 输入 ----------------
let videoLibrary = null;
let pausedBeforeVideo = false;
const keyMap = {};
window.addEventListener('keydown', (e) => {
  if (videoLibrary?.isOpen) return;
  if (e.code === 'KeyV' && !e.repeat) { e.preventDefault(); videoLibrary?.show(); return; }
  if (e.target.closest('select, input, button')) return;
  if(e.repeat && ['KeyM','KeyF','KeyO','KeyC','KeyE','KeyR','Escape'].includes(e.code))return;
  if(e.code==='Enter'&&!e.repeat){input.settlePressed=true;return;}
  if (e.code === 'KeyM') { audio.setMuted(!audio.muted); return; }
  if (e.code === 'KeyF' && state.started) {
    car.wingMode = (car.wingMode + 1) % 3;
    const act = carRefs.actions;
    if (act) {
      for (const k of ['Wing_LowDrag', 'Airbrake_DeployRetract']) if (act[k]) act[k].stop();
      if (car.wingMode === 1 && act['Wing_LowDrag']) act['Wing_LowDrag'].play();
      if (car.wingMode === 2 && act['Airbrake_DeployRetract']) act['Airbrake_DeployRetract'].play();
      if (car.wingMode === 0) {
        // 收起：反向播放
        for (const k of ['Wing_LowDrag', 'Airbrake_DeployRetract']) if (act[k]) { act[k].reset(); }
      }
    }
    const names = ['收起', '低风阻', '空气刹车'];
    msg(`尾翼：${names[car.wingMode]}`, 'sub');
    return;
  }
  if (e.code === 'KeyO' && state.started) {
    car.doorsOpen = !car.doorsOpen;
    const a = carRefs.actions && carRefs.actions['Doors_OpenClose'];
    if (a) {
      a.reset(); a.timeScale = car.doorsOpen ? 1 : -1; a.play();
    }
    return;
  }
  if (e.code === 'KeyC') { state.camMode = (state.camMode + 1) % 3; return; }
  if (e.code === 'KeyE') { if(state.started&&!state.paused)input.invertPressed = true; return; }
  if (e.code === 'KeyR' && state.started) { resetRun(); return; }
  if (e.code === 'Escape') { togglePause(true); return; }
  if (e.code === 'Space') { e.preventDefault(); if(!e.repeat&&!keyMap.Space)input.jumpPressed=true; }
  keyMap[e.code] = true;
});
window.addEventListener('keyup', (e) => { keyMap[e.code] = false; });
window.addEventListener('blur', () => { if (state.started && !state.finished && !videoLibrary?.isOpen) togglePause(true); });

function sampleInput() {
  input.throttle = 0;
  if (keyMap['KeyW'] || keyMap['ArrowUp']) input.throttle += 1;
  if (keyMap['KeyS'] || keyMap['ArrowDown']) input.throttle -= 1;
  input.steer = 0;
  if (keyMap['KeyA'] || keyMap['ArrowLeft']) input.steer -= 1;
  if (keyMap['KeyD'] || keyMap['ArrowRight']) input.steer += 1;
  input.boost = !!keyMap['ShiftLeft'] || !!keyMap['ShiftRight'];
  input.jump = !!keyMap['Space'];
  input.invertKey = !!keyMap['KeyE'];
}

function clearInput(){for(const k of Object.keys(keyMap))delete keyMap[k];input.jump=input.boost=input.jumpPressed=input.invertPressed=input.settlePressed=false;input.throttle=input.steer=0;}

function togglePause(paused) {
  state.paused = paused; clearInput(); audio.boost(false); audio.wind(false,0); if(audio.ctx) { if(paused)audio.ctx.suspend();else audio.resume(); }
  $('#pauseOv').classList.toggle('hidden', !paused);
  if (!paused) { document.activeElement?.blur(); audio.resume(); }
}

// ---------------- 主循环 ----------------
let last = now(), accumulator = 0;
function loop() {
  requestAnimationFrame(loop);
  const t = now();
  let dt = (t - last) / 1000;
  last = t;
  dt = clamp(dt, 0.001, 0.05);
  if (videoLibrary?.isOpen) { accumulator = 0; return; }
  if (!state.started || state.paused || state.finished) {
    accumulator=0;post.render(scene,camera,car,state);
    return;
  }
  state.time += dt;
  sampleInput();
  accumulator+=dt;
  while(accumulator>=1/120){physics(1/120);accumulator-=1/120;if(state.finished){accumulator=0;break;}}
  if(carRefs.mixer)carRefs.mixer.update(dt);
  emitNozzle(dt);
  audio.boost(car.mainThrust>.05 || car.downThrust>.05 || car.gripThrust>.1,car.airTank/100);
  audio.engineUpdate(Math.hypot(car.vel.x,car.vel.z)*3.6,Math.abs(input.throttle));
  audio.wind(state.mode==='air',car.vel.length());
  updateCrystals(dt);
  moonBase.update(dt,state.time,car,state);
  scene.fog.color.set(state.atmosphere?0x183546:0x05080f);scene.fog.near=state.atmosphere?25:600;scene.fog.far=state.atmosphere?180:2600;
  updateCamera(dt);
  updateHUD(dt);
  particles.update(dt,renderer.domElement.height);
  // 动画循环：晶体浮动
  post.render(scene,camera,car,state);
}

// ---------------- 初始化 ----------------
window.__gameState = 'boot';
async function init() {
  const loading = $('#loading');
  window.__gameState = 'init:start';
  try {
    surfaceMaps=await loadSurface(renderer);
    addReflectionEnvironment(scene,renderer);
    buildStars();
    buildEarth();
    buildSunGlow();
    buildTerrain();
    buildTube();
    buildCrystals();
    buildCanisters();
    moonBase=new MoonBase(scene);
    detailRocks=addSurfaceDetails(scene,terrainHeight,CONFIG,surfaceMaps);
    window.__gameState = 'init:built';
    particles = new LunarParticles(scene);
    window.__gameState = 'init:loading-model';
    await loadRoadster();
    window.__gameState = 'init:model-loaded';
    thrusterFX=new ThrusterFX(car.group,particles);
    tracks=new WheelTracks(scene,terrainHeight);
    post=new LunarPost(renderer);post.motion=!reducedMotion;
    $('#motionToggle').checked=post.motion;
    setQuality(window.innerWidth<900?'balanced':'high');
    resetRun();
    renderObjectives();
    window.__gameState = 'init:reset-done';
    loading.style.display = 'none';
    $('#startOv').style.display = 'flex';
    // 加载完成后的轻微循环渲染（预览背景）
    renderer.render(scene, camera);
    camera.position.set(125,88,115);
    camera.lookAt(0,BASE.ground+20,0);
    last = now();
    loop();
    window.__gameState = 'init:done';
  } catch (err) {
    console.error(err);
    window.__gameState = 'init:error:' + err.message;
    loading.innerHTML = `<p style="color:#ff9a5c">模型加载失败：${err.message}</p>`;
  }
}

function setQuality(value){
  quality=value;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio,value==='high'?1.75:value==='balanced'?1.25:1));
  renderer.setSize(innerWidth,innerHeight);renderer.shadowMap.enabled=value!=='performance';
  if(detailRocks)detailRocks.count=value==='high'?3400:1500;
  if(post){post.enabled=value!=='performance'&&post.supported;post.bloom=value==='high';post.resize();}
  $('#qualitySelect').value=value;
}
function bindUI() {
  videoLibrary = initVideoLibrary({
    onOpen() {
      pausedBeforeVideo = state.paused;
      state.paused = true;
      clearInput(); audio.boost(false); audio.wind(false, 0);
      audio.ctx?.suspend();
    },
    onClose() {
      state.paused = pausedBeforeVideo;
      clearInput();
      if (state.started && !state.paused && !state.finished) { document.activeElement?.blur(); audio.resume(); }
    },
  });
  $('#qualitySelect').addEventListener('change',e=>setQuality(e.target.value));
  $('#motionToggle').addEventListener('change',e=>{if(post)post.motion=e.target.checked;});
  const btn = $('#startBtn');
  if (btn) btn.addEventListener('click', () => {
    document.activeElement?.blur();
    audio.init();
    audio.resume();
    state.started = true;
    state.paused = false;
    $('#startOv').style.display = 'none';
    $('#hud').classList.add('on');
    audio.engine();
    msg('沿蓝色灯带驶入基地 · 内墙按 E 停靠补气', '');
  });
  $('#baseStartBtn').addEventListener('click',()=>{
    $('#startBtn').click();resetRun();car.group.position.set(77,baseFloor(77,0,terrainHeight),0);car.airTank=30;car.yaw=-Math.PI/2;
    msg('基地演练：W 驶入 → E 停靠 → 松开补气 → 空格出舱','sub');
  });
  const pBtn = $('#pauseBtn');
  if (pBtn) pBtn.addEventListener('click', () => togglePause(true));
  const rBtn = $('#resumeBtn');
  if (rBtn) rBtn.addEventListener('click', () => togglePause(false));
  const rstBtn = $('#restartBtn');
  if (rstBtn) rstBtn.addEventListener('click', () => { togglePause(false); resetRun(); });
  const aBtn = $('#againBtn');
  if (aBtn) aBtn.addEventListener('click', () => resetRun());
  const cBtn = $('#closeBtn');
  if (cBtn) cBtn.addEventListener('click', () => {
    state.finished = false;
    $('#finishOv').classList.add('hidden');
    $('#hud').classList.add('on');
  });
}

// 返回基地检测
let baseWarned = false;
function checkReturn() {
  if (state.finished || !state.started) return;
  if(!input.settlePressed)return;
  input.settlePressed=false;
  if(state.mode!=='base_wall'||Math.abs(car.base.speed)>.4){msg('请在基地墙面泊位停稳后按 Enter 结算','warn');return;}
  const doneAny=OBJECTIVES.slice(0,4).some(o=>o.done);
  if(!doneAny){msg('先完成至少一项探索挑战；现在可补气后出舱','sub');return;}
  completeObj('return');finishRun();
}
// 挂到 physics 末尾
const _physics = physics;
physics = function (dt) {
  _physics(dt);
  checkReturn();
};

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight); post?.resize();
});

// 等待 DOM 就绪后绑定 UI（防御式）
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => { bindUI(); init(); });
} else {
  bindUI();
  init();
}

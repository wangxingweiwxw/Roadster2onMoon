import * as THREE from '../lib/three.module.min.js';
import { CONFIG } from './config.js';
const clamp=THREE.MathUtils.clamp;
const smooth=t=>t*t*(3-2*t);
const CRATERS = [
  { x: -620, z: 520, r: 150, depth: 48, rim: 13 },
  { x: 720, z: -660, r: 110, depth: 36, rim: 10 },
  { x: -480, z: -700, r: 95, depth: 30, rim: 8 },
  { x: -260, z: -120, r: 55, depth: 16, rim: 5 },
  { x: 260, z: 420, r: 48, depth: 13, rim: 4 },
  { x: 880, z: 260, r: 42, depth: 12, rim: 3.5 },
  { x: -820, z: -180, r: 38, depth: 10, rim: 3 },
];

export function terrainHeight(x, z) {
  let h = 0;
  h += Math.sin(x * 0.0021) * Math.cos(z * 0.0017) * 42;
  h += Math.sin(x * 0.0053 + 1.2) * Math.sin(z * 0.0041 + 0.8) * 18;
  h += Math.sin(x * 0.011 + 2.3) * Math.cos(z * 0.009 + 1.1) * 6;
  h += Math.sin(x * 0.02 + 0.4) * Math.cos(z * 0.017 + 2.2) * 2.5;
  // 山脊（腾空跳台，斜穿 z≈-320）
  const ridgeZ = -320 + Math.sin(x * 0.004) * 42;
  h += 26 * Math.exp(-Math.pow((z - ridgeZ) / 58, 2));
  // 环形山
  for (const c of CRATERS) {
    const d = Math.hypot(x - c.x, z - c.z);
    if (d > c.r * 1.28) continue;
    const t = d / c.r;
    h += -c.depth * Math.pow(Math.max(0, 1 - t * t), 2);
    h += c.rim * Math.exp(-Math.pow((t - 0.78) / 0.10, 2));
  }
  // Level a small base foundation, fading into the original lunar surface.
  const baseDistance = Math.hypot(x - CONFIG.base.x, z - CONFIG.base.z);
  if (baseDistance < 115) h = THREE.MathUtils.lerp(14.7, h, smooth(clamp((baseDistance - 82) / 33, 0, 1)));
  // 熔岩管沟槽：两端坡道 + 管底平地（与管底地板同高，避免台阶）
  const tube = CONFIG.tube;
  const dz = Math.abs(z - tube.zc);
  if (x > tube.x0 - 110 && x < tube.x1 + 110 && dz < 26 + 100) {
    const dxg = Math.max(0, Math.abs(x - (tube.x0 + tube.x1) / 2) - (tube.x1 - tube.x0) / 2);
    const dzg = Math.max(0, dz - 24);
    const edge = Math.max(dxg, dzg);
    const blend = smooth(clamp(edge / 90, 0, 1));
    h = h * blend + tube.floorY * (1 - blend);
  }
  return h;
}

export function terrainNormal(x, z) {
  const e = 1.2;
  const hx = terrainHeight(x + e, z) - terrainHeight(x - e, z);
  const hz = terrainHeight(x, z + e) - terrainHeight(x, z - e);
  const n = new THREE.Vector3(-hx / (2 * e), 1, -hz / (2 * e)).normalize();
  return n;
}


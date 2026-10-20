import * as THREE from '../lib/three.module.min.js';
import { BASE, baseFloor } from './base-layout.js';
import { isBaseAttached } from './base-physics.js';

export function baseCameraPose(car, state) {
  const p = car.group.position;
  if (state.mode === 'base_launch' || (car.base.launchPending && state.mode === 'air'))
    return { offset: new THREE.Vector3(18, 8, 18), look: new THREE.Vector3(-2, 1, 0) };
  if (isBaseAttached(state))
    return { offset: new THREE.Vector3(12, 2.5, 6), look: new THREE.Vector3(0, 1.5, 0) };
  // Start the corridor camera before crossing the pressure boundary.
  if (p.x >= BASE.wallX && p.x < BASE.rampEndX + 10 && Math.abs(p.z) < BASE.laneHalfWidth && p.y < BASE.floor + 7)
    return { offset: new THREE.Vector3(8, 3, 1.5), look: new THREE.Vector3(-2, 1, 0) };
  return null;
}

// Keep transition state separate from the rendered camera. No distance-triggered
// teleport: only actual terrain/tunnel intersections may shorten the camera boom.
export class CameraRig {
  constructor() {
    this.offset = new THREE.Vector3(); this.lookOffset = new THREE.Vector3();
    this.position = new THREE.Vector3(); this.focus = new THREE.Vector3();
    this.up = new THREE.Vector3(0, 1, 0); this.aim = new THREE.Object3D();
    this.ready = false; this.yaw = -Math.PI / 2;
  }
  reset(yaw) { this.ready = false; this.yaw = yaw; }
  update(camera, car, state, dt, { config, height, motion = true, reducedMotion = false }) {
    const p = car.group.position, speed = Math.hypot(car.vel.x, car.vel.z);
    const alpha = rate => 1 - Math.exp(-rate * dt);
    const delta = Math.atan2(Math.sin(car.yaw - this.yaw), Math.cos(car.yaw - this.yaw));
    this.yaw += THREE.MathUtils.clamp(delta * alpha(5), -2.4 * dt, 2.4 * dt);
    const base = baseCameraPose(car, state), cockpit = state.camMode === 1 && !base;
    const inverted = state.mode === 'inverted';
    const forward = new THREE.Vector3(Math.sin(this.yaw), 0, Math.cos(this.yaw));
    const offset = forward.multiplyScalar(-(state.camMode === 2 ? 16 : 8.8) - Math.min(speed, 90) * .025);
    offset.y = inverted ? -3.3 : state.camMode === 2 ? 6 : 3.4;
    const look = new THREE.Vector3(0, inverted ? -.6 : .6, 0), up = new THREE.Vector3(0, 1, 0);
    if (base) { offset.copy(base.offset); look.copy(base.look); }
    else if (cockpit) {
      up.applyQuaternion(car.group.quaternion);
      const nose = new THREE.Vector3(0, 0, 1).applyQuaternion(car.group.quaternion);
      offset.copy(up).multiplyScalar(.96).addScaledVector(nose, .5);
      look.copy(offset).addScaledVector(nose, 30);
    }
    if (!this.ready) {
      this.offset.copy(offset); this.lookOffset.copy(look); this.up.copy(up);
      this.position.copy(p).add(offset); this.focus.copy(p).add(look); this.ready = true;
    }
    this.offset.add(offset.sub(this.offset).multiplyScalar(alpha(3.5)).clampLength(0, 16 * dt));
    this.lookOffset.add(look.sub(this.lookOffset).multiplyScalar(alpha(3.5)).clampLength(0, 12 * dt));
    this.up.lerp(up, alpha(8)); if (this.up.lengthSq() < .001) this.up.set(0, 1, 0);
    this.up.normalize();
    this.position.lerp(p.clone().add(this.offset), alpha(cockpit ? 18 : 8));
    this.focus.lerp(p.clone().add(this.lookOffset), alpha(cockpit ? 18 : 8));
    const anchor = p.clone().add(new THREE.Vector3(0, inverted ? -.8 : .8, 0));
    if (!cockpit) {
      const desired = this.position.clone(), tube = config.tube;
      for (let i = 1; i <= 60; i++) {
        const sample = anchor.clone().lerp(desired, i / 60);
        const inTube = sample.x > tube.x0 && sample.x < tube.x1 && Math.abs(sample.z - tube.zc) < 13;
        if (sample.y < baseFloor(sample.x, sample.z, height) + .45 || (inTube && (Math.abs(sample.z - tube.zc) > 10.7 || sample.y > tube.ceilY - .4))) {
          this.position.copy(anchor).lerp(desired, (i - 1) / 60); break;
        }
      }
    }
    this.position.y = Math.max(this.position.y, baseFloor(this.position.x, this.position.z, height) + .45);
    camera.position.copy(this.position);
    this.aim.position.copy(this.position); this.aim.up.copy(this.up); this.aim.lookAt(this.focus);
    // Object3D looks along +Z; cameras look along -Z.
    this.aim.rotateY(Math.PI);
    const turn = camera.quaternion.angleTo(this.aim.quaternion);
    camera.quaternion.slerp(this.aim.quaternion, Math.min(alpha(12), 1.8 * dt / Math.max(turn, 1e-6)));
    camera.up.copy(this.up);
    if (!base && !reducedMotion && motion && state.shake > 0) {
      camera.position.x += Math.sin(state.time * 82) * state.shake * .07;
      camera.position.y += Math.sin(state.time * 67) * state.shake * .05;
    }
    state.shake *= Math.exp(-6 * dt);
    const fov = base ? 70 : 64 + (motion ? Math.min(speed / 100, 1) * 7 + car.mainThrust * 6 : 0);
    camera.fov += (fov - camera.fov) * alpha(4); camera.updateProjectionMatrix();
  }
}

// Lunar arcade dynamics. RCS damping and contact-state design inspired by
// openracing/src/physics/vehicle.ts (MPL-2.0). This file is MPL-2.0.
import * as THREE from '../lib/three.module.min.js';
const UP = new THREE.Vector3(0, 1, 0);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const wrap = a => Math.atan2(Math.sin(a), Math.cos(a));

export function resetDynamics(car) {
  Object.assign(car, { grounded: true, pitch: 0, roll: 0, pitchRate: 0,
    rollRate: 0, pitchArc: 0, rollArc: 0, mainThrust: 0, downThrust: 0,
    rcs: 0, gripThrust: 0, attachTime: 0, attachY: 0, regenDelay: 0,
    steerAngle: 0, spinSpeed: 0 });
}

export function stepVehicle(car, state, input, dt, config, height, normal) {
  const events = [], p = car.group.position, v = car.vel, t = config.tube;
  const inside = p.x > t.x0 && p.x < t.x1 && Math.abs(p.z - t.zc) < 10.2;
  const attachZone = inside && p.x > t.enter && p.x < t.exit;
  let detached = false;
  const detach = () => {
    state.mode = 'air'; car.grounded = false; car.inverted = false;
    car.roll = Math.PI; car.pitch = 0; car.rollRate = car.pitchRate = 0;
    car.rollArc = car.pitchArc = 0; state.airTime = 0; v.y = -1.5;
    events.push({ type: 'detach' }); detached = true;
  };
  if (state.mode === 'inverted' && (!attachZone || car.airTank <= 0 || input.invertPressed)) detach();
  else if (input.invertPressed && state.mode !== 'inverted') {
    if (attachZone && car.airTank >= 15) {
      car.airTank -= 5; car.attachY = p.y; car.attachTime = 0;
      state.mode = 'inverted'; car.inverted = true; car.grounded = false;
      events.push({ type: 'attach' });
    } else events.push({ type: 'unavailable', reason: attachZone ? 'air' : 'zone' });
  }
  input.invertPressed = false;
  let used = false;
  const spend = amount => {
    const fraction = Math.min(1, car.airTank / Math.max(amount, 1e-8));
    car.airTank = Math.max(0, car.airTank - amount); used ||= fraction > 0;
    return fraction;
  };
  car.mainThrust = car.downThrust = car.rcs = car.gripThrust = 0;
  const inverted = state.mode === 'inverted';
  const groundY = height(p.x, p.z);
  if (!inverted && state.mode !== 'air' && p.y > groundY + 0.65) {
    state.mode = 'air'; car.grounded = false; state.airTime = 0;
  }
  if (inverted) {
    car.gripThrust = spend(config.invertDrain * dt);
    car.attachTime = Math.min(1, car.attachTime + dt / 0.95);
    const ease = car.attachTime * car.attachTime * (3 - 2 * car.attachTime);
    p.y = THREE.MathUtils.lerp(car.attachY, t.ceilY, ease);
    car.roll = Math.PI * ease; car.pitch = 0; v.y = 0;
    car.grounded = car.attachTime >= 1;
  }
  const groundDrive = state.mode === 'ground' || inverted;
  if (groundDrive) {
    const speed = Math.hypot(v.x, v.z);
    const forward = new THREE.Vector3(Math.sin(car.yaw), 0, Math.cos(car.yaw));
    let longitudinal = v.dot(forward);
    // Nose is +Z: viewed from behind, screen-right is forward × world-up (-X).
    car.yaw -= input.steer * THREE.MathUtils.lerp(config.turnRate, config.turnRateHi,
      clamp(speed / config.maxSpeed, 0, 1)) * dt * (longitudinal < -0.5 ? -1 : 1) * Math.min(1, speed / 2);
    forward.set(Math.sin(car.yaw), 0, Math.cos(car.yaw));
    let acc = input.throttle * (input.throttle < 0 && longitudinal > 0 ? config.brakeDecel : config.engineAccel);
    if (input.boost && input.throttle >= 0) {
      car.mainThrust = spend(config.boostDrain * dt); acc += config.boostAccel * car.mainThrust;
    }
    longitudinal += acc * dt;
    longitudinal *= Math.exp(-config.drag * dt);
    longitudinal = clamp(longitudinal, -12, car.mainThrust > 0 ? config.boostMaxSpeed : Math.max(config.maxSpeed, speed - 16 * dt));
    const lateral = v.clone().addScaledVector(forward, -v.dot(forward)).setY(0).multiplyScalar(Math.exp(-7 * dt));
    v.copy(forward).multiplyScalar(longitudinal).add(lateral);
    const n = normal(p.x, p.z);
    if (!inverted) v.y = -(n.x * v.x + n.z * v.z) / Math.max(0.3, n.y);
    p.x += v.x * dt; p.z += v.z * dt;
    if (!inverted) {
      p.y = height(p.x, p.z); car.grounded = true;
      const nextNormal = normal(p.x + v.x * 0.06, p.z + v.z * 0.06);
      const nextSlope = -(nextNormal.x * v.x + nextNormal.z * v.z) / Math.max(0.3, nextNormal.y);
      if ((input.jumpPressed && car.airTank >= 5) || (v.y > 2 && v.y - nextSlope > 1.1 && speed > 18)) {
        if (input.jumpPressed) { spend(5); v.y = Math.max(0, v.y) + config.jumpImpulse; }
        state.mode = 'air'; car.grounded = false; state.airTime = 0;
        car.pitchArc = car.rollArc = 0; car.pitch = car.roll = 0;
        p.y += 0.025; events.push({ type: 'takeoff' });
      }
    } else if (car.grounded) state.invertDist += Math.hypot(v.x, v.z) * dt;
  } else {
    state.mode = 'air'; car.grounded = false; state.airTime += dt;
    state.bestAirTime = Math.max(state.bestAirTime, state.airTime);
    const control = (Math.abs(input.throttle) + Math.abs(input.steer)) > 0;
    if (car.base?.descentAssist && (control || input.jump || input.boost)) car.base.descentAssist = false;
    const assistedDescent = car.base?.descentAssist && car.base.flightGrace <= 0;
    car.rcs = control ? spend(3 * dt) : 0;
    const damping = 1 - Math.exp(-6 * dt);
    car.pitchRate += (-input.throttle * config.airPitchRate * car.rcs - car.pitchRate) * damping;
    car.rollRate += (input.steer * config.airRollRate * car.rcs - car.rollRate) * damping;
    const dp = car.pitchRate * dt, dr = car.rollRate * dt;
    car.pitch += dp; car.roll += dr;
    // Track signed, single-axis turns; alternating input cannot farm flips.
    car.pitchArc += dp; car.rollArc += dr;
    for (const axis of ['pitchArc', 'rollArc']) {
      if (Math.abs(car[axis]) >= Math.PI * 2) {
        car[axis] -= Math.sign(car[axis]) * Math.PI * 2;
        state.flipCount++; events.push({ type: 'flip', count: state.flipCount });
      }
    }
    if (!control && !detached && !(car.base?.flightGrace > 0)) {
      const rate = assistedDescent ? 3.2 : p.y - groundY < 6 && v.y < 0 ? 4 : 1.3;
      car.pitch -= wrap(car.pitch) * (1 - Math.exp(-rate * dt));
      car.roll -= wrap(car.roll) * (1 - Math.exp(-rate * dt));
    }
    const attitude = new THREE.Quaternion().setFromEuler(new THREE.Euler(car.pitch, car.yaw, car.roll, 'YXZ'));
    v.y -= config.gravity * dt;
    if (assistedDescent) {
      // Base-only arcade landing assist: descend briskly, then brake above the
      // surface. Ordinary lunar jumps retain their original gravity and controls.
      const clearance = Math.max(0, p.y - groundY);
      const desiredFall = -Math.min(20, Math.sqrt(2 * 3 * clearance) + .5);
      const correction = clamp((desiredFall - v.y) * 6, -6, 14) * dt;
      v.y += correction;
      car.rcs = Math.max(car.rcs, .25);
      if (correction > 0) car.downThrust = .35;
    }
    if (input.jump) {
      car.downThrust = spend(config.jetDrain * dt);
      v.addScaledVector(UP.clone().applyQuaternion(attitude), config.airThrust * car.downThrust * dt);
    }
    if (input.boost) {
      car.mainThrust = spend(config.boostDrain * dt);
      v.addScaledVector(new THREE.Vector3(0, 0, 1).applyQuaternion(attitude), config.boostAccel * car.mainThrust * dt);
    }
    v.y = clamp(v.y, -65, 24); v.x *= Math.exp(-0.035 * dt); v.z *= Math.exp(-0.035 * dt);
    const horizontal = Math.hypot(v.x, v.z);
    if (horizontal > config.boostMaxSpeed) { v.x *= config.boostMaxSpeed / horizontal; v.z *= config.boostMaxSpeed / horizontal; }
    p.addScaledVector(v, dt);
    const landingY = height(p.x, p.z);
    if (p.y <= landingY && v.y <= 0) {
      events.push({ type: 'land', impact: Math.abs(v.y), airTime: state.airTime });
      p.y = landingY; v.y = 0; state.mode = 'ground'; car.grounded = true;
      state.airTime = 0; car.pitch = car.roll = car.pitchRate = car.rollRate = 0;
      car.pitchArc = car.rollArc = 0;
    }
  }
  input.jumpPressed = false;
  // A solid roof and side clearance apply in air as well as on the floor.
  if (p.x > t.x0 && p.x < t.x1 && Math.abs(p.z - t.zc) < 13) {
    if (Math.abs(p.z - t.zc) > 10.2) { p.z = t.zc + Math.sign(p.z - t.zc) * 10.2; v.z *= -0.15; }
    if (!inverted && p.y > t.ceilY - 1.5 && p.y < t.ceilY + 3) { p.y = t.ceilY - 1.5; v.y = Math.min(0, v.y); }
  }
  if (state.mode === 'ground') {
    const align = new THREE.Quaternion().setFromUnitVectors(UP, normal(p.x, p.z));
    align.multiply(new THREE.Quaternion().setFromAxisAngle(UP, car.yaw));
    car.group.quaternion.slerp(align, 1 - Math.exp(-config.groundAlign * dt));
  } else car.group.quaternion.setFromEuler(new THREE.Euler(car.pitch, car.yaw, car.roll, 'YXZ'));
  car.regenDelay = used ? 0.65 : Math.max(0, car.regenDelay - dt);
  // The compressor needs ambient gas; vacuum travel cannot refill a tank.
  if (state.atmosphere && !used && car.regenDelay === 0) car.airTank = Math.min(config.airTankMax, car.airTank + config.tankRegen * dt);
  car.spinSpeed = Math.hypot(v.x, v.z) / config.wheelR;
  car.steerAngle += (-input.steer * (inverted ? -1 : 1) * 0.42 - car.steerAngle) * (1 - Math.exp(-8 * dt));
  return events;
}

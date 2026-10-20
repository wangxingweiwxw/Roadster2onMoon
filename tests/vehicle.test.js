import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../roadster2-moon-cloudbase/public/lib/three.module.min.js';
import { resetDynamics, stepVehicle } from '../roadster2-moon-cloudbase/public/src/vehicle.js';
import { CONFIG } from '../roadster2-moon-cloudbase/public/src/config.js';
import { terrainHeight, terrainNormal } from '../roadster2-moon-cloudbase/public/src/terrain.js';
const normal=()=>new THREE.Vector3(0,1,0);
function fixture() {
  const c={group:new THREE.Group(),vel:new THREE.Vector3(),yaw:0,airTank:100};resetDynamics(c);
  const s={mode:'ground',airTime:0,bestAirTime:0,flipCount:0,invertDist:0};
  return {c,s};
}
function run(f,seconds,control={},height=()=>0,n=normal,config=CONFIG) {
  const input={throttle:0,steer:0,boost:false,jump:false,jumpPressed:false,invertPressed:false,...control};
  const events=[];
  for(let i=0;i<Math.round(seconds*120);i++)events.push(...stepVehicle(f.c,f.s,input,1/120,config,height,n));
  return events;
}
test('rear thrust reaches 300 km/h while using only its metered air',()=>{
  const f=fixture();run(f,5,{throttle:1,boost:true});
  assert.ok(f.c.vel.length()*3.6>=300);assert.ok(Math.abs(f.c.airTank-20)<.001);
});

test('compressor refills only in artificial atmosphere, never in lunar vacuum',()=>{
  const f=fixture();f.c.airTank=20;run(f,5);assert.equal(f.c.airTank,20);
  f.s.atmosphere=true;run(f,2);assert.ok(Math.abs(f.c.airTank-34)<.001);
  f.s.atmosphere=false;run(f,3);assert.ok(Math.abs(f.c.airTank-34)<.001);
});
test('left/right steering follows the chase-camera frame at every heading',()=>{
  for(const yaw of [0,Math.PI/2,Math.PI,-Math.PI/2])for(const steer of [-1,1]){
    const f=fixture();f.c.yaw=yaw;f.c.group.quaternion.setFromAxisAngle(new THREE.Vector3(0,1,0),yaw);
    const forward=new THREE.Vector3(Math.sin(yaw),0,Math.cos(yaw));
    const right=forward.clone().cross(new THREE.Vector3(0,1,0));
    f.c.vel.copy(forward).multiplyScalar(12);
    run(f,.3,{steer,throttle:1});
    assert.ok(f.c.group.position.dot(right)*steer>0,'trajectory must turn toward the pressed side');
    const wheelForward=new THREE.Vector3(0,0,1).applyAxisAngle(new THREE.Vector3(0,1,0),f.c.steerAngle).applyQuaternion(f.c.group.quaternion);
    assert.ok(wheelForward.dot(right)*steer>0,'front wheels must agree with the turn');
  }
});
test('reverse steering preserves the expected opposite nose rotation',()=>{
  for(const steer of [-1,1]){
    const f=fixture();f.c.vel.z=-6;run(f,.3,{steer,throttle:-1});
    assert.ok(f.c.yaw*steer>0);
  }
});
test('ceiling steering and wheel angle agree with the upright chase camera',()=>{
  for(const steer of [-1,1]){
    const f=fixture();f.c.yaw=Math.PI/2;f.c.group.position.set(530,34,0);
    run(f,1,{invertPressed:true},()=>34);
    const start=f.c.group.position.clone(),right=new THREE.Vector3(0,0,1);
    f.c.vel.set(12,0,0);run(f,.3,{steer,throttle:1},()=>34);
    assert.ok(f.c.group.position.clone().sub(start).dot(right)*steer>0);
    const wheelForward=new THREE.Vector3(0,0,1).applyAxisAngle(new THREE.Vector3(0,1,0),f.c.steerAngle).applyQuaternion(f.c.group.quaternion);
    assert.ok(wheelForward.dot(right)*steer>0);
  }
});
test('airborne left/right input banks the roof toward the pressed screen side',()=>{
  for(const yaw of [0,Math.PI/2,-Math.PI/2])for(const steer of [-1,1]){
    const f=fixture();f.c.yaw=yaw;f.c.group.position.y=100;f.s.mode='air';
    run(f,.3,{steer});
    const right=new THREE.Vector3(Math.sin(yaw),0,Math.cos(yaw)).cross(new THREE.Vector3(0,1,0));
    const roofUp=new THREE.Vector3(0,1,0).applyQuaternion(f.c.group.quaternion);
    assert.ok(roofUp.dot(right)*steer>0);
  }
});
test('a ballistic hop takes off, lasts over 4 seconds and lands exactly once',()=>{
  const f=fixture(),events=run(f,12,{jumpPressed:true});
  assert.equal(events.filter(e=>e.type==='takeoff').length,1);
  assert.equal(events.filter(e=>e.type==='land').length,1);
  assert.ok(f.s.bestAirTime>9);assert.equal(f.s.mode,'ground');assert.equal(f.c.group.position.y,0);
});
test('lift consumes one drain per second; an inverted vehicle thrusts down',()=>{
  const f=fixture();f.c.group.position.y=30;f.s.mode='air';
  run(f,1,{jump:true});assert.ok(Math.abs(f.c.airTank-87)<.001);assert.ok(f.c.vel.y>8);
  const upside=fixture();upside.c.group.position.y=30;upside.c.roll=Math.PI;upside.s.mode='air';
  run(upside,.1,{jump:true},()=>0,normal,{...CONFIG,airRollRate:0});assert.ok(upside.c.vel.y<-.8);
});
test('a full signed roll counts in the score; alternating partial rolls do not',()=>{
  const f=fixture();f.c.group.position.y=100;f.s.mode='air';
  run(f,2.65,{steer:1});assert.equal(f.s.flipCount,1);
  const g=fixture();g.c.group.position.y=100;g.s.mode='air';
  for(let i=0;i<10;i++)run(g,.3,{steer:i%2?1:-1});
  assert.equal(g.s.flipCount,0);
});
test('ceiling transfer does not award distance until roof contact',()=>{
  const f=fixture();f.c.yaw=Math.PI/2;f.c.group.position.set(500,34,0);
  run(f,.5,{invertPressed:true,throttle:1},()=>34);
  assert.equal(f.s.mode,'inverted');assert.equal(f.s.invertDist,0);
  assert.ok(f.c.group.position.y>34&&f.c.group.position.y<CONFIG.tube.ceilY);
  run(f,3,{throttle:1},()=>34);assert.ok(f.s.invertDist>1);assert.equal(f.c.group.position.y,CONFIG.tube.ceilY);
});
test('air depletion releases ceiling attachment and enables a safe return to ground',()=>{
  const f=fixture();f.c.group.position.set(540,34,0);run(f,1,{invertPressed:true},()=>34);
  f.c.airTank=.01;const events=run(f,8,{},()=>34);
  assert.ok(events.some(e=>e.type==='detach'));assert.ok(events.some(e=>e.type==='land'));
  assert.equal(f.s.mode,'ground');assert.ok(f.c.airTank>=0);
});
test('driving through the tube exit detaches, preserving finite state',()=>{
  const f=fixture();f.c.yaw=Math.PI/2;f.c.group.position.set(640,34,0);
  run(f,1,{invertPressed:true},()=>34);const events=run(f,3,{boost:true,throttle:1},()=>34);
  assert.ok(events.some(e=>e.type==='detach'));assert.notEqual(f.s.mode,'inverted');
  assert.ok([...f.c.group.position,...f.c.group.quaternion,...f.c.vel].every(Number.isFinite));
});
test('real lunar terrain remains bounded through boost, jump, roll and recovery',()=>{
  const f=fixture();f.c.group.position.set(200,terrainHeight(200,-310),-310);
  for(let i=0;i<1800;i++)run(f,1/120,{throttle:i<400?1:0,boost:i<250,jumpPressed:i===300,jump:i>300&&i<340,steer:i>350&&i<650?1:0},terrainHeight,terrainNormal);
  const p=f.c.group.position;assert.ok(p.y>=terrainHeight(p.x,p.z)-.01);
  assert.ok([...p,...f.c.vel,...f.c.group.quaternion].every(Number.isFinite));assert.ok(f.c.airTank>=0&&f.c.airTank<=100);
});

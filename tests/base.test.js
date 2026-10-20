import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../roadster2-moon-cloudbase/public/lib/three.module.min.js';
import { CONFIG } from '../roadster2-moon-cloudbase/public/src/config.js';
import { BASE, RAIL_END, WALL_LENGTH, BEND_LENGTH, railPose, inAtmosphere, inBaseLane } from '../roadster2-moon-cloudbase/public/src/base-layout.js';
import { resetBase, stepBase, resolveBaseCollision, baseFloor, railQuaternion } from '../roadster2-moon-cloudbase/public/src/base-physics.js';
import { resetDynamics, stepVehicle } from '../roadster2-moon-cloudbase/public/src/vehicle.js';
import { terrainHeight, terrainNormal } from '../roadster2-moon-cloudbase/public/src/terrain.js';
import { CameraRig } from '../roadster2-moon-cloudbase/public/src/camera-rig.js';
function fixture(x=40){
  const car={group:new THREE.Group(),vel:new THREE.Vector3(),yaw:-Math.PI/2,airTank:20};resetDynamics(car);
  car.group.position.set(x,baseFloor(x,0,terrainHeight),0);car.group.quaternion.setFromAxisAngle(new THREE.Vector3(0,1,0),car.yaw);
  const state={mode:'ground',airTime:0,bestAirTime:0,flipCount:0,invertDist:0};resetBase(car,state);
  return {car,state,events:[]};
}
function run(f,seconds,controls={}){
  const input={throttle:0,steer:0,jump:false,jumpPressed:false,boost:false,invertPressed:false,...controls};
  for(let i=0;i<Math.round(seconds*120);i++){
    const prev=f.car.group.position.clone(),step=stepBase(f.car,f.state,input,1/120);f.events.push(...step.events);
    if(!step.handled){
      f.events.push(...stepVehicle(f.car,f.state,input,1/120,CONFIG,(x,z)=>baseFloor(x,z,terrainHeight),(x,z)=>inBaseLane({x,z})?new THREE.Vector3(0,1,0):terrainNormal(x,z)));
      resolveBaseCollision(f.car,f.state,prev);
    }
    f.onStep?.();
  }
}
test('continuous drive from the ramp reaches the docking wall without penetrating it',()=>{
  const f=fixture(78);run(f,8,{throttle:1});
  assert.ok(f.car.group.position.x>=BASE.wallX+1.1);assert.ok(f.car.group.position.x<42);
  assert.ok(Math.abs(f.car.group.position.z)<.01);assert.ok(f.car.group.position.y>=BASE.floor-.02);
  run(f,1.5,{invertPressed:true});assert.equal(f.state.mode,'base_wall');
});
test('empty tank can dock using base power, stay vertical and recharge to full',()=>{
  const f=fixture();f.car.airTank=0;run(f,1.5,{invertPressed:true});
  assert.equal(f.state.mode,'base_wall');assert.ok(f.state.baseDocked);
  const up=new THREE.Vector3(0,1,0).applyQuaternion(f.car.group.quaternion);
  assert.ok(up.x>.999);assert.equal(f.car.group.position.x,BASE.wallX);
  run(f,5);assert.equal(f.car.airTank,100);assert.ok(f.state.baseRefilled);
  assert.ok(f.events.some(e=>e.type==='base-refilled'));
});
test('rail pose is continuous at wall/bend/roof and finishes upside down',()=>{
  for(const s of [WALL_LENGTH,WALL_LENGTH+BEND_LENGTH]){
    const a=railPose(s-.001),b=railPose(s+.001);assert.ok(Math.hypot(a.x-b.x,a.y-b.y)<.003);
  }
  const up=new THREE.Vector3(0,1,0).applyQuaternion(railQuaternion(railPose(RAIL_END).angle));
  assert.ok(up.y<-.999);
});
test('one Space press completes climb, inverted departure, roll recovery and lunar landing',()=>{
  const f=fixture();run(f,1.5,{invertPressed:true});run(f,5);
  run(f,9,{jumpPressed:true});assert.ok(f.state.baseLaunched);assert.equal(f.state.mode,'air');
  assert.ok(f.events.some(e=>e.type==='base-hatch'));assert.ok(f.events.some(e=>e.type==='base-launched'));
  run(f,30);assert.ok(f.state.baseLanded);assert.equal(f.state.mode,'ground');
  assert.ok(new THREE.Vector3(0,1,0).applyQuaternion(f.car.group.quaternion).y>.8);
  assert.ok(f.car.airTank>=0&&f.car.airTank<=100);
});
test('manual ascent can stop and reverse without losing wall attachment',()=>{
  const f=fixture();run(f,1.5,{invertPressed:true});const y=f.car.group.position.y;
  run(f,1,{throttle:1});assert.ok(f.car.group.position.y>y+4);
  run(f,.8);const stopped=f.car.group.position.y;run(f,.8,{throttle:-1});assert.ok(f.car.group.position.y<stopped-3);
  assert.equal(f.state.mode,'base_wall');assert.equal(f.car.group.position.x,BASE.wallX);
});
test('roof departure starts inverted and does not immediately auto-right inside the hatch',()=>{
  const f=fixture();run(f,1.5,{invertPressed:true});run(f,5);run(f,1/120,{jumpPressed:true});
  for(let i=0;i<1500&&!f.state.baseLaunched;i++)run(f,1/120);
  assert.ok(f.state.baseLaunched);assert.ok(f.car.base.flightGrace>.6);
  assert.ok(new THREE.Vector3(0,1,0).applyQuaternion(f.car.group.quaternion).y<-.99);
  assert.ok(f.car.group.position.x>BASE.towerFront+5);assert.ok(f.car.group.position.y>BASE.roofY+5);
});
test('pressure boundary distinguishes inside service shaft from lunar vacuum',()=>{
  assert.equal(inAtmosphere(new THREE.Vector3(40,BASE.floor+2,0)),true);
  assert.equal(inAtmosphere(new THREE.Vector3(70,BASE.floor,0)),false);
  assert.equal(inAtmosphere(new THREE.Vector3(58,BASE.roofY+8,0)),false);
});
test('outer hull blocks a vehicle trying to enter away from the airlock',()=>{
  const f=fixture();f.car.group.position.set(0,BASE.ground,52);f.car.yaw=Math.PI;f.car.group.quaternion.setFromAxisAngle(new THREE.Vector3(0,1,0),Math.PI);
  run(f,4,{throttle:1,boost:true});assert.ok(f.car.group.position.z>=BASE.radius+1.1);
});

test('assisted roof departure lands within nine seconds with a gentle touchdown',()=>{
  const f=fixture();run(f,1.5,{invertPressed:true});run(f,5);run(f,1/120,{jumpPressed:true});
  for(let i=0;i<1500&&!f.state.baseLaunched;i++)run(f,1/120);
  let flight=0;
  while(!f.state.baseLanded&&flight<12){run(f,1/120);flight+=1/120;}
  assert.ok(f.state.baseLanded);assert.ok(flight<9,`flight took ${flight}s`);
  assert.ok(f.events.find(e=>e.type==='land').impact<5,JSON.stringify({flight,landing:f.events.find(e=>e.type==='land')}));
  assert.equal(f.car.base.descentAssist,false);
});

test('manual flight input cancels base descent assist without re-enabling it',()=>{
  const f=fixture();run(f,1.5,{invertPressed:true});run(f,5);run(f,1/120,{jumpPressed:true});
  for(let i=0;i<1500&&!f.state.baseLaunched;i++)run(f,1/120);
  run(f,.2,{steer:1});assert.equal(f.car.base.descentAssist,false);
  run(f,1);assert.equal(f.car.base.descentAssist,false);assert.equal(f.state.mode,'air');
});

test('camera stays continuous across airlock, wall, launch, flight and touchdown at varied frame rates',()=>{
  for(const fps of [30,60,120])for(const mode of [0,1,2]){
    const f=fixture(87),camera=new THREE.PerspectiveCamera(66,16/9,.1,6000),rig=new CameraRig();
    f.state.camMode=mode;f.state.time=0;f.state.shake=0;rig.reset(f.car.yaw);
    const options={config:CONFIG,height:terrainHeight,motion:false};
    for(let i=0;i<fps;i++)rig.update(camera,f.car,f.state,1/fps,options);
    let prev=camera.position.clone(),q=camera.quaternion.clone(),ticks=0,maxSpeed=0,maxTurn=0,peak={};
    f.onStep=()=>{
      if(++ticks%(120/fps))return;
      rig.update(camera,f.car,f.state,1/fps,options);
      if(camera.position.distanceTo(prev)*fps>maxSpeed)peak={mode:f.state.mode,car:f.car.group.position.toArray(),camera:camera.position.toArray(),previous:prev.toArray()};
      maxSpeed=Math.max(maxSpeed,camera.position.distanceTo(prev)*fps);
      maxTurn=Math.max(maxTurn,camera.quaternion.angleTo(q)*fps);
      assert.ok(camera.position.y>=baseFloor(camera.position.x,camera.position.z,terrainHeight)+.449);
      assert.ok(camera.position.toArray().every(Number.isFinite));
      prev.copy(camera.position);q.copy(camera.quaternion);
    };
    run(f,6,{throttle:1});run(f,1.5,{invertPressed:true});run(f,5);run(f,18,{jumpPressed:true});
    assert.ok(f.state.baseLanded,`route incomplete at ${fps} fps`);
    assert.ok(maxSpeed<45,`camera teleported at ${fps} fps: ${maxSpeed} m/s ${JSON.stringify(peak)}`);
    assert.ok(maxTurn<3,`camera whipped at ${fps} fps: ${maxTurn} rad/s`);
  }
});

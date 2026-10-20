import * as THREE from '../lib/three.module.min.js';
import { BASE, WALL_LENGTH, RAIL_END, railPose, inBaseLane, inAtmosphere, baseFloor } from './base-layout.js';
const UP=new THREE.Vector3(0,1,0), clamp=THREE.MathUtils.clamp;
const ease=t=>t*t*(3-2*t);
export const isBaseAttached=state=>['base_attach','base_wall','base_roof','base_launch'].includes(state.mode);

export function resetBase(car,state) {
  car.base={s:BASE.dockY-BASE.floor,speed:0,t:0,auto:false,charged:false,launchPending:false,flightGrace:0,descentAssist:false};
  state.baseDocked=false;state.baseRefilled=false;state.baseLaunched=false;state.baseLanded=false;state.atmosphere=false;
}
export function railQuaternion(angle) {
  const normal=new THREE.Vector3(Math.cos(angle),-Math.sin(angle),0);
  const forward=new THREE.Vector3(Math.sin(angle),Math.cos(angle),0);
  const side=new THREE.Vector3().crossVectors(normal,forward);
  return new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(side,normal,forward));
}

// Returns handled=true while external-powered adhesion owns the vehicle pose.
export function stepBase(car,state,input,dt) {
  const p=car.group.position,b=car.base,events=[];
  state.atmosphere=inAtmosphere(p);
  if(b.flightGrace>0)b.flightGrace=Math.max(0,b.flightGrace-dt);
  if(!isBaseAttached(state)) {
    if(input.invertPressed && inBaseLane(p) && p.x<=46 && p.y<BASE.floor+4) {
      if(car.vel.length()>12){input.invertPressed=false;events.push({type:'base-fast'});return {handled:false,events};}
      input.invertPressed=false;input.jumpPressed=false;
      b.from=p.clone();b.qFrom=car.group.quaternion.clone();b.t=0;b.s=BASE.dockY-BASE.floor;b.auto=false;
      state.mode='base_attach';state.baseDocked=true;car.grounded=false;car.vel.set(0,0,0);
      events.push({type:'base-attach'});
    } else return {handled:false,events};
  }
  car.mainThrust=car.downThrust=car.rcs=0;car.gripThrust=.28;car.steerAngle=0;car.regenDelay=.65;
  if(state.mode==='base_attach') {
    b.t=Math.min(1,b.t+dt/1.25);
    p.copy(b.from).lerp(new THREE.Vector3(BASE.wallX,BASE.dockY,0),ease(b.t));
    car.group.quaternion.copy(b.qFrom).slerp(railQuaternion(0),ease(b.t));
    if(b.t===1){state.mode='base_wall';car.grounded=true;events.push({type:'base-parked'});}
  } else if(state.mode==='base_launch') {
    b.t=Math.min(1,b.t+dt/1.1);const t=ease(b.t);
    p.set(BASE.exitX+10*t,BASE.wallTop+BASE.bendR+10*t*t,0);
    car.group.quaternion.copy(railQuaternion(Math.PI/2));
    car.mainThrust=.85;car.gripThrust=0;car.airTank=Math.max(0,car.airTank-5*dt);
    if(b.t===1){
      state.mode='air';state.airTime=0;state.baseLaunched=true;b.launchPending=true;b.flightGrace=.7;b.descentAssist=true;
      car.yaw=Math.PI/2;car.pitch=0;car.roll=Math.PI;car.rollRate=car.pitchRate=0;car.pitchArc=car.rollArc=0;
      car.vel.set(20,2,0);car.grounded=false;car.inverted=false;events.push({type:'base-launched'});
    }
  } else {
    if(input.invertPressed){
      input.invertPressed=false;b.auto=false;b.speed=0;
      // Safe release from a wall; normal flight controls and gravity take over.
      const e=new THREE.Euler().setFromQuaternion(car.group.quaternion,'YXZ');
      car.pitch=e.x;car.yaw=e.y;car.roll=e.z;car.rollRate=car.pitchRate=0;car.pitchArc=car.rollArc=0;
      state.mode='air';state.airTime=0;car.grounded=false;car.gripThrust=0;
      const n=new THREE.Vector3(0,1,0).applyQuaternion(car.group.quaternion);p.addScaledVector(n,1.8);car.vel.copy(n).multiplyScalar(2);
      events.push({type:'base-release'});return {handled:true,events};
    }
    if(input.jumpPressed){
      if(car.airTank>=25){b.auto=true;events.push({type:'base-ascent'});}
      else events.push({type:'base-charge-first'});
    }
    if(input.throttle<0)b.auto=false;
    const target=b.auto?10:input.throttle*7;
    b.speed+=(target-b.speed)*(1-Math.exp(-7*dt));
    b.s=clamp(b.s+b.speed*dt,3,RAIL_END);
    const pose=railPose(b.s);p.set(pose.x,pose.y,0);car.group.quaternion.copy(railQuaternion(pose.angle));
    state.mode=b.s>WALL_LENGTH?'base_roof':'base_wall';car.grounded=true;
    car.vel.set(Math.sin(pose.angle)*b.speed,Math.cos(pose.angle)*b.speed,0);
    if(Math.abs(p.y-BASE.dockY)<3&&Math.abs(b.speed)<.4&&!b.auto){
      car.airTank=Math.min(100,car.airTank+BASE.rechargeRate*dt);state.baseRefilled ||= car.airTank>=99.9;
      if(car.airTank>=99.9&&!b.charged){b.charged=true;events.push({type:'base-refilled'});}
    }
    if(b.s>=RAIL_END){state.mode='base_launch';b.t=0;b.speed=0;car.vel.set(0,0,0);events.push({type:'base-hatch'});}
  }
  car.spinSpeed=b.speed/.37;
  input.invertPressed=false;input.jumpPressed=false;
  return {handled:true,events};
}

// Broad static hull + explicit entrance corridor. Substepping avoids tunnelling.
export function resolveBaseCollision(car,state,previous) {
  if(isBaseAttached(state))return;
  const p=car.group.position;
  const inLane=Math.abs(p.z)<BASE.laneHalfWidth && p.x>=BASE.wallX+1.1 && p.x<=BASE.rampEndX;
  const r=Math.hypot(p.x,p.z), domeY=BASE.domeRim+BASE.domeRise*Math.sqrt(Math.max(0,1-(r/BASE.domeR)**2));
  const hull=r<BASE.radius+1.2 && p.y<Math.max(BASE.domeRim,domeY)+1.3;
  const tower=p.x>BASE.towerBack-1 && p.x<BASE.towerFront+1 && Math.abs(p.z)<BASE.towerHalfZ+1 && p.y<BASE.roofY+1;
  const laneFloorRoof=p.y<BASE.floor+8.5 || (p.x<BASE.towerFront&&p.y<BASE.roofY-3);
  if((hull||tower)&&!(inLane&&laneFloorRoof)) {
    // Resolve roof landing separately, so a falling car never sinks into the dome.
    if(previous.y>Math.max(BASE.domeRim,domeY)+1.3 && !tower){p.y=Math.max(BASE.domeRim,domeY)+1.35;car.vel.y=Math.max(0,car.vel.y);}
    else{p.x=previous.x;p.z=previous.z;car.vel.x*=.1;car.vel.z*=.1;}
  }
  if(inLane&&p.x<BASE.entranceX&&p.y<BASE.floor+7){
    // Interior driving has a firm low speed limit and lateral guide rails.
    const speed=Math.hypot(car.vel.x,car.vel.z);if(speed>12){car.vel.x*=12/speed;car.vel.z*=12/speed;}
  }
  if(car.base.launchPending&&state.mode==='ground'&&Math.hypot(p.x,p.z)>BASE.radius+8){state.baseLanded=true;car.base.launchPending=false;car.base.descentAssist=false;}
}
export {baseFloor};

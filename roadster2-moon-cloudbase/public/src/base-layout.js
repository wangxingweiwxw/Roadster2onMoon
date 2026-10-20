// Shared dimensions for the model, collisions, docking rail and cameras (metres).
export const BASE = Object.freeze({
  x: 0, z: 0, ground: 14.7, floor: 15.9, radius: 46,
  domeR: 42, domeRise: 23, domeRim: 23.7,
  entranceX: 64, rampEndX: 78, laneHalfWidth: 5.8,
  towerX: 39, towerHalfZ: 7.6, towerBack: 31, towerFront: 49,
  wallX: 32, dockY: 26.9, wallTop: 63.7, bendR: 6,
  roofY: 72.7, exitX: 48, rechargeRate: 24, atmosphereKPa: 101.3,
});
export const WALL_LENGTH = BASE.wallTop - BASE.floor;
export const BEND_LENGTH = Math.PI * BASE.bendR / 2;
export const RAIL_END = WALL_LENGTH + BEND_LENGTH + BASE.exitX - BASE.wallX - BASE.bendR;

export function inBaseLane(p) {
  return p.x >= BASE.wallX && p.x <= BASE.entranceX && Math.abs(p.z) < BASE.laneHalfWidth;
}
export function inAtmosphere(p) {
  const lane = inBaseLane(p) && p.x < 56 && p.y >= BASE.floor-.5 && p.y < BASE.roofY;
  const r = Math.hypot(p.x,p.z);
  const dome = r < BASE.domeR && p.y >= BASE.floor-.5 && p.y < BASE.domeRim + BASE.domeRise*Math.sqrt(Math.max(0,1-(r/BASE.domeR)**2));
  return lane || dome;
}
export function baseFloor(x,z,fallback) {
  if(Math.abs(z)<BASE.laneHalfWidth && x>=BASE.wallX && x<BASE.rampEndX) {
    const t=Math.max(0,Math.min(1,(BASE.rampEndX-x)/(BASE.rampEndX-BASE.entranceX)));
    return BASE.ground+(BASE.floor-BASE.ground)*t;
  }
  return fallback(x,z);
}

// Continuous rail: vertical wall -> quarter-circle -> inverted ceiling track.
export function railPose(s) {
  if(s<=WALL_LENGTH)return {x:BASE.wallX,y:BASE.floor+s,angle:0};
  const u=s-WALL_LENGTH;
  if(u<=BEND_LENGTH){const a=u/BASE.bendR;return {x:BASE.wallX+BASE.bendR*(1-Math.cos(a)),y:BASE.wallTop+BASE.bendR*Math.sin(a),angle:a};}
  return {x:BASE.wallX+BASE.bendR+u-BEND_LENGTH,y:BASE.wallTop+BASE.bendR,angle:Math.PI/2};
}

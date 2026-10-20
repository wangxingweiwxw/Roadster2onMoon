export const CONFIG = {
  ruleset_id: 'roadster2-moon-v3',
  gravity: 1.62,
  engineAccel: 8.0,        // m/s² 基础加速
  boostAccel: 38.0,        // m/s² 压缩空气加速额外推力（总 46 m/s²，200m 内可达 300km/h+）
  maxSpeed: 60,            // m/s ≈ 216 km/h 基础极速
  boostMaxSpeed: 110,      // m/s ≈ 396 km/h 加速极速上限
  drag: 0.42,              // 速度阻尼
  brakeDecel: 14,
  turnRate: 1.55,          // rad/s 低速转向
  turnRateHi: 0.55,        // rad/s 高速转向
  turnRateAir: 0.9,
  jumpImpulse: 8.5,        // m/s 腾空初速
  airThrust: 10.0,         // m/s² 空中喷气（沿车体 up）
  airPitchRate: 2.1,       // rad/s 空中俯仰
  airRollRate: 2.7,        // rad/s 空中横滚
  groundAlign: 7.0,        // 地面法线对齐速率
  airAlign: 2.2,
  wheelR: 0.37,
  airTankMax: 100,
  boostDrain: 16,          // 罐/s
  jetDrain: 13,            // 罐/s
  invertDrain: 10,         // 罐/s
  tankRegen: 7.0,          // 罐/s，仅在基地人造大气内压缩回充
  canisterGain: 45,
  // 熔岩管（倒挂区）
  tube: { x0: 460, x1: 660, zc: 0, halfW: 8, floorY: 34, ceilY: 47.6, enter: 470, exit: 650 },
  // 基地
  base: { x: 0, z: 0, radius: 55 },
  worldR: 1450,
};


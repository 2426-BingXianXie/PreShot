export type Vec2 = { x: number; y: number };
export type SpinMapping = { side: number; topBack: number };

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

const dot = (a: Vec2, b: Vec2) => a.x * b.x + a.y * b.y;

const normalize = (v: Vec2): Vec2 => {
  const mag = Math.hypot(v.x, v.y);
  if (mag === 0) return { x: 0, y: 0 };
  return { x: v.x / mag, y: v.y / mag };
};

const tangentFromNormal = (n: Vec2): Vec2 => ({ x: n.y, y: -n.x });

export function mapPowerToImpulse(
  power: number,
  impulseMin: number,
  impulseMax: number,
): number {
  const p = clamp(power, 0, 1);
  return impulseMin + p * (impulseMax - impulseMin);
}

export function initialVelocityFromImpulse(
  impulse: number,
  mass: number,
  aimDir: Vec2,
): Vec2 {
  const dir = normalize(aimDir);
  const speed = impulse / mass;
  return { x: dir.x * speed, y: dir.y * speed };
}

export function mapSpinFromOffset(
  offset: Vec2,
  power: number,
  scale: { sideScale: number; topBackScale: number },
  max: { sideMax: number; topBackMax: number },
): SpinMapping {
  const ox = clamp(offset.x, -1, 1);
  const oy = clamp(offset.y, -1, 1);
  const p = clamp(power, 0, 1);
  const side = clamp(scale.sideScale * ox * p, -max.sideMax, max.sideMax);
  const topBack = clamp(
    scale.topBackScale * oy * p,
    -max.topBackMax,
    max.topBackMax,
  );
  return { side, topBack };
}

export function reflectFromCushion(
  velocity: Vec2,
  cushionNormal: Vec2,
  restitution: number,
  cushionFriction: number,
  sideSpinDecay: number,
  sideSpin: number,
): { velocity: Vec2; nextSideSpin: number } {
  const n = normalize(cushionNormal);
  const t = tangentFromNormal(n);

  const vn = dot(velocity, n);
  const vt = dot(velocity, t);

  const reflectedNormal = -restitution * vn;
  const reflectedTangent = vt * (1 - cushionFriction) + sideSpinDecay * sideSpin;

  const reflected = {
    x: reflectedNormal * n.x + reflectedTangent * t.x,
    y: reflectedNormal * n.y + reflectedTangent * t.y,
  };

  return {
    velocity: reflected,
    nextSideSpin: sideSpin * (1 - sideSpinDecay),
  };
}

import {
  mapSpinFromOffset,
  type Vec2,
} from "./engine";

type TableBounds = {
  width: number;
  height: number;
  cushionInset: number;
  ballRadius: number;
};

type PreviewInput = {
  cue: Vec2;
  target: Vec2;
  aimDirection: Vec2;
  power: number;
  cueOffset: Vec2;
  table: TableBounds;
};

type PreviewOutput = {
  prePath: Vec2[];
  objectPath: Vec2[];
  postPath: Vec2[];
  contactPoint: Vec2;
};

const normalize = (v: Vec2): Vec2 => {
  const mag = Math.hypot(v.x, v.y);
  if (mag < 1e-8) return { x: 1, y: 0 };
  return { x: v.x / mag, y: v.y / mag };
};

const dot = (a: Vec2, b: Vec2): number => a.x * b.x + a.y * b.y;
const cross2D = (a: Vec2, b: Vec2): number => a.x * b.y - a.y * b.x;
const sub = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x - b.x, y: a.y - b.y });
const add = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x + b.x, y: a.y + b.y });
const mul = (a: Vec2, s: number): Vec2 => ({ x: a.x * s, y: a.y * s });
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/**
 * Compute the ghost ball position: where the cue ball center will be at the
 * moment of contact when traveling along `aimDir` toward `ob`.
 * Returns null if the aim ray misses the OB (perpendicular distance > 2R).
 */
export function computeGhostBall(
  cue: Vec2,
  aimDir: Vec2,
  ob: Vec2,
  ballRadius: number,
): Vec2 | null {
  const toOB = sub(ob, cue);
  const along = dot(toOB, aimDir);
  if (along <= 0) return null;
  const dPerp = Math.abs(cross2D(toOB, aimDir));
  const contactDist = ballRadius * 2;
  if (dPerp > contactDist) return null;
  const offset = Math.sqrt(contactDist * contactDist - dPerp * dPerp);
  return add(cue, mul(aimDir, along - offset));
}

// ── Mini-simulation constants (must match simulateShot.ts) ──────────────
const SIM_DT = 1 / 120;
const SIM_FRICTION = 0.994;
const SIM_RESTITUTION = 0.96;
const SIM_CUSHION_RESTITUTION = 0.75;
const SIM_STOP_SPEED = 0.8;
const SIM_MAX_SPEED = 1800;

/**
 * Run a lightweight 2-ball simulation of the cue ball colliding with the
 * target ball, then trace both paths until they stop.
 *
 * Uses the same physics constants and formulas as the full simulateShot so
 * the preview dots accurately predict the actual outcome.
 *
 * Inspired by tailuge/billiards Trace approach: the prediction IS the
 * physics, not a separate heuristic.
 */
function miniSimulate(
  contactPoint: Vec2,
  target: Vec2,
  cueVel: Vec2,
  topNorm: number,
  sideNorm: number,
  cueSpeed: number,
  aimDir: Vec2,
  table: TableBounds,
): { cbPath: Vec2[]; obPath: Vec2[] } {
  const R = table.ballRadius;
  const minX = table.cushionInset + R;
  const maxX = table.width - table.cushionInset - R;
  const minY = table.cushionInset + R;
  const maxY = table.height - table.cushionInset - R;

  // CB starts at the ghost ball position with the incoming cue ball velocity.
  // OB starts at the target position, stationary.
  const cb = { x: contactPoint.x, y: contactPoint.y, vx: cueVel.x, vy: cueVel.y };
  const ob = { x: target.x, y: target.y, vx: 0, vy: 0 };

  // ── Resolve the ball-ball collision at the contact point ──────────
  const dx = ob.x - cb.x;
  const dy = ob.y - cb.y;
  const dist = Math.hypot(dx, dy);
  if (dist > 1e-4) {
    const nx = dx / dist;
    const ny = dy / dist;
    const dvx = cb.vx - ob.vx;
    const dvy = cb.vy - ob.vy;
    const vRelN = dvx * nx + dvy * ny;
    if (vRelN > 0) {
      const impulse = ((1 + SIM_RESTITUTION) * vRelN) / 2;
      cb.vx -= impulse * nx;
      cb.vy -= impulse * ny;
      ob.vx += impulse * nx;
      ob.vy += impulse * ny;
    }
  }

  // Apply spin effect on the cue ball after collision (follow/draw/english).
  // This matches the spin impulse in simulateShot.ts first-contact handler.
  const perp = { x: -aimDir.y, y: aimDir.x };
  cb.vx += aimDir.x * topNorm * cueSpeed * 0.12 + perp.x * sideNorm * cueSpeed * 0.04;
  cb.vy += aimDir.y * topNorm * cueSpeed * 0.12 + perp.y * sideNorm * cueSpeed * 0.04;

  // ── Step both balls forward with friction and cushion reflections ──
  const cbPath: Vec2[] = [{ x: cb.x, y: cb.y }];
  const obPath: Vec2[] = [{ x: ob.x, y: ob.y }];

  const POINT_INTERVAL = 12;
  const MAX_ITERS = 600;
  let cbStopped = false;
  let obStopped = false;
  let cbAccum = 0;
  let obAccum = 0;

  const applyCushionSingle = (b: { x: number; y: number; vx: number; vy: number }) => {
    if (b.x < minX) { b.x = minX; b.vx = Math.abs(b.vx) * SIM_CUSHION_RESTITUTION; b.vy *= SIM_CUSHION_RESTITUTION; }
    else if (b.x > maxX) { b.x = maxX; b.vx = -Math.abs(b.vx) * SIM_CUSHION_RESTITUTION; b.vy *= SIM_CUSHION_RESTITUTION; }
    if (b.y < minY) { b.y = minY; b.vy = Math.abs(b.vy) * SIM_CUSHION_RESTITUTION; b.vx *= SIM_CUSHION_RESTITUTION; }
    else if (b.y > maxY) { b.y = maxY; b.vy = -Math.abs(b.vy) * SIM_CUSHION_RESTITUTION; b.vx *= SIM_CUSHION_RESTITUTION; }
  };

  for (let i = 0; i < MAX_ITERS; i += 1) {
    if (cbStopped && obStopped) break;

    if (!cbStopped) {
      cb.x += cb.vx * SIM_DT;
      cb.y += cb.vy * SIM_DT;
      applyCushionSingle(cb);
      cb.vx *= SIM_FRICTION;
      cb.vy *= SIM_FRICTION;
      const spd = Math.hypot(cb.vx, cb.vy);
      if (spd < SIM_STOP_SPEED) { cb.vx = 0; cb.vy = 0; cbStopped = true; cbPath.push({ x: cb.x, y: cb.y }); }
      else {
        cbAccum += spd * SIM_DT;
        if (cbAccum >= POINT_INTERVAL) { cbPath.push({ x: cb.x, y: cb.y }); cbAccum = 0; }
      }
    }

    if (!obStopped) {
      ob.x += ob.vx * SIM_DT;
      ob.y += ob.vy * SIM_DT;
      applyCushionSingle(ob);
      ob.vx *= SIM_FRICTION;
      ob.vy *= SIM_FRICTION;
      const spd = Math.hypot(ob.vx, ob.vy);
      if (spd < SIM_STOP_SPEED) { ob.vx = 0; ob.vy = 0; obStopped = true; obPath.push({ x: ob.x, y: ob.y }); }
      else {
        obAccum += spd * SIM_DT;
        if (obAccum >= POINT_INTERVAL) { obPath.push({ x: ob.x, y: ob.y }); obAccum = 0; }
      }
    }
  }

  // Ensure the final resting position is always included.
  const lastCb = cbPath[cbPath.length - 1];
  if (lastCb.x !== cb.x || lastCb.y !== cb.y) cbPath.push({ x: cb.x, y: cb.y });
  const lastOb = obPath[obPath.length - 1];
  if (lastOb.x !== ob.x || lastOb.y !== ob.y) obPath.push({ x: ob.x, y: ob.y });

  return { cbPath, obPath };
}

export function computePreviewPath(input: PreviewInput): PreviewOutput {
  const aimDir = normalize(input.aimDirection);
  const R = input.table.ballRadius;

  const ghostBall = computeGhostBall(input.cue, aimDir, input.target, R);
  const contactPoint = ghostBall ?? sub(input.target, mul(aimDir, R * 2));
  const prePath = [input.cue, contactPoint];

  const spin = mapSpinFromOffset(
    { x: input.cueOffset.x, y: -input.cueOffset.y },
    input.power,
    { sideScale: 18, topBackScale: 12 },
    { sideMax: 20, topBackMax: 20 },
  );

  const topNorm = clamp(spin.topBack / 20, -1, 1);
  const sideNorm = clamp(spin.side / 20, -1, 1);

  // Cue ball velocity at the moment it reaches the ghost ball position.
  // Uses the same speed model as simulateShot.ts.
  const cueSpeed = clamp(input.power, 0, 1) * SIM_MAX_SPEED;
  const perp = { x: -aimDir.y, y: aimDir.x };
  const cueVel: Vec2 = {
    x: aimDir.x * cueSpeed + perp.x * (sideNorm * cueSpeed * 0.06),
    y: aimDir.y * cueSpeed + perp.y * (sideNorm * cueSpeed * 0.06),
  };

  const { cbPath, obPath } = miniSimulate(
    contactPoint,
    input.target,
    cueVel,
    topNorm,
    sideNorm,
    cueSpeed,
    aimDir,
    input.table,
  );

  return {
    prePath,
    objectPath: obPath,
    postPath: cbPath,
    contactPoint,
  };
}

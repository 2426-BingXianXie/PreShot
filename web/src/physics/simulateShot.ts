import { mapSpinFromOffset, type Vec2 } from "./engine";
import type { Ball, BallKind } from "../game/state";

type TableConfig = {
  width: number;
  height: number;
  cushionInset: number;
  pocketRadius: number;
  ballRadius: number;
};

type SimulationInput = {
  balls: Ball[];
  targetId: string;
  aimDirection: Vec2;
  power: number;
  cueOffset: Vec2;
  table: TableConfig;
};

export type ShotSimulationResult = {
  frames: Ball[][];
  finalBalls: Ball[];
  firstContactKind: BallKind | null;
  pottedIds: string[];
  cueScratch: boolean;
  railAfterContact: boolean;
};

const DT = 1 / 120;
const SUBSTEPS = 2;
const MAX_STEPS = 1800;
const FRICTION = 0.994;
const RESTITUTION = 0.96;
const CUSHION_RESTITUTION = 0.75;
const STOP_SPEED = 0.8;
const FRAME_SAMPLE_STEP = 2;

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const cloneBalls = (balls: Ball[]) => balls.map((ball) => ({ ...ball }));
const normalize = (v: Vec2): Vec2 => {
  const mag = Math.hypot(v.x, v.y);
  if (mag < 1e-8) return { x: 1, y: 0 };
  return { x: v.x / mag, y: v.y / mag };
};
const speed = (ball: Ball) => Math.hypot(ball.vx, ball.vy);
const isMoving = (balls: Ball[]) =>
  balls.some((ball) => !ball.pocketed && speed(ball) > STOP_SPEED);

const applyCushion = (ball: Ball, table: TableConfig) => {
  const minX = table.cushionInset + table.ballRadius;
  const maxX = table.width - table.cushionInset - table.ballRadius;
  const minY = table.cushionInset + table.ballRadius;
  const maxY = table.height - table.cushionInset - table.ballRadius;

  let hit = false;
  if (ball.x < minX) {
    ball.x = minX;
    ball.vx = Math.abs(ball.vx) * CUSHION_RESTITUTION;
    ball.vy *= CUSHION_RESTITUTION;
    hit = true;
  } else if (ball.x > maxX) {
    ball.x = maxX;
    ball.vx = -Math.abs(ball.vx) * CUSHION_RESTITUTION;
    ball.vy *= CUSHION_RESTITUTION;
    hit = true;
  }
  if (ball.y < minY) {
    ball.y = minY;
    ball.vy = Math.abs(ball.vy) * CUSHION_RESTITUTION;
    ball.vx *= CUSHION_RESTITUTION;
    hit = true;
  } else if (ball.y > maxY) {
    ball.y = maxY;
    ball.vy = -Math.abs(ball.vy) * CUSHION_RESTITUTION;
    ball.vx *= CUSHION_RESTITUTION;
    hit = true;
  }
  return hit;
};

/**
 * Proper elastic collision between equal-mass balls with restitution.
 *
 * Based on the standard formula used by tailuge/billiards and ScriptRaccoon/pool-game:
 *   v_rel_n = dot(v_a - v_b, n)
 *   impulse  = (1 + e) * v_rel_n / 2
 *   v_a' = v_a - impulse * n
 *   v_b' = v_b + impulse * n
 */
const resolveBallCollision = (a: Ball, b: Ball, ballRadius: number) => {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const dist = Math.hypot(dx, dy);
  const minDist = ballRadius * 2;
  if (dist >= minDist || dist < 1e-8) return false;

  const nx = dx / dist;
  const ny = dy / dist;

  // Separate overlapping balls
  const overlap = minDist - dist;
  a.x -= nx * (overlap * 0.5);
  a.y -= ny * (overlap * 0.5);
  b.x += nx * (overlap * 0.5);
  b.y += ny * (overlap * 0.5);

  // Relative velocity along the impact normal
  const dvx = a.vx - b.vx;
  const dvy = a.vy - b.vy;
  const vRelNormal = dvx * nx + dvy * ny;

  // Only resolve if balls are approaching
  if (vRelNormal <= 0) return false;

  // Impulse magnitude (equal masses cancel out to this form)
  const impulse = ((1 + RESTITUTION) * vRelNormal) / 2;

  a.vx -= impulse * nx;
  a.vy -= impulse * ny;
  b.vx += impulse * nx;
  b.vy += impulse * ny;

  return true;
};

const checkPockets = (
  ball: Ball,
  table: TableConfig,
  potted: Set<string>,
): boolean => {
  const pockets = [
    { x: table.cushionInset, y: table.cushionInset },
    { x: table.width / 2, y: table.cushionInset },
    { x: table.width - table.cushionInset, y: table.cushionInset },
    { x: table.cushionInset, y: table.height - table.cushionInset },
    { x: table.width / 2, y: table.height - table.cushionInset },
    { x: table.width - table.cushionInset, y: table.height - table.cushionInset },
  ];
  for (const pocket of pockets) {
    if (Math.hypot(ball.x - pocket.x, ball.y - pocket.y) <= table.pocketRadius) {
      ball.pocketed = true;
      ball.vx = 0;
      ball.vy = 0;
      potted.add(ball.id);
      return true;
    }
  }
  return false;
};

export const simulateShot = (input: SimulationInput): ShotSimulationResult => {
  const balls = cloneBalls(input.balls);
  balls.forEach((ball) => {
    ball.vx = 0;
    ball.vy = 0;
  });

  const cue = balls.find((ball) => ball.id === "cue");
  const target = balls.find((ball) => ball.id === input.targetId && !ball.pocketed);
  if (!cue || !target) {
    return {
      frames: [balls],
      finalBalls: balls,
      firstContactKind: null,
      pottedIds: [],
      cueScratch: false,
      railAfterContact: false,
    };
  }

  const aim = normalize(input.aimDirection);
  const spin = mapSpinFromOffset(
    { x: input.cueOffset.x, y: -input.cueOffset.y },
    input.power,
    { sideScale: 18, topBackScale: 12 },
    { sideMax: 20, topBackMax: 20 },
  );
  const topNorm = clamp(spin.topBack / 20, -1, 1);
  const sideNorm = clamp(spin.side / 20, -1, 1);

  // Speed calibrated so max power sends the cue ball across the table
  // in a realistic time. At power=1: 1800 px/s → crosses 980px table in ~0.55s.
  const maxSpeed = 1800;
  const cueSpeed = clamp(input.power, 0, 1) * maxSpeed;
  const perp = { x: -aim.y, y: aim.x };
  cue.vx = aim.x * cueSpeed + perp.x * (sideNorm * cueSpeed * 0.06);
  cue.vy = aim.y * cueSpeed + perp.y * (sideNorm * cueSpeed * 0.06);

  const frames: Ball[][] = [cloneBalls(balls)];
  const potted = new Set<string>();
  let firstContactKind: BallKind | null = null;
  let railAfterContact = false;

  for (let step = 0; step < MAX_STEPS; step += 1) {
    // Substep for more reliable collision detection at higher speeds.
    // Each substep advances by DT. With DT=1/120 and SUBSTEPS=2,
    // one outer step = 1/60s (matching 60fps animation).
    for (let sub = 0; sub < SUBSTEPS; sub += 1) {
      for (const ball of balls) {
        if (ball.pocketed) continue;
        ball.x += ball.vx * DT;
        ball.y += ball.vy * DT;
      }

      for (let i = 0; i < balls.length; i += 1) {
        const a = balls[i];
        if (a.pocketed) continue;
        for (let j = i + 1; j < balls.length; j += 1) {
          const b = balls[j];
          if (b.pocketed) continue;
          const hadCollision = resolveBallCollision(a, b, input.table.ballRadius);
          if (!hadCollision) continue;
          if (firstContactKind === null && (a.id === "cue" || b.id === "cue")) {
            const other = a.id === "cue" ? b : a;
            firstContactKind = other.kind;
            const cueBall = a.id === "cue" ? a : b;
            cueBall.vx += aim.x * topNorm * cueSpeed * 0.12 + perp.x * sideNorm * cueSpeed * 0.04;
            cueBall.vy += aim.y * topNorm * cueSpeed * 0.12 + perp.y * sideNorm * cueSpeed * 0.04;
          }
        }
      }

      for (const ball of balls) {
        if (ball.pocketed) continue;
        const hitRail = applyCushion(ball, input.table);
        if (hitRail && firstContactKind !== null) railAfterContact = true;
      }

      for (const ball of balls) {
        if (ball.pocketed) continue;
        checkPockets(ball, input.table, potted);
      }
    }

    // Apply rolling friction once per outer step (equivalent to per-frame)
    for (const ball of balls) {
      if (ball.pocketed) continue;
      ball.vx *= FRICTION;
      ball.vy *= FRICTION;
      if (speed(ball) < STOP_SPEED) {
        ball.vx = 0;
        ball.vy = 0;
      }
    }

    if (step % FRAME_SAMPLE_STEP === 0) frames.push(cloneBalls(balls));
    if (!isMoving(balls) && step > 10) break;
  }

  return {
    frames,
    finalBalls: cloneBalls(balls),
    firstContactKind,
    pottedIds: [...potted],
    cueScratch: potted.has("cue"),
    railAfterContact,
  };
};

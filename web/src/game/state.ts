export type BallKind = "cue" | "solid" | "stripe" | "eight";

export type Ball = {
  id: string;
  kind: BallKind;
  x: number;
  y: number;
  vx: number;
  vy: number;
  pocketed: boolean;
};

export const createInitialBalls = (): Ball[] => {
  const cue: Ball = { id: "cue", kind: "cue", x: 260, y: 250, vx: 0, vy: 0, pocketed: false };
  const ballRadius = 12;
  const rackGap = 0.6;
  const dx = ballRadius * 2 + rackGap;
  const dy = Math.sqrt(3) * ballRadius + rackGap * 0.5;
  const apexX = 690;
  const apexY = 250;

  const rackOrder = ["1", "10", "2", "11", "8", "3", "12", "4", "13", "5", "14", "6", "15", "7", "9"];
  const inRack = new Set(rackOrder);
  const kindFor = (id: string): BallKind => {
    if (id === "8") return "eight";
    const n = Number(id);
    return n >= 1 && n <= 7 ? "solid" : "stripe";
  };

  const rackBalls: Ball[] = [];
  let idx = 0;
  for (let row = 0; row < 5; row += 1) {
    const rowX = apexX + row * dx;
    const rowYStart = apexY - (row * dy) / 2;
    for (let col = 0; col <= row; col += 1) {
      const id = rackOrder[idx];
      idx += 1;
      rackBalls.push({
        id,
        kind: kindFor(id),
        x: rowX,
        y: rowYStart + col * dy,
        vx: 0,
        vy: 0,
        pocketed: false,
      });
    }
  }

  // Keep deterministic 1..15 ordering for easier downstream lookups.
  const ordered = Array.from({ length: 15 }, (_, i) => String(i + 1))
    .filter((id) => inRack.has(id))
    .map((id) => rackBalls.find((ball) => ball.id === id)!)
    .filter(Boolean);

  return [cue, ...ordered];
};

export const cloneBalls = (balls: Ball[]): Ball[] => balls.map((ball) => ({ ...ball }));

export const pushSnapshot = (stack: Ball[][], balls: Ball[]): Ball[][] => [
  ...stack,
  cloneBalls(balls),
];

export const restoreLastSnapshot = (
  stack: Ball[][],
  fallbackBalls: Ball[],
): { balls: Ball[]; stack: Ball[][] } => {
  if (stack.length === 0) {
    return { balls: cloneBalls(fallbackBalls), stack: [] };
  }
  const previous = stack[stack.length - 1];
  return { balls: cloneBalls(previous), stack: stack.slice(0, -1) };
};

export const clampBallPositionNoOverlap = ({
  ballId,
  target,
  balls,
  minCenterDistance,
}: {
  ballId: string;
  target: { x: number; y: number };
  balls: Ball[];
  minCenterDistance: number;
}): { x: number; y: number } => {
  let outX = target.x;
  let outY = target.y;

  for (const other of balls) {
    if (other.id === ballId || other.pocketed) continue;
    const dx = outX - other.x;
    const dy = outY - other.y;
    const d = Math.hypot(dx, dy);
    if (d < minCenterDistance) {
      const ux = d < 1e-6 ? 1 : dx / d;
      const uy = d < 1e-6 ? 0 : dy / d;
      outX = other.x + ux * minCenterDistance;
      outY = other.y + uy * minCenterDistance;
    }
  }

  return { x: outX, y: outY };
};

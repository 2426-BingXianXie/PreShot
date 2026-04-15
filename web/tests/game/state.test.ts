import { describe, expect, test } from "vitest";
import {
  createInitialBalls,
  clampBallPositionNoOverlap,
  pushSnapshot,
  restoreLastSnapshot,
} from "../../src/game/state";

describe("practice redo snapshots", () => {
  test("restores exact pre-shot layout", () => {
    const initial = createInitialBalls();
    const moved = initial.map((ball) =>
      ball.id === "cue" ? { ...ball, x: ball.x + 120, y: ball.y - 50 } : ball,
    );

    const stack = pushSnapshot([], initial);
    const restored = restoreLastSnapshot(stack, moved);

    const cue = restored.balls.find((b) => b.id === "cue");
    const initialCue = initial.find((b) => b.id === "cue");

    expect(cue).toBeDefined();
    expect(initialCue).toBeDefined();
    expect(cue?.x).toBe(initialCue?.x);
    expect(cue?.y).toBe(initialCue?.y);
    expect(restored.stack).toHaveLength(0);
  });

  test("prevents dragging ball into overlap with other balls", () => {
    const balls = createInitialBalls();
    const anchor = balls.find((b) => b.id === "1");
    const moved = clampBallPositionNoOverlap({
      ballId: "cue",
      target: { x: anchor!.x, y: anchor!.y },
      balls,
      minCenterDistance: 24,
    });

    const dx = moved.x - anchor!.x;
    const dy = moved.y - anchor!.y;
    expect(Math.hypot(dx, dy)).toBeGreaterThanOrEqual(24);
  });
});

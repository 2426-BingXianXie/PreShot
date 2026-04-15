import { describe, expect, test } from "vitest";
import { simulateShot } from "../../src/physics/simulateShot";
import type { Ball } from "../../src/game/state";

const baseTable = {
  width: 980,
  height: 500,
  cushionInset: 24,
  pocketRadius: 20,
  ballRadius: 12,
};

describe("simulateShot", () => {
  test("produces frame-by-frame motion and settles to final balls", () => {
    const balls: Ball[] = [
      { id: "cue", kind: "cue", x: 180, y: 250, vx: 0, vy: 0, pocketed: false },
      { id: "1", kind: "solid", x: 420, y: 250, vx: 0, vy: 0, pocketed: false },
    ];

    const result = simulateShot({
      balls,
      targetId: "1",
      aimDirection: { x: 1, y: 0 },
      power: 0.6,
      cueOffset: { x: 0, y: 0 },
      table: baseTable,
    });

    expect(result.frames.length).toBeGreaterThan(3);
    const cueStart = result.frames[0].find((ball) => ball.id === "cue");
    const cueEnd = result.finalBalls.find((ball) => ball.id === "cue");
    expect(cueStart && cueEnd ? cueEnd.x !== cueStart.x || cueEnd.y !== cueStart.y : false).toBe(true);
  });

  test("reports first contact kind when cue hits selected ball", () => {
    const balls: Ball[] = [
      { id: "cue", kind: "cue", x: 210, y: 240, vx: 0, vy: 0, pocketed: false },
      { id: "7", kind: "solid", x: 430, y: 240, vx: 0, vy: 0, pocketed: false },
    ];

    const dx = 430 - 210;
    const dy = 240 - 240;
    const mag = Math.hypot(dx, dy);
    const result = simulateShot({
      balls,
      targetId: "7",
      aimDirection: { x: dx / mag, y: dy / mag },
      power: 0.7,
      cueOffset: { x: 0.05, y: -0.1 },
      table: baseTable,
    });

    expect(result.firstContactKind).toBe("solid");
  });

  test("object ball can be pocketed when aimed at corner pocket", () => {
    // Ball 1 sits directly in front of the top-left corner pocket (24, 24).
    // Cue ball is aligned to push it straight in.
    const balls: Ball[] = [
      { id: "cue", kind: "cue", x: 140, y: 50, vx: 0, vy: 0, pocketed: false },
      { id: "1", kind: "solid", x: 60, y: 38, vx: 0, vy: 0, pocketed: false },
    ];

    const dx = 60 - 140;
    const dy = 38 - 50;
    const mag = Math.hypot(dx, dy);
    const result = simulateShot({
      balls,
      targetId: "1",
      aimDirection: { x: dx / mag, y: dy / mag },
      power: 0.4,
      cueOffset: { x: 0, y: 0 },
      table: baseTable,
    });

    expect(result.pottedIds).toContain("1");
    const ball1 = result.finalBalls.find((b) => b.id === "1");
    expect(ball1?.pocketed).toBe(true);
  });

  test("object ball receives significant velocity from head-on collision", () => {
    const balls: Ball[] = [
      { id: "cue", kind: "cue", x: 200, y: 250, vx: 0, vy: 0, pocketed: false },
      { id: "3", kind: "solid", x: 500, y: 250, vx: 0, vy: 0, pocketed: false },
    ];

    const result = simulateShot({
      balls,
      targetId: "3",
      aimDirection: { x: 1, y: 0 },
      power: 0.6,
      cueOffset: { x: 0, y: 0 },
      table: baseTable,
    });

    const ball3 = result.finalBalls.find((b) => b.id === "3");
    expect(ball3).toBeDefined();
    // The object ball should have moved significantly from its start position
    expect(ball3!.x).toBeGreaterThan(600);
  });

  test("break shot scatters multiple balls from the rack", () => {
    // Simulate a break: cue ball aimed at the apex of a tight rack
    const apexX = 690;
    const apexY = 250;
    const r = 12;
    const gap = 0.6;
    const rowDx = r * 2 + gap;
    const rowDy = Math.sqrt(3) * r + gap * 0.5;
    const balls: Ball[] = [
      { id: "cue", kind: "cue", x: 260, y: 250, vx: 0, vy: 0, pocketed: false },
      { id: "1", kind: "solid", x: apexX, y: apexY, vx: 0, vy: 0, pocketed: false },
      { id: "2", kind: "solid", x: apexX + rowDx, y: apexY - rowDy / 2, vx: 0, vy: 0, pocketed: false },
      { id: "10", kind: "stripe", x: apexX + rowDx, y: apexY + rowDy / 2, vx: 0, vy: 0, pocketed: false },
      { id: "8", kind: "eight", x: apexX + rowDx * 2, y: apexY, vx: 0, vy: 0, pocketed: false },
    ];

    const result = simulateShot({
      balls,
      targetId: "1",
      aimDirection: { x: 1, y: 0 },
      power: 0.95,
      cueOffset: { x: 0, y: 0 },
      table: baseTable,
    });

    // At least some balls should have moved far from their starting positions
    const movedBalls = result.finalBalls.filter((b) => {
      if (b.id === "cue") return false;
      const orig = balls.find((o) => o.id === b.id)!;
      return Math.hypot(b.x - orig.x, b.y - orig.y) > 50;
    });
    expect(movedBalls.length).toBeGreaterThanOrEqual(2);
  });
});


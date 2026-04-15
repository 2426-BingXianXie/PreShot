import { describe, expect, test } from "vitest";
import { computePreviewPath, computeGhostBall } from "./preview";

const TABLE = { width: 1000, height: 500, cushionInset: 24, ballRadius: 12 };

describe("computeGhostBall", () => {
  test("returns ghost ball position for a direct (full-ball) hit", () => {
    const ghost = computeGhostBall(
      { x: 200, y: 250 },
      { x: 1, y: 0 },
      { x: 500, y: 250 },
      12,
    );
    expect(ghost).not.toBeNull();
    expect(ghost!.x).toBeCloseTo(500 - 24, 1);
    expect(ghost!.y).toBeCloseTo(250, 1);
  });

  test("returns null when aim ray misses the ball", () => {
    const ghost = computeGhostBall(
      { x: 200, y: 250 },
      { x: 1, y: 0 },
      { x: 500, y: 350 },
      12,
    );
    expect(ghost).toBeNull();
  });

  test("returns ghost ball for a cut shot (aim offset from OB center)", () => {
    const ghost = computeGhostBall(
      { x: 200, y: 250 },
      { x: 1, y: 0 },
      { x: 500, y: 260 },
      12,
    );
    expect(ghost).not.toBeNull();
    expect(ghost!.x).toBeLessThan(500);
    expect(ghost!.y).toBeCloseTo(250, 1);
  });

  test("returns null when target ball is behind the cue ball", () => {
    const ghost = computeGhostBall(
      { x: 500, y: 250 },
      { x: 1, y: 0 },
      { x: 200, y: 250 },
      12,
    );
    expect(ghost).toBeNull();
  });
});

describe("preview path", () => {
  test("returns both pre-contact and post-contact segments", () => {
    const result = computePreviewPath({
      cue: { x: 200, y: 250 },
      target: { x: 500, y: 250 },
      aimDirection: { x: 1, y: 0 },
      power: 0.6,
      cueOffset: { x: 0.3, y: 0.2 },
      table: TABLE,
    });

    expect(result.prePath.length).toBeGreaterThan(1);
    expect(result.objectPath.length).toBeGreaterThan(1);
    expect(result.postPath.length).toBeGreaterThan(1);
  });

  test("changes post path by side spin direction", () => {
    const left = computePreviewPath({
      cue: { x: 200, y: 250 },
      target: { x: 500, y: 250 },
      aimDirection: { x: 1, y: 0 },
      power: 0.6,
      cueOffset: { x: -0.4, y: 0.1 },
      table: TABLE,
    });
    const right = computePreviewPath({
      cue: { x: 200, y: 250 },
      target: { x: 500, y: 250 },
      aimDirection: { x: 1, y: 0 },
      power: 0.6,
      cueOffset: { x: 0.4, y: 0.1 },
      table: TABLE,
    });

    expect(left.postPath[left.postPath.length - 1].y).not.toBe(
      right.postPath[right.postPath.length - 1].y,
    );
  });

  test("pulls cue ball back on strong back spin", () => {
    const backSpin = computePreviewPath({
      cue: { x: 200, y: 250 },
      target: { x: 500, y: 250 },
      aimDirection: { x: 1, y: 0 },
      power: 0.8,
      cueOffset: { x: 0, y: 1 },
      table: TABLE,
    });

    expect(backSpin.postPath[backSpin.postPath.length - 1].x).toBeLessThan(500);
  });

  test("uses fixed realistic physics carry profile", () => {
    const result = computePreviewPath({
      cue: { x: 220, y: 250 },
      target: { x: 520, y: 250 },
      aimDirection: { x: 1, y: 0 },
      power: 0.7,
      cueOffset: { x: 0.2, y: -0.2 },
      table: TABLE,
    });

    const polylineLength = (points: { x: number; y: number }[]) =>
      points.slice(1).reduce((sum, p, idx) => {
        const prev = points[idx];
        return sum + Math.hypot(p.x - prev.x, p.y - prev.y);
      }, 0);

    expect(polylineLength(result.postPath)).toBeLessThan(1000);
  });

  test("OB deflects along ghost-to-OB direction for a cut shot", () => {
    const aimDir = { x: 1, y: 0 };
    const result = computePreviewPath({
      cue: { x: 200, y: 250 },
      target: { x: 500, y: 262 },
      aimDirection: aimDir,
      power: 0.6,
      cueOffset: { x: 0, y: 0 },
      table: TABLE,
    });

    // The initial deflection should move the OB in the +y direction
    // (ghost ball is below the OB center, so deflection pushes OB downward).
    // Check the second point, not the last — the OB may bounce off a wall later.
    expect(result.objectPath.length).toBeGreaterThan(1);
    const obStart = result.objectPath[0];
    const obSecond = result.objectPath[1];
    expect(obSecond.y).toBeGreaterThan(obStart.y);
  });

  test("postPath extends to more than 3 segments for moderate power", () => {
    const result = computePreviewPath({
      cue: { x: 200, y: 250 },
      target: { x: 500, y: 250 },
      aimDirection: { x: 1, y: 0 },
      power: 0.7,
      cueOffset: { x: 0, y: -0.3 },
      table: TABLE,
    });

    expect(result.postPath.length).toBeGreaterThan(3);
  });

  test("contactPoint is at ghost ball position, not OB center", () => {
    const result = computePreviewPath({
      cue: { x: 200, y: 250 },
      target: { x: 500, y: 250 },
      aimDirection: { x: 1, y: 0 },
      power: 0.5,
      cueOffset: { x: 0, y: 0 },
      table: TABLE,
    });

    expect(result.contactPoint.x).toBeLessThan(500);
    expect(result.contactPoint.x).toBeCloseTo(500 - 24, 1);
  });

  test("stun shot (no spin): CB moves ~perpendicular to OB deflection", () => {
    // Full ball hit, center cue = stun shot → 90° rule: CB should move
    // roughly perpendicular to the OB direction. For a straight-on shot,
    // the CB should nearly stop (no tangent component).
    const result = computePreviewPath({
      cue: { x: 200, y: 250 },
      target: { x: 500, y: 250 },
      aimDirection: { x: 1, y: 0 },
      power: 0.5,
      cueOffset: { x: 0, y: 0 },
      table: TABLE,
    });

    // On a head-on stun shot the CB transfers almost all momentum to the OB
    // and barely moves forward. The CB final position should be near contact.
    const cbEnd = result.postPath[result.postPath.length - 1];
    expect(cbEnd.x).toBeLessThan(result.contactPoint.x + 100);
  });

  test("follow (topspin): CB advances well past the contact point", () => {
    const result = computePreviewPath({
      cue: { x: 200, y: 250 },
      target: { x: 500, y: 250 },
      aimDirection: { x: 1, y: 0 },
      power: 0.7,
      cueOffset: { x: 0, y: -1 },
      table: TABLE,
    });

    const cbEnd = result.postPath[result.postPath.length - 1];
    expect(cbEnd.x).toBeGreaterThan(result.contactPoint.x + 50);
  });

  test("higher power makes OB travel farther (max displacement)", () => {
    const low = computePreviewPath({
      cue: { x: 200, y: 250 },
      target: { x: 500, y: 250 },
      aimDirection: { x: 1, y: 0 },
      power: 0.3,
      cueOffset: { x: 0, y: 0 },
      table: TABLE,
    });
    const high = computePreviewPath({
      cue: { x: 200, y: 250 },
      target: { x: 500, y: 250 },
      aimDirection: { x: 1, y: 0 },
      power: 0.9,
      cueOffset: { x: 0, y: 0 },
      table: TABLE,
    });

    // Measure total path length, not final position (OB may bounce back at high power).
    const pathLen = (pts: { x: number; y: number }[]) =>
      pts.slice(1).reduce((sum, p, i) => sum + Math.hypot(p.x - pts[i].x, p.y - pts[i].y), 0);
    expect(pathLen(high.objectPath)).toBeGreaterThan(pathLen(low.objectPath));
  });

  test("OB path includes cushion bounce when driven toward wall", () => {
    // Target near the right wall — on a hard straight shot, the OB
    // should bounce off the far cushion and come back.
    const result = computePreviewPath({
      cue: { x: 200, y: 250 },
      target: { x: 800, y: 250 },
      aimDirection: { x: 1, y: 0 },
      power: 0.9,
      cueOffset: { x: 0, y: 0 },
      table: TABLE,
    });

    // The OB was at x=800, moving right. After bouncing off the right wall,
    // the final x should be less than the far cushion (it came back).
    const obEnd = result.objectPath[result.objectPath.length - 1];
    const cushionX = TABLE.width - TABLE.cushionInset - TABLE.ballRadius;
    expect(obEnd.x).toBeLessThan(cushionX);
    // And it should have traveled a meaningful distance
    expect(result.objectPath.length).toBeGreaterThan(3);
  });
});

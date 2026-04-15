import { describe, expect, test } from "vitest";
import {
  initialVelocityFromImpulse,
  mapPowerToImpulse,
  mapSpinFromOffset,
  reflectFromCushion,
  type Vec2,
} from "./engine";

const almostEqual = (a: number, b: number, tolerance = 1e-6) => {
  expect(Math.abs(a - b)).toBeLessThanOrEqual(tolerance);
};

const almostVec = (a: Vec2, b: Vec2, tolerance = 1e-6) => {
  almostEqual(a.x, b.x, tolerance);
  almostEqual(a.y, b.y, tolerance);
};

describe("cue ball physics core", () => {
  test("maps power from 0..1 into impulse range", () => {
    expect(mapPowerToImpulse(0, 0.5, 4)).toBe(0.5);
    expect(mapPowerToImpulse(1, 0.5, 4)).toBe(4);
    expect(mapPowerToImpulse(0.5, 0.5, 4)).toBe(2.25);
  });

  test("computes initial velocity from impulse and mass", () => {
    const velocity = initialVelocityFromImpulse(2.7, 0.17, { x: 1, y: 0 });
    almostVec(velocity, { x: 15.882352941176471, y: 0 }, 1e-8);
  });

  test("maps cue strike offset to side and top/back spin", () => {
    const spin = mapSpinFromOffset(
      { x: 0.5, y: -0.25 },
      0.8,
      { sideScale: 16, topBackScale: 12 },
      { sideMax: 20, topBackMax: 20 },
    );

    almostEqual(spin.side, 6.4);
    almostEqual(spin.topBack, -2.4);
  });

  test("reflects from cushion and applies side spin coupling", () => {
    const reflected = reflectFromCushion(
      { x: 2, y: -1 },
      { x: 0, y: 1 },
      0.7,
      0.12,
      0.08,
      6,
    );

    // Cushion normal is +Y, so incoming negative Y reflects positive and damped.
    almostEqual(reflected.velocity.y, 0.7);
    // Tangential component is adjusted by spin coupling.
    almostEqual(reflected.velocity.x, 2.24);
    almostEqual(reflected.nextSideSpin, 5.52);
  });
});

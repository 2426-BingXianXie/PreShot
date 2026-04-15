import { describe, expect, test } from "vitest";
import {
  TABLE_TOAST_FADE_MS,
  TABLE_TOAST_TOTAL_MS,
  TABLE_TOAST_VISIBLE_MS,
  transitionToastPhase,
} from "../../src/ui/tableToastLifecycle";

describe("table toast lifecycle", () => {
  test("splits total lifetime into visible and fade durations", () => {
    expect(TABLE_TOAST_TOTAL_MS).toBeGreaterThan(TABLE_TOAST_FADE_MS);
    expect(TABLE_TOAST_VISIBLE_MS).toBe(TABLE_TOAST_TOTAL_MS - TABLE_TOAST_FADE_MS);
  });

  test("transitions through active -> fading -> hidden", () => {
    expect(transitionToastPhase("hidden", "show")).toBe("active");
    expect(transitionToastPhase("active", "fade")).toBe("fading");
    expect(transitionToastPhase("fading", "hide")).toBe("hidden");
  });
});

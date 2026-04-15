import { describe, expect, test } from "vitest";
import { createInitialBalls } from "../../src/game/state";
import {
  createInitialMatchState,
  resolveMatchTurn,
  legalTargetKindsForPlayer,
  type MatchState,
} from "../../src/game/rules";

const withGroups = (groups: { 1: "solid" | "stripe"; 2: "solid" | "stripe" }): MatchState => ({
  ...createInitialMatchState(),
  phase: "groups_set",
  playerGroups: groups,
});

describe("match rules", () => {
  test("assigns groups on first legal pot in open table", () => {
    const state = createInitialMatchState();
    const result = resolveMatchTurn(state, {
      event: { targetKind: "solid", potted: true, cueScratch: false },
      remaining: { solid: 3, stripe: 3, eight: 1 },
    });

    expect(result.state.phase).toBe("groups_set");
    expect(result.state.playerGroups[1]).toBe("solid");
    expect(result.state.playerGroups[2]).toBe("stripe");
    expect(result.state.currentPlayer).toBe(1);
  });

  test("switches turn on miss after groups are set", () => {
    const state = withGroups({ 1: "solid", 2: "stripe" });
    const result = resolveMatchTurn(state, {
      event: { targetKind: "solid", potted: false, cueScratch: false },
      remaining: { solid: 2, stripe: 3, eight: 1 },
    });
    expect(result.state.currentPlayer).toBe(2);
  });

  test("wins when black 8 is potted after clearing own group", () => {
    const state = withGroups({ 1: "solid", 2: "stripe" });
    const result = resolveMatchTurn(state, {
      event: { targetKind: "eight", potted: true, cueScratch: false },
      remaining: { solid: 0, stripe: 2, eight: 0 },
    });
    expect(result.state.phase).toBe("ended");
    expect(result.state.winner).toBe(1);
  });

  test("loses when black 8 is potted early", () => {
    const state = withGroups({ 1: "solid", 2: "stripe" });
    const result = resolveMatchTurn(state, {
      event: { targetKind: "eight", potted: true, cueScratch: false },
      remaining: { solid: 1, stripe: 2, eight: 0 },
    });
    expect(result.state.phase).toBe("ended");
    expect(result.state.winner).toBe(2);
  });

  test("returns legal target kind based on remaining balls", () => {
    const balls = createInitialBalls();
    const state = withGroups({ 1: "solid", 2: "stripe" });
    const legal = legalTargetKindsForPlayer(state, 1, balls);
    expect(legal).toEqual(["solid"]);
  });

  test("awards ball-in-hand to opponent after cue scratch", () => {
    const state = withGroups({ 1: "solid", 2: "stripe" });
    const result = resolveMatchTurn(state, {
      event: { targetKind: "solid", potted: false, cueScratch: true },
      remaining: { solid: 2, stripe: 3, eight: 1 },
    });
    expect(result.state.currentPlayer).toBe(2);
    expect(result.state.ballInHand).toBe(true);
  });

  test("awards ball-in-hand on wrong first contact", () => {
    const state = withGroups({ 1: "solid", 2: "stripe" });
    const result = resolveMatchTurn(state, {
      event: { targetKind: "stripe", potted: false, cueScratch: false },
      remaining: { solid: 2, stripe: 3, eight: 1 },
    });
    expect(result.state.currentPlayer).toBe(2);
    expect(result.state.ballInHand).toBe(true);
  });

  test("clears ball-in-hand when legal shot starts", () => {
    const state = { ...withGroups({ 1: "solid", 2: "stripe" }), ballInHand: true, currentPlayer: 2 as const };
    const result = resolveMatchTurn(state, {
      event: { targetKind: "stripe", potted: true, cueScratch: false, railAfterContact: true },
      remaining: { solid: 2, stripe: 2, eight: 1 },
    });
    expect(result.state.ballInHand).toBe(false);
  });

  test("fouls when no pot and no rail after legal contact", () => {
    const state = withGroups({ 1: "solid", 2: "stripe" });
    const result = resolveMatchTurn(state, {
      event: { targetKind: "solid", potted: false, cueScratch: false, railAfterContact: false },
      remaining: { solid: 2, stripe: 3, eight: 1 },
    });
    expect(result.foul).toBe(true);
    expect(result.state.currentPlayer).toBe(2);
    expect(result.state.ballInHand).toBe(true);
  });

  test("does not foul on miss when rail contact exists", () => {
    const state = withGroups({ 1: "solid", 2: "stripe" });
    const result = resolveMatchTurn(state, {
      event: { targetKind: "solid", potted: false, cueScratch: false, railAfterContact: true },
      remaining: { solid: 2, stripe: 3, eight: 1 },
    });
    expect(result.foul).toBe(false);
    expect(result.state.currentPlayer).toBe(2);
    expect(result.state.ballInHand).toBe(false);
  });

  test("loses if cue scratches while potting black 8", () => {
    const state = withGroups({ 1: "solid", 2: "stripe" });
    const result = resolveMatchTurn(state, {
      event: { targetKind: "eight", potted: true, cueScratch: true, railAfterContact: true },
      remaining: { solid: 0, stripe: 2, eight: 0 },
    });
    expect(result.state.phase).toBe("ended");
    expect(result.state.winner).toBe(2);
  });
});

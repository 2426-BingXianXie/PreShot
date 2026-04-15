import type { Ball, BallKind } from "./state";

export type PlayerId = 1 | 2;
export type PlayerGroup = "solid" | "stripe" | null;
export type MatchPhase = "open" | "groups_set" | "ended";

export type MatchState = {
  currentPlayer: PlayerId;
  playerGroups: { 1: PlayerGroup; 2: PlayerGroup };
  phase: MatchPhase;
  winner: PlayerId | null;
  ballInHand: boolean;
};

export type ShotEvent = {
  targetKind: BallKind | null;
  potted: boolean;
  cueScratch: boolean;
  railAfterContact?: boolean;
};

export type RemainingCounts = {
  solid: number;
  stripe: number;
  eight: number;
};

export const createInitialMatchState = (): MatchState => ({
  currentPlayer: 1,
  playerGroups: { 1: null, 2: null },
  phase: "open",
  winner: null,
  ballInHand: false,
});

const otherPlayer = (id: PlayerId): PlayerId => (id === 1 ? 2 : 1);

export const countRemaining = (balls: Ball[]): RemainingCounts => ({
  solid: balls.filter((b) => b.kind === "solid" && !b.pocketed).length,
  stripe: balls.filter((b) => b.kind === "stripe" && !b.pocketed).length,
  eight: balls.some((b) => b.kind === "eight" && !b.pocketed) ? 1 : 0,
});

const playerHasClearedGroup = (
  state: MatchState,
  player: PlayerId,
  remaining: RemainingCounts,
): boolean => {
  const group = state.playerGroups[player];
  if (group === "solid") return remaining.solid === 0;
  if (group === "stripe") return remaining.stripe === 0;
  return false;
};

export const legalTargetKindsForPlayer = (
  state: MatchState,
  player: PlayerId,
  balls: Ball[],
): BallKind[] => {
  if (state.phase === "open") return ["solid", "stripe"];
  if (state.phase === "ended") return [];

  const remaining = countRemaining(balls);
  const group = state.playerGroups[player];
  if (group === "solid") return remaining.solid === 0 ? ["eight"] : ["solid"];
  if (group === "stripe") return remaining.stripe === 0 ? ["eight"] : ["stripe"];
  return ["solid", "stripe"];
};

export const resolveMatchTurn = (
  state: MatchState,
  input: { event: ShotEvent; remaining: RemainingCounts },
): { state: MatchState; foul: boolean; summary: string } => {
  if (state.phase === "ended") {
    return { state, foul: false, summary: "Game already ended." };
  }

  const clearedState = state.ballInHand ? { ...state, ballInHand: false } : state;
  const shooter = state.currentPlayer;
  const defender = otherPlayer(shooter);
  const { event, remaining } = input;
  const railAfterContact = event.railAfterContact ?? true;

  if (event.cueScratch && event.targetKind === "eight" && event.potted) {
    return {
      state: { ...clearedState, phase: "ended", winner: defender, ballInHand: false },
      foul: true,
      summary: "Cue scratch on black 8. Opponent wins.",
    };
  }

  if (event.cueScratch) {
    return {
      state: { ...clearedState, currentPlayer: defender, ballInHand: true },
      foul: true,
      summary: "Cue scratch foul. Ball-in-hand to opponent.",
    };
  }

  if (event.targetKind === null) {
    return {
      state: { ...clearedState, currentPlayer: defender, ballInHand: true },
      foul: true,
      summary: "No legal contact. Ball-in-hand to opponent.",
    };
  }

  if (clearedState.phase === "open") {
    if (event.potted && (event.targetKind === "solid" || event.targetKind === "stripe")) {
      const shooterGroup = event.targetKind;
      const defenderGroup = shooterGroup === "solid" ? "stripe" : "solid";
      return {
        state: {
          ...clearedState,
          phase: "groups_set",
          playerGroups: { [shooter]: shooterGroup, [defender]: defenderGroup } as {
            1: PlayerGroup;
            2: PlayerGroup;
          },
        },
        foul: false,
        summary: `Groups assigned. Player ${shooter} is ${shooterGroup}.`,
      };
    }
    if (event.potted && event.targetKind === "eight") {
      return {
        state: { ...clearedState, phase: "ended", winner: defender },
        foul: true,
        summary: "Illegal black 8 pot. Opponent wins.",
      };
    }
    if (!event.potted && !railAfterContact) {
      return {
        state: { ...clearedState, currentPlayer: defender, ballInHand: true },
        foul: true,
        summary: "No rail after contact. Ball-in-hand to opponent.",
      };
    }
    return {
      state: { ...clearedState, currentPlayer: defender },
      foul: false,
      summary: "Open table miss. Turn switches.",
    };
  }

  const group = clearedState.playerGroups[shooter];
  const legalKind =
    group === "solid"
      ? remaining.solid === 0
        ? "eight"
        : "solid"
      : group === "stripe"
        ? remaining.stripe === 0
          ? "eight"
          : "stripe"
        : null;

  if (event.targetKind === "eight" && event.potted) {
    const cleared = playerHasClearedGroup(clearedState, shooter, remaining);
    return {
      state: { ...clearedState, phase: "ended", winner: cleared ? shooter : defender },
      foul: !cleared,
      summary: cleared ? `Player ${shooter} wins by potting black 8.` : "Early black 8 pot. Opponent wins.",
    };
  }

  if (legalKind && event.targetKind !== legalKind) {
    return {
      state: { ...clearedState, currentPlayer: defender, ballInHand: true },
      foul: true,
      summary: "Wrong first contact. Ball-in-hand to opponent.",
    };
  }

  if (!event.potted) {
    if (!railAfterContact) {
      return {
        state: { ...clearedState, currentPlayer: defender, ballInHand: true },
        foul: true,
        summary: "No rail after contact. Ball-in-hand to opponent.",
      };
    }
    return {
      state: { ...clearedState, currentPlayer: defender },
      foul: false,
      summary: "Miss. Turn switches.",
    };
  }

  return {
    state: clearedState,
    foul: false,
    summary: `Player ${shooter} potted ${event.targetKind}. Continue shooting.`,
  };
};

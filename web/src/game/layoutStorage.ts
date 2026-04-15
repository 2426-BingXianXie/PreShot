import type { Ball } from "./state";
import { cloneBalls } from "./state";

const STORAGE_KEY = "preshot.practice.layout.v1";

type StorageLike = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
};

type SavedLayout = {
  balls: Ball[];
  savedAt: string;
};

const isValidBall = (value: unknown): value is Ball => {
  if (!value || typeof value !== "object") return false;
  const ball = value as Partial<Ball>;
  return (
    typeof ball.id === "string" &&
    typeof ball.kind === "string" &&
    typeof ball.x === "number" &&
    typeof ball.y === "number" &&
    typeof ball.vx === "number" &&
    typeof ball.vy === "number" &&
    typeof ball.pocketed === "boolean"
  );
};

export const savePracticeLayout = (storage: StorageLike, balls: Ball[]): void => {
  const payload: SavedLayout = {
    balls: cloneBalls(balls),
    savedAt: new Date().toISOString(),
  };
  storage.setItem(STORAGE_KEY, JSON.stringify(payload));
};

export const loadSavedPracticeLayout = (storage: StorageLike): Ball[] | null => {
  const raw = storage.getItem(STORAGE_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<SavedLayout>;
    if (!parsed || !Array.isArray(parsed.balls)) return null;
    if (!parsed.balls.every(isValidBall)) return null;
    return cloneBalls(parsed.balls);
  } catch {
    return null;
  }
};

export const clearSavedPracticeLayout = (storage: StorageLike): void => {
  storage.removeItem(STORAGE_KEY);
};


import { describe, expect, test } from "vitest";
import type { Ball } from "./state";
import {
  clearSavedPracticeLayout,
  loadSavedPracticeLayout,
  savePracticeLayout,
} from "./layoutStorage";

const createMemoryStorage = () => {
  const store = new Map<string, string>();
  return {
    getItem: (key: string) => (store.has(key) ? store.get(key)! : null),
    setItem: (key: string, value: string) => {
      store.set(key, value);
    },
    removeItem: (key: string) => {
      store.delete(key);
    },
  };
};

const mockBalls: Ball[] = [
  { id: "cue", kind: "cue", x: 100, y: 120, vx: 0, vy: 0, pocketed: false },
  { id: "1", kind: "solid", x: 200, y: 220, vx: 0, vy: 0, pocketed: false },
];

describe("practice layout storage", () => {
  test("saves and loads practice layout", () => {
    const storage = createMemoryStorage();
    savePracticeLayout(storage, mockBalls);
    const loaded = loadSavedPracticeLayout(storage);
    expect(loaded).toEqual(mockBalls);
  });

  test("returns null for invalid saved payload", () => {
    const storage = createMemoryStorage();
    storage.setItem("preshot.practice.layout.v1", "{bad json");
    expect(loadSavedPracticeLayout(storage)).toBeNull();
  });

  test("clears saved layout", () => {
    const storage = createMemoryStorage();
    savePracticeLayout(storage, mockBalls);
    clearSavedPracticeLayout(storage);
    expect(loadSavedPracticeLayout(storage)).toBeNull();
  });
});

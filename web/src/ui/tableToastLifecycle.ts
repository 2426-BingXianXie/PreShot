export type TableToastPhase = "hidden" | "active" | "fading";
export type TableToastEvent = "show" | "fade" | "hide";

export const TABLE_TOAST_TOTAL_MS = 1800;
export const TABLE_TOAST_FADE_MS = 260;
export const TABLE_TOAST_VISIBLE_MS = TABLE_TOAST_TOTAL_MS - TABLE_TOAST_FADE_MS;

export const transitionToastPhase = (
  phase: TableToastPhase,
  event: TableToastEvent,
): TableToastPhase => {
  if (event === "show") return "active";
  if (event === "fade" && phase === "active") return "fading";
  if (event === "hide") return "hidden";
  return phase;
};

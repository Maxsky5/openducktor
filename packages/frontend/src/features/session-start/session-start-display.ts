import type { AgentSessionStartMode } from "@openducktor/core";

const START_MODE_DISPLAY_ORDER: Record<AgentSessionStartMode, number> = {
  fresh: 0,
  reuse: 1,
  fork: 2,
};

export const orderStartModesForDisplay = (
  startModes: readonly AgentSessionStartMode[],
): AgentSessionStartMode[] => {
  return [...startModes].sort(
    (left, right) => START_MODE_DISPLAY_ORDER[left] - START_MODE_DISPLAY_ORDER[right],
  );
};

export const sessionStartModeButtonLabel = (startMode: AgentSessionStartMode): string => {
  if (startMode === "fresh") {
    return "Start fresh";
  }
  if (startMode === "reuse") {
    return "Reuse existing";
  }
  return "Fork existing";
};

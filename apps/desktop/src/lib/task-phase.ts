import type { TaskPhase } from "@openblueprint/contracts";

export const PHASE_OPTIONS: Array<{ value: TaskPhase; label: string }> = [
  { value: "backlog", label: "Backlog" },
  { value: "specifying", label: "Specifying" },
  { value: "ready_for_dev", label: "Ready for Dev" },
  { value: "in_progress", label: "In Progress" },
  { value: "blocked_needs_input", label: "Blocked / Needs Input" },
  { value: "done", label: "Done" },
];

export const PHASE_LABEL_MAP = new Map(PHASE_OPTIONS.map((entry) => [entry.value, entry.label]));

export const phaseLabel = (phase: TaskPhase | undefined): string => {
  if (!phase) {
    return "Backlog";
  }
  return PHASE_LABEL_MAP.get(phase) ?? phase;
};

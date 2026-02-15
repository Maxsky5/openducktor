import type { TaskCard, TaskPhase } from "@openblueprint/contracts";

type ToneVariant = "secondary" | "warning" | "danger" | "success";

const PRIORITY_FALLBACK = "P4";
const PRIORITY_LABELS = ["P0", "P1", "P2", "P3", "P4"] as const;

export const priorityLabel = (priority: number): string => {
  if (!Number.isFinite(priority)) {
    return PRIORITY_FALLBACK;
  }

  if (priority < 0) {
    return PRIORITY_LABELS[0];
  }

  if (priority >= PRIORITY_LABELS.length) {
    return PRIORITY_FALLBACK;
  }

  return PRIORITY_LABELS[priority] ?? PRIORITY_FALLBACK;
};

export const statusLabel = (status: TaskCard["status"]): string => status.replaceAll("_", " ");

export const statusBadgeVariant = (status: TaskCard["status"]): ToneVariant => {
  if (status === "blocked") {
    return "danger";
  }
  if (status === "in_progress") {
    return "warning";
  }
  if (status === "closed") {
    return "success";
  }
  return "secondary";
};

export const phaseBadgeVariant = (phase?: TaskPhase): ToneVariant => {
  if (!phase) {
    return "secondary";
  }
  if (phase === "blocked_needs_input") {
    return "danger";
  }
  if (phase === "done") {
    return "success";
  }
  if (phase === "in_progress") {
    return "warning";
  }
  return "secondary";
};

export const humanDate = (value: string): string => {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.valueOf())) {
    return value;
  }
  return parsed.toLocaleString();
};

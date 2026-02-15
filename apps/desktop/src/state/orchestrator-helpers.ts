import type { TaskPhase } from "@openblueprint/contracts";

const TASK_STORE_HINT =
  "OpenBlueprint uses centralized Beads at ~/.openblueprint/beads/<repo-id>/.beads. Initialization is automatic on repo open; retry if this is the first load.";

export const errorMessage = (error: unknown): string => {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === "string") {
    return error;
  }
  try {
    return JSON.stringify(error);
  } catch {
    return "Unknown error";
  }
};

export const summarizeTaskLoadError = (error: unknown): string => {
  const message = (errorMessage(error).split("\n").at(0) ?? "Unknown error").trim();
  const beadsFailure = /beads|beads_dir|\bbd\b|task store/i.test(message);
  if (beadsFailure) {
    return `Task store unavailable. ${message} ${TASK_STORE_HINT}`;
  }
  return `Task store unavailable. ${message}`;
};

export const phaseToStatus = (phase: TaskPhase): "open" | "in_progress" | "blocked" | "closed" => {
  if (phase === "in_progress") {
    return "in_progress";
  }
  if (phase === "blocked_needs_input") {
    return "blocked";
  }
  if (phase === "done") {
    return "closed";
  }
  return "open";
};

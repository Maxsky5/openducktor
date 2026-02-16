import type { TaskPhase } from "@openblueprint/contracts";

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

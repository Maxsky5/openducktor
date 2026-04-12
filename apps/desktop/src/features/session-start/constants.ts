import type { AgentScenario } from "@openducktor/core";

export const BUILD_TARGET_BRANCH_SCENARIOS = new Set<AgentScenario>([
  "build_implementation_start",
  "build_after_qa_rejected",
  "build_after_human_request_changes",
]);

export const supportsTaskTargetBranchSelection = (
  role: string | null | undefined,
  scenario: AgentScenario | null | undefined,
): boolean => {
  return role === "build" && scenario !== undefined && scenario !== null
    ? BUILD_TARGET_BRANCH_SCENARIOS.has(scenario)
    : false;
};

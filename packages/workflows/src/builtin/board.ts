import type { WorkflowBoardLayout } from "../workflow-catalog";

/** Production column order. Workflow inventory and task arrival never define board order. */
export const BUILTIN_BOARD_LAYOUT: WorkflowBoardLayout = {
  states: [
    { id: "open", taskOrder: "priority_then_created" },
    ...(
      [
        "spec_ready",
        "ready_for_dev",
        "in_progress",
        "blocked",
        "ai_review",
        "human_review",
        "closed",
      ] as const
    ).map((id) => ({ id, taskOrder: "updated" as const })),
  ],
};

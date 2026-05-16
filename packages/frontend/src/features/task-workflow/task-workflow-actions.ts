import type { TaskAction } from "@openducktor/contracts";

export type BaseTaskWorkflowAction = Exclude<TaskAction, "view_details">;

export type TaskWorkflowAction = BaseTaskWorkflowAction | "open_spec" | "open_planner";

export type AgentStudioWorkflowQuickAction =
  | "set_spec"
  | "set_plan"
  | "build_start"
  | "qa_start"
  | "human_request_changes";

export const AGENT_STUDIO_SESSION_START_ACTIONS = [
  "set_spec",
  "set_plan",
  "build_start",
  "qa_start",
  "human_request_changes",
] as const satisfies readonly AgentStudioWorkflowQuickAction[];

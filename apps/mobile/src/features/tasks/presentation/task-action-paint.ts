import { type TaskWorkflowAction, type BuiltinRoleId as AgentRole } from "@openducktor/workflows";
import type { IconName } from "@/ui/icon";

/**
 * The role of an action that starts a role session. The desktop shows the role icon on these
 * actions, in place of the action icon.
 */
export const taskActionRole = (action: TaskWorkflowAction): AgentRole | null => {
  switch (action) {
    case "set_spec":
      return "spec";
    case "set_plan":
      return "planner";
    case "build_start":
      return "build";
    case "qa_start":
      return "qa";
    default:
      return null;
  }
};

/** The icon of each workflow action, on its button and in the actions menu, after the desktop. */
export const TASK_ACTION_ICONS = {
  set_spec: "file-pen",
  set_plan: "route",
  open_spec: "square-arrow-out-up-right",
  open_planner: "square-arrow-out-up-right",
  open_builder: "square-arrow-out-up-right",
  open_qa: "square-arrow-out-up-right",
  build_start: "hammer",
  qa_start: "search-check",
  human_approve: "circle-check-big",
  human_request_changes: "undo-2",
  reset_implementation: "rotate-ccw",
  reset_task: "rotate-ccw",
  close_task: "circle-check-big",
} as const satisfies Record<TaskWorkflowAction, IconName>;

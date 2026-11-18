// The approval choices of TASK_APPROVAL_MODE_OPTIONS in task-approval-copy.ts of
// packages/frontend-core. The Approve task dialog of the desktop app and the sheet of the mobile
// app show them. The module holds data only and loads no React.

export type ApprovalMode = "direct_merge" | "pull_request" | "close_task";

/** The approval modes of TASK_APPROVAL_MODE_OPTIONS. */
export const APPROVAL_MODES = [
  { value: "direct_merge", label: "Direct merge" },
  { value: "pull_request", label: "Pull request" },
  { value: "close_task", label: "Close task" },
] as const satisfies readonly { value: ApprovalMode; label: string }[];

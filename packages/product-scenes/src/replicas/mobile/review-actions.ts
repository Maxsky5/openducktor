// The Quick Actions of a task in Human Review with a Builder session, in the order of the menu of
// QuickActionsMenu.tsx. They come from buildAgentStudioQuickActions in
// packages/frontend-core/src/sessions/start/agent-studio-quick-actions.ts for a repository whose
// Git provider creates pull requests, so the menu offers Generate Pull Request.
import {
  CircleCheckBig,
  GitPullRequest,
  RotateCcw,
  SquareArrowOutUpRight,
  Undo2,
} from "lucide-react";
import type { MenuItem } from "./QuickActionsMenu";

/** The quick actions of the task, in the order of the menu. */
export const HUMAN_REVIEW_ACTIONS: readonly MenuItem[] = [
  { id: "quick:pull_request", title: "Generate Pull Request", icon: { Icon: GitPullRequest } },
  { id: "task:human_request_changes", title: "Request Changes", icon: { Icon: Undo2 } },
  { id: "quick:qa_review", title: "Request QA Review", icon: { role: "qa" } },
  {
    id: "quick:build_implementation_start",
    title: "Start Implementation",
    icon: { role: "build" },
  },
  { id: "quick:spec_initial", title: "Start Spec", icon: { role: "spec" } },
  { id: "quick:planner_initial", title: "Start Planner", icon: { role: "planner" } },
  { id: "task:human_approve", title: "Approve Task", icon: { Icon: CircleCheckBig } },
  { id: "task:open_builder", title: "Open Builder", icon: { Icon: SquareArrowOutUpRight } },
  {
    id: "task:reset_implementation",
    title: "Reset Implementation",
    icon: { Icon: RotateCcw },
    destructive: true,
  },
];

/** The item of the menu that opens the approval. */
export const APPROVE_ACTION = "task:human_approve";

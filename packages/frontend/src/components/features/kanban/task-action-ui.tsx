import { ArrowUpRightFromSquare, CircleCheckBig, FolderX, RotateCcw, Undo2 } from "lucide-react";
import type { ReactElement } from "react";
import {
  BuilderRoleIcon,
  PlannerRoleIcon,
  QaRoleIcon,
  SpecRoleIcon,
} from "@/lib/agent-role-presentation";
import type { TaskWorkflowAction } from "@openducktor/workflows";
import { taskActionTone } from "@openducktor/frontend-core/tasks/board/task-action-presentation";

export const TASK_ACTION_ICON = {
  set_spec: <SpecRoleIcon className="size-3.5" />,
  set_plan: <PlannerRoleIcon className="size-3.5" />,
  open_spec: <ArrowUpRightFromSquare className="size-3.5" />,
  open_planner: <ArrowUpRightFromSquare className="size-3.5" />,
  open_builder: <ArrowUpRightFromSquare className="size-3.5" />,
  open_qa: <ArrowUpRightFromSquare className="size-3.5" />,
  reset_implementation: <RotateCcw className="size-3.5" />,
  reset_task: <RotateCcw className="size-3.5" />,
  close_task: <CircleCheckBig className="size-3.5" />,
  remove_worktree: <FolderX className="size-3.5" />,
  build_start: <BuilderRoleIcon className="size-3.5" />,
  qa_start: <QaRoleIcon className="size-3.5" />,
  human_approve: <CircleCheckBig className="size-3.5" />,
  human_request_changes: <Undo2 className="size-3.5" />,
} satisfies Record<TaskWorkflowAction, ReactElement>;

const PRIMARY_ACTION_VARIANTS = {
  prominent: "default",
  neutral: "outline",
  destructive: "destructive",
  warning: "warning",
} as const;

const MENU_ACTION_VARIANTS = {
  prominent: "ghost",
  neutral: "ghost",
  destructive: "destructiveGhost",
  warning: "warningGhost",
} as const;

export const taskPrimaryActionVariant = (
  action: TaskWorkflowAction,
): "default" | "outline" | "destructive" | "warning" =>
  PRIMARY_ACTION_VARIANTS[taskActionTone(action)];

export const taskMenuActionVariant = (
  action: TaskWorkflowAction,
): "ghost" | "destructiveGhost" | "warningGhost" => MENU_ACTION_VARIANTS[taskActionTone(action)];

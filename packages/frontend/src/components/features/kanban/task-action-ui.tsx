import { ArrowRight } from "lucide-react";
import type { ReactElement } from "react";
import { WORKFLOW_ICONS } from "@/lib/agent-role-presentation";
import type { TaskWorkflowAction, ResolvedTaskCard } from "@openducktor/workflows";
import { taskActionTone } from "@openducktor/frontend-core/tasks/board/task-action-presentation";

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
  task: ResolvedTaskCard,
): "default" | "outline" | "destructive" | "warning" =>
  PRIMARY_ACTION_VARIANTS[taskActionTone(action, task)];

export const taskMenuActionVariant = (
  action: TaskWorkflowAction,
  task: ResolvedTaskCard,
): "ghost" | "destructiveGhost" | "warningGhost" =>
  MENU_ACTION_VARIANTS[taskActionTone(action, task)];

export const taskActionIcon = (action: string, task: ResolvedTaskCard): ReactElement => {
  const hint = task.taskWorkflow.action(action).icon;
  const Icon = hint ? WORKFLOW_ICONS[hint] : ArrowRight;
  return <Icon className="size-3.5" />;
};

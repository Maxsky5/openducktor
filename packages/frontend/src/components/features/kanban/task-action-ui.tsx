import type { TaskCard } from "@openducktor/contracts";
import {
  ArrowUpRightFromSquare,
  CircleCheckBig,
  CircleX,
  RotateCcw,
  ScrollText,
  ShieldCheck,
  Sparkles,
  Undo2,
  Wrench,
} from "lucide-react";
import type { ReactElement } from "react";
import { isQaRejectedTask } from "@/lib/task-qa";
import type { TaskWorkflowAction } from "./kanban-task-workflow";

type TaskActionLabelOptions = {
  surface?: "kanban" | "agent_studio";
};

export const taskActionLabel = (
  action: TaskWorkflowAction,
  task: TaskCard,
  options: TaskActionLabelOptions = {},
): string => {
  if (action === "set_spec") {
    return task.status === "spec_ready" ? "Open Spec" : "Start Spec";
  }
  if (action === "set_plan") {
    return "Start Planner";
  }
  if (action === "open_spec") {
    return "Open Spec";
  }
  if (action === "open_planner") {
    return "Open Planner";
  }
  if (action === "open_builder") {
    return "Open Builder";
  }
  if (action === "open_qa") {
    return "Open QA";
  }
  if (action === "reset_implementation") {
    return "Reset Implementation";
  }
  if (action === "reset_task") {
    return "Reset Task";
  }
  if (action === "close_task") {
    return "Close Task";
  }
  if (action === "build_start") {
    if (isQaRejectedTask(task)) {
      return "Address QA Feedbacks";
    }
    return options.surface === "agent_studio" ? "Start Implementation" : "Start Builder";
  }
  if (action === "qa_start") {
    return "Request QA Review";
  }
  if (action === "human_approve") {
    return "Approve Task";
  }
  if (action === "human_request_changes") {
    return "Request Changes";
  }
  const exhaustive: never = action;
  return exhaustive;
};

export const TASK_ACTION_ICON: Record<TaskWorkflowAction, ReactElement> = {
  set_spec: <Sparkles className="size-3.5" />,
  set_plan: <ScrollText className="size-3.5" />,
  open_spec: <ArrowUpRightFromSquare className="size-3.5" />,
  open_planner: <ArrowUpRightFromSquare className="size-3.5" />,
  open_builder: <ArrowUpRightFromSquare className="size-3.5" />,
  open_qa: <ArrowUpRightFromSquare className="size-3.5" />,
  reset_implementation: <RotateCcw className="size-3.5" />,
  reset_task: <RotateCcw className="size-3.5" />,
  close_task: <CircleX className="size-3.5" />,
  build_start: <Wrench className="size-3.5" />,
  qa_start: <ShieldCheck className="size-3.5" />,
  human_approve: <CircleCheckBig className="size-3.5" />,
  human_request_changes: <Undo2 className="size-3.5" />,
};

export const taskPrimaryActionVariant = (
  action: TaskWorkflowAction,
): "default" | "outline" | "destructive" => {
  if (action === "build_start" || action === "qa_start" || action === "human_approve") {
    return "default";
  }
  if (action === "reset_implementation" || action === "reset_task" || action === "close_task") {
    return "destructive";
  }
  return "outline";
};

export const taskActionIsDestructive = (action: TaskWorkflowAction): boolean =>
  action === "reset_implementation" || action === "reset_task" || action === "close_task";

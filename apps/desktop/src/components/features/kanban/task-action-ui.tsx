import type { TaskCard } from "@openducktor/contracts";
import {
  ArrowUpRightFromSquare,
  CircleCheckBig,
  Pause,
  Play,
  ScrollText,
  Sparkles,
  Undo2,
  Wrench,
} from "lucide-react";
import type { ReactElement } from "react";
import type { TaskWorkflowAction } from "./kanban-task-workflow";

export const taskActionLabel = (action: TaskWorkflowAction, task: TaskCard): string => {
  if (action === "set_spec") {
    return task.status === "spec_ready" ? "Continue Spec" : "Start Spec";
  }
  if (action === "set_plan") {
    return "Start Plan";
  }
  if (action === "open_builder") {
    return "Open Builder";
  }
  if (action === "build_start") {
    return "Start Build";
  }
  if (action === "human_approve") {
    return "Approve";
  }
  if (action === "human_request_changes") {
    return "Request Changes";
  }
  if (action === "defer_issue") {
    return "Defer";
  }
  return "Resume";
};

export const TASK_ACTION_ICON: Record<TaskWorkflowAction, ReactElement> = {
  set_spec: <Sparkles className="size-3.5" />,
  set_plan: <ScrollText className="size-3.5" />,
  open_builder: <ArrowUpRightFromSquare className="size-3.5" />,
  build_start: <Wrench className="size-3.5" />,
  human_approve: <CircleCheckBig className="size-3.5" />,
  human_request_changes: <Undo2 className="size-3.5" />,
  defer_issue: <Pause className="size-3.5" />,
  resume_deferred: <Play className="size-3.5" />,
};

export const taskPrimaryActionVariant = (
  action: TaskWorkflowAction,
): "default" | "outline" | "destructive" => {
  if (action === "build_start" || action === "human_approve" || action === "resume_deferred") {
    return "default";
  }
  if (action === "human_request_changes" || action === "defer_issue") {
    return "destructive";
  }
  return "outline";
};

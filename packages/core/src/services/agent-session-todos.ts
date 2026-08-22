import { hasRuntimeType } from "@openducktor/contracts";
import type { AgentSessionTodoItem } from "../types/agent-orchestrator";

const TODO_STATUSES = ["pending", "in_progress", "completed", "cancelled"] as const;
const TODO_PRIORITIES = ["high", "medium", "low"] as const;
const TODO_STATUS_SET = new Set<AgentSessionTodoItem["status"]>(TODO_STATUSES);
const TODO_PRIORITY_SET = new Set<AgentSessionTodoItem["priority"]>(TODO_PRIORITIES);

const isAgentSessionTodoStatus = (value: string): value is AgentSessionTodoItem["status"] => {
  // SAFETY: The preceding runtime guard establishes `AgentSessionTodoItem["status"]` before this assertion.
  return TODO_STATUS_SET.has(value as AgentSessionTodoItem["status"]);
};

const isAgentSessionTodoPriority = (value: string): value is AgentSessionTodoItem["priority"] => {
  // SAFETY: The preceding runtime guard establishes `AgentSessionTodoItem["priority"]` before this assertion.
  return TODO_PRIORITY_SET.has(value as AgentSessionTodoItem["priority"]);
};

export type NormalizeAgentSessionTodoInput = {
  id: string;
  content: string;
  status?: string | undefined;
  priority?: string | undefined;
  completed?: boolean | undefined;
};

export const normalizeAgentSessionTodoStatus = (
  value: string | undefined,
): AgentSessionTodoItem["status"] => {
  const normalized = hasRuntimeType(value, "string") ? value.trim().toLowerCase() : "";
  if (!normalized) {
    return "pending";
  }
  if (normalized === "in-progress" || normalized === "in progress") {
    return "in_progress";
  }
  if (
    normalized === "inprogress" ||
    normalized === "active" ||
    normalized === "current" ||
    normalized === "started" ||
    normalized === "ongoing" ||
    normalized === "doing"
  ) {
    return "in_progress";
  }
  if (normalized === "done" || normalized === "complete" || normalized === "finished") {
    return "completed";
  }

  return isAgentSessionTodoStatus(normalized) ? normalized : "pending";
};

export const normalizeAgentSessionTodoPriority = (
  value: string | undefined,
): AgentSessionTodoItem["priority"] => {
  const normalized = hasRuntimeType(value, "string") ? value.trim().toLowerCase() : "";
  return isAgentSessionTodoPriority(normalized) ? normalized : "medium";
};

export const normalizeAgentSessionTodoItem = (
  value: NormalizeAgentSessionTodoInput,
): AgentSessionTodoItem | null => {
  const id = value.id.trim();
  const content = value.content.trim();
  if (!id || !content) {
    return null;
  }

  const status = normalizeAgentSessionTodoStatus(value.status);
  const statusFromBoolean = hasRuntimeType(value.completed, "boolean")
    ? value.completed
      ? "completed"
      : "pending"
    : undefined;

  return {
    id,
    content,
    status: statusFromBoolean ?? status,
    priority: normalizeAgentSessionTodoPriority(value.priority),
  };
};

export const normalizeAgentSessionTodoList = (
  payload: NormalizeAgentSessionTodoInput[],
): AgentSessionTodoItem[] => {
  return payload
    .map((entry) => normalizeAgentSessionTodoItem(entry))
    .filter((entry): entry is AgentSessionTodoItem => entry !== null);
};

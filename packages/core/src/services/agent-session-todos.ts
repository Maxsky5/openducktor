import type { AgentSessionTodoItem } from "../types/agent-orchestrator";

const TODO_STATUSES = ["pending", "in_progress", "completed", "cancelled"] as const;
const TODO_PRIORITIES = ["high", "medium", "low"] as const;
const TODO_STATUS_SET = new Set<AgentSessionTodoItem["status"]>(TODO_STATUSES);
const TODO_PRIORITY_SET = new Set<AgentSessionTodoItem["priority"]>(TODO_PRIORITIES);

const isAgentSessionTodoStatus = (value: unknown): value is AgentSessionTodoItem["status"] => {
  return TODO_STATUS_SET.has(value as AgentSessionTodoItem["status"]);
};

const isAgentSessionTodoPriority = (value: unknown): value is AgentSessionTodoItem["priority"] => {
  return TODO_PRIORITY_SET.has(value as AgentSessionTodoItem["priority"]);
};

export type NormalizeAgentSessionTodoInput = {
  id: string;
  content: string;
  status?: unknown;
  priority?: unknown;
  completed?: boolean;
};

export const normalizeAgentSessionTodoStatus = (value: unknown): AgentSessionTodoItem["status"] => {
  const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
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
  value: unknown,
): AgentSessionTodoItem["priority"] => {
  const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
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
  const statusFromBoolean =
    typeof value.completed === "boolean" ? (value.completed ? "completed" : "pending") : undefined;

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

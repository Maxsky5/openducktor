import type { AgentSessionTodoItem } from "../types/agent-orchestrator";

const TODO_STATUSES = ["pending", "in_progress", "completed", "cancelled"] as const;
const TODO_PRIORITIES = ["high", "medium", "low"] as const;
const TODO_STATUS_SET = new Set<AgentSessionTodoItem["status"]>(TODO_STATUSES);
const TODO_PRIORITY_SET = new Set<AgentSessionTodoItem["priority"]>(TODO_PRIORITIES);

export type NormalizeAgentSessionTodoListOptions = {
  allowStringEntries?: boolean;
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

  return TODO_STATUS_SET.has(normalized as AgentSessionTodoItem["status"])
    ? (normalized as AgentSessionTodoItem["status"])
    : "pending";
};

export const normalizeAgentSessionTodoPriority = (
  value: unknown,
): AgentSessionTodoItem["priority"] => {
  const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
  return TODO_PRIORITY_SET.has(normalized as AgentSessionTodoItem["priority"])
    ? (normalized as AgentSessionTodoItem["priority"])
    : "medium";
};

export const normalizeAgentSessionTodoItem = (
  value: unknown,
  fallbackId: string | null = null,
): AgentSessionTodoItem | null => {
  if (!value || typeof value !== "object") {
    return null;
  }
  const record = value as Record<string, unknown>;
  const id =
    (typeof record.id === "string" ? record.id.trim() : "") ||
    (typeof record.todoId === "string" ? record.todoId.trim() : "") ||
    fallbackId ||
    "";
  const contentCandidate =
    typeof record.content === "string"
      ? record.content
      : typeof record.text === "string"
        ? record.text
        : typeof record.title === "string"
          ? record.title
          : "";
  const content = contentCandidate.trim();
  if (!id || !content) {
    return null;
  }

  const status = normalizeAgentSessionTodoStatus(record.status);
  const statusFromBoolean =
    typeof record.completed === "boolean"
      ? record.completed
        ? "completed"
        : "pending"
      : undefined;

  return {
    id,
    content,
    status: statusFromBoolean ?? status,
    priority: normalizeAgentSessionTodoPriority(record.priority),
  };
};

const normalizeAgentSessionTodoStringEntry = (
  value: unknown,
  fallbackId: string,
): AgentSessionTodoItem | null => {
  if (typeof value !== "string") {
    return null;
  }
  const content = value.trim();
  if (!content) {
    return null;
  }
  return {
    id: fallbackId,
    content,
    status: "pending",
    priority: "medium",
  };
};

export const normalizeAgentSessionTodoList = (
  payload: unknown,
  options: NormalizeAgentSessionTodoListOptions = {},
): AgentSessionTodoItem[] => {
  if (!Array.isArray(payload)) {
    return [];
  }

  return payload
    .map((entry, index) => {
      const fallbackId = `todo:${index}`;
      if (options.allowStringEntries) {
        const stringEntry = normalizeAgentSessionTodoStringEntry(entry, fallbackId);
        if (stringEntry) {
          return stringEntry;
        }
      }
      return normalizeAgentSessionTodoItem(entry, fallbackId);
    })
    .filter((entry): entry is AgentSessionTodoItem => entry !== null);
};

import type { AgentSessionTodoItem } from "@openducktor/core";

const TODO_STATUSES = new Set(["pending", "in_progress", "completed", "cancelled"]);
const TODO_PRIORITIES = new Set(["high", "medium", "low"]);

const normalizeTodoStatus = (value: unknown): AgentSessionTodoItem["status"] => {
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
  if (normalized === "done" || normalized === "complete") {
    return "completed";
  }
  if (normalized === "finished") {
    return "completed";
  }
  return TODO_STATUSES.has(normalized) ? (normalized as AgentSessionTodoItem["status"]) : "pending";
};

const normalizeTodoPriority = (value: unknown): AgentSessionTodoItem["priority"] => {
  const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
  return TODO_PRIORITIES.has(normalized)
    ? (normalized as AgentSessionTodoItem["priority"])
    : "medium";
};

const normalizeTodoItem = (
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

  const status = normalizeTodoStatus(record.status);
  const statusFromBoolean =
    typeof record.completed === "boolean"
      ? record.completed
        ? "completed"
        : "pending"
      : undefined;
  const priority = normalizeTodoPriority(record.priority);

  return {
    id,
    content,
    status: statusFromBoolean ?? status,
    priority,
  };
};

export const normalizeTodoList = (payload: unknown): AgentSessionTodoItem[] => {
  if (!Array.isArray(payload)) {
    return [];
  }
  return payload
    .map((entry, index) => normalizeTodoItem(entry, `todo:${index}`))
    .filter((entry): entry is AgentSessionTodoItem => entry !== null);
};

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
  if (normalized === "done" || normalized === "complete" || normalized === "finished") {
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

const normalizeSessionTodo = (
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

const normalizeSessionTodoList = (payload: unknown): AgentSessionTodoItem[] => {
  if (!Array.isArray(payload)) {
    return [];
  }
  return payload
    .map((entry, index) => normalizeSessionTodo(entry, `todo:${index}`))
    .filter((entry): entry is AgentSessionTodoItem => entry !== null);
};

export const parseTodosFromToolOutput = (
  output: string | undefined,
): AgentSessionTodoItem[] | null => {
  if (!output || output.trim().length === 0) {
    return null;
  }
  try {
    const parsed = JSON.parse(output) as unknown;
    if (Array.isArray(parsed)) {
      return normalizeSessionTodoList(parsed);
    }
    if (parsed && typeof parsed === "object") {
      const record = parsed as Record<string, unknown>;
      if (Array.isArray(record.todos)) {
        return normalizeSessionTodoList(record.todos);
      }
    }
    return null;
  } catch {
    return null;
  }
};

export const parseTodosFromToolInput = (
  input: Record<string, unknown> | undefined,
): AgentSessionTodoItem[] | null => {
  if (!input) {
    return null;
  }
  const rawTodos = Array.isArray(input.todos)
    ? input.todos
    : Array.isArray(input.items)
      ? input.items
      : null;
  if (!rawTodos) {
    return null;
  }

  const normalized = rawTodos
    .map((entry, index) => {
      if (typeof entry === "string") {
        const content = entry.trim();
        if (!content) {
          return null;
        }
        return {
          id: `todo:${index}`,
          content,
          status: "pending",
          priority: "medium",
        } satisfies AgentSessionTodoItem;
      }
      return normalizeSessionTodo(entry, `todo:${index}`);
    })
    .filter((entry): entry is AgentSessionTodoItem => entry !== null);

  return normalized.length > 0 ? normalized : null;
};

export const mergeTodoListPreservingOrder = (
  previous: AgentSessionTodoItem[],
  incoming: AgentSessionTodoItem[],
): AgentSessionTodoItem[] => {
  if (incoming.length === 0) {
    return [];
  }
  const deduped = new Map<string, AgentSessionTodoItem>();
  for (const todo of incoming) {
    deduped.set(todo.id, todo);
  }
  const normalizedIncoming = [...deduped.values()];
  const previousOrder = new Map(previous.map((todo, index) => [todo.id, index]));

  return [...normalizedIncoming].sort((a, b) => {
    const aIndex = previousOrder.get(a.id);
    const bIndex = previousOrder.get(b.id);
    if (aIndex !== undefined && bIndex !== undefined) {
      return aIndex - bIndex;
    }
    if (aIndex !== undefined) {
      return -1;
    }
    if (bIndex !== undefined) {
      return 1;
    }
    return 0;
  });
};

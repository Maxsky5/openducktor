export type AgentSessionTodoPayloadRecord = {
  id: string;
  content: string;
  status?: unknown;
  priority?: unknown;
  completed?: boolean;
};

export type ParseAgentSessionTodoPayloadOptions = {
  allowStringEntries?: boolean;
};

const parseTodoId = (record: Record<string, unknown>, fallbackId: string): string => {
  return (
    (typeof record.id === "string" ? record.id.trim() : "") ||
    (typeof record.todoId === "string" ? record.todoId.trim() : "") ||
    fallbackId
  );
};

const parseTodoContent = (record: Record<string, unknown>): string => {
  const contentCandidate =
    typeof record.content === "string"
      ? record.content
      : typeof record.text === "string"
        ? record.text
        : typeof record.title === "string"
          ? record.title
          : "";
  return contentCandidate.trim();
};

export const parseAgentSessionTodoPayloadEntry = (
  value: unknown,
  fallbackId: string,
  options: ParseAgentSessionTodoPayloadOptions = {},
): AgentSessionTodoPayloadRecord | null => {
  if (options.allowStringEntries && typeof value === "string") {
    const content = value.trim();
    if (!content) {
      return null;
    }
    return {
      id: fallbackId,
      content,
    };
  }

  if (!value || typeof value !== "object") {
    return null;
  }

  const record = value as Record<string, unknown>;
  const id = parseTodoId(record, fallbackId);
  const content = parseTodoContent(record);
  if (!id || !content) {
    return null;
  }

  return {
    id,
    content,
    status: record.status,
    priority: record.priority,
    ...(typeof record.completed === "boolean" ? { completed: record.completed } : {}),
  };
};

export const parseAgentSessionTodoPayloadList = (
  payload: unknown,
  options: ParseAgentSessionTodoPayloadOptions = {},
): AgentSessionTodoPayloadRecord[] => {
  if (!Array.isArray(payload)) {
    return [];
  }

  return payload
    .map((entry, index) => parseAgentSessionTodoPayloadEntry(entry, `todo:${index}`, options))
    .filter((entry): entry is AgentSessionTodoPayloadRecord => entry !== null);
};

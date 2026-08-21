import { agentSessionTodoPayloadListSchema } from "@openducktor/contracts";
import { type AgentSessionTodoItem, normalizeAgentSessionTodoList } from "@openducktor/core";
import type { JsonValue } from "@openducktor/contracts";

export const parseTodosFromToolOutput = (
  output: string | undefined,
): AgentSessionTodoItem[] | null => {
  if (!output || output.trim().length === 0) {
    return null;
  }
  try {
    const parsed: JsonValue = JSON.parse(output);
    if (Array.isArray(parsed)) {
      return normalizeAgentSessionTodoList(agentSessionTodoPayloadListSchema().parse(parsed));
    }
    if (parsed && typeof parsed === "object") {
      if (Array.isArray(parsed.todos)) {
        return normalizeAgentSessionTodoList(
          agentSessionTodoPayloadListSchema().parse(parsed.todos),
        );
      }
    }
    return null;
  } catch {
    return null;
  }
};

export const parseTodosFromToolInput = (
  input: Record<string, JsonValue> | undefined,
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

  const parsed = agentSessionTodoPayloadListSchema({
    allowStringEntries: true,
  }).parse(rawTodos);
  const normalized = normalizeAgentSessionTodoList(parsed);

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

  return normalizedIncoming.toSorted((a, b) => {
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

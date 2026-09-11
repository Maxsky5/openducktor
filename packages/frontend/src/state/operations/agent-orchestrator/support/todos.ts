import {
  agentSessionTodoPayloadListSchema,
  agentToolDataSchema,
  type AgentToolData,
} from "@openducktor/contracts";
import { z } from "zod";
import { type AgentSessionTodoItem, normalizeAgentSessionTodoList } from "@openducktor/core";

const todoJsonValueSchema = z.json();
const todoOutputListSchema = agentSessionTodoPayloadListSchema();
const todoInputListSchema = agentSessionTodoPayloadListSchema({ allowStringEntries: true });

export const parseTodosFromToolOutput = (
  output: string | undefined,
): AgentSessionTodoItem[] | null => {
  if (!output || output.trim().length === 0) {
    return null;
  }
  try {
    const parsed = todoJsonValueSchema.parse(JSON.parse(output));
    if (Array.isArray(parsed)) {
      return normalizeAgentSessionTodoList(todoOutputListSchema.parse(parsed));
    }
    const record = agentToolDataSchema.safeParse(parsed);
    if (record.success && Array.isArray(record.data.todos)) {
      return normalizeAgentSessionTodoList(todoOutputListSchema.parse(record.data.todos));
    }
    return null;
  } catch {
    return null;
  }
};

export const parseTodosFromToolInput = (
  input: AgentToolData | undefined,
): AgentSessionTodoItem[] | null => {
  if (!input) {
    return null;
  }
  let rawTodos = input.todos;
  if (!Array.isArray(rawTodos)) {
    rawTodos = input.items;
  }
  if (!Array.isArray(rawTodos)) {
    return null;
  }

  const parsed = todoInputListSchema.parse(rawTodos);
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

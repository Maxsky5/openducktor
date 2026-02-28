import type { AgentSessionTodoItem } from "@openducktor/core";
import { normalizeAgentSessionTodoList } from "@openducktor/core";

export const normalizeTodoList = (payload: unknown): AgentSessionTodoItem[] => {
  return normalizeAgentSessionTodoList(payload);
};

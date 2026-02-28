import { parseAgentSessionTodoPayloadList } from "@openducktor/contracts";
import type { AgentSessionTodoItem } from "@openducktor/core";
import { normalizeAgentSessionTodoList } from "@openducktor/core";

export const normalizeTodoList = (payload: unknown): AgentSessionTodoItem[] => {
  const parsed = parseAgentSessionTodoPayloadList(payload);
  return normalizeAgentSessionTodoList(parsed);
};

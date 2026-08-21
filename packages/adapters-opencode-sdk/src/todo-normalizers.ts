import { agentSessionTodoPayloadListSchema } from "@openducktor/contracts";
import { normalizeAgentSessionTodoList, type AgentSessionTodoItem } from "@openducktor/core";

export const normalizeTodoList = (payload: unknown): AgentSessionTodoItem[] => {
  return normalizeAgentSessionTodoList(agentSessionTodoPayloadListSchema().parse(payload));
};

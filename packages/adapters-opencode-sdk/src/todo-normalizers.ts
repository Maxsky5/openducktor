import { agentSessionTodoPayloadListSchema } from "@openducktor/contracts";
import { normalizeAgentSessionTodoList, type AgentSessionTodoItem } from "@openducktor/core";

const todoPayloadListSchema = agentSessionTodoPayloadListSchema();

export const normalizeTodoList = (payload: unknown): AgentSessionTodoItem[] => {
  return normalizeAgentSessionTodoList(todoPayloadListSchema.parse(payload));
};

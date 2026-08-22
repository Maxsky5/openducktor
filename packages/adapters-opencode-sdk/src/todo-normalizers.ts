import { agentSessionTodoPayloadListSchema } from "@openducktor/contracts";
import { normalizeAgentSessionTodoList, type AgentSessionTodoItem } from "@openducktor/core";

const todoPayloadListSchema = agentSessionTodoPayloadListSchema();

export const normalizeTodoList = (
  payload: Parameters<typeof todoPayloadListSchema.parse>[0],
): AgentSessionTodoItem[] => {
  return normalizeAgentSessionTodoList(todoPayloadListSchema.parse(payload));
};

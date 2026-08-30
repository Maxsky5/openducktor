import type { Todo } from "@opencode-ai/sdk/v2/client";
import { agentSessionTodoPayloadListSchema } from "@openducktor/contracts";
import { normalizeAgentSessionTodoList, type AgentSessionTodoItem } from "@openducktor/core";

const todoPayloadListSchema = agentSessionTodoPayloadListSchema();

export const normalizeTodoList = (payload: Todo[]): AgentSessionTodoItem[] => {
  return normalizeAgentSessionTodoList(todoPayloadListSchema.parse(payload));
};

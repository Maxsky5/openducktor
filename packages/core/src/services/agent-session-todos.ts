import {
  agentSessionTodoPrioritySchema,
  agentSessionTodoStatusSchema,
} from "@openducktor/contracts";
import type { AgentSessionTodoItem } from "../types/agent-orchestrator";

const isAgentSessionTodoStatus = (value: string): value is AgentSessionTodoItem["status"] =>
  agentSessionTodoStatusSchema.safeParse(value).success;

const isAgentSessionTodoPriority = (value: string): value is AgentSessionTodoItem["priority"] =>
  agentSessionTodoPrioritySchema.safeParse(value).success;

export type NormalizeAgentSessionTodoInput = {
  id: string;
  content: string;
  status?: string | undefined;
  priority?: string | undefined;
  completed?: boolean | undefined;
};

export const normalizeAgentSessionTodoStatus = (
  value: string | undefined,
): AgentSessionTodoItem["status"] => {
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

  return isAgentSessionTodoStatus(normalized) ? normalized : "pending";
};

export const normalizeAgentSessionTodoPriority = (
  value: string | undefined,
): AgentSessionTodoItem["priority"] => {
  const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
  return isAgentSessionTodoPriority(normalized) ? normalized : "medium";
};

export const normalizeAgentSessionTodoItem = (
  value: NormalizeAgentSessionTodoInput,
): AgentSessionTodoItem | null => {
  const id = value.id.trim();
  const content = value.content.trim();
  if (!id || !content) {
    return null;
  }

  const status = normalizeAgentSessionTodoStatus(value.status);
  const statusFromBoolean =
    typeof value.completed === "boolean" ? (value.completed ? "completed" : "pending") : undefined;

  return {
    id,
    content,
    status: statusFromBoolean ?? status,
    priority: normalizeAgentSessionTodoPriority(value.priority),
  };
};

export const normalizeAgentSessionTodoList = (
  payload: NormalizeAgentSessionTodoInput[],
): AgentSessionTodoItem[] => {
  return payload
    .map((entry) => normalizeAgentSessionTodoItem(entry))
    .filter((entry): entry is AgentSessionTodoItem => entry !== null);
};

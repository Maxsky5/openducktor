import { hasRuntimeType } from "./runtime-type";
import { z } from "zod";
import type { JsonValue } from "./json-types";

export type AgentSessionTodoPayloadRecord = {
  id: string;
  content: string;
  status?: string | undefined;
  priority?: string | undefined;
  completed?: boolean | undefined;
};

export type ParseAgentSessionTodoPayloadOptions = {
  allowStringEntries?: boolean;
};

const normalizeLooseTodoEntry = (
  entry: JsonValue | undefined,
  fallbackId: string,
  options: ParseAgentSessionTodoPayloadOptions,
): AgentSessionTodoPayloadRecord | null => {
  if (options.allowStringEntries && hasRuntimeType(entry, "string")) {
    const content = entry.trim();
    if (!content) {
      return null;
    }
    return { id: fallbackId, content };
  }

  if (!entry || !hasRuntimeType(entry, "object") || Array.isArray(entry)) {
    return null;
  }

  const id =
    (hasRuntimeType(entry.id, "string") ? entry.id.trim() : "") ||
    (hasRuntimeType(entry.todoId, "string") ? entry.todoId.trim() : "") ||
    fallbackId;
  const content = (
    hasRuntimeType(entry.content, "string")
      ? entry.content
      : hasRuntimeType(entry.text, "string")
        ? entry.text
        : hasRuntimeType(entry.title, "string")
          ? entry.title
          : ""
  ).trim();
  if (!id || !content) {
    return null;
  }

  return {
    id,
    content,
    ...(hasRuntimeType(entry.status, "string") ? { status: entry.status } : undefined),
    ...(hasRuntimeType(entry.priority, "string") ? { priority: entry.priority } : undefined),
    ...(hasRuntimeType(entry.completed, "boolean") ? { completed: entry.completed } : undefined),
  };
};

export const agentSessionTodoPayloadSchema = z.object({
  id: z.string(),
  content: z.string(),
  status: z.string().optional(),
  priority: z.string().optional(),
  completed: z.boolean().optional(),
});

export const agentSessionTodoPayloadListSchema = (
  options: ParseAgentSessionTodoPayloadOptions = {},
) =>
  z.preprocess((payload: JsonValue | undefined) => {
    if (!Array.isArray(payload)) {
      return [];
    }
    return payload
      .map((entry, index) => normalizeLooseTodoEntry(entry, `todo:${index}`, options))
      .filter((entry): entry is AgentSessionTodoPayloadRecord => entry !== null);
  }, z.array(agentSessionTodoPayloadSchema));

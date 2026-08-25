import { z } from "zod";

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

type LooseAgentSessionTodoPayloadRecord = {
  id?: string | undefined;
  todoId?: string | undefined;
  content?: string | undefined;
  text?: string | undefined;
  title?: string | undefined;
  status?: string | undefined;
  priority?: string | undefined;
  completed?: boolean | undefined;
};

const normalizeLooseTodoEntry = (
  entry: string | LooseAgentSessionTodoPayloadRecord,
  fallbackId: string,
  options: ParseAgentSessionTodoPayloadOptions,
): AgentSessionTodoPayloadRecord | null => {
  if (typeof entry === "string") {
    if (!options.allowStringEntries) {
      return null;
    }
    const content = entry.trim();
    if (!content) {
      return null;
    }
    return { id: fallbackId, content };
  }

  const id =
    (typeof entry.id === "string" ? entry.id.trim() : "") ||
    (typeof entry.todoId === "string" ? entry.todoId.trim() : "") ||
    fallbackId;
  const content = (
    typeof entry.content === "string"
      ? entry.content
      : typeof entry.text === "string"
        ? entry.text
        : typeof entry.title === "string"
          ? entry.title
          : ""
  ).trim();
  if (!id || !content) {
    return null;
  }

  return {
    id,
    content,
    ...(typeof entry.status === "string" ? { status: entry.status } : undefined),
    ...(typeof entry.priority === "string" ? { priority: entry.priority } : undefined),
    ...(typeof entry.completed === "boolean" ? { completed: entry.completed } : undefined),
  };
};

export const agentSessionTodoPayloadSchema = z.object({
  id: z.string(),
  content: z.string(),
  status: z.string().optional(),
  priority: z.string().optional(),
  completed: z.boolean().optional(),
});

const looseTodoEntrySchema = z.union([
  z.string(),
  z.object({
    id: z.string().optional(),
    todoId: z.string().optional(),
    content: z.string().optional(),
    text: z.string().optional(),
    title: z.string().optional(),
    status: z.string().optional(),
    priority: z.string().optional(),
    completed: z.boolean().optional(),
  }),
]);

export const agentSessionTodoPayloadListSchema = (
  options: ParseAgentSessionTodoPayloadOptions = {},
) =>
  z.preprocess((payload: unknown) => {
    if (!Array.isArray(payload)) {
      return [];
    }
    return payload.flatMap((entry, index) => {
      const parsed = looseTodoEntrySchema.safeParse(entry);
      if (!parsed.success) {
        return [];
      }
      const normalized = normalizeLooseTodoEntry(parsed.data, `todo:${index}`, options);
      return normalized === null ? [] : [normalized];
    });
  }, z.array(agentSessionTodoPayloadSchema));

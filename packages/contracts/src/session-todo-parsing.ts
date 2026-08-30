import { z } from "zod";

export type ParseAgentSessionTodoPayloadOptions = {
  allowStringEntries?: boolean;
};

const looseTodoRecordEntrySchema = z.object({
  id: z.string().optional(),
  todoId: z.string().optional(),
  content: z.string().optional(),
  text: z.string().optional(),
  title: z.string().optional(),
  status: z.string().optional(),
  priority: z.string().optional(),
  completed: z.boolean().optional(),
});
type LooseAgentSessionTodoPayloadRecord = z.output<typeof looseTodoRecordEntrySchema>;

const looseTodoEntrySchema = z.union([
  z.string().transform((value) => ({ kind: "text" as const, value })),
  looseTodoRecordEntrySchema.transform((value) => ({ kind: "record" as const, value })),
]);
const looseTodoEntryListSchema = z.array(z.json()).catch([]);

const normalizeLooseTodoStringEntry = (
  entry: string,
  fallbackId: string,
  options: ParseAgentSessionTodoPayloadOptions,
): AgentSessionTodoPayloadRecord | null => {
  if (!options.allowStringEntries) {
    return null;
  }
  const content = entry.trim();
  if (!content) {
    return null;
  }
  return { id: fallbackId, content };
};

const normalizeLooseTodoRecordEntry = (
  entry: LooseAgentSessionTodoPayloadRecord,
  fallbackId: string,
): AgentSessionTodoPayloadRecord | null => {
  const id = entry.id?.trim() || entry.todoId?.trim() || fallbackId;
  const content = (entry.content ?? entry.text ?? entry.title ?? "").trim();
  if (!id || !content) {
    return null;
  }

  const todo: AgentSessionTodoPayloadRecord = {
    id,
    content,
  };
  if (entry.status !== undefined) {
    todo.status = entry.status;
  }
  if (entry.priority !== undefined) {
    todo.priority = entry.priority;
  }
  if (entry.completed !== undefined) {
    todo.completed = entry.completed;
  }
  return todo;
};

const normalizeLooseTodoEntry = (
  entry: z.output<typeof looseTodoEntrySchema>,
  fallbackId: string,
  options: ParseAgentSessionTodoPayloadOptions,
): AgentSessionTodoPayloadRecord | null => {
  if (entry.kind === "text") {
    return normalizeLooseTodoStringEntry(entry.value, fallbackId, options);
  }
  return normalizeLooseTodoRecordEntry(entry.value, fallbackId);
};

export const agentSessionTodoPayloadSchema = z.object({
  id: z.string(),
  content: z.string(),
  status: z.string().optional(),
  priority: z.string().optional(),
  completed: z.boolean().optional(),
});
export type AgentSessionTodoPayloadRecord = z.output<typeof agentSessionTodoPayloadSchema>;

export const agentSessionTodoPayloadListSchema = (
  options: ParseAgentSessionTodoPayloadOptions = {},
) =>
  looseTodoEntryListSchema
    .transform((entries) =>
      entries.flatMap((entry, index) => {
        const parsed = looseTodoEntrySchema.safeParse(entry);
        if (!parsed.success) {
          return [];
        }
        const normalized = normalizeLooseTodoEntry(parsed.data, `todo:${index}`, options);
        return normalized === null ? [] : [normalized];
      }),
    )
    .pipe(z.array(agentSessionTodoPayloadSchema));

import { z } from "zod";
import { jsonValueSchema } from "./json-types";

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

const looseTodoStringEntrySchema = z.string();
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
const looseTodoEntrySchema = z.union([looseTodoStringEntrySchema, looseTodoRecordEntrySchema]);
const looseTodoEntryListSchema = z.array(jsonValueSchema).catch([]);

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
  const parsedStringEntry = looseTodoStringEntrySchema.safeParse(entry);
  if (parsedStringEntry.success) {
    return normalizeLooseTodoStringEntry(parsedStringEntry.data, fallbackId, options);
  }
  return normalizeLooseTodoRecordEntry(looseTodoRecordEntrySchema.parse(entry), fallbackId);
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

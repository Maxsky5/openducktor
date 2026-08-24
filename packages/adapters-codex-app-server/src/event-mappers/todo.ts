import type { AgentSessionTodoItem, NormalizeAgentSessionTodoInput } from "@openducktor/core";
import { jsonValueSchema, type CodexAppServerJsonValue } from "@openducktor/contracts";
import { normalizeAgentSessionTodoList } from "@openducktor/core";
import {
  arrayFromUnknown,
  codexNamespacedToolName,
  extractStringField,
  isPlainObject,
} from "../codex-app-server-shared";
import { codexItemTypeMatches } from "../codex-app-server-transcript";
import type {
  CodexCanonicalEvent,
  CodexMappingContext,
  CodexMappingResult,
} from "../codex-canonical-events";
import { emptyCodexMappingResult } from "../codex-canonical-events";
import type { CodexEventMapper, CodexLiveInput, CodexThreadItemInput } from "../codex-event-mapper";
import type { CodexTimedThreadItem } from "../codex-event-mapper";
import { codexDynamicToolErrorFromItem } from "../codex-tool-error-extractor";
import { type CodexToolTimingFields, codexToolTimingFields } from "../codex-tool-timing";
import type { CodexNotificationRecord, CodexThreadHistoryReadResponse } from "../types";

type CodexDynamicToolCallItem = Extract<CodexTimedThreadItem, { type: "dynamicToolCall" }>;
type CodexPlanItem = Extract<CodexTimedThreadItem, { type: "plan" }>;
type CodexPlanUpdatedPayload = Extract<
  CodexNotificationRecord,
  { method: "turn/plan/updated" }
>["params"];

const parseJsonObject = (
  value: CodexAppServerJsonValue | undefined,
): Record<string, CodexAppServerJsonValue> | null => {
  if (isPlainObject(value)) return value;
  if (!(typeof value === "string")) return null;
  try {
    const parsed = jsonValueSchema.safeParse(JSON.parse(value));
    return parsed.success && isPlainObject(parsed.data) ? parsed.data : null;
  } catch {
    return null;
  }
};

export type CodexTodoUpdate = {
  explanation?: string;
  todos: AgentSessionTodoItem[];
};

const TODO_MAPPER_NAME = "todo";
type CodexTodoMapperState = {
  livePlanUpdateSequence: number;
};

const normalizePlanTextStatus = (value: string): AgentSessionTodoItem["status"] | null => {
  const normalized = value.toLowerCase().replace(/[\s-]+/g, "_");
  if (normalized === "x" || normalized === "done" || normalized === "completed") {
    return "completed";
  }
  if (normalized === "in_progress" || normalized === "active" || normalized === "doing") {
    return "in_progress";
  }
  if (normalized === "pending" || normalized === "todo" || normalized === " ") {
    return "pending";
  }
  if (normalized === "cancelled" || normalized === "canceled") {
    return "cancelled";
  }
  return null;
};

type CodexPlanTextTodo = {
  id: NormalizeAgentSessionTodoInput["id"];
  content: NormalizeAgentSessionTodoInput["content"];
  status: string;
};

const codexTodoItemsFromPlanText = (text: string): CodexPlanTextTodo[] => {
  const todos: CodexPlanTextTodo[] = [];
  for (const [index, line] of text.split(/\r?\n/).entries()) {
    const checkboxMatch = line.match(/^\s*(?:[-*+]\s+|\d+[.)]\s+)\[([ xX~-])\]\s+(.+?)\s*$/);
    if (checkboxMatch) {
      const status = normalizePlanTextStatus(checkboxMatch[1] ?? " ") ?? "pending";
      const content = checkboxMatch[2]?.trim() ?? "";
      if (content.length > 0) {
        todos.push({ id: `codex-plan-text:${index}`, content, status });
      }
      continue;
    }

    const statusMatch = line.match(
      /^\s*(?:[-*+]\s+|\d+[.)]\s+)(?:\*\*)?(pending|todo|in[\s_-]?progress|active|doing|completed|done|cancelled|canceled)(?:\*\*)?\s*[:\-–]\s+(.+?)\s*$/i,
    );
    if (!statusMatch) {
      continue;
    }
    const status = normalizePlanTextStatus(statusMatch[1] ?? "");
    const content = statusMatch[2]?.trim() ?? "";
    if (status && content.length > 0) {
      todos.push({ id: `codex-plan-text:${index}`, content, status });
    }
  }
  return todos;
};

type CodexTodoItemSource =
  | { kind: "structured"; items: CodexAppServerJsonValue[] }
  | { kind: "plan_text"; items: CodexPlanTextTodo[] };

const codexTodoItemsFromPayload = (
  payload: Record<string, CodexAppServerJsonValue>,
): CodexTodoItemSource => {
  const todo = arrayFromUnknown(payload.todo);
  if (todo.length > 0) {
    return { kind: "structured", items: todo };
  }
  const plan = arrayFromUnknown(payload.plan);
  if (plan.length > 0) {
    return { kind: "structured", items: plan };
  }
  const text = extractStringField(payload, ["text"]);
  return { kind: "plan_text", items: text ? codexTodoItemsFromPlanText(text) : [] };
};

const codexTodoToolInputFromPayload = (
  payload: Record<string, CodexAppServerJsonValue>,
): Record<string, CodexAppServerJsonValue> | null => {
  const source = codexTodoItemsFromPayload(payload);
  if (source.items.length === 0) {
    return null;
  }
  const todos =
    source.kind === "plan_text"
      ? source.items.map((item) => ({ step: item.content, status: item.status }))
      : source.items.filter(isPlainObject).map((item) => ({
          step: extractStringField(item, ["step", "content", "text", "title"]) ?? "",
          status: extractStringField(item, ["status"]) ?? "pending",
        }));
  if (todos.length === 0) {
    return null;
  }
  const explanation = extractStringField(payload, ["explanation"]);
  return {
    ...(explanation ? { explanation } : undefined),
    todos,
  };
};

const codexTodoUpdateFromPayload = (
  payload: Record<string, CodexAppServerJsonValue>,
): CodexTodoUpdate | null => {
  const source = codexTodoItemsFromPayload(payload);
  if (source.items.length === 0) {
    return null;
  }
  const todos = normalizeAgentSessionTodoList(
    source.kind === "plan_text"
      ? source.items
      : source.items.filter(isPlainObject).map((item, index) => ({
          id: extractStringField(item, ["id", "todoId", "todo_id"]) ?? `codex-todo:${index}`,
          content: extractStringField(item, ["content", "text", "title", "step"]) ?? "",
          ...(typeof item.status === "string" ? { status: item.status } : undefined),
          ...(typeof item.priority === "string" ? { priority: item.priority } : undefined),
        })),
  );
  if (todos.length === 0) {
    return null;
  }
  const explanation = extractStringField(payload, ["explanation"]);
  return {
    ...(explanation ? { explanation } : undefined),
    todos,
  };
};

const codexTodoUpdateFromToolCall = (
  toolName: string,
  input: Record<string, CodexAppServerJsonValue> | null | undefined,
): CodexTodoUpdate | null => {
  const tool = toolName.split(/[./]/).filter(Boolean).at(-1) ?? toolName;
  if (tool !== "update_plan" && tool !== "todo_write") {
    return null;
  }
  return input ? codexTodoUpdateFromPayload(input) : null;
};

const todoToolCanonicalEvents = (
  update: CodexTodoUpdate,
  input: Record<string, CodexAppServerJsonValue>,
  ctx: CodexMappingContext,
  ids: {
    messageId: string;
    partId: string;
    callId: string;
    rawToolName: string;
  } & CodexToolTimingFields,
): CodexCanonicalEvent[] => [
  {
    kind: "tool",
    source: ctx.source,
    mapper: TODO_MAPPER_NAME,
    threadId: ctx.threadId,
    ...(ctx.turnId ? { turnId: ctx.turnId } : undefined),
    ...(ctx.timestamp ? { timestamp: ctx.timestamp } : undefined),
    invocation: {
      ...ids,
      status: "completed",
      displayLabel: "todo",
      input,
      output: "Plan updated",
      metadata: { codexTodoUpdate: true },
    },
  },
  {
    kind: "todo_update",
    source: ctx.source,
    mapper: TODO_MAPPER_NAME,
    threadId: ctx.threadId,
    ...(ctx.turnId ? { turnId: ctx.turnId } : undefined),
    ...(ctx.timestamp ? { timestamp: ctx.timestamp } : undefined),
    todos: update.todos,
  },
];

const completedDynamicToolCallEvents = (
  item: CodexDynamicToolCallItem,
  ctx: CodexMappingContext,
  fallbackId: string,
): CodexMappingResult => {
  const error = codexDynamicToolErrorFromItem(item);
  if (item.success === false || error || item.status !== "completed") {
    return emptyCodexMappingResult();
  }
  const rawToolName = codexNamespacedToolName(item.namespace, item.tool);
  const input = parseJsonObject(item.arguments);
  const update = codexTodoUpdateFromToolCall(rawToolName, input);
  if (!update || !input) {
    return emptyCodexMappingResult();
  }
  const displayInput = codexTodoToolInputFromPayload(input) ?? input;
  const partId = item.id || fallbackId;
  const timing = codexToolTimingFields(item);
  return {
    handled: true,
    events: todoToolCanonicalEvents(update, displayInput, ctx, {
      messageId: partId,
      partId,
      callId: partId,
      rawToolName,
      ...timing,
    }),
  };
};

const planItemEvents = (item: CodexPlanItem, ctx: CodexMappingContext): CodexMappingResult => {
  const payload = { text: item.text };
  const input = codexTodoToolInputFromPayload(payload);
  const update = codexTodoUpdateFromPayload(payload);
  if (!input || !update) {
    return emptyCodexMappingResult();
  }
  const partId = item.id;
  const timing = codexToolTimingFields(item);
  return {
    handled: true,
    events: todoToolCanonicalEvents(update, input, ctx, {
      messageId: partId,
      partId,
      callId: partId,
      rawToolName: "update_plan",
      ...timing,
    }),
  };
};

export const todoMapper: CodexEventMapper<CodexTodoMapperState> & {
  fromLivePlanUpdated(
    payload: CodexPlanUpdatedPayload,
    ctx: CodexMappingContext,
    state?: CodexTodoMapperState,
  ): CodexMappingResult;
  fromCompletedItem(item: CodexTimedThreadItem, ctx: CodexMappingContext): CodexMappingResult;
  fromThreadItemObject(item: CodexTimedThreadItem, ctx: CodexMappingContext): CodexMappingResult;
} = {
  name: TODO_MAPPER_NAME,

  createState: (): CodexTodoMapperState => ({ livePlanUpdateSequence: 0 }),

  fromLive(
    input: CodexLiveInput,
    ctx: CodexMappingContext,
    state: CodexTodoMapperState,
  ): CodexMappingResult {
    if (input.kind === "notification" && input.notification.method === "turn/plan/updated") {
      return this.fromLivePlanUpdated(input.notification.params, ctx, state);
    }
    if (input.kind === "item_completed") {
      return this.fromCompletedItem(input.item, ctx);
    }
    return emptyCodexMappingResult();
  },

  fromThreadItem(
    input: CodexThreadItemInput,
    ctx: CodexMappingContext,
    _state: CodexTodoMapperState,
  ): CodexMappingResult {
    return this.fromThreadItemObject(input.item, ctx);
  },

  fromLivePlanUpdated(
    payload: CodexPlanUpdatedPayload,
    ctx: CodexMappingContext,
    state?: CodexTodoMapperState,
  ): CodexMappingResult {
    const input = codexTodoToolInputFromPayload(payload);
    const update = codexTodoUpdateFromPayload(payload);
    if (!input || !update) {
      return emptyCodexMappingResult();
    }
    const turnId = ctx.turnId ?? ctx.threadId;
    let sequence = 1;
    if (state) {
      state.livePlanUpdateSequence += 1;
      sequence = state.livePlanUpdateSequence;
    }
    const partId = `${turnId}-update-plan-${sequence}`;
    return {
      handled: true,
      events: todoToolCanonicalEvents(update, input, ctx, {
        messageId: turnId,
        partId,
        callId: partId,
        rawToolName: "update_plan",
      }),
    };
  },

  fromCompletedItem(item: CodexTimedThreadItem, ctx: CodexMappingContext): CodexMappingResult {
    return codexItemTypeMatches(item, "dynamicToolCall")
      ? completedDynamicToolCallEvents(item, ctx, item.id)
      : emptyCodexMappingResult();
  },

  fromThreadItemObject(item: CodexTimedThreadItem, ctx: CodexMappingContext): CodexMappingResult {
    if (codexItemTypeMatches(item, "plan")) {
      return planItemEvents(item, ctx);
    }
    return this.fromCompletedItem(item, ctx);
  },
};

export const codexTodosFromThreadRead = (
  value: CodexThreadHistoryReadResponse | undefined,
  threadId = "codex-thread",
): AgentSessionTodoItem[] => {
  if (!value) {
    return [];
  }
  let latestTodos: AgentSessionTodoItem[] = [];
  for (const turn of value.thread.turns) {
    for (const item of turn.items) {
      const result = todoMapper.fromThreadItemObject(item, {
        source: "thread_read",
        threadId,
      });
      const todoEvent = [...result.events].reverse().find((event) => event.kind === "todo_update");
      if (todoEvent?.kind === "todo_update") {
        latestTodos = todoEvent.todos;
      }
    }
  }
  return latestTodos;
};

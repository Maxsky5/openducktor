import type { AgentSessionTodoItem } from "@openducktor/core";
import { normalizeAgentSessionTodoList } from "@openducktor/core";
import {
  arrayFromUnknown,
  codexNamespacedToolName,
  codexToolErrorFromObject,
  extractOptionalObject,
  extractStringField,
  isPlainObject,
} from "../codex-app-server-shared";
import { codexItemId, codexItemTypeMatches } from "../codex-app-server-transcript";
import type {
  CodexCanonicalEvent,
  CodexMappingContext,
  CodexMappingResult,
} from "../codex-canonical-events";
import { emptyCodexMappingResult } from "../codex-canonical-events";
import type { CodexEventMapper, CodexLiveInput, CodexThreadItemInput } from "../codex-event-mapper";
import { noCodexMapperState } from "../codex-event-mapper";
import { statusFromCodexStatus } from "../codex-tool-normalizer";

const parseJsonObject = (value: unknown): Record<string, unknown> | null => {
  if (isPlainObject(value)) return value;
  if (typeof value !== "string") return null;
  try {
    const parsed = JSON.parse(value) as unknown;
    return isPlainObject(parsed) ? parsed : null;
  } catch {
    return null;
  }
};

export type CodexTodoUpdate = {
  explanation?: string;
  todos: AgentSessionTodoItem[];
};

const TODO_MAPPER_NAME = "todo";

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

export const codexTodoItemsFromPlanText = (text: string): Record<string, unknown>[] => {
  const todos: Record<string, unknown>[] = [];
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

export const codexTodoItemsFromPayload = (payload: Record<string, unknown>): unknown[] => {
  const todo = arrayFromUnknown(payload.todo);
  if (todo.length > 0) {
    return todo;
  }
  const plan = arrayFromUnknown(payload.plan);
  if (plan.length > 0) {
    return plan;
  }
  const text = extractStringField(payload, ["text"]);
  return text ? codexTodoItemsFromPlanText(text) : [];
};

export const codexTodoToolInputFromPayload = (
  payload: Record<string, unknown>,
): Record<string, unknown> | null => {
  const rawTodos = codexTodoItemsFromPayload(payload);
  if (rawTodos.length === 0) {
    return null;
  }
  const todos = rawTodos.filter(isPlainObject).map((item) => ({
    step: extractStringField(item, ["step", "content", "text", "title"]) ?? "",
    status: extractStringField(item, ["status"]) ?? "pending",
  }));
  if (todos.length === 0) {
    return null;
  }
  const explanation = extractStringField(payload, ["explanation"]);
  const todoField = arrayFromUnknown(payload.todo).length > 0 ? "todo" : "plan";
  return {
    ...(explanation ? { explanation } : {}),
    [todoField]: todos,
  };
};

export const codexTodoUpdateFromPayload = (
  payload: Record<string, unknown>,
): CodexTodoUpdate | null => {
  const rawTodos = codexTodoItemsFromPayload(payload);
  if (rawTodos.length === 0) {
    return null;
  }
  const todos = normalizeAgentSessionTodoList(
    rawTodos.filter(isPlainObject).map((item, index) => ({
      id: extractStringField(item, ["id", "todoId", "todo_id"]) ?? `codex-todo:${index}`,
      content: extractStringField(item, ["content", "text", "title", "step"]) ?? "",
      status: item.status,
      priority: item.priority,
    })),
  );
  if (todos.length === 0) {
    return null;
  }
  const explanation = extractStringField(payload, ["explanation"]);
  return {
    ...(explanation ? { explanation } : {}),
    todos,
  };
};

export const codexTodoUpdateFromToolCall = (
  toolName: string,
  input: Record<string, unknown> | null | undefined,
): CodexTodoUpdate | null => {
  const tool = toolName.split(/[./]/).filter(Boolean).at(-1) ?? toolName;
  if (tool !== "update_plan" && tool !== "todo_write") {
    return null;
  }
  return input ? codexTodoUpdateFromPayload(input) : null;
};

const todoToolCanonicalEvents = (
  update: CodexTodoUpdate,
  input: Record<string, unknown>,
  ctx: CodexMappingContext,
  ids: { messageId: string; partId: string; callId: string; rawToolName: string },
  raw: unknown,
): CodexCanonicalEvent[] => [
  {
    kind: "tool",
    source: ctx.source,
    mapper: TODO_MAPPER_NAME,
    threadId: ctx.threadId,
    ...(ctx.turnId ? { turnId: ctx.turnId } : {}),
    ...(ctx.timestamp ? { timestamp: ctx.timestamp } : {}),
    raw,
    invocation: {
      ...ids,
      status: "completed",
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
    ...(ctx.turnId ? { turnId: ctx.turnId } : {}),
    ...(ctx.timestamp ? { timestamp: ctx.timestamp } : {}),
    raw,
    todos: update.todos,
  },
];

const completedDynamicToolCallEvents = (
  item: Record<string, unknown>,
  ctx: CodexMappingContext,
  fallbackId: string,
): CodexMappingResult => {
  if (!codexItemTypeMatches(item, "dynamicToolCall")) {
    return emptyCodexMappingResult();
  }
  const error = codexToolErrorFromObject(item.result) ?? codexToolErrorFromObject(item);
  if (
    item.success === false ||
    error ||
    (item.status !== undefined && statusFromCodexStatus(item.status) !== "completed")
  ) {
    return emptyCodexMappingResult();
  }
  const namespace = extractStringField(item, ["namespace"]);
  const rawToolName = codexNamespacedToolName(
    namespace,
    extractStringField(item, ["tool", "name"]) ?? "",
  );
  const input =
    extractOptionalObject(item, "arguments") ??
    parseJsonObject(item.arguments) ??
    extractOptionalObject(item, "input") ??
    parseJsonObject(item.input);
  const update = codexTodoUpdateFromToolCall(rawToolName, input);
  if (!update || !input) {
    return emptyCodexMappingResult();
  }
  const displayInput = codexTodoToolInputFromPayload(input) ?? input;
  const partId = codexItemId(item, fallbackId);
  return {
    handled: true,
    events: todoToolCanonicalEvents(
      update,
      displayInput,
      ctx,
      { messageId: partId, partId, callId: partId, rawToolName },
      item,
    ),
  };
};

const planItemEvents = (
  item: Record<string, unknown>,
  ctx: CodexMappingContext,
): CodexMappingResult => {
  if (!codexItemTypeMatches(item, "plan")) {
    return emptyCodexMappingResult();
  }
  const input = codexTodoToolInputFromPayload(item);
  const update = codexTodoUpdateFromPayload(item);
  if (!input || !update) {
    return emptyCodexMappingResult();
  }
  const partId = codexItemId(item, `${ctx.threadId}-plan`);
  return {
    handled: true,
    events: todoToolCanonicalEvents(
      update,
      input,
      ctx,
      { messageId: partId, partId, callId: partId, rawToolName: "update_plan" },
      item,
    ),
  };
};

export const todoMapper: CodexEventMapper & {
  fromLivePlanUpdated(
    payload: Record<string, unknown>,
    ctx: CodexMappingContext,
  ): CodexMappingResult;
  fromCompletedItem(item: Record<string, unknown>, ctx: CodexMappingContext): CodexMappingResult;
  fromThreadItemObject(item: Record<string, unknown>, ctx: CodexMappingContext): CodexMappingResult;
} = {
  name: TODO_MAPPER_NAME,

  createState: noCodexMapperState,

  fromLive(input: CodexLiveInput, ctx: CodexMappingContext): CodexMappingResult {
    if (
      input.kind === "notification" &&
      input.notification.method === "turn/plan/updated" &&
      isPlainObject(input.notification.params)
    ) {
      return this.fromLivePlanUpdated(input.notification.params, ctx);
    }
    if (input.kind === "item_completed") {
      return this.fromCompletedItem(input.item, ctx);
    }
    return emptyCodexMappingResult();
  },

  fromThreadItem(
    input: CodexThreadItemInput,
    ctx: CodexMappingContext,
    _state: undefined,
  ): CodexMappingResult {
    return this.fromThreadItemObject(input.item, ctx);
  },

  fromLivePlanUpdated(
    payload: Record<string, unknown>,
    ctx: CodexMappingContext,
  ): CodexMappingResult {
    const input = codexTodoToolInputFromPayload(payload);
    const update = codexTodoUpdateFromPayload(payload);
    if (!input || !update) {
      return emptyCodexMappingResult();
    }
    const turnId = ctx.turnId ?? ctx.threadId;
    return {
      handled: true,
      events: todoToolCanonicalEvents(
        update,
        input,
        ctx,
        {
          messageId: turnId,
          partId: `${turnId}-update-plan`,
          callId: `${turnId}-update-plan`,
          rawToolName: "update_plan",
        },
        payload,
      ),
    };
  },

  fromCompletedItem(item: Record<string, unknown>, ctx: CodexMappingContext): CodexMappingResult {
    return completedDynamicToolCallEvents(item, ctx, `codex-item-${Date.now()}`);
  },

  fromThreadItemObject(
    item: Record<string, unknown>,
    ctx: CodexMappingContext,
  ): CodexMappingResult {
    const planResult = planItemEvents(item, ctx);
    if (planResult.handled) {
      return planResult;
    }
    return completedDynamicToolCallEvents(item, ctx, codexItemId(item, "codex-thread-item"));
  },
};

export const codexTodosFromThreadRead = (
  value: unknown,
  threadId = "codex-thread",
): AgentSessionTodoItem[] => {
  if (!isPlainObject(value) || !isPlainObject(value.thread) || !Array.isArray(value.thread.turns)) {
    return [];
  }
  let latestTodos: AgentSessionTodoItem[] = [];
  for (const turn of value.thread.turns) {
    if (!isPlainObject(turn)) {
      continue;
    }
    for (const item of arrayFromUnknown(turn.items).filter(isPlainObject)) {
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

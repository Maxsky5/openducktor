import type { FileDiff } from "@openducktor/contracts";
import type {
  AgentModelSelection,
  AgentUserMessageDisplayPart,
  AgentUserMessagePart,
} from "@openducktor/core";
import {
  arrayFromUnknown,
  codexToolErrorFromObject,
  extractNumberField,
  extractOptionalObject,
  extractStringField,
  extractText,
  isCodexApplyPatchTool,
  isCodexContextualUserMessage,
  isPlainObject,
  readPathFromCommand,
  searchInputFromCommand,
  stringifyJsonValue,
} from "./codex-app-server-shared";
import { projectCodexCanonicalEvents } from "./codex-canonical-projector";
import {
  codexNamespacedToolName,
  normalizeCodexToolInvocation,
  stableToolTitle,
  statusFromCodexStatus,
} from "./codex-tool-normalizer";
import {
  type CodexTodoUpdate,
  codexTodoItemsFromPayload,
  codexTodosFromThreadRead,
  codexTodoToolInputFromPayload,
  codexTodoUpdateFromPayload,
  codexTodoUpdateFromToolCall,
  todoMapper,
} from "./event-mappers";
import type { CodexUserInput } from "./types";

export type CodexTokenUsageTotals = {
  totalTokens: number;
  contextWindow?: number;
};

export type CodexTurnTiming = {
  durationMs?: number;
};

export type { AgentToolStatus } from "./codex-tool-normalizer";
export {
  type CodexTodoUpdate,
  codexTodoItemsFromPayload,
  codexTodosFromThreadRead,
  codexTodoToolInputFromPayload,
  codexTodoUpdateFromPayload,
  codexTodoUpdateFromToolCall,
};

export const timestampFromCodexParams = (params: unknown): string => {
  const millis = extractNumberField(params, ["completedAtMs", "startedAtMs"]);
  return millis ? new Date(millis).toISOString() : new Date().toISOString();
};

export const codexTimestampFromSeconds = (seconds: number | null): string | undefined => {
  return seconds === null ? undefined : new Date(seconds * 1000).toISOString();
};

export const codexItemId = (item: Record<string, unknown>, fallbackId: string): string => {
  return extractStringField(item, ["id", "itemId", "item_id"]) ?? fallbackId;
};

export const codexItemType = (item: Record<string, unknown>): string => {
  return extractStringField(item, ["type", "kind", "itemType"]) ?? "";
};

export const codexItemTypeMatches = (item: Record<string, unknown>, expected: string): boolean => {
  const normalize = (value: string) => value.replace(/[_-]/g, "").toLowerCase();
  return normalize(codexItemType(item)) === normalize(expected);
};

export const codexAgentMessagePhase = (item: Record<string, unknown>): string | null => {
  return extractStringField(item, ["phase"]);
};

export const isCodexFinalAnswerPhase = (phase: string | null): boolean => {
  return phase === "final_answer" || phase === "finalAnswer" || phase === "final-answer";
};

export const isCodexCommentaryPhase = (phase: string | null): boolean => {
  return phase === "commentary";
};

export const hasVisibleCodexAgentMessageText = (item: Record<string, unknown>): boolean => {
  return codexAgentMessageText(item).trim().length > 0;
};

export const codexAgentMessageText = (item: Record<string, unknown>): string => {
  const directText = extractStringField(item, ["text", "message", "summary", "delta"]);
  if (directText) {
    return directText;
  }
  const contentText = arrayFromUnknown(item.content)
    .map((entry) => {
      if (typeof entry === "string") {
        return entry;
      }
      return isPlainObject(entry)
        ? (extractStringField(entry, ["text", "output_text", "content"]) ?? "")
        : "";
    })
    .filter((entry) => entry.trim().length > 0)
    .join("\n");
  return contentText;
};

export const selectCodexFinalAgentMessage = (
  items: Record<string, unknown>[],
): Record<string, unknown> | null => {
  const visibleAgentMessages = items.filter(
    (item) => codexItemTypeMatches(item, "agentMessage") && hasVisibleCodexAgentMessageText(item),
  );
  return (
    [...visibleAgentMessages]
      .reverse()
      .find((item) => isCodexFinalAnswerPhase(codexAgentMessagePhase(item))) ??
    [...visibleAgentMessages]
      .reverse()
      .find((item) => !isCodexCommentaryPhase(codexAgentMessagePhase(item))) ??
    visibleAgentMessages.at(-1) ??
    null
  );
};

export const shouldReplaceCodexBufferedFinalAgentMessage = (
  current: Record<string, unknown>,
  next: Record<string, unknown>,
): boolean => {
  return selectCodexFinalAgentMessage([current, next]) === next;
};

export const codexUserInputFromUnknown = (entry: unknown): CodexUserInput | null => {
  if (!isPlainObject(entry)) {
    return null;
  }
  if (entry.type === "text" && typeof entry.text === "string") {
    return { type: "text", text: entry.text };
  }
  if (
    entry.type === "mention" &&
    typeof entry.name === "string" &&
    typeof entry.path === "string"
  ) {
    return { type: "mention", name: entry.name, path: entry.path };
  }
  if (entry.type === "localImage" && typeof entry.path === "string") {
    return { type: "localImage", path: entry.path };
  }
  return null;
};

export const codexUserInputsFromItem = (item: Record<string, unknown>): CodexUserInput[] => {
  return arrayFromUnknown(item.content)
    .map(codexUserInputFromUnknown)
    .filter((entry): entry is CodexUserInput => Boolean(entry));
};

export const codexTurnTimestampSeconds = (
  turn: Record<string, unknown>,
  keys: [string, string],
): number | null => {
  const [camelKey, snakeKey] = keys;
  return typeof turn[camelKey] === "number"
    ? turn[camelKey]
    : typeof turn[snakeKey] === "number"
      ? turn[snakeKey]
      : null;
};

export const codexTurnItemsFromThreadRead = (
  value: unknown,
): Array<{
  item: Record<string, unknown>;
  timestamp?: string;
  isFinalAgentMessage?: boolean;
  turnTiming?: CodexTurnTiming;
}> => {
  if (!isPlainObject(value) || !isPlainObject(value.thread)) {
    throw new Error("Codex thread/read response is missing thread data.");
  }
  if (!Array.isArray(value.thread.turns)) {
    throw new Error("Codex thread/read response is missing thread turns.");
  }
  return value.thread.turns.flatMap(
    (
      turn,
    ): Array<{
      item: Record<string, unknown>;
      timestamp?: string;
      isFinalAgentMessage?: boolean;
      turnTiming?: CodexTurnTiming;
    }> => {
      if (!isPlainObject(turn)) {
        return [];
      }
      const items = arrayFromUnknown(turn.items).filter(isPlainObject);
      const isCompletedTurn = extractStringField(turn, ["status"]) === "completed";
      const finalAgentMessageId = isCompletedTurn ? selectCodexFinalAgentMessage(items) : null;
      const startedAtSeconds = codexTurnTimestampSeconds(turn, ["startedAt", "started_at"]);
      const completedAtSeconds = codexTurnTimestampSeconds(turn, ["completedAt", "completed_at"]);
      const durationMs =
        extractNumberField(turn, ["durationMs", "duration_ms"]) ??
        (typeof startedAtSeconds === "number" && typeof completedAtSeconds === "number"
          ? Math.max(0, (completedAtSeconds - startedAtSeconds) * 1000)
          : null);
      return items.map((item) => {
        const itemIsFinalAgentMessage =
          finalAgentMessageId !== null && item === finalAgentMessageId;
        const timestampSeconds =
          codexItemType(item) === "userMessage"
            ? startedAtSeconds
            : itemIsFinalAgentMessage
              ? completedAtSeconds
              : (completedAtSeconds ?? startedAtSeconds);
        const timestamp = codexTimestampFromSeconds(timestampSeconds);
        return {
          item,
          ...(timestamp ? { timestamp } : {}),
          ...(itemIsFinalAgentMessage ? { isFinalAgentMessage: true } : {}),
          ...(itemIsFinalAgentMessage && typeof durationMs === "number" && durationMs > 0
            ? { turnTiming: { durationMs } }
            : {}),
        };
      });
    },
  );
};

export const toHistoryMessage = (
  item: unknown,
  fallbackId: string,
  model?: AgentModelSelection,
  timestamp?: string,
  isFinalAgentMessage?: boolean,
  turnTiming?: CodexTurnTiming,
): import("@openducktor/core").AgentSessionHistoryMessage | null => {
  if (!isPlainObject(item)) {
    return null;
  }
  const messageId = codexItemId(item, fallbackId);
  const messageTimestamp =
    timestamp ??
    (typeof item.timestamp === "string"
      ? item.timestamp
      : typeof item.createdAt === "string"
        ? item.createdAt
        : new Date().toISOString());
  if (codexItemTypeMatches(item, "userMessage") || item.role === "user") {
    const input = codexItemTypeMatches(item, "userMessage") ? codexUserInputsFromItem(item) : [];
    const text = input.length > 0 ? codexUserInputListToText(input) : (extractText(item) ?? "");
    if (isCodexContextualUserMessage(item)) {
      return null;
    }
    return {
      messageId,
      role: "user",
      timestamp: messageTimestamp,
      text,
      displayParts:
        input.length > 0 ? input.map(codexUserInputToDisplayPart) : [{ kind: "text", text }],
      state: "read",
      parts: toHistoryParts(item, messageId, text),
      ...(model ? { model } : {}),
    };
  }
  if (codexItemTypeMatches(item, "agentMessage") || item.role === "assistant") {
    const text = codexAgentMessageText(item);
    return {
      messageId,
      role: "assistant",
      timestamp: messageTimestamp,
      text,
      ...(isFinalAgentMessage && typeof turnTiming?.durationMs === "number"
        ? { durationMs: turnTiming.durationMs }
        : {}),
      parts: toHistoryParts(item, messageId, text, {
        ...(isFinalAgentMessage ? { isFinalAgentMessage } : {}),
        includeTextFallback: false,
      }),
      ...(model ? { model } : {}),
    };
  }
  const parts = toStreamPart(item, messageId, messageId);
  if (parts.length > 0) {
    return {
      messageId,
      role: "assistant",
      timestamp: messageTimestamp,
      text: "",
      parts,
      ...(model ? { model } : {}),
    };
  }
  return null;
};

export const toHistoryParts = (
  item: Record<string, unknown>,
  messageId: string,
  fallbackText: string,
  options: { isFinalAgentMessage?: boolean; includeTextFallback?: boolean } = {},
): import("@openducktor/core").AgentStreamPart[] => {
  const isFinalAgentMessage = options.isFinalAgentMessage === true;
  const includeTextFallback = options.includeTextFallback !== false;
  const rawParts = arrayFromUnknown(item.parts ?? item.items ?? item.content);
  const parts = rawParts.flatMap((part, index): import("@openducktor/core").AgentStreamPart[] => {
    if (!isPlainObject(part)) {
      return [];
    }
    return toStreamPart(part, messageId, `codex-history-part-${index}`);
  });
  if (parts.length > 0) {
    return isFinalAgentMessage ? [...parts, terminalHistoryPart(messageId)] : parts;
  }
  if (fallbackText.length === 0 || !includeTextFallback) {
    return isFinalAgentMessage ? [terminalHistoryPart(messageId)] : [];
  }
  const textParts: import("@openducktor/core").AgentStreamPart[] = [
    {
      kind: "text",
      messageId,
      partId: `${messageId}-text`,
      text: fallbackText,
      completed: true,
    },
  ];
  return isFinalAgentMessage ? [...textParts, terminalHistoryPart(messageId)] : textParts;
};

export const terminalHistoryPart = (
  messageId: string,
  tokenUsage?: CodexTokenUsageTotals | null,
): import("@openducktor/core").AgentStreamPart => ({
  kind: "step",
  messageId,
  partId: `${messageId}-finish`,
  phase: "finish",
  reason: "stop",
  ...(typeof tokenUsage?.totalTokens === "number" ? { totalTokens: tokenUsage.totalTokens } : {}),
  ...(typeof tokenUsage?.contextWindow === "number"
    ? { contextWindow: tokenUsage.contextWindow }
    : {}),
});

export const firstPlainObject = (value: unknown): Record<string, unknown> | null => {
  return arrayFromUnknown(value).find(isPlainObject) ?? null;
};

export const parseObjectString = (value: unknown): Record<string, unknown> | null => {
  if (typeof value !== "string") {
    return null;
  }
  try {
    const parsed = JSON.parse(value) as unknown;
    return isPlainObject(parsed) ? parsed : null;
  } catch {
    return null;
  }
};

export const commandActionToolName = (action: Record<string, unknown> | null): string => {
  if (!action) {
    return "bash";
  }
  const actionType = extractStringField(action, ["type", "kind", "tool", "name"])
    ?.replace(/[_-]/g, "")
    .toLowerCase();
  if (actionType === "read") {
    return "read";
  }
  if (actionType === "list" || actionType === "listfiles") {
    return "list";
  }
  if (actionType === "search" || actionType === "grep") {
    return "search";
  }
  if (actionType === "find" || actionType === "glob") {
    return "find";
  }
  return "bash";
};

export const commandActionInput = (
  action: Record<string, unknown> | null,
  command: string,
  cwd: string | null,
): Record<string, unknown> => {
  if (!action) {
    return { command, ...(cwd ? { cwd } : {}) };
  }
  const actionCommand = extractStringField(action, ["command"]) ?? command;
  const tool = commandActionToolName(action);
  const path =
    extractStringField(action, ["path", "file", "directory"]) ??
    (tool === "read" ? readPathFromCommand(actionCommand) : null) ??
    (tool === "search"
      ? extractStringField(searchInputFromCommand(actionCommand), ["path"])
      : null);
  const query =
    extractStringField(action, ["query", "pattern"]) ??
    (tool === "search"
      ? extractStringField(searchInputFromCommand(actionCommand), ["query"])
      : null);
  const pattern = extractStringField(action, ["pattern", "glob"]);
  const name = extractStringField(action, ["name"]);
  return {
    command: actionCommand,
    ...(cwd ? { cwd } : {}),
    ...(path ? { path } : {}),
    ...(query ? { query } : {}),
    ...(pattern ? { pattern } : {}),
    ...(name ? { name } : {}),
  };
};

export const codexCommandText = (value: unknown): string | null => {
  if (typeof value === "string" && value.trim().length > 0) {
    return value;
  }
  const argv = Array.isArray(value)
    ? value
    : isPlainObject(value) && Array.isArray(value.command)
      ? value.command
      : null;
  if (!argv) {
    return null;
  }
  const parts = argv.filter((part): part is string => typeof part === "string");
  return parts.length > 0 ? parts.join(" ") : null;
};

export const codexObjectInput = (value: unknown): Record<string, unknown> | undefined => {
  if (isPlainObject(value)) {
    return value;
  }
  if (typeof value !== "string") {
    return undefined;
  }
  try {
    const parsed = JSON.parse(value) as unknown;
    return isPlainObject(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
};

export const codexToolResultText = (value: unknown): string | null => {
  if (value === undefined || value === null) {
    return null;
  }
  if (typeof value === "string") {
    return value;
  }
  const content = Array.isArray(value)
    ? value
    : isPlainObject(value)
      ? arrayFromUnknown(value.content ?? value.contentItems ?? value.content_items)
      : [];
  const text = content
    .map((entry) => {
      if (typeof entry === "string") {
        return entry;
      }
      if (!isPlainObject(entry)) {
        return "";
      }
      const entryType = extractStringField(entry, ["type"]);
      if (entryType === "inputImage" || entryType === "image") {
        return "";
      }
      return extractStringField(entry, ["text", "inputText", "outputText", "content"]) ?? "";
    })
    .filter((entry) => entry.trim().length > 0)
    .join("\n");
  return text.length > 0 ? text : stringifyJsonValue(value);
};

const webSearchActionInput = (action: unknown): Record<string, unknown> | undefined => {
  if (!isPlainObject(action)) {
    return undefined;
  }

  const type = extractStringField(action, ["type"]);
  if (type === "search") {
    const query =
      extractStringField(action, ["query"]) ??
      arrayFromUnknown(action.queries).find(
        (entry): entry is string => typeof entry === "string" && entry.trim().length > 0,
      );
    return query ? { query } : undefined;
  }

  if (type === "openPage" || type === "open_page") {
    const url = extractStringField(action, ["url"]);
    return url ? { url } : undefined;
  }

  if (type === "findInPage" || type === "find_in_page") {
    const url = extractStringField(action, ["url"]);
    const pattern = extractStringField(action, ["pattern"]);
    if (!url && !pattern) {
      return undefined;
    }
    return {
      ...(pattern ? { pattern } : {}),
      ...(url ? { url } : {}),
    };
  }

  return undefined;
};

const webSearchInput = (value: Record<string, unknown>): Record<string, unknown> | undefined => {
  const query = extractStringField(value, ["query"]);
  if (query) {
    return { query };
  }
  return webSearchActionInput(value.action);
};

export const fileChangeDiff = (changes: unknown[]): string | null => {
  const diffs = changes
    .filter(isPlainObject)
    .map((change) => extractStringField(change, ["diff", "patch"]))
    .filter((diff): diff is string => Boolean(diff));
  return diffs.length > 0 ? diffs.join("\n") : null;
};

export const fileChangeEntries = (value: Record<string, unknown>): unknown[] => {
  const changes = arrayFromUnknown(value.changes);
  const diffs = arrayFromUnknown(value.diffs);
  return changes.length > 0 ? changes : diffs;
};

export const extractCodexTokenUsageTotals = (params: unknown): CodexTokenUsageTotals | null => {
  if (!isPlainObject(params)) {
    return null;
  }
  const usage = isPlainObject(params.tokenUsage ?? params.token_usage)
    ? (params.tokenUsage ?? params.token_usage)
    : null;
  if (!usage || !isPlainObject(usage)) {
    return null;
  }
  const last = isPlainObject(usage.last) ? usage.last : null;
  const totalTokens =
    extractNumberField(last, ["totalTokens", "total_tokens"]) ??
    extractNumberField(usage, ["totalTokens", "total_tokens"]);
  if (typeof totalTokens !== "number" || totalTokens <= 0) {
    return null;
  }
  const contextWindow = extractNumberField(usage, [
    "modelContextWindow",
    "model_context_window",
    "contextWindow",
    "context_window",
  ]);
  return {
    totalTokens,
    ...(typeof contextWindow === "number" && contextWindow > 0 ? { contextWindow } : {}),
  };
};

export const syntheticToolPart = ({
  metadata,
  ...part
}: Extract<import("@openducktor/core").AgentStreamPart, { kind: "tool" }>): Extract<
  import("@openducktor/core").AgentStreamPart,
  { kind: "tool" }
> => ({
  ...part,
  metadata: { ...(isPlainObject(metadata) ? metadata : {}), syntheticCodexToolPart: true },
});

export const toStreamPart = (
  value: Record<string, unknown>,
  messageId: string,
  fallbackPartId: string,
): import("@openducktor/core").AgentStreamPart[] => {
  const partId = codexItemId(value, fallbackPartId);
  if (codexItemTypeMatches(value, "reasoning")) {
    const text = [...arrayFromUnknown(value.summary), ...arrayFromUnknown(value.content)]
      .filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
      .join("\n");
    return text ? [{ kind: "reasoning", messageId, partId, text, completed: true }] : [];
  }
  if (codexItemTypeMatches(value, "plan")) {
    const text = extractStringField(value, ["text"]);
    return text
      ? [
          syntheticToolPart({
            kind: "tool",
            messageId,
            partId,
            callId: partId,
            tool: "plan",
            title: "Plan",
            status: "completed",
            preview: text,
            metadata: { codexItem: value },
          }),
        ]
      : [];
  }
  if (codexItemTypeMatches(value, "commandExecution")) {
    const command = codexCommandText(value.command) ?? "command";
    const cwd = extractStringField(value, ["cwd"]);
    const firstAction = firstPlainObject(value.commandActions ?? value.command_actions);
    const tool = commandActionToolName(firstAction);
    const input = commandActionInput(firstAction, command, cwd);
    const output = codexToolResultText(value.aggregatedOutput ?? value.aggregated_output);
    const explicitError = stringifyJsonValue(value.error);
    const status = statusFromCodexStatus(value.status);
    const error = explicitError ?? (status === "error" ? output : null);
    const startedAtMs = extractNumberField(value, ["startedAtMs", "started_at_ms"]);
    const durationMs = extractNumberField(value, ["durationMs", "duration_ms"]);
    const endedAtMs = startedAtMs && durationMs ? startedAtMs + durationMs : null;
    return [
      normalizeCodexToolInvocation({
        messageId,
        partId,
        callId: partId,
        rawToolName: tool,
        title: stableToolTitle(tool),
        status,
        input,
        output,
        error,
        ...(typeof startedAtMs === "number" ? { startedAtMs } : {}),
        ...(typeof endedAtMs === "number" ? { endedAtMs } : {}),
        metadata: { codexItem: value },
      }),
    ].filter((part): part is import("@openducktor/core").AgentStreamPart => Boolean(part));
  }
  if (codexItemTypeMatches(value, "fileChange")) {
    const changes = fileChangeEntries(value);
    const diff = fileChangeDiff(changes);
    const error = codexToolErrorFromObject(value);
    return [
      normalizeCodexToolInvocation({
        messageId,
        partId,
        callId: partId,
        rawToolName: "apply_patch",
        title: "File changes",
        status: error ? "error" : statusFromCodexStatus(value.status),
        preview: `${changes.length} file change${changes.length === 1 ? "" : "s"}`,
        ...(diff ? { input: { patch: diff } } : {}),
        output: diff,
        error,
        metadata: { codexItem: value, changes, diffs: changes, ...(diff ? { diff } : {}) },
      }),
    ].filter((part): part is import("@openducktor/core").AgentStreamPart => Boolean(part));
  }
  if (codexItemTypeMatches(value, "mcpToolCall")) {
    const server = extractStringField(value, ["server"]);
    const tool = extractStringField(value, ["tool"]) ?? "mcp_tool";
    const args = extractOptionalObject(value, "arguments") ?? codexObjectInput(value.arguments);
    const error = codexToolErrorFromObject(value.result) ?? codexToolErrorFromObject(value);
    const output = codexToolResultText(value.result);
    return [
      normalizeCodexToolInvocation({
        messageId,
        partId,
        callId: partId,
        rawToolName: codexNamespacedToolName(server, tool),
        status: error ? "error" : statusFromCodexStatus(value.status),
        ...(args ? { input: args } : {}),
        output,
        error,
        metadata: { codexItem: value, ...(server ? { server } : {}) },
      }),
    ].filter((part): part is import("@openducktor/core").AgentStreamPart => Boolean(part));
  }
  if (codexItemTypeMatches(value, "collabAgentToolCall")) {
    const tool = extractStringField(value, ["tool"]) ?? "collab_agent";
    const prompt = extractStringField(value, ["prompt"]);
    const receivers = arrayFromUnknown(value.receiverThreadIds ?? value.receiver_thread_ids).filter(
      (entry): entry is string => typeof entry === "string",
    );
    return [
      syntheticToolPart({
        kind: "tool",
        messageId,
        partId,
        callId: partId,
        tool: `collab.${tool}`,
        title: `Collab ${tool}`,
        status: statusFromCodexStatus(value.status),
        ...(prompt ? { input: { prompt } } : {}),
        ...(receivers.length > 0 ? { output: receivers.join("\n") } : {}),
        metadata: { codexItem: value },
      }),
    ];
  }
  if (codexItemTypeMatches(value, "dynamicToolCall")) {
    const todoResult = todoMapper.fromThreadItemObject(value, {
      source: "thread_read",
      threadId: messageId,
    });
    if (todoResult.handled) {
      return projectCodexCanonicalEvents(todoResult.events).flatMap((event) =>
        event.type === "assistant_part" ? [event.part] : [],
      );
    }
    const namespace = extractStringField(value, ["namespace"]);
    const rawTool = codexNamespacedToolName(
      namespace,
      extractStringField(value, ["tool", "name"]) ?? "dynamic_tool",
    );
    const args = extractOptionalObject(value, "arguments") ?? codexObjectInput(value.arguments);
    const parsedInput = parseObjectString(value.input);
    const patch =
      isCodexApplyPatchTool(rawTool) && typeof value.input === "string" ? value.input : null;
    const input = patch ? { ...(args ?? {}), patch } : (args ?? parsedInput ?? undefined);
    const output = codexToolResultText(value.contentItems ?? value.content_items ?? value.result);
    const success = typeof value.success === "boolean" ? value.success : true;
    return [
      normalizeCodexToolInvocation({
        messageId,
        partId,
        callId: partId,
        rawToolName: rawTool,
        status: success ? statusFromCodexStatus(value.status) : "error",
        ...(input ? { input } : {}),
        output: success ? (patch ?? output) : null,
        error: success ? null : output,
        metadata: { codexItem: value },
      }),
    ].filter((part): part is import("@openducktor/core").AgentStreamPart => Boolean(part));
  }
  if (codexItemTypeMatches(value, "webSearch")) {
    const input = webSearchInput(value);
    const output = stringifyJsonValue(
      value.output ?? value.result ?? value.results ?? value.contentItems ?? value.content_items,
    );
    return [
      normalizeCodexToolInvocation({
        messageId,
        partId,
        callId: partId,
        rawToolName: "webSearch",
        status: "completed",
        ...(input ? { input } : {}),
        ...(output ? { output } : {}),
        ...(input ? { preview: Object.values(input).join(" ") } : {}),
        metadata: { codexItem: value },
      }),
    ].filter((part): part is import("@openducktor/core").AgentStreamPart => Boolean(part));
  }
  return [];
};

export const toFileDiffs = (value: unknown): FileDiff[] => {
  const entries = arrayFromUnknown(value).flatMap((entry) => {
    if (!isPlainObject(entry)) {
      return [entry];
    }
    const nested = arrayFromUnknown(entry.fileChanges ?? entry.changes ?? entry.files);
    return nested.length > 0 ? nested : [entry];
  });
  return entries.flatMap((entry): FileDiff[] => {
    if (!isPlainObject(entry)) {
      return [];
    }
    const file = entry.file ?? entry.path;
    const diff = entry.diff ?? entry.patch;
    if (typeof file !== "string" || typeof diff !== "string") {
      return [];
    }
    return [
      {
        file,
        type: typeof entry.type === "string" ? entry.type : "modified",
        additions: typeof entry.additions === "number" ? entry.additions : 0,
        deletions: typeof entry.deletions === "number" ? entry.deletions : 0,
        diff,
      },
    ];
  });
};
export const toCodexUserInput = (part: AgentUserMessagePart): CodexUserInput => {
  if (part.kind === "text") {
    return { type: "text", text: part.text };
  }
  if (part.kind === "file_reference") {
    return { type: "mention", name: part.file.name, path: part.file.path };
  }
  if (part.kind === "attachment" && part.attachment.kind === "image") {
    return { type: "localImage", path: part.attachment.path };
  }

  throw new Error(`Codex app-server does not support '${part.kind}' user message parts.`);
};

export const toCodexUserInputList = (parts: AgentUserMessagePart[]): CodexUserInput[] => {
  return parts.map(toCodexUserInput);
};

export const toDisplayPart = (part: AgentUserMessagePart): AgentUserMessageDisplayPart | null => {
  if (part.kind === "text") {
    return { kind: "text", text: part.text };
  }
  if (part.kind === "file_reference") {
    return { kind: "file_reference", file: part.file };
  }
  if (part.kind === "attachment") {
    return { kind: "attachment", attachment: part.attachment };
  }
  return null;
};

export const toDisplayParts = (parts: AgentUserMessagePart[]): AgentUserMessageDisplayPart[] => {
  return parts
    .map(toDisplayPart)
    .filter((part): part is AgentUserMessageDisplayPart => Boolean(part));
};

export const userInputText = (input: CodexUserInput): string => {
  if (input.type === "text") {
    return input.text;
  }
  if (input.type === "mention") {
    return `@${input.name}`;
  }
  return input.path;
};

export const codexUserInputToDisplayPart = (input: CodexUserInput): AgentUserMessageDisplayPart => {
  if (input.type === "text") {
    return { kind: "text", text: input.text };
  }
  return { kind: "text", text: userInputText(input), synthetic: true };
};

export const codexUserInputListToText = (input: CodexUserInput[]): string => {
  return input.map(userInputText).join(" ").trim();
};

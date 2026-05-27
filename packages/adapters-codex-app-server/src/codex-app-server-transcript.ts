import type { FileDiff } from "@openducktor/contracts";
import type { AgentModelSelection, AgentStreamPart, AgentUserMessagePart } from "@openducktor/core";
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
  type NormalizedCodexToolInvocation,
  normalizeCodexToolInvocation,
  stableToolTitle,
  statusFromCodexStatus,
} from "./codex-tool-normalizer";
import {
  codexUserInputListToText,
  codexUserInputsToDisplayParts,
  utf8ByteLength,
} from "./codex-user-input-display";
import {
  type CodexTodoUpdate,
  codexTodoItemsFromPayload,
  codexTodosFromThreadRead,
  codexTodoToolInputFromPayload,
  codexTodoUpdateFromPayload,
  codexTodoUpdateFromToolCall,
  todoMapper,
} from "./event-mappers";
import type { CodexTextElement, CodexUserInput } from "./types";

export type CodexTokenUsageTotals = {
  totalTokens: number;
  contextWindow?: number;
};

const extractOptionalFiniteNumberField = (
  value: Record<string, unknown>,
  keys: string[],
  label: string,
): number | null => {
  for (const key of keys) {
    if (!Object.hasOwn(value, key)) {
      continue;
    }
    const candidate = value[key];
    if (candidate === null || candidate === undefined) {
      return null;
    }
    if (typeof candidate === "number" && Number.isFinite(candidate)) {
      return candidate;
    }
    throw new Error(`Codex commandExecution ${label} must be a finite number when present.`);
  }
  return null;
};

export type CodexTurnTiming = {
  durationMs: number;
};

export type CodexThreadReadItem = {
  item: Record<string, unknown>;
  turnId: string | null;
  timestamp: string | null;
  isFinalAgentMessage: boolean;
  turnTiming: CodexTurnTiming | null;
  model?: AgentModelSelection;
};

export type CodexHistoryTokenUsageFields = {
  totalTokens: number;
  contextWindow?: number;
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

const codexTextElementFromUnknown = (entry: unknown): CodexTextElement | null => {
  if (!isPlainObject(entry)) {
    return null;
  }
  const byteRange = entry.byteRange ?? entry.byte_range;
  if (!isPlainObject(byteRange)) {
    return null;
  }
  const start = byteRange.start;
  const end = byteRange.end;
  if (
    typeof start !== "number" ||
    typeof end !== "number" ||
    !Number.isFinite(start) ||
    !Number.isFinite(end)
  ) {
    return null;
  }
  const placeholder = entry.placeholder;
  return {
    byteRange: { start, end },
    placeholder: typeof placeholder === "string" ? placeholder : null,
  };
};

const codexTextElementsFromUnknown = (value: unknown): CodexTextElement[] =>
  arrayFromUnknown(value)
    .map(codexTextElementFromUnknown)
    .filter((entry): entry is CodexTextElement => Boolean(entry));

export const codexUserInputFromUnknown = (entry: unknown): CodexUserInput | null => {
  if (!isPlainObject(entry)) {
    return null;
  }
  if (entry.type === "text" && typeof entry.text === "string") {
    return {
      type: "text",
      text: entry.text,
      text_elements: codexTextElementsFromUnknown(entry.text_elements ?? entry.textElements ?? []),
    };
  }
  if (
    entry.type === "mention" &&
    typeof entry.name === "string" &&
    typeof entry.path === "string"
  ) {
    return { type: "mention", name: entry.name, path: entry.path };
  }
  if (entry.type === "skill" && typeof entry.name === "string" && typeof entry.path === "string") {
    return { type: "skill", name: entry.name, path: entry.path };
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

export const codexTurnItemsFromThreadRead = (value: unknown): CodexThreadReadItem[] => {
  if (!isPlainObject(value) || !isPlainObject(value.thread)) {
    throw new Error("Codex thread/read response is missing thread data.");
  }
  if (!Array.isArray(value.thread.turns)) {
    throw new Error("Codex thread/read response is missing thread turns.");
  }
  const threadModelProvider = extractStringField(value.thread, ["modelProvider", "model_provider"]);
  return value.thread.turns.flatMap((turn): CodexThreadReadItem[] => {
    if (!isPlainObject(turn)) {
      return [];
    }
    const items = arrayFromUnknown(turn.items).filter(isPlainObject);
    const turnId = extractStringField(turn, ["id", "turnId", "turn_id"]) ?? null;
    const isCompletedTurn = extractStringField(turn, ["status"]) === "completed";
    const finalAgentMessageId = isCompletedTurn ? selectCodexFinalAgentMessage(items) : null;
    const startedAtSeconds = codexTurnTimestampSeconds(turn, ["startedAt", "started_at"]);
    const completedAtSeconds = codexTurnTimestampSeconds(turn, ["completedAt", "completed_at"]);
    const durationMs =
      extractNumberField(turn, ["durationMs", "duration_ms"]) ??
      (typeof startedAtSeconds === "number" && typeof completedAtSeconds === "number"
        ? Math.max(0, (completedAtSeconds - startedAtSeconds) * 1000)
        : null);
    const modelId = extractStringField(turn, ["model", "modelId", "model_id"]);
    const providerId =
      extractStringField(turn, ["modelProvider", "model_provider", "providerId", "provider_id"]) ??
      threadModelProvider;
    const variant = extractStringField(turn, ["effort", "reasoningEffort", "reasoning_effort"]);
    const model =
      modelId && providerId
        ? {
            providerId,
            modelId,
            ...(variant ? { variant } : {}),
          }
        : undefined;
    return items.map((item) => {
      const itemIsFinalAgentMessage = finalAgentMessageId !== null && item === finalAgentMessageId;
      let timestampSeconds: number | null;
      if (codexItemType(item) === "userMessage") {
        timestampSeconds = startedAtSeconds;
      } else if (itemIsFinalAgentMessage) {
        timestampSeconds = completedAtSeconds;
      } else {
        timestampSeconds = completedAtSeconds ?? startedAtSeconds;
      }
      const timestamp = codexTimestampFromSeconds(timestampSeconds) ?? null;
      return {
        item,
        turnId,
        timestamp,
        isFinalAgentMessage: itemIsFinalAgentMessage,
        turnTiming:
          itemIsFinalAgentMessage && typeof durationMs === "number" && durationMs > 0
            ? { durationMs }
            : null,
        ...(model ? { model } : {}),
      };
    });
  });
};

export const toHistoryMessage = (
  item: unknown,
  fallbackId: string,
  model?: AgentModelSelection,
  timestamp?: string,
  isFinalAgentMessage?: boolean,
  turnTiming?: CodexTurnTiming | null,
  tokenUsage?: CodexTokenUsageTotals | null,
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
        input.length > 0
          ? codexUserInputsToDisplayParts(input, messageId)
          : [{ kind: "text", text }],
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
      ...(isFinalAgentMessage && turnTiming ? { durationMs: turnTiming.durationMs } : {}),
      ...(isFinalAgentMessage && tokenUsage ? codexTokenUsageHistoryFields(tokenUsage) : {}),
      parts: toHistoryParts(item, messageId, text, {
        ...(isFinalAgentMessage ? { isFinalAgentMessage } : {}),
        ...(tokenUsage ? { tokenUsage } : {}),
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

export const codexTokenUsageHistoryFields = (
  tokenUsage: CodexTokenUsageTotals,
): CodexHistoryTokenUsageFields => ({
  totalTokens: tokenUsage.totalTokens,
  ...(typeof tokenUsage.contextWindow === "number"
    ? { contextWindow: tokenUsage.contextWindow }
    : {}),
});

export const toHistoryParts = (
  item: Record<string, unknown>,
  messageId: string,
  fallbackText: string,
  options: {
    isFinalAgentMessage?: boolean;
    includeTextFallback?: boolean;
    tokenUsage?: CodexTokenUsageTotals | null;
  } = {},
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
    return isFinalAgentMessage
      ? [...parts, terminalHistoryPart(messageId, options.tokenUsage)]
      : parts;
  }
  if (fallbackText.length === 0 || !includeTextFallback) {
    return isFinalAgentMessage ? [terminalHistoryPart(messageId, options.tokenUsage)] : [];
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
  return isFinalAgentMessage
    ? [...textParts, terminalHistoryPart(messageId, options.tokenUsage)]
    : textParts;
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
  ...(tokenUsage ? codexTokenUsageHistoryFields(tokenUsage) : {}),
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

  const usage = codexTokenUsagePayload(params);
  if (!usage) {
    return null;
  }
  const last = firstPlainObject([usage.last, usage.lastTokenUsage, usage.last_token_usage]);
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

const codexTokenUsagePayload = (
  params: Record<string, unknown>,
): Record<string, unknown> | null => {
  const directUsage = params.tokenUsage ?? params.token_usage;
  if (isPlainObject(directUsage)) {
    return directUsage;
  }

  return null;
};

export const syntheticToolPart = ({
  metadata,
  ...part
}: Extract<AgentStreamPart, { kind: "tool" }>): Extract<AgentStreamPart, { kind: "tool" }> => ({
  ...part,
  metadata: { ...(isPlainObject(metadata) ? metadata : {}), syntheticCodexToolPart: true },
});

const normalizedCodexToolPart = (input: NormalizedCodexToolInvocation): AgentStreamPart[] => {
  const part = normalizeCodexToolInvocation(input);
  return part ? [part] : [];
};

const codexReasoningStreamParts = (
  value: Record<string, unknown>,
  messageId: string,
  partId: string,
): AgentStreamPart[] => {
  const text = [...arrayFromUnknown(value.summary), ...arrayFromUnknown(value.content)]
    .filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
    .join("\n");
  return text ? [{ kind: "reasoning", messageId, partId, text, completed: true }] : [];
};

const codexPlanStreamParts = (
  value: Record<string, unknown>,
  messageId: string,
  partId: string,
): AgentStreamPart[] => {
  const text = extractStringField(value, ["text"]);
  if (!text) {
    return [];
  }

  return [
    syntheticToolPart({
      kind: "tool",
      messageId,
      partId,
      callId: partId,
      tool: "plan",
      toolType: "todo",
      title: "Plan",
      status: "completed",
      preview: text,
      metadata: { codexItem: value },
    }),
  ];
};

const codexCommandExecutionStreamParts = (
  value: Record<string, unknown>,
  messageId: string,
  partId: string,
): AgentStreamPart[] => {
  const command = codexCommandText(value.command) ?? "command";
  const cwd = extractStringField(value, ["cwd"]);
  const firstAction = firstPlainObject(value.commandActions ?? value.command_actions);
  const tool = commandActionToolName(firstAction);
  const input = commandActionInput(firstAction, command, cwd);
  const output = codexToolResultText(value.aggregatedOutput ?? value.aggregated_output);
  const explicitError = stringifyJsonValue(value.error);
  const status = statusFromCodexStatus(value.status);
  const error = explicitError ?? (status === "error" ? output : null);
  const startedAtMs = extractOptionalFiniteNumberField(
    value,
    ["startedAtMs", "started_at_ms"],
    "startedAtMs",
  );
  const durationMs = extractOptionalFiniteNumberField(
    value,
    ["durationMs", "duration_ms"],
    "durationMs",
  );
  const endedAtMs =
    typeof startedAtMs === "number" && typeof durationMs === "number"
      ? startedAtMs + durationMs
      : null;

  return normalizedCodexToolPart({
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
  });
};

const codexFileChangeStreamParts = (
  value: Record<string, unknown>,
  messageId: string,
  partId: string,
): AgentStreamPart[] => {
  const changes = fileChangeEntries(value);
  const diff = fileChangeDiff(changes);
  const error = codexToolErrorFromObject(value);
  return normalizedCodexToolPart({
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
  });
};

const codexMcpToolCallStreamParts = (
  value: Record<string, unknown>,
  messageId: string,
  partId: string,
): AgentStreamPart[] => {
  const server = extractStringField(value, ["server"]);
  const tool = extractStringField(value, ["tool"]) ?? "mcp_tool";
  const args = extractOptionalObject(value, "arguments") ?? codexObjectInput(value.arguments);
  const error = codexToolErrorFromObject(value.result) ?? codexToolErrorFromObject(value);
  const output = codexToolResultText(value.result);
  return normalizedCodexToolPart({
    messageId,
    partId,
    callId: partId,
    rawToolName: codexNamespacedToolName(server, tool),
    status: error ? "error" : statusFromCodexStatus(value.status),
    ...(args ? { input: args } : {}),
    output: error ? null : output,
    error,
    metadata: { codexItem: value, ...(server ? { server } : {}) },
  });
};

const codexCollabAgentToolCallStreamParts = (
  value: Record<string, unknown>,
  messageId: string,
  partId: string,
): AgentStreamPart[] => {
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
      toolType: "generic",
      title: `Collab ${tool}`,
      status: statusFromCodexStatus(value.status),
      ...(prompt ? { input: { prompt } } : {}),
      ...(receivers.length > 0 ? { output: receivers.join("\n") } : {}),
      metadata: { codexItem: value },
    }),
  ];
};

const codexDynamicToolCallStreamParts = (
  value: Record<string, unknown>,
  messageId: string,
  partId: string,
): AgentStreamPart[] => {
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
  const resultPayload = value.contentItems ?? value.content_items ?? value.result;
  const output = codexToolResultText(resultPayload);
  const error = codexToolErrorFromObject(resultPayload) ?? codexToolErrorFromObject(value);
  const success = typeof value.success === "boolean" ? value.success : true;
  const failed = !success || error !== null;
  return normalizedCodexToolPart({
    messageId,
    partId,
    callId: partId,
    rawToolName: rawTool,
    status: failed ? "error" : statusFromCodexStatus(value.status),
    ...(input ? { input } : {}),
    output: failed ? null : (patch ?? output),
    error: error ?? (failed ? output : null),
    metadata: { codexItem: value },
  });
};

const codexWebSearchStreamParts = (
  value: Record<string, unknown>,
  messageId: string,
  partId: string,
): AgentStreamPart[] => {
  const input = webSearchInput(value);
  const output = stringifyJsonValue(
    value.output ?? value.result ?? value.results ?? value.contentItems ?? value.content_items,
  );
  return normalizedCodexToolPart({
    messageId,
    partId,
    callId: partId,
    rawToolName: "webSearch",
    status: "completed",
    ...(input ? { input } : {}),
    ...(output ? { output } : {}),
    ...(input ? { preview: Object.values(input).join(" ") } : {}),
    metadata: { codexItem: value },
  });
};

export const toStreamPart = (
  value: Record<string, unknown>,
  messageId: string,
  fallbackPartId: string,
): AgentStreamPart[] => {
  const partId = codexItemId(value, fallbackPartId);
  if (codexItemTypeMatches(value, "reasoning")) {
    return codexReasoningStreamParts(value, messageId, partId);
  }
  if (codexItemTypeMatches(value, "plan")) {
    return codexPlanStreamParts(value, messageId, partId);
  }
  if (codexItemTypeMatches(value, "commandExecution")) {
    return codexCommandExecutionStreamParts(value, messageId, partId);
  }
  if (codexItemTypeMatches(value, "fileChange")) {
    return codexFileChangeStreamParts(value, messageId, partId);
  }
  if (codexItemTypeMatches(value, "mcpToolCall")) {
    return codexMcpToolCallStreamParts(value, messageId, partId);
  }
  if (codexItemTypeMatches(value, "collabAgentToolCall")) {
    return codexCollabAgentToolCallStreamParts(value, messageId, partId);
  }
  if (codexItemTypeMatches(value, "dynamicToolCall")) {
    return codexDynamicToolCallStreamParts(value, messageId, partId);
  }
  if (codexItemTypeMatches(value, "webSearch")) {
    return codexWebSearchStreamParts(value, messageId, partId);
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
  if (part.kind === "skill_mention") {
    if (part.skill.name.trim().length === 0 || part.skill.path.trim().length === 0) {
      throw new Error("Codex skill references require a non-empty name and path.");
    }
    return { type: "skill", name: part.skill.name, path: part.skill.path };
  }
  if (part.kind === "attachment" && part.attachment.kind === "image") {
    return { type: "localImage", path: part.attachment.path };
  }

  throw new Error(`Codex app-server does not support '${part.kind}' user message parts.`);
};

export const toCodexUserInputList = (parts: AgentUserMessagePart[]): CodexUserInput[] => {
  return parts.map(toCodexUserInput);
};

export const toCodexTurnInputList = (parts: AgentUserMessagePart[]): CodexUserInput[] => {
  return parts.flatMap((part): CodexUserInput[] => {
    if (part.kind !== "skill_mention") {
      return [toCodexUserInput(part)];
    }
    const marker = `$${part.skill.name}`;
    return [
      {
        type: "text",
        text: marker,
        text_elements: [
          {
            byteRange: { start: 0, end: utf8ByteLength(marker) },
            placeholder: marker,
          },
        ],
      },
      toCodexUserInput(part),
    ];
  });
};

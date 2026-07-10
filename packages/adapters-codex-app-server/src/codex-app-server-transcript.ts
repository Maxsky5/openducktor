import type { AgentModelSelection, AgentStreamPart } from "@openducktor/core";
import {
  arrayFromUnknown,
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
  CodexFileDiffParseError,
  codexApplyPatchFileDiffs,
  codexFileChangeEntries,
  codexPatchInputFromToolPayload,
  fileDiffsPatchOutput,
  toFileDiffs,
} from "./codex-file-diffs";
import {
  codexDynamicToolDisplayPayload,
  codexDynamicToolErrorFromItem,
  codexFileChangeErrorFromItem,
  codexMcpToolErrorFromResult,
} from "./codex-tool-error-extractor";
import {
  codexNamespacedToolName,
  type NormalizedCodexToolInvocation,
  normalizeCodexToolInvocation,
  stableToolTitle,
  statusFromCodexStatus,
} from "./codex-tool-normalizer";
import {
  type CodexToolTimingOptions,
  codexItemTimestamp,
  codexToolTimingFields,
  safeCodexTimestampFromMilliseconds,
  withCodexItemCompletedAtMs,
} from "./codex-tool-timing";
import {
  codexUserInputListToText,
  codexUserInputsToDisplayParts,
} from "./codex-user-input-display";
import { codexUserInputsFromItem } from "./codex-user-inputs";
import { type CodexTodoUpdate, codexTodosFromThreadRead, todoMapper } from "./event-mappers";

export type CodexTokenUsageTotals = {
  totalTokens: number;
  contextWindow?: number;
};

export type CodexTurnTiming = {
  durationMs: number;
};

export type CodexThreadReadItem = {
  item: Record<string, unknown>;
  turnIndex: number;
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
export { type CodexTodoUpdate, codexTodosFromThreadRead };

export const timestampFromCodexParams = (params: unknown): string | null => {
  const millis = extractNumberField(params, [
    "occurredAtMs",
    "occurred_at_ms",
    "timestampMs",
    "timestamp_ms",
    "completedAtMs",
    "completed_at_ms",
    "startedAtMs",
    "started_at_ms",
  ]);
  return safeCodexTimestampFromMilliseconds(millis);
};

const codexTimestampFromSeconds = (seconds: number | null): string | undefined => {
  if (seconds === null || !Number.isFinite(seconds)) {
    return undefined;
  }

  const timestamp = new Date(seconds * 1000);
  return Number.isFinite(timestamp.getTime()) ? timestamp.toISOString() : undefined;
};

const codexTurnTimestampSeconds = (
  turn: Record<string, unknown>,
  keys: [string, string],
): number | null => {
  const [camelKey, snakeKey] = keys;
  const camelValue = turn[camelKey];
  if (typeof camelValue === "number") {
    return camelValue;
  }

  const snakeValue = turn[snakeKey];
  return typeof snakeValue === "number" ? snakeValue : null;
};

export const timestampFromCodexTurn = (turn: unknown, keys: [string, string]): string | null =>
  isPlainObject(turn)
    ? (codexTimestampFromSeconds(codexTurnTimestampSeconds(turn, keys)) ?? null)
    : null;

export const codexItemId = (item: Record<string, unknown>, fallbackId: string): string => {
  return extractStringField(item, ["id", "itemId", "item_id"]) ?? fallbackId;
};

const codexItemType = (item: Record<string, unknown>): string => {
  return extractStringField(item, ["type", "kind", "itemType"]) ?? "";
};

export const codexItemTypeMatches = (item: Record<string, unknown>, expected: string): boolean => {
  const normalize = (value: string) => value.replace(/[_-]/g, "").toLowerCase();
  return normalize(codexItemType(item)) === normalize(expected);
};

const codexAgentMessagePhase = (item: Record<string, unknown>): string | null => {
  return extractStringField(item, ["phase"]);
};

const isCodexFinalAnswerPhase = (phase: string | null): boolean => {
  return phase === "final_answer" || phase === "finalAnswer" || phase === "final-answer";
};

const isCodexCommentaryPhase = (phase: string | null): boolean => {
  return phase === "commentary";
};

const hasVisibleCodexAgentMessageText = (item: Record<string, unknown>): boolean => {
  return codexAgentMessageText(item).trim().length > 0;
};

const codexAgentMessageText = (item: Record<string, unknown>): string => {
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

const selectCodexFinalAgentMessage = (
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

export const codexTurnItemsFromThreadRead = (value: unknown): CodexThreadReadItem[] => {
  if (!isPlainObject(value) || !isPlainObject(value.thread)) {
    throw new Error("Codex thread/read response is missing thread data.");
  }
  if (!Array.isArray(value.thread.turns)) {
    throw new Error("Codex thread/read response is missing thread turns.");
  }
  const threadModelProvider = extractStringField(value.thread, ["modelProvider", "model_provider"]);
  return value.thread.turns.flatMap((turn, turnIndex): CodexThreadReadItem[] => {
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
      const timestamp =
        codexItemTimestamp(item) ?? codexTimestampFromSeconds(timestampSeconds) ?? null;
      return {
        item: withCodexItemCompletedAtMs(item),
        turnIndex,
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
  const parts = toStreamPart(withCodexItemCompletedAtMs(item), messageId, messageId);
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

const toHistoryParts = (
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

const firstPlainObject = (value: unknown): Record<string, unknown> | null => {
  return arrayFromUnknown(value).find(isPlainObject) ?? null;
};

const parseObjectString = (value: unknown): Record<string, unknown> | null => {
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

const commandActionToolName = (action: Record<string, unknown> | null): string => {
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

const commandActionInput = (
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

const codexCommandText = (value: unknown): string | null => {
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

const codexObjectInput = (value: unknown): Record<string, unknown> | undefined => {
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

const codexToolResultText = (value: unknown): string | null => {
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

const syntheticToolPart = ({
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
  timingOptions?: CodexToolTimingOptions,
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
  const timing = codexToolTimingFields(value, timingOptions);

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
    ...timing,
    metadata: { codexItem: value },
  });
};

const codexFileChangeStreamParts = (
  value: Record<string, unknown>,
  messageId: string,
  partId: string,
): AgentStreamPart[] => {
  const changes = codexFileChangeEntries(value);
  const fileDiffsResult = (() => {
    try {
      return { fileDiffs: toFileDiffs(changes), error: null };
    } catch (error) {
      if (error instanceof CodexFileDiffParseError) {
        return { fileDiffs: [], error: error.message };
      }
      throw error;
    }
  })();
  const diff = fileDiffsPatchOutput(fileDiffsResult.fileDiffs);
  const error = fileDiffsResult.error ?? codexFileChangeErrorFromItem(value);
  return normalizedCodexToolPart({
    messageId,
    partId,
    callId: partId,
    rawToolName: "apply_patch",
    title: "File changes",
    status: error ? "error" : statusFromCodexStatus(value.status),
    preview: `${changes.length} file change${changes.length === 1 ? "" : "s"}`,
    ...(fileDiffsResult.error ? {} : diff ? { input: { patch: diff }, output: diff } : {}),
    error,
    fileDiffs: fileDiffsResult.fileDiffs,
    metadata: { codexItem: value },
  });
};

const codexMcpToolCallStreamParts = (
  value: Record<string, unknown>,
  messageId: string,
  partId: string,
  timingOptions?: CodexToolTimingOptions,
): AgentStreamPart[] => {
  const server = extractStringField(value, ["server"]);
  const tool = extractStringField(value, ["tool"]) ?? "mcp_tool";
  const args = extractOptionalObject(value, "arguments") ?? codexObjectInput(value.arguments);
  const error = codexMcpToolErrorFromResult(value.result, value);
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
    ...codexToolTimingFields(value, timingOptions),
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
  const receivers = [
    ...arrayFromUnknown(value.receiverThreadIds ?? value.receiver_thread_ids).filter(
      (entry): entry is string => typeof entry === "string",
    ),
    extractStringField(value, ["receiverThreadId", "receiver_thread_id"]),
    extractStringField(value, ["newThreadId", "new_thread_id"]),
  ].filter((entry): entry is string => Boolean(entry));
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
  timingOptions?: CodexToolTimingOptions,
): AgentStreamPart[] => {
  const todoResult = todoMapper.fromThreadItemObject(value, {
    source: "thread_read",
    threadId: messageId,
  });
  if (todoResult.handled) {
    const timing = codexToolTimingFields(value, timingOptions);
    return projectCodexCanonicalEvents(todoResult.events).flatMap((event) =>
      event.type === "assistant_part"
        ? [event.part.kind === "tool" ? { ...event.part, ...timing } : event.part]
        : [],
    );
  }

  const namespace = extractStringField(value, ["namespace"]);
  const rawTool = codexNamespacedToolName(
    namespace,
    extractStringField(value, ["tool", "name"]) ?? "dynamic_tool",
  );
  const args = extractOptionalObject(value, "arguments") ?? codexObjectInput(value.arguments);
  const parsedInput = parseObjectString(value.input);
  const inputObject = args ?? parsedInput;
  const patch = isCodexApplyPatchTool(rawTool)
    ? codexPatchInputFromToolPayload(value, inputObject)
    : null;
  const input = patch ? { ...(inputObject ?? {}), patch } : (inputObject ?? undefined);
  const fileDiffs = patch ? codexApplyPatchFileDiffs(patch) : [];
  const patchOutput = fileDiffsPatchOutput(fileDiffs);
  const resultPayload = codexDynamicToolDisplayPayload(value);
  const output = codexToolResultText(resultPayload);
  const error = codexDynamicToolErrorFromItem(value);
  const success = typeof value.success === "boolean" ? value.success : true;
  const failed = !success || error !== null;
  return normalizedCodexToolPart({
    messageId,
    partId,
    callId: partId,
    rawToolName: rawTool,
    status: failed ? "error" : statusFromCodexStatus(value.status),
    ...(input ? { input } : {}),
    output: failed ? null : patch ? patchOutput : output,
    error: error ?? (failed ? output : null),
    fileDiffs,
    ...codexToolTimingFields(value, timingOptions),
    metadata: { codexItem: value },
  });
};

const codexWebSearchStreamParts = (
  value: Record<string, unknown>,
  messageId: string,
  partId: string,
  timingOptions?: CodexToolTimingOptions,
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
    ...codexToolTimingFields(value, timingOptions),
    metadata: { codexItem: value },
  });
};

export const toStreamPart = (
  value: Record<string, unknown>,
  messageId: string,
  fallbackPartId: string,
  timingOptions?: CodexToolTimingOptions,
): AgentStreamPart[] => {
  const partId = codexItemId(value, fallbackPartId);
  if (codexItemTypeMatches(value, "reasoning")) {
    return codexReasoningStreamParts(value, messageId, partId);
  }
  if (codexItemTypeMatches(value, "plan")) {
    return codexPlanStreamParts(value, messageId, partId);
  }
  if (codexItemTypeMatches(value, "commandExecution")) {
    return codexCommandExecutionStreamParts(value, messageId, partId, timingOptions);
  }
  if (codexItemTypeMatches(value, "fileChange")) {
    return codexFileChangeStreamParts(value, messageId, partId);
  }
  if (codexItemTypeMatches(value, "mcpToolCall")) {
    return codexMcpToolCallStreamParts(value, messageId, partId, timingOptions);
  }
  if (
    codexItemTypeMatches(value, "collabAgentToolCall") ||
    codexItemTypeMatches(value, "collabToolCall")
  ) {
    return codexCollabAgentToolCallStreamParts(value, messageId, partId);
  }
  if (codexItemTypeMatches(value, "dynamicToolCall")) {
    return codexDynamicToolCallStreamParts(value, messageId, partId, timingOptions);
  }
  if (codexItemTypeMatches(value, "webSearch")) {
    return codexWebSearchStreamParts(value, messageId, partId, timingOptions);
  }
  return [];
};

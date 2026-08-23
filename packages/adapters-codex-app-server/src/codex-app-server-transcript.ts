import type { AgentModelSelection, AgentStreamPart } from "@openducktor/core";
import {
  arrayFromUnknown,
  extractNumberField,
  extractStringField,
  isCodexApplyPatchTool,
  isCodexContextualUserMessage,
  isPlainObject,
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
} from "./codex-tool-timing";
import {
  codexUserInputListToText,
  codexUserInputsToDisplayParts,
} from "./codex-user-input-display";
import { codexUserInputsFromItem } from "./codex-user-inputs";
import { type CodexTodoUpdate, codexTodosFromThreadRead, todoMapper } from "./event-mappers";
import {
  jsonValueSchema,
  type CodexAppServerCommandAction,
  type CodexAppServerThreadItem,
  type CodexAppServerTurn,
  type CodexAppServerWebSearchAction,
  type CodexAppServerJsonValue,
  hasRuntimeType,
} from "@openducktor/contracts";
import type { CodexThreadHistoryReadResponse } from "./types";
import type { CodexTimedThreadItem } from "./codex-event-mapper";

type CodexAgentMessageItem = Extract<CodexTimedThreadItem, { type: "agentMessage" }>;
type CodexCommandExecutionItem = Extract<CodexTimedThreadItem, { type: "commandExecution" }>;
type CodexDynamicToolCallItem = Extract<CodexTimedThreadItem, { type: "dynamicToolCall" }>;
type CodexFileChangeItem = Extract<CodexTimedThreadItem, { type: "fileChange" }>;
type CodexMcpToolCallItem = Extract<CodexTimedThreadItem, { type: "mcpToolCall" }>;
type CodexCollabAgentToolCallItem = Extract<CodexTimedThreadItem, { type: "collabAgentToolCall" }>;
type CodexPlanItem = Extract<CodexTimedThreadItem, { type: "plan" }>;
type CodexReasoningItem = Extract<CodexTimedThreadItem, { type: "reasoning" }>;
type CodexWebSearchItem = Extract<CodexTimedThreadItem, { type: "webSearch" }>;

export type CodexTokenUsageTotals = {
  totalTokens: number;
  contextWindow?: number;
};

export type CodexTurnTiming = {
  durationMs: number;
};

export type CodexThreadReadItem = {
  item: CodexTimedThreadItem;
  turnIndex: number;
  turnId: string | null;
  timestamp: string | null;
  timestampIsApproximate?: true;
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

export const timestampFromCodexParams = (
  params: CodexAppServerJsonValue | undefined,
): string | null => {
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

export const timestampFromCodexTurn = (
  turn: Pick<CodexAppServerTurn, "completedAt" | "startedAt">,
  key: "completedAt" | "startedAt",
): string | null => codexTimestampFromSeconds(turn[key]) ?? null;

export const codexItemId = (item: CodexTimedThreadItem, _fallbackId: string): string => item.id;

export const codexItemTypeMatches = <Type extends CodexAppServerThreadItem["type"]>(
  item: CodexTimedThreadItem,
  expected: Type,
): item is Extract<CodexTimedThreadItem, { type: Type }> => item.type === expected;

const codexAgentMessagePhase = (item: CodexAgentMessageItem): CodexAgentMessageItem["phase"] =>
  item.phase;

const isCodexFinalAnswerPhase = (phase: CodexAgentMessageItem["phase"]): boolean =>
  phase === "final_answer";

const isCodexCommentaryPhase = (phase: CodexAgentMessageItem["phase"]): boolean =>
  phase === "commentary";

const hasVisibleCodexAgentMessageText = (item: CodexAgentMessageItem): boolean => {
  return codexAgentMessageText(item).trim().length > 0;
};

const codexAgentMessageText = (item: CodexAgentMessageItem): string => item.text;

const selectCodexFinalAgentMessage = (
  items: CodexTimedThreadItem[],
): CodexAgentMessageItem | null => {
  const visibleAgentMessages = items.filter(
    (item): item is CodexAgentMessageItem =>
      item.type === "agentMessage" && hasVisibleCodexAgentMessageText(item),
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
  current: CodexAgentMessageItem,
  next: CodexAgentMessageItem,
): boolean => {
  return selectCodexFinalAgentMessage([current, next]) === next;
};

export const codexTurnItemsFromThreadRead = (
  value: CodexThreadHistoryReadResponse | undefined,
): CodexThreadReadItem[] => {
  if (!value) {
    throw new Error("Codex thread/read response is missing thread data.");
  }
  return value.thread.turns.flatMap((turn, turnIndex): CodexThreadReadItem[] => {
    const items = turn.items;
    const turnId = turn.id;
    const isCompletedTurn = turn.status === "completed";
    const finalAgentMessageId = isCompletedTurn ? selectCodexFinalAgentMessage(items) : null;
    const startedAtSeconds = turn.startedAt;
    const completedAtSeconds = turn.completedAt;
    const durationMs =
      turn.durationMs ??
      (hasRuntimeType(startedAtSeconds, "number") && hasRuntimeType(completedAtSeconds, "number")
        ? Math.max(0, (completedAtSeconds - startedAtSeconds) * 1000)
        : null);
    return items.map((item) => {
      const itemIsFinalAgentMessage = finalAgentMessageId !== null && item === finalAgentMessageId;
      const itemTimestamp = codexItemTimestamp(item);
      let semanticTimestampSeconds: number | null;
      if (item.type === "userMessage") {
        semanticTimestampSeconds = startedAtSeconds;
      } else if (itemIsFinalAgentMessage) {
        semanticTimestampSeconds = completedAtSeconds;
      } else {
        semanticTimestampSeconds = null;
      }
      const fallbackTimestampSeconds = completedAtSeconds ?? startedAtSeconds;
      const timestamp =
        itemTimestamp ??
        codexTimestampFromSeconds(semanticTimestampSeconds ?? fallbackTimestampSeconds) ??
        null;
      const timestampIsApproximate = itemTimestamp === null && semanticTimestampSeconds === null;
      return {
        item,
        turnIndex,
        turnId,
        timestamp,
        ...(timestampIsApproximate ? { timestampIsApproximate: true as const } : undefined),
        isFinalAgentMessage: itemIsFinalAgentMessage,
        turnTiming:
          itemIsFinalAgentMessage && hasRuntimeType(durationMs, "number") && durationMs > 0
            ? { durationMs }
            : null,
      };
    });
  });
};

export const toHistoryMessage = (
  item: CodexTimedThreadItem | undefined,
  fallbackId: string,
  model?: AgentModelSelection,
  timestamp?: string,
  isFinalAgentMessage?: boolean,
  turnTiming?: CodexTurnTiming | null,
  tokenUsage?: CodexTokenUsageTotals | null,
): import("@openducktor/core").AgentSessionHistoryMessage | null => {
  if (!item) {
    return null;
  }
  const messageId = codexItemId(item, fallbackId);
  const messageTimestamp = timestamp ?? new Date().toISOString();
  if (item.type === "userMessage") {
    const input = codexUserInputsFromItem(item);
    const text = codexUserInputListToText(input);
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
      ...(model ? { model } : undefined),
    };
  }
  if (item.type === "agentMessage") {
    const text = codexAgentMessageText(item);
    return {
      messageId,
      role: "assistant",
      timestamp: messageTimestamp,
      text,
      ...(isFinalAgentMessage && turnTiming ? { durationMs: turnTiming.durationMs } : undefined),
      ...(isFinalAgentMessage && tokenUsage ? codexTokenUsageHistoryFields(tokenUsage) : undefined),
      parts: toHistoryParts(item, messageId, text, {
        ...(isFinalAgentMessage ? { isFinalAgentMessage } : undefined),
        ...(tokenUsage ? { tokenUsage } : undefined),
        includeTextFallback: false,
      }),
      ...(model ? { model } : undefined),
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
      ...(model ? { model } : undefined),
    };
  }
  return null;
};

export const codexTokenUsageHistoryFields = (
  tokenUsage: CodexTokenUsageTotals,
): CodexHistoryTokenUsageFields => ({
  totalTokens: tokenUsage.totalTokens,
  ...(hasRuntimeType(tokenUsage.contextWindow, "number")
    ? { contextWindow: tokenUsage.contextWindow }
    : undefined),
});

const toHistoryParts = (
  item: CodexTimedThreadItem,
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
  const parts = toStreamPart(item, messageId, item.id);
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
  ...(tokenUsage ? codexTokenUsageHistoryFields(tokenUsage) : undefined),
});

const firstPlainObject = (
  value: CodexAppServerJsonValue | undefined,
): Record<string, CodexAppServerJsonValue> | null => {
  return arrayFromUnknown(value).find(isPlainObject) ?? null;
};

const commandActionToolName = (action: CodexAppServerCommandAction | undefined): string => {
  if (!action) {
    return "bash";
  }
  if (action.type === "read") {
    return "read";
  }
  if (action.type === "listFiles") {
    return "list";
  }
  if (action.type === "search") {
    return "search";
  }
  return "bash";
};

const commandActionInput = (
  action: CodexAppServerCommandAction | undefined,
  command: string,
  cwd: string,
) => {
  if (!action) {
    return { command, cwd };
  }
  const path =
    action.type === "read" ? action.path : action.type !== "unknown" ? action.path : null;
  const query = action.type === "search" ? action.query : null;
  const name = action.type === "read" ? action.name : null;
  return {
    command: action.command,
    cwd,
    ...(path ? { path } : undefined),
    ...(query ? { query } : undefined),
    ...(name ? { name } : undefined),
  };
};

const codexObjectInput = (
  value: CodexAppServerJsonValue | undefined,
): Record<string, CodexAppServerJsonValue> | undefined => {
  if (isPlainObject(value)) {
    return value;
  }
  if (!hasRuntimeType(value, "string")) {
    return undefined;
  }
  try {
    const parsed = jsonValueSchema.safeParse(JSON.parse(value));
    return parsed.success && isPlainObject(parsed.data) ? parsed.data : undefined;
  } catch {
    return undefined;
  }
};

const codexToolResultText = (value: CodexAppServerJsonValue | undefined): string | null => {
  if (value === undefined || value === null) {
    return null;
  }
  if (hasRuntimeType(value, "string")) {
    return value;
  }
  const content = Array.isArray(value)
    ? value
    : isPlainObject(value)
      ? arrayFromUnknown(value.content)
      : [];
  const text = content
    .map((entry) => {
      if (hasRuntimeType(entry, "string")) {
        return entry;
      }
      if (!isPlainObject(entry)) {
        return "";
      }
      const entryType = extractStringField(entry, ["type"]);
      if (entryType === "inputImage" || entryType === "image") {
        return "";
      }
      return extractStringField(entry, ["text"]) ?? "";
    })
    .filter((entry) => entry.trim().length > 0)
    .join("\n");
  return text.length > 0 ? text : stringifyJsonValue(value);
};

const webSearchActionInput = (
  action: CodexAppServerWebSearchAction | null,
): Record<string, CodexAppServerJsonValue> | undefined => {
  if (!action) {
    return undefined;
  }

  if (action.type === "search") {
    const query = action.query ?? action.queries?.find((entry) => entry.trim().length > 0);
    return query ? { query } : undefined;
  }

  if (action.type === "openPage") {
    return action.url ? { url: action.url } : undefined;
  }

  if (action.type === "findInPage") {
    if (!action.url && !action.pattern) {
      return undefined;
    }
    return {
      ...(action.pattern ? { pattern: action.pattern } : undefined),
      ...(action.url ? { url: action.url } : undefined),
    };
  }

  return undefined;
};

const webSearchInput = (
  value: CodexWebSearchItem,
): Record<string, CodexAppServerJsonValue> | undefined => {
  if (value.query) {
    return { query: value.query };
  }
  return webSearchActionInput(value.action);
};

export const extractCodexTokenUsageTotals = (
  params: CodexAppServerJsonValue | undefined,
): CodexTokenUsageTotals | null => {
  if (!isPlainObject(params)) {
    return null;
  }

  const usage = codexTokenUsagePayload(params);
  if (!usage) {
    return null;
  }
  const last = firstPlainObject(
    [usage.last, usage.lastTokenUsage, usage.last_token_usage].filter(
      (value): value is CodexAppServerJsonValue => value !== undefined,
    ),
  );
  const totalTokens =
    extractNumberField(last, ["totalTokens", "total_tokens"]) ??
    extractNumberField(usage, ["totalTokens", "total_tokens"]);
  if (!hasRuntimeType(totalTokens, "number") || totalTokens <= 0) {
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
    ...(hasRuntimeType(contextWindow, "number") && contextWindow > 0
      ? { contextWindow }
      : undefined),
  };
};

const codexTokenUsagePayload = (
  params: Record<string, CodexAppServerJsonValue>,
): Record<string, CodexAppServerJsonValue> | null => {
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
  metadata: {
    ...(isPlainObject(metadata) ? metadata : undefined),
    syntheticCodexToolPart: true,
  },
});

const normalizedCodexToolPart = (input: NormalizedCodexToolInvocation): AgentStreamPart[] => {
  const part = normalizeCodexToolInvocation(input);
  return part ? [part] : [];
};

const codexReasoningStreamParts = (
  value: CodexReasoningItem,
  messageId: string,
  partId: string,
): AgentStreamPart[] => {
  const text = [...value.summary, ...value.content]
    .filter((entry) => entry.trim().length > 0)
    .join("\n");
  return text ? [{ kind: "reasoning", messageId, partId, text, completed: true }] : [];
};

const codexPlanStreamParts = (
  value: CodexPlanItem,
  messageId: string,
  partId: string,
): AgentStreamPart[] => {
  const text = value.text;
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
    }),
  ];
};

const codexCommandExecutionStreamParts = (
  value: CodexCommandExecutionItem,
  messageId: string,
  partId: string,
  timingOptions?: CodexToolTimingOptions,
): AgentStreamPart[] => {
  const command = value.command;
  const cwd = value.cwd;
  const firstAction = value.commandActions[0];
  const tool = commandActionToolName(firstAction);
  const input = commandActionInput(firstAction, command, cwd);
  const output = value.aggregatedOutput;
  const status = statusFromCodexStatus(value.status);
  const error = status === "error" ? output : null;
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
  });
};

const codexFileChangeStreamParts = (
  value: CodexFileChangeItem,
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
    ...(!fileDiffsResult.error && diff ? { input: { patch: diff }, output: diff } : undefined),
    error,
    fileDiffs: fileDiffsResult.fileDiffs,
  });
};

const codexMcpToolCallStreamParts = (
  value: CodexMcpToolCallItem,
  messageId: string,
  partId: string,
  timingOptions?: CodexToolTimingOptions,
): AgentStreamPart[] => {
  const server = value.server;
  const tool = value.tool;
  const args = codexObjectInput(value.arguments);
  const error = codexMcpToolErrorFromResult(value);
  const output = codexToolResultText(value.result);
  return normalizedCodexToolPart({
    messageId,
    partId,
    callId: partId,
    rawToolName: codexNamespacedToolName(server, tool),
    status: error ? "error" : statusFromCodexStatus(value.status),
    ...(args ? { input: args } : undefined),
    output: error ? null : output,
    error,
    ...codexToolTimingFields(value, timingOptions),
    metadata: {
      server,
    },
  });
};

const codexCollabAgentToolCallStreamParts = (
  value: CodexCollabAgentToolCallItem,
  messageId: string,
  partId: string,
): AgentStreamPart[] => {
  const tool = value.tool;
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
      ...(value.prompt ? { input: { prompt: value.prompt } } : undefined),
      ...(value.receiverThreadIds.length > 0
        ? { output: value.receiverThreadIds.join("\n") }
        : undefined),
    }),
  ];
};

const codexDynamicToolCallStreamParts = (
  value: CodexDynamicToolCallItem,
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

  const namespace = value.namespace;
  const rawTool = codexNamespacedToolName(namespace, value.tool);
  const inputObject = codexObjectInput(value.arguments);
  const patch = isCodexApplyPatchTool(rawTool) ? codexPatchInputFromToolPayload(inputObject) : null;
  const input = patch ? { ...inputObject, patch } : (inputObject ?? undefined);
  const fileDiffs = patch ? codexApplyPatchFileDiffs(patch) : [];
  const patchOutput = fileDiffsPatchOutput(fileDiffs);
  const resultPayload = codexDynamicToolDisplayPayload(value);
  const output = codexToolResultText(resultPayload);
  const error = codexDynamicToolErrorFromItem(value);
  const failed = value.success === false || error !== null || value.status === "failed";
  return normalizedCodexToolPart({
    messageId,
    partId,
    callId: partId,
    rawToolName: rawTool,
    status: failed ? "error" : statusFromCodexStatus(value.status),
    ...(input ? { input } : undefined),
    output: failed ? null : patch ? patchOutput : output,
    error: error ?? (failed ? output : null),
    fileDiffs,
    ...codexToolTimingFields(value, timingOptions),
  });
};

const codexWebSearchStreamParts = (
  value: CodexWebSearchItem,
  messageId: string,
  partId: string,
  timingOptions?: CodexToolTimingOptions,
): AgentStreamPart[] => {
  const input = webSearchInput(value);
  const output = stringifyJsonValue(value.results);
  return normalizedCodexToolPart({
    messageId,
    partId,
    callId: partId,
    rawToolName: "webSearch",
    status: "completed",
    ...(input ? { input } : undefined),
    ...(output ? { output } : undefined),
    ...(input ? { preview: Object.values(input).join(" ") } : undefined),
    ...codexToolTimingFields(value, timingOptions),
  });
};

export const toStreamPart = (
  value: CodexTimedThreadItem,
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
  if (codexItemTypeMatches(value, "collabAgentToolCall")) {
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

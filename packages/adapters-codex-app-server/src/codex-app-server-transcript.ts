import type { AgentModelSelection, AgentStreamPart } from "@openducktor/core";
import {
  arrayFromCodexJsonValue,
  extractStringField,
  isCodexApplyPatchTool,
  isCodexContextualUserMessage,
  parseCodexJsonObjectString,
  isPlainObject,
  readCodexString,
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
} from "./codex-tool-timing";
import {
  codexUserInputListToText,
  codexUserInputsToDisplayParts,
} from "./codex-user-input-display";
import { codexUserInputsFromItem } from "./codex-user-inputs";
import { type CodexTodoUpdate, codexTodosFromThreadRead, todoMapper } from "./event-mappers";
import {
  type CodexAppServerCommandAction,
  type CodexAppServerThreadItem,
  type CodexAppServerTurn,
  type CodexAppServerWebSearchAction,
  type CodexAppServerJsonValue,
} from "@openducktor/contracts";
import type { CodexNotificationRecord, CodexThreadHistoryReadResponse } from "./types";
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

type CodexTokenUsageUpdatedParams = Extract<
  CodexNotificationRecord,
  { method: "thread/tokenUsage/updated" }
>["params"];

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

type CodexCommandActionInput = {
  command: string;
  cwd: string;
  path?: string;
  query?: string;
  name?: string;
};

type CodexWebSearchFindInPageInput = {
  pattern?: string;
  url?: string;
};

export type { AgentToolStatus } from "./codex-tool-normalizer";
export { type CodexTodoUpdate, codexTodosFromThreadRead };

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
      (startedAtSeconds !== null && completedAtSeconds !== null
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
      const threadReadItem: CodexThreadReadItem = {
        item,
        turnIndex,
        turnId,
        timestamp,
        isFinalAgentMessage: itemIsFinalAgentMessage,
        turnTiming:
          itemIsFinalAgentMessage && durationMs !== null && durationMs > 0 ? { durationMs } : null,
      };

      if (timestampIsApproximate) {
        threadReadItem.timestampIsApproximate = true;
      }

      return threadReadItem;
    });
  });
};

export const toHistoryMessage = (
  item: CodexTimedThreadItem | undefined,
  model?: AgentModelSelection,
  timestamp?: string,
  isFinalAgentMessage?: boolean,
  turnTiming?: CodexTurnTiming | null,
  tokenUsage?: CodexTokenUsageTotals | null,
): import("@openducktor/core").AgentSessionHistoryMessage | null => {
  if (!item) {
    return null;
  }
  const messageId = item.id;
  const messageTimestamp = timestamp ?? new Date().toISOString();
  if (item.type === "userMessage") {
    const input = codexUserInputsFromItem(item);
    const text = codexUserInputListToText(input);
    if (isCodexContextualUserMessage(item)) {
      return null;
    }
    const historyMessage: import("@openducktor/core").AgentSessionHistoryMessage = {
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
    };

    if (model) {
      historyMessage.model = model;
    }

    return historyMessage;
  }
  if (item.type === "agentMessage") {
    const text = codexAgentMessageText(item);
    const partsOptions: Parameters<typeof toHistoryParts>[3] = {
      includeTextFallback: false,
    };
    if (isFinalAgentMessage) {
      partsOptions.isFinalAgentMessage = true;
    }
    if (tokenUsage) {
      partsOptions.tokenUsage = tokenUsage;
    }
    const historyMessage: import("@openducktor/core").AgentSessionHistoryMessage = {
      messageId,
      role: "assistant",
      timestamp: messageTimestamp,
      text,
      parts: toHistoryParts(item, messageId, text, partsOptions),
    };

    if (isFinalAgentMessage && turnTiming) {
      historyMessage.durationMs = turnTiming.durationMs;
    }
    if (isFinalAgentMessage && tokenUsage) {
      const tokenUsageFields = codexTokenUsageHistoryFields(tokenUsage);
      historyMessage.totalTokens = tokenUsageFields.totalTokens;
      if (tokenUsageFields.contextWindow !== undefined) {
        historyMessage.contextWindow = tokenUsageFields.contextWindow;
      }
    }
    if (model) {
      historyMessage.model = model;
    }

    return historyMessage;
  }
  const parts = toStreamPart(item, messageId);
  if (parts.length > 0) {
    const historyMessage: import("@openducktor/core").AgentSessionHistoryMessage = {
      messageId,
      role: "assistant",
      timestamp: messageTimestamp,
      text: "",
      parts,
    };

    if (model) {
      historyMessage.model = model;
    }

    return historyMessage;
  }
  return null;
};

export const codexTokenUsageHistoryFields = (
  tokenUsage: CodexTokenUsageTotals,
): CodexHistoryTokenUsageFields => {
  const historyFields: CodexHistoryTokenUsageFields = {
    totalTokens: tokenUsage.totalTokens,
  };

  if (tokenUsage.contextWindow !== undefined) {
    historyFields.contextWindow = tokenUsage.contextWindow;
  }

  return historyFields;
};

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
  const parts = toStreamPart(item, messageId);
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
): import("@openducktor/core").AgentStreamPart => {
  const part: import("@openducktor/core").AgentStreamPart = {
    kind: "step",
    messageId,
    partId: `${messageId}-finish`,
    phase: "finish",
    reason: "stop",
  };

  if (tokenUsage) {
    const tokenUsageFields = codexTokenUsageHistoryFields(tokenUsage);
    part.totalTokens = tokenUsageFields.totalTokens;
    if (tokenUsageFields.contextWindow !== undefined) {
      part.contextWindow = tokenUsageFields.contextWindow;
    }
  }

  return part;
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
  const input: CodexCommandActionInput = {
    command: action.command,
    cwd,
  };

  if (path) {
    input.path = path;
  }
  if (query) {
    input.query = query;
  }
  if (name) {
    input.name = name;
  }

  return input;
};

const codexObjectInput = (
  value: CodexAppServerJsonValue | undefined,
): Record<string, CodexAppServerJsonValue> | undefined => {
  return isPlainObject(value) ? value : (parseCodexJsonObjectString(value) ?? undefined);
};

const codexToolResultText = (value: CodexAppServerJsonValue | undefined): string | null => {
  if (value === undefined || value === null) {
    return null;
  }
  const textValue = readCodexString(value);
  if (textValue !== null) {
    return textValue;
  }
  const content = Array.isArray(value)
    ? value
    : isPlainObject(value)
      ? arrayFromCodexJsonValue(value.content)
      : [];
  const text = content
    .map((entry) => {
      const entryText = readCodexString(entry);
      if (entryText !== null) {
        return entryText;
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

const webSearchActionInput = (action: CodexAppServerWebSearchAction | null) => {
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
    const input: CodexWebSearchFindInPageInput = {};
    if (action.pattern) {
      input.pattern = action.pattern;
    }
    if (action.url) {
      input.url = action.url;
    }
    return input;
  }

  return undefined;
};

const webSearchInput = (value: CodexWebSearchItem) => {
  if (value.query) {
    return { query: value.query };
  }
  return webSearchActionInput(value.action);
};

export const extractCodexTokenUsageTotals = (
  params: CodexTokenUsageUpdatedParams,
): CodexTokenUsageTotals | null => {
  const { totalTokens } = params.tokenUsage.last;
  if (!Number.isFinite(totalTokens) || totalTokens < 0) {
    return null;
  }
  const contextWindow = params.tokenUsage.modelContextWindow;
  if (contextWindow != null && (!Number.isFinite(contextWindow) || contextWindow <= 0)) {
    return null;
  }
  const tokenUsage: CodexTokenUsageTotals = {
    totalTokens,
  };
  if (contextWindow != null) {
    tokenUsage.contextWindow = contextWindow;
  }
  return tokenUsage;
};

const syntheticToolPart = ({
  metadata,
  ...part
}: Extract<AgentStreamPart, { kind: "tool" }>): Extract<AgentStreamPart, { kind: "tool" }> => {
  const syntheticPart: Extract<AgentStreamPart, { kind: "tool" }> = {
    ...part,
    metadata: {
      syntheticCodexToolPart: true,
    },
  };

  if (isPlainObject(metadata)) {
    syntheticPart.metadata = {
      ...metadata,
      syntheticCodexToolPart: true,
    };
  }

  return syntheticPart;
};

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
  const toolInvocation: NormalizedCodexToolInvocation = {
    messageId,
    partId,
    callId: partId,
    rawToolName: "apply_patch",
    title: "File changes",
    status: error ? "error" : statusFromCodexStatus(value.status),
    preview: `${changes.length} file change${changes.length === 1 ? "" : "s"}`,
    error,
    fileDiffs: fileDiffsResult.fileDiffs,
  };

  if (!fileDiffsResult.error && diff) {
    toolInvocation.input = { patch: diff };
    toolInvocation.output = diff;
  }

  return normalizedCodexToolPart(toolInvocation);
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
  const toolInvocation: NormalizedCodexToolInvocation = {
    messageId,
    partId,
    callId: partId,
    rawToolName: codexNamespacedToolName(server, tool),
    status: error ? "error" : statusFromCodexStatus(value.status),
    output: error ? null : output,
    error,
    ...codexToolTimingFields(value, timingOptions),
    metadata: {
      server,
    },
  };

  if (args) {
    toolInvocation.input = args;
  }

  return normalizedCodexToolPart(toolInvocation);
};

const codexCollabAgentToolCallStreamParts = (
  value: CodexCollabAgentToolCallItem,
  messageId: string,
  partId: string,
): AgentStreamPart[] => {
  const tool = value.tool;
  const part: Extract<AgentStreamPart, { kind: "tool" }> = {
    kind: "tool",
    messageId,
    partId,
    callId: partId,
    tool: `collab.${tool}`,
    toolType: "generic",
    title: `Collab ${tool}`,
    status: statusFromCodexStatus(value.status),
  };

  if (value.prompt) {
    part.input = { prompt: value.prompt };
  }
  if (value.receiverThreadIds.length > 0) {
    part.output = value.receiverThreadIds.join("\n");
  }

  return [syntheticToolPart(part)];
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
  const toolInvocation: NormalizedCodexToolInvocation = {
    messageId,
    partId,
    callId: partId,
    rawToolName: rawTool,
    status: failed ? "error" : statusFromCodexStatus(value.status),
    output: failed ? null : patch ? patchOutput : output,
    error: error ?? (failed ? output : null),
    fileDiffs,
    ...codexToolTimingFields(value, timingOptions),
  };

  if (input) {
    toolInvocation.input = input;
  }

  return normalizedCodexToolPart(toolInvocation);
};

const codexWebSearchStreamParts = (
  value: CodexWebSearchItem,
  messageId: string,
  partId: string,
  timingOptions?: CodexToolTimingOptions,
): AgentStreamPart[] => {
  const input = webSearchInput(value);
  const output = stringifyJsonValue(value.results);
  const toolInvocation: NormalizedCodexToolInvocation = {
    messageId,
    partId,
    callId: partId,
    rawToolName: "webSearch",
    status: "completed",
    ...codexToolTimingFields(value, timingOptions),
  };

  if (input) {
    toolInvocation.input = input;
    toolInvocation.preview = Object.values(input).join(" ");
  }
  if (output) {
    toolInvocation.output = output;
  }

  return normalizedCodexToolPart(toolInvocation);
};

export const toStreamPart = (
  value: CodexTimedThreadItem,
  messageId: string,
  timingOptions?: CodexToolTimingOptions,
): AgentStreamPart[] => {
  const partId = value.id;
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

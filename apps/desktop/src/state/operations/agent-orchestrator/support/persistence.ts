import type { AgentSessionRecord } from "@openducktor/contracts";
import type {
  AgentModelSelection,
  AgentRole,
  AgentScenario,
  AgentSessionHistoryMessage,
} from "@openducktor/core";
import { DEFAULT_RUNTIME_KIND } from "@/lib/agent-runtime";
import type { AgentChatMessage, AgentSessionState } from "@/types/agent-orchestrator";
import { formatToolContent } from "../agent-tool-messages";
import { mergeModelSelection, normalizePersistedSelection } from "./models";
import { normalizeToolInput, normalizeToolText } from "./tool-messages";

type HistoryPart = AgentSessionHistoryMessage["parts"][number];

const normalizePersistedPendingPermissions = (
  permissions: AgentSessionRecord["pendingPermissions"],
): AgentSessionState["pendingPermissions"] =>
  (permissions ?? []).map((entry) => ({
    requestId: entry.requestId,
    permission: entry.permission,
    patterns: [...entry.patterns],
    ...(entry.metadata ? { metadata: entry.metadata } : {}),
  }));

const normalizePersistedPendingQuestions = (
  questions: AgentSessionRecord["pendingQuestions"],
): AgentSessionState["pendingQuestions"] =>
  (questions ?? []).map((entry) => ({
    requestId: entry.requestId,
    questions: entry.questions.map((question) => ({
      header: question.header,
      question: question.question,
      options: question.options.map((option) => ({
        label: option.label,
        description: option.description,
      })),
      ...(typeof question.multiple === "boolean" ? { multiple: question.multiple } : {}),
      ...(typeof question.custom === "boolean" ? { custom: question.custom } : {}),
    })),
  }));

const asRecord = (value: unknown): Record<string, unknown> | null => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
};

const parseJsonRecord = (value: string | undefined): Record<string, unknown> | null => {
  if (!value) {
    return null;
  }
  const trimmed = value.trim();
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) {
    return null;
  }
  try {
    return asRecord(JSON.parse(trimmed));
  } catch {
    return null;
  }
};

const readString = (source: Record<string, unknown> | null, keys: string[]): string | null => {
  if (!source) {
    return null;
  }
  for (const key of keys) {
    const value = source[key];
    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim();
    }
  }
  return null;
};

const readBoolean = (source: Record<string, unknown> | null, keys: string[]): boolean | null => {
  if (!source) {
    return null;
  }
  for (const key of keys) {
    const value = source[key];
    if (typeof value === "boolean") {
      return value;
    }
  }
  return null;
};

const normalizeRecoveredQuestions = (
  rawQuestions: unknown,
): AgentSessionState["pendingQuestions"][number]["questions"] => {
  if (!Array.isArray(rawQuestions)) {
    return [];
  }

  return rawQuestions.flatMap((entry) => {
    const question = asRecord(entry);
    if (!question) {
      return [];
    }
    const prompt = readString(question, ["question", "prompt", "header", "title", "label", "name"]);
    if (!prompt) {
      return [];
    }
    const header = readString(question, ["header", "title", "label", "name"]) ?? prompt;
    const rawOptions = Array.isArray(question.options) ? question.options : [];
    const options = rawOptions.flatMap((optionEntry) => {
      const option = asRecord(optionEntry);
      const label = readString(option, ["label"]);
      if (!label) {
        return [];
      }
      const description = readString(option, ["description"]) ?? label;
      return [{ label, description }];
    });

    const multiple = readBoolean(question, ["multiple"]);
    const custom = readBoolean(question, ["custom"]);

    return [
      {
        header,
        question: prompt,
        options,
        ...(typeof multiple === "boolean" ? { multiple } : {}),
        ...(typeof custom === "boolean" ? { custom } : {}),
      },
    ];
  });
};

const isQuestionTool = (toolName: string): boolean => {
  const normalized = toolName.trim().toLowerCase();
  return (
    normalized === "question" || normalized.endsWith("_question") || normalized.includes("question")
  );
};

const readPendingQuestionRequest = (
  part: Extract<HistoryPart, { kind: "tool" }>,
): AgentSessionState["pendingQuestions"][number] | null => {
  if (!isQuestionTool(part.tool)) {
    return null;
  }

  const metadata = asRecord(part.metadata);
  const input = asRecord(part.input);
  const output = parseJsonRecord(part.output);
  const requestId =
    readString(metadata, ["requestId", "requestID", "questionRequestId", "id"]) ??
    readString(input, ["requestId", "requestID", "questionRequestId", "id"]) ??
    readString(output, ["requestId", "requestID", "questionRequestId", "id"]) ??
    part.callId ??
    part.partId;

  const questions = normalizeRecoveredQuestions(
    metadata?.questions ?? input?.questions ?? output?.questions,
  );
  if (questions.length === 0) {
    return null;
  }

  return {
    requestId,
    questions,
  };
};

export const recoverPendingQuestionsFromHistory = (
  history: AgentSessionHistoryMessage[],
): AgentSessionState["pendingQuestions"] => {
  const pendingQueue: AgentSessionState["pendingQuestions"] = [];

  for (const message of history) {
    for (const part of message.parts) {
      if (part.kind !== "tool") {
        continue;
      }
      const request = readPendingQuestionRequest(part);
      if (!request) {
        continue;
      }

      const existingIndex = pendingQueue.findIndex(
        (entry) => entry.requestId === request.requestId,
      );
      if (existingIndex >= 0) {
        pendingQueue.splice(existingIndex, 1);
      }
      pendingQueue.push(request);
    }

    if (isSyntheticHistoryUserMessage(message) && pendingQueue.length > 0) {
      pendingQueue.shift();
    }
  }

  return pendingQueue;
};

export const toPersistedSessionRecord = (session: AgentSessionState): AgentSessionRecord => ({
  sessionId: session.sessionId,
  externalSessionId: session.externalSessionId,
  taskId: session.taskId,
  role: session.role,
  scenario: session.scenario,
  status: session.status,
  startedAt: session.startedAt,
  runtimeKind: session.runtimeKind ?? session.selectedModel?.runtimeKind ?? DEFAULT_RUNTIME_KIND,
  workingDirectory: session.workingDirectory,
  pendingPermissions: session.pendingPermissions,
  pendingQuestions: session.pendingQuestions,
  selectedModel: session.selectedModel
    ? {
        runtimeKind:
          session.selectedModel.runtimeKind ?? session.runtimeKind ?? DEFAULT_RUNTIME_KIND,
        providerId: session.selectedModel.providerId,
        modelId: session.selectedModel.modelId,
        ...(session.selectedModel.variant ? { variant: session.selectedModel.variant } : {}),
        ...(session.selectedModel.profileId ? { profileId: session.selectedModel.profileId } : {}),
      }
    : undefined,
});

export const defaultScenarioForRole = (role: AgentRole): AgentScenario => {
  if (role === "spec") {
    return "spec_initial";
  }
  if (role === "planner") {
    return "planner_initial";
  }
  if (role === "qa") {
    return "qa_review";
  }
  return "build_implementation_start";
};

export const fromPersistedSessionRecord = (
  session: AgentSessionRecord,
  fallbackTaskId: string,
): AgentSessionState => {
  const persistedStatus = session.status ?? "stopped";
  const normalizedStatus =
    persistedStatus === "starting" || persistedStatus === "running" ? "stopped" : persistedStatus;
  return {
    sessionId: session.sessionId,
    externalSessionId: session.externalSessionId ?? session.sessionId,
    taskId: session.taskId ?? fallbackTaskId,
    role: session.role,
    scenario: session.scenario ?? defaultScenarioForRole(session.role),
    status: normalizedStatus,
    startedAt: session.startedAt,
    runtimeKind: session.runtimeKind ?? session.selectedModel?.runtimeKind ?? DEFAULT_RUNTIME_KIND,
    runtimeId: null,
    runId: null,
    runtimeEndpoint: "",
    workingDirectory: session.workingDirectory,
    messages: [],
    draftAssistantText: "",
    draftAssistantMessageId: null,
    draftReasoningText: "",
    draftReasoningMessageId: null,
    contextUsage: null,
    pendingPermissions: normalizePersistedPendingPermissions(session.pendingPermissions),
    pendingQuestions: normalizePersistedPendingQuestions(session.pendingQuestions),
    todos: [],
    modelCatalog: null,
    selectedModel: normalizePersistedSelection(session.selectedModel),
    isLoadingModelCatalog: true,
  };
};

const assistantDurationFromHistory = (
  message: AgentSessionHistoryMessage,
  previousUserTimestampMs: number | null,
): number | undefined => {
  if (message.role !== "assistant") {
    return undefined;
  }

  let startedAtMs: number | null = null;
  let endedAtMs: number | null = null;
  for (const part of message.parts) {
    if (part.kind !== "tool") {
      continue;
    }
    if (typeof part.startedAtMs === "number") {
      startedAtMs =
        startedAtMs === null ? part.startedAtMs : Math.min(startedAtMs, part.startedAtMs);
    }
    if (typeof part.endedAtMs === "number") {
      endedAtMs = endedAtMs === null ? part.endedAtMs : Math.max(endedAtMs, part.endedAtMs);
    }
  }

  if (startedAtMs !== null && endedAtMs !== null && endedAtMs >= startedAtMs) {
    return endedAtMs - startedAtMs;
  }

  const assistantTimestampMs = Date.parse(message.timestamp);
  if (previousUserTimestampMs !== null && !Number.isNaN(assistantTimestampMs)) {
    if (assistantTimestampMs >= previousUserTimestampMs) {
      return assistantTimestampMs - previousUserTimestampMs;
    }
  }

  return undefined;
};

const isSyntheticHistoryUserMessage = (message: AgentSessionHistoryMessage): boolean => {
  if (message.role !== "user") {
    return false;
  }

  let hasTextPart = false;
  for (const part of message.parts) {
    if (part.kind !== "text") {
      continue;
    }
    hasTextPart = true;
    if (!part.synthetic) {
      return false;
    }
  }

  return hasTextPart;
};

const assistantMessageMeta = (
  role: AgentRole,
  selectedModel: AgentModelSelection | null,
  messageModel: AgentModelSelection | undefined,
  isFinal: boolean,
  durationMs: number | undefined,
  totalTokens: number | undefined,
) => {
  const effectiveModel = mergeModelSelection(selectedModel, messageModel);
  return {
    kind: "assistant",
    agentRole: role,
    isFinal,
    ...(effectiveModel?.providerId ? { providerId: effectiveModel.providerId } : {}),
    ...(effectiveModel?.modelId ? { modelId: effectiveModel.modelId } : {}),
    ...(effectiveModel?.variant ? { variant: effectiveModel.variant } : {}),
    ...(effectiveModel?.profileId ? { profileId: effectiveModel.profileId } : {}),
    ...(isFinal && typeof durationMs === "number" && durationMs > 0 ? { durationMs } : {}),
    ...(isFinal && typeof totalTokens === "number" && totalTokens > 0 ? { totalTokens } : {}),
  } satisfies Extract<NonNullable<AgentChatMessage["meta"]>, { kind: "assistant" }>;
};

const isFinalAssistantHistoryMessage = (message: AgentSessionHistoryMessage): boolean => {
  if (message.role !== "assistant") {
    return false;
  }

  return message.parts.some(
    (part) => part.kind === "step" && part.phase === "finish" && part.reason === "stop",
  );
};

const userMessageMeta = (messageModel: AgentModelSelection | undefined) => {
  const effectiveModel = mergeModelSelection(null, messageModel);
  if (!effectiveModel) {
    return undefined;
  }

  return {
    kind: "user",
    ...(effectiveModel.providerId ? { providerId: effectiveModel.providerId } : {}),
    ...(effectiveModel.modelId ? { modelId: effectiveModel.modelId } : {}),
    ...(effectiveModel.variant ? { variant: effectiveModel.variant } : {}),
    ...(effectiveModel.profileId ? { profileId: effectiveModel.profileId } : {}),
  } satisfies Extract<NonNullable<AgentChatMessage["meta"]>, { kind: "user" }>;
};

const historyPartToChatMessage = (
  message: AgentSessionHistoryMessage,
  part: HistoryPart,
): AgentChatMessage | null => {
  switch (part.kind) {
    case "reasoning": {
      if (part.text.trim().length === 0) {
        return null;
      }
      return {
        id: `history:thinking:${message.messageId}:${part.partId}`,
        role: "thinking",
        content: part.text,
        timestamp: message.timestamp,
        meta: {
          kind: "reasoning",
          partId: part.partId,
          completed: part.completed,
        },
      };
    }
    case "tool": {
      const input = normalizeToolInput(part.input);
      const output = normalizeToolText(part.output);
      const error = normalizeToolText(part.error);
      return {
        id: `history:tool:${message.messageId}:${part.partId}`,
        role: "tool",
        content: formatToolContent(part),
        timestamp: message.timestamp,
        meta: {
          kind: "tool",
          partId: part.partId,
          callId: part.callId,
          tool: part.tool,
          status: part.status,
          ...(part.preview ? { preview: part.preview } : {}),
          ...(part.title ? { title: part.title } : {}),
          ...(input ? { input } : {}),
          ...(output ? { output } : {}),
          ...(error ? { error } : {}),
          ...(part.metadata ? { metadata: part.metadata } : {}),
          ...(typeof part.startedAtMs === "number" ? { startedAtMs: part.startedAtMs } : {}),
          ...(typeof part.endedAtMs === "number" ? { endedAtMs: part.endedAtMs } : {}),
        },
      };
    }
    case "subtask": {
      return {
        id: `history:subtask:${message.messageId}:${part.partId}`,
        role: "system",
        content: `Subtask (${part.agent}): ${part.description}`,
        timestamp: message.timestamp,
        meta: {
          kind: "subtask",
          partId: part.partId,
          agent: part.agent,
          prompt: part.prompt,
          description: part.description,
        },
      };
    }
    case "step":
    case "text":
      return null;
  }
};

export const historyToChatMessages = (
  history: AgentSessionHistoryMessage[],
  sessionContext: {
    role: AgentRole;
    selectedModel: AgentModelSelection | null;
  },
): AgentChatMessage[] => {
  const next: AgentChatMessage[] = [];
  let previousUserTimestampMs: number | null = null;

  for (const message of history) {
    for (const part of message.parts) {
      const partMessage = historyPartToChatMessage(message, part);
      if (partMessage) {
        next.push(partMessage);
      }
    }

    const content = message.text.trim();
    if (content.length > 0) {
      const isFinalAssistantMessage = isFinalAssistantHistoryMessage(message);
      const assistantDurationMs = assistantDurationFromHistory(message, previousUserTimestampMs);
      next.push({
        id: `history:text:${message.messageId}`,
        role: message.role,
        content,
        timestamp: message.timestamp,
        ...(message.role === "assistant"
          ? {
              meta: assistantMessageMeta(
                sessionContext.role,
                sessionContext.selectedModel,
                message.model,
                isFinalAssistantMessage,
                isFinalAssistantMessage ? assistantDurationMs : undefined,
                isFinalAssistantMessage ? message.totalTokens : undefined,
              ),
            }
          : message.role === "user"
            ? (() => {
                const meta = userMessageMeta(message.model);
                return meta ? { meta } : {};
              })()
            : {}),
      });
    }

    if (message.role === "user" && !isSyntheticHistoryUserMessage(message)) {
      const parsed = Date.parse(message.timestamp);
      previousUserTimestampMs = Number.isNaN(parsed) ? previousUserTimestampMs : parsed;
    }
  }

  return next;
};

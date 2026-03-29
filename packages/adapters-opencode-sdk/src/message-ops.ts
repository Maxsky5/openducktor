import {
  type AgentPendingPermissionRequest,
  type AgentPendingQuestionRequest,
  type AgentSessionHistoryMessage,
  type AgentSessionTodoItem,
  type AgentStreamPart,
  type ReplyPermissionInput,
  type ReplyQuestionInput,
  type SendAgentUserMessageInput,
  serializeAgentUserMessagePartsToText,
} from "@openducktor/core";
import { unwrapData } from "./data-utils";
import { setSessionActive } from "./event-stream/shared";
import {
  extractMessageTotalTokens,
  readMessageModelSelection,
  readTextFromMessageInfo,
  readTextFromParts,
  sanitizeAssistantMessage,
} from "./message-normalizers";
import { normalizeModelInput } from "./payload-mappers";
import { toOpenCodeRequestError } from "./request-errors";
import { toIsoFromEpoch } from "./session-runtime-utils";
import { mapPartToAgentStreamPart } from "./stream-part-mapper";
import { normalizeTodoList } from "./todo-normalizers";
import type { ClientFactory, SessionRecord } from "./types";

const asRecord = (value: unknown): Record<string, unknown> | null => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
};

const readString = (record: Record<string, unknown>, keys: string[]): string | undefined => {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim().length > 0) {
      return value;
    }
  }
  return undefined;
};

const readStringArray = (record: Record<string, unknown>, key: string): string[] => {
  const value = record[key];
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((entry): entry is string => typeof entry === "string");
};

const normalizeQuestionOptions = (
  value: unknown,
): AgentPendingQuestionRequest["questions"][number]["options"] => {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((entry) => {
    const record = asRecord(entry);
    if (!record) {
      return [];
    }
    const label = readString(record, ["label"]);
    if (!label) {
      return [];
    }
    const description = readString(record, ["description"]) ?? label;
    return [{ label, description }];
  });
};

const normalizePendingQuestion = (value: unknown): AgentPendingQuestionRequest | null => {
  const record = asRecord(value);
  if (!record) {
    return null;
  }
  const requestId = readString(record, ["id", "requestID", "requestId"]);
  const sessionId = readString(record, ["sessionID", "sessionId", "session_id"]);
  const rawQuestions = record.questions;
  if (!requestId || !sessionId || !Array.isArray(rawQuestions)) {
    return null;
  }

  const questions = rawQuestions.flatMap((entry) => {
    const question = asRecord(entry);
    if (!question) {
      return [];
    }
    const header = readString(question, ["header", "title", "label"]);
    const prompt = readString(question, ["question", "title", "header"]);
    if (!header || !prompt) {
      return [];
    }
    const options = normalizeQuestionOptions(question.options);
    return [
      {
        header,
        question: prompt,
        options,
        ...(typeof question.multiple === "boolean" ? { multiple: question.multiple } : {}),
        ...(typeof question.custom === "boolean" ? { custom: question.custom } : {}),
      },
    ];
  });

  if (questions.length === 0) {
    return null;
  }

  return {
    requestId,
    questions,
  };
};

const normalizePendingPermission = (value: unknown): AgentPendingPermissionRequest | null => {
  const record = asRecord(value);
  if (!record) {
    return null;
  }

  const requestId = readString(record, ["id", "requestID", "requestId"]);
  const permission = readString(record, ["permission"]);
  const patterns = readStringArray(record, "patterns");
  if (!requestId || !permission) {
    return null;
  }

  const metadata = asRecord(record.metadata);
  return {
    requestId,
    permission,
    patterns,
    ...(metadata ? { metadata } : {}),
  };
};

const readPendingSessionId = (value: unknown): string | undefined => {
  const record = asRecord(value);
  if (!record) {
    return undefined;
  }
  return readString(record, ["sessionID", "sessionId", "session_id"]);
};

const hasCompletedAssistantMessage = (value: unknown): boolean => {
  const record = asRecord(value);
  const time = record ? asRecord(record.time) : null;
  return typeof time?.completed === "number";
};

const hasPendingAssistantBoundary = (session: SessionRecord): boolean => {
  return session.activeAssistantMessageId !== null;
};

export const loadSessionHistory = async (
  createClient: ClientFactory,
  now: () => string,
  input: {
    runtimeEndpoint: string;
    workingDirectory: string;
    externalSessionId: string;
    limit?: number;
  },
): Promise<AgentSessionHistoryMessage[]> => {
  const client = createClient({
    runtimeEndpoint: input.runtimeEndpoint,
    workingDirectory: input.workingDirectory,
  });
  const response = await client.session.messages({
    sessionID: input.externalSessionId,
    directory: input.workingDirectory,
    ...(typeof input.limit === "number" ? { limit: input.limit } : {}),
  });
  const data = unwrapData(response, "load session messages");
  const entries = data
    .map((entry) => {
      const rawTextFromParts = readTextFromParts(entry.parts);
      const rawText =
        rawTextFromParts.length > 0 ? rawTextFromParts : readTextFromMessageInfo(entry.info);
      const text = entry.info.role === "assistant" ? sanitizeAssistantMessage(rawText) : rawText;
      const totalTokens = extractMessageTotalTokens(entry.info, entry.parts);
      const parts = entry.parts
        .map(mapPartToAgentStreamPart)
        .filter((part): part is AgentStreamPart => part !== null && part.kind !== "text");
      const timestamp = toIsoFromEpoch(entry.info.time.created, now);
      const model = readMessageModelSelection(entry.info);
      const infoRecord = asRecord(entry.info);
      const parentId = infoRecord
        ? readString(infoRecord, ["parentID", "parentId", "parent_id"])
        : undefined;

      return {
        entry,
        timestamp,
        text,
        ...(typeof totalTokens === "number" ? { totalTokens } : {}),
        ...(model ? { model } : {}),
        ...(parentId ? { parentId } : {}),
        parts,
      };
    })
    .sort((a, b) => {
      const aTime = Date.parse(a.timestamp);
      const bTime = Date.parse(b.timestamp);
      if (Number.isNaN(aTime) || Number.isNaN(bTime)) {
        return 0;
      }
      return aTime - bTime;
    });

  const pendingAssistantReverseIndex = [...entries]
    .reverse()
    .findIndex(
      (item) =>
        item.entry.info.role === "assistant" && !hasCompletedAssistantMessage(item.entry.info),
    );
  const pendingAssistantIndex =
    pendingAssistantReverseIndex >= 0 ? entries.length - 1 - pendingAssistantReverseIndex : -1;

  return entries.map((item, index) => {
    if (item.entry.info.role === "assistant") {
      return {
        messageId: item.entry.info.id,
        role: "assistant",
        timestamp: item.timestamp,
        text: item.text,
        ...(typeof item.totalTokens === "number" ? { totalTokens: item.totalTokens } : {}),
        ...(item.model ? { model: item.model } : {}),
        parts: item.parts,
      };
    }

    return {
      messageId: item.entry.info.id,
      role: "user",
      timestamp: item.timestamp,
      text: item.text,
      state: pendingAssistantIndex >= 0 && index > pendingAssistantIndex ? "queued" : "read",
      ...(item.model ? { model: item.model } : {}),
      parts: item.parts,
    };
  });
};

export const loadSessionTodos = async (
  createClient: ClientFactory,
  input: {
    runtimeEndpoint: string;
    workingDirectory: string;
    externalSessionId: string;
  },
): Promise<AgentSessionTodoItem[]> => {
  try {
    const trimmedWorkingDirectory = input.workingDirectory.trim();
    const client = createClient({
      runtimeEndpoint: input.runtimeEndpoint,
      workingDirectory: input.workingDirectory,
    });
    const response = await client.session.todo({
      sessionID: input.externalSessionId,
      ...(trimmedWorkingDirectory.length > 0 ? { directory: trimmedWorkingDirectory } : {}),
    });
    if (response.data === undefined || response.data === null) {
      throw toOpenCodeRequestError(
        "load session todos",
        response.error,
        (response as { response?: { status?: unknown; statusText?: unknown } }).response,
      );
    }
    const payload = response.data;
    return normalizeTodoList(payload);
  } catch (error) {
    throw toOpenCodeRequestError("load session todos", error);
  }
};

export const listLiveAgentSessionPendingInput = async (
  createClient: ClientFactory,
  input: {
    runtimeEndpoint: string;
    workingDirectory: string;
  },
): Promise<
  Record<
    string,
    {
      permissions: AgentPendingPermissionRequest[];
      questions: AgentPendingQuestionRequest[];
    }
  >
> => {
  const client = createClient({
    runtimeEndpoint: input.runtimeEndpoint,
    workingDirectory: input.workingDirectory,
  });
  const [permissionResponse, questionResponse] = await Promise.all([
    client.permission.list({
      directory: input.workingDirectory,
    }),
    client.question.list({
      directory: input.workingDirectory,
    }),
  ]);
  const permissions = unwrapData(permissionResponse, "list pending permissions");
  const questions = unwrapData(questionResponse, "list pending questions");

  const bySession: Record<
    string,
    {
      permissions: AgentPendingPermissionRequest[];
      questions: AgentPendingQuestionRequest[];
    }
  > = {};

  for (const entry of permissions) {
    const sessionId = readPendingSessionId(entry);
    const normalized = normalizePendingPermission(entry);
    if (!sessionId || !normalized) {
      continue;
    }
    bySession[sessionId] ??= { permissions: [], questions: [] };
    bySession[sessionId].permissions.push(normalized);
  }

  for (const entry of questions) {
    const sessionId = readPendingSessionId(entry);
    const normalized = normalizePendingQuestion(entry);
    if (!sessionId || !normalized) {
      continue;
    }
    bySession[sessionId] ??= { permissions: [], questions: [] };
    bySession[sessionId].questions.push(normalized);
  }

  return bySession;
};

export const sendUserMessage = async (input: {
  session: SessionRecord;
  request: SendAgentUserMessageInput;
  tools: Record<string, boolean>;
}): Promise<void> => {
  const model = input.request.model ?? input.session.input.model;
  const wasBusy = hasPendingAssistantBoundary(input.session);
  const queuedSend = wasBusy
    ? {
        content: input.request.content.trim(),
        ...(model ? { model } : {}),
      }
    : null;
  if (queuedSend) {
    input.session.pendingQueuedUserMessages.push(queuedSend);
  }
  const modelInput = normalizeModelInput(model);
  const serializedPromptText = serializeAgentUserMessagePartsToText(input.request.parts);
  const promptRequest = {
    sessionID: input.session.externalSessionId,
    directory: input.session.input.workingDirectory,
    ...(input.session.input.systemPrompt.trim().length > 0
      ? { system: input.session.input.systemPrompt }
      : {}),
    ...(modelInput.model ? { model: modelInput.model } : {}),
    ...(modelInput.variant ? { variant: modelInput.variant } : {}),
    ...(modelInput.agent ? { agent: modelInput.agent } : {}),
    tools: input.tools,
    parts: [{ type: "text" as const, text: serializedPromptText }],
  };

  setSessionActive(input.session);
  try {
    const response = await input.session.client.session.promptAsync(promptRequest);
    if (response.error) {
      throw toOpenCodeRequestError("prompt session", response.error, response.response);
    }
  } catch (error) {
    if (queuedSend) {
      input.session.pendingQueuedUserMessages = input.session.pendingQueuedUserMessages.filter(
        (entry) => entry !== queuedSend,
      );
    }
    throw toOpenCodeRequestError("prompt session", error);
  }
};

export const replyPermission = async (
  session: SessionRecord,
  input: ReplyPermissionInput,
): Promise<void> => {
  await session.client.permission.reply({
    directory: session.input.workingDirectory,
    requestID: input.requestId,
    reply: input.reply,
    ...(input.message ? { message: input.message } : {}),
  });
};

export const replyQuestion = async (
  session: SessionRecord,
  input: ReplyQuestionInput,
): Promise<void> => {
  await session.client.question.reply({
    directory: session.input.workingDirectory,
    requestID: input.requestId,
    answers: input.answers,
  });
};

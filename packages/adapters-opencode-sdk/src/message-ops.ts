import type { OpencodeClient, Part } from "@opencode-ai/sdk/v2/client";
import type {
  AgentPendingPermissionRequest,
  AgentPendingQuestionRequest,
  AgentSessionHistoryMessage,
  AgentSessionTodoItem,
  AgentStreamPart,
  AgentUserMessageDisplayPart,
  ReplyPermissionInput,
  ReplyQuestionInput,
} from "@openducktor/core";
import { unwrapData } from "./data-utils";
import {
  ensureVisibleUserTextDisplayParts,
  extractMessageTotalTokens,
  mergePreservedAttachmentDisplayParts,
  normalizeUserMessageDisplayParts,
  readMessageModelSelection,
  readTextFromMessageInfo,
  readTextFromParts,
  readVisibleUserTextFromDisplayParts,
  sanitizeAssistantMessage,
} from "./message-normalizers";
import { toOpenCodeRequestError } from "./request-errors";
import { toIsoFromEpoch } from "./session-runtime-utils";
import { mapPartToAgentStreamPart } from "./stream-part-mapper";
import { normalizeTodoList } from "./todo-normalizers";
import type { ClientFactory, SessionRecord } from "./types";

type PermissionReplyTarget = {
  client: Pick<OpencodeClient, "permission">;
  workingDirectory: string;
};

type PermissionReplyPayload = Pick<ReplyPermissionInput, "requestId" | "reply" | "message">;

type QuestionReplyTarget = {
  client: Pick<OpencodeClient, "question">;
  workingDirectory: string;
};

type QuestionReplyPayload = Pick<ReplyQuestionInput, "requestId" | "answers">;

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

type MappedSubagentPart = Extract<AgentStreamPart, { kind: "subagent" }>;

const buildSubagentSignature = (part: MappedSubagentPart): string | undefined => {
  const agent = part.agent?.trim() ?? "";
  const prompt = part.prompt?.trim() ?? "";
  if (!agent && !prompt) {
    return undefined;
  }

  return [agent, prompt].join(":");
};

const buildPartScopedSubagentCorrelationKey = (
  part: Pick<MappedSubagentPart, "messageId">,
  rawPartId: string,
): string => {
  return ["part", part.messageId, rawPartId].join(":");
};

const enqueuePendingSubagentCorrelationKey = (
  pendingBySignature: Map<string, string[]>,
  signature: string,
  correlationKey: string,
): void => {
  const pending = pendingBySignature.get(signature) ?? [];
  if (pending.includes(correlationKey)) {
    return;
  }

  pendingBySignature.set(signature, [...pending, correlationKey]);
};

const dequeuePendingSubagentCorrelationKey = (
  pendingBySignature: Map<string, string[]>,
  signature: string,
): string | undefined => {
  const pending = pendingBySignature.get(signature);
  if (!pending || pending.length === 0) {
    return undefined;
  }

  const [next, ...rest] = pending;
  if (rest.length === 0) {
    pendingBySignature.delete(signature);
  } else {
    pendingBySignature.set(signature, rest);
  }

  return next;
};

const peekPendingSubagentCorrelationKeys = (
  pendingBySignature: Map<string, string[]>,
  signature: string,
): string[] => {
  return pendingBySignature.get(signature) ?? [];
};

const removePendingSubagentCorrelationKey = (
  pendingBySignature: Map<string, string[]>,
  correlationKey: string,
): void => {
  for (const [signature, pending] of pendingBySignature) {
    if (!pending.includes(correlationKey)) {
      continue;
    }

    const nextPending = pending.filter((entry) => entry !== correlationKey);
    if (nextPending.length === 0) {
      pendingBySignature.delete(signature);
      continue;
    }

    pendingBySignature.set(signature, nextPending);
  }
};

const normalizeHistoryStreamParts = (parts: Part[]): AgentStreamPart[] => {
  const pendingBySignature = new Map<string, string[]>();
  const correlationByExternalSessionId = new Map<string, string>();
  const normalized: AgentStreamPart[] = [];

  for (const rawPart of parts) {
    const mapped = mapPartToAgentStreamPart(rawPart);
    if (!mapped || mapped.kind === "text") {
      continue;
    }

    if (mapped.kind !== "subagent") {
      normalized.push(mapped);
      continue;
    }

    const signature = buildSubagentSignature(mapped);
    if (rawPart.type === "subtask") {
      const correlationKey = buildPartScopedSubagentCorrelationKey(mapped, rawPart.id);
      if (signature) {
        enqueuePendingSubagentCorrelationKey(pendingBySignature, signature, correlationKey);
      }
      if (mapped.externalSessionId) {
        correlationByExternalSessionId.set(mapped.externalSessionId, correlationKey);
      }

      normalized.push({
        ...mapped,
        correlationKey,
      });
      continue;
    }

    const sessionCorrelationKey = mapped.externalSessionId
      ? correlationByExternalSessionId.get(mapped.externalSessionId)
      : undefined;
    const pendingCorrelationKeys = signature
      ? peekPendingSubagentCorrelationKeys(pendingBySignature, signature)
      : [];
    const queuedCorrelationKey =
      pendingCorrelationKeys.length === 1 && signature
        ? dequeuePendingSubagentCorrelationKey(pendingBySignature, signature)
        : undefined;
    const correlationKey =
      sessionCorrelationKey ??
      queuedCorrelationKey ??
      (mapped.externalSessionId
        ? ["session", mapped.messageId, mapped.externalSessionId].join(":")
        : buildPartScopedSubagentCorrelationKey(mapped, rawPart.id));

    if (mapped.externalSessionId) {
      correlationByExternalSessionId.set(mapped.externalSessionId, correlationKey);
      removePendingSubagentCorrelationKey(pendingBySignature, correlationKey);
    }

    normalized.push({
      ...mapped,
      correlationKey,
    });
  }

  return normalized;
};

const seedSubagentCorrelationFromHistory = (
  session: Pick<
    SessionRecord,
    | "subagentCorrelationKeyByPartId"
    | "subagentCorrelationKeyByExternalSessionId"
    | "pendingSubagentCorrelationKeysBySignature"
    | "pendingSubagentCorrelationKeys"
  >,
  parts: AgentStreamPart[],
): void => {
  for (const part of parts) {
    if (part.kind !== "subagent") {
      continue;
    }

    session.subagentCorrelationKeyByPartId.set(part.partId, part.correlationKey);
    if (part.externalSessionId) {
      session.subagentCorrelationKeyByExternalSessionId.set(
        part.externalSessionId,
        part.correlationKey,
      );
    }

    const signature = buildSubagentSignature(part);
    if (!signature) {
      continue;
    }

    if (part.status === "pending" || part.status === "running") {
      if (part.externalSessionId) {
        removePendingSubagentCorrelationKey(
          session.pendingSubagentCorrelationKeysBySignature,
          part.correlationKey,
        );
        const pendingIndex = session.pendingSubagentCorrelationKeys.indexOf(part.correlationKey);
        if (pendingIndex >= 0) {
          session.pendingSubagentCorrelationKeys.splice(pendingIndex, 1);
        }
        continue;
      }

      if (!session.pendingSubagentCorrelationKeys.includes(part.correlationKey)) {
        session.pendingSubagentCorrelationKeys.push(part.correlationKey);
      }
      enqueuePendingSubagentCorrelationKey(
        session.pendingSubagentCorrelationKeysBySignature,
        signature,
        part.correlationKey,
      );
      continue;
    }

    removePendingSubagentCorrelationKey(
      session.pendingSubagentCorrelationKeysBySignature,
      part.correlationKey,
    );
    const pendingIndex = session.pendingSubagentCorrelationKeys.indexOf(part.correlationKey);
    if (pendingIndex >= 0) {
      session.pendingSubagentCorrelationKeys.splice(pendingIndex, 1);
    }
  }
};

export const loadSessionHistory = async (
  createClient: ClientFactory,
  now: () => string,
  input: {
    runtimeEndpoint: string;
    workingDirectory: string;
    externalSessionId: string;
    limit?: number;
    preservedDisplayPartsByMessageId?: Map<string, AgentUserMessageDisplayPart[]>;
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
  const normalizedEntries = data
    .map((entry) => {
      const infoText = readTextFromMessageInfo(entry.info);
      const displayParts =
        entry.info.role === "user"
          ? ensureVisibleUserTextDisplayParts(
              mergePreservedAttachmentDisplayParts(
                normalizeUserMessageDisplayParts(entry.parts),
                input.preservedDisplayPartsByMessageId
                  ?.get(entry.info.id)
                  ?.filter(
                    (part): part is Extract<AgentUserMessageDisplayPart, { kind: "attachment" }> =>
                      part.kind === "attachment",
                  ) ?? [],
              ),
              infoText,
            )
          : [];
      const rawTextFromParts =
        entry.info.role === "user"
          ? readVisibleUserTextFromDisplayParts(displayParts)
          : readTextFromParts(entry.parts);
      const rawText = rawTextFromParts.length > 0 ? rawTextFromParts : infoText;
      const text = entry.info.role === "assistant" ? sanitizeAssistantMessage(rawText) : rawText;
      const totalTokens = extractMessageTotalTokens(entry.info, entry.parts);
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
        ...(entry.info.role === "user" ? { displayParts } : {}),
        rawParts: entry.parts,
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

  const assistantNormalizedPartsByMessageId = new Map(
    normalizeHistoryStreamParts(
      normalizedEntries.flatMap((item) =>
        item.entry.info.role === "assistant" ? item.rawParts : [],
      ),
    ).reduce<Map<string, AgentStreamPart[]>>((byMessageId, part) => {
      const existing = byMessageId.get(part.messageId) ?? [];
      existing.push(part);
      byMessageId.set(part.messageId, existing);
      return byMessageId;
    }, new Map()),
  );

  const entries = normalizedEntries.map((item) => ({
    ...item,
    parts:
      item.entry.info.role === "assistant"
        ? (assistantNormalizedPartsByMessageId.get(item.entry.info.id) ?? [])
        : normalizeHistoryStreamParts(item.rawParts),
  }));

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
      displayParts: item.displayParts ?? [],
      state: pendingAssistantIndex >= 0 && index > pendingAssistantIndex ? "queued" : "read",
      ...(item.model ? { model: item.model } : {}),
      parts: item.parts,
    };
  });
};

export const loadAndSeedSessionHistory = async (
  createClient: ClientFactory,
  now: () => string,
  input: {
    runtimeEndpoint: string;
    workingDirectory: string;
    externalSessionId: string;
    limit?: number;
    preservedDisplayPartsByMessageId?: Map<string, AgentUserMessageDisplayPart[]>;
    session: Pick<
      SessionRecord,
      | "subagentCorrelationKeyByPartId"
      | "subagentCorrelationKeyByExternalSessionId"
      | "pendingSubagentCorrelationKeysBySignature"
      | "pendingSubagentCorrelationKeys"
    >;
  },
): Promise<AgentSessionHistoryMessage[]> => {
  const history = await loadSessionHistory(createClient, now, input);

  for (const entry of history) {
    if (entry.role !== "assistant") {
      continue;
    }
    seedSubagentCorrelationFromHistory(input.session, entry.parts);
  }

  return history;
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

export const replyPermissionToTarget = async (
  target: PermissionReplyTarget,
  input: PermissionReplyPayload,
): Promise<void> => {
  await target.client.permission.reply({
    directory: target.workingDirectory,
    requestID: input.requestId,
    reply: input.reply,
    ...(input.message ? { message: input.message } : {}),
  });
};

export const replyPermission = async (
  session: SessionRecord,
  input: ReplyPermissionInput,
): Promise<void> => {
  await replyPermissionToTarget(
    {
      client: session.client,
      workingDirectory: session.input.workingDirectory,
    },
    input,
  );
};

export const replyQuestion = async (
  session: SessionRecord,
  input: ReplyQuestionInput,
): Promise<void> => {
  await replyQuestionToTarget(
    {
      client: session.client,
      workingDirectory: session.input.workingDirectory,
    },
    input,
  );
};

export const replyQuestionToTarget = async (
  target: QuestionReplyTarget,
  input: QuestionReplyPayload,
): Promise<void> => {
  await target.client.question.reply({
    directory: target.workingDirectory,
    requestID: input.requestId,
    answers: input.answers,
  });
};

import type { OpencodeClient, Part, Session } from "@opencode-ai/sdk/v2/client";
import type { FileDiff } from "@openducktor/contracts";
import type {
  AgentPendingApprovalRequest,
  AgentPendingQuestionRequest,
  AgentSessionHistoryMessage,
  AgentSessionTodoItem,
  AgentStreamPart,
  AgentUserMessageDisplayPart,
  ReplyApprovalInput,
  ReplyQuestionInput,
} from "@openducktor/core";
import {
  normalizeOpenCodeApprovalRequest,
  toOpenCodePermissionReply,
} from "./approval-translation";
import { unwrapData } from "./data-utils";
import { loadSessionDiff } from "./diff-ops";
import { bindSubagentExternalSession, bindSubagentPartCorrelation } from "./event-stream/shared";
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
import { toProjectRelativePath } from "./path-utils";
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

const normalizeQuestionOptions = (
  value: unknown,
  requestId: string,
  questionIndex: number,
): AgentPendingQuestionRequest["questions"][number]["options"] => {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.map((entry, optionIndex) => {
    const record = asRecord(entry);
    if (!record) {
      throw new Error(
        `Malformed Opencode pending question payload '${requestId}': option ${optionIndex} for question ${questionIndex} must be an object.`,
      );
    }
    const label = readString(record, ["label"]);
    if (!label) {
      throw new Error(
        `Malformed Opencode pending question payload '${requestId}': option ${optionIndex} for question ${questionIndex} is missing label.`,
      );
    }
    const description = readString(record, ["description"]) ?? label;
    return { label, description };
  });
};

const normalizePendingQuestion = (value: unknown): AgentPendingQuestionRequest => {
  const record = asRecord(value);
  if (!record) {
    throw new Error("Malformed Opencode pending question payload: expected an object.");
  }
  const requestId = readString(record, ["id", "requestID", "requestId"]);
  const sessionId = readString(record, ["sessionID", "sessionId", "session_id"]);
  const rawQuestions = record.questions;
  if (!requestId) {
    throw new Error("Malformed Opencode pending question payload: missing request id.");
  }
  if (!sessionId) {
    throw new Error("Malformed Opencode pending question payload: missing session id.");
  }
  if (!Array.isArray(rawQuestions)) {
    throw new Error(
      `Malformed Opencode pending question payload '${requestId}': missing questions array.`,
    );
  }

  const questions = rawQuestions.map((entry, questionIndex) => {
    const question = asRecord(entry);
    if (!question) {
      throw new Error(
        `Malformed Opencode pending question payload '${requestId}': question ${questionIndex} must be an object.`,
      );
    }
    const header = readString(question, ["header", "title", "label"]);
    const prompt = readString(question, ["question", "title", "header"]);
    if (!header) {
      throw new Error(
        `Malformed Opencode pending question payload '${requestId}': question ${questionIndex} is missing header.`,
      );
    }
    if (!prompt) {
      throw new Error(
        `Malformed Opencode pending question payload '${requestId}': question ${questionIndex} is missing question text.`,
      );
    }
    const options = normalizeQuestionOptions(question.options, requestId, questionIndex);
    return {
      header,
      question: prompt,
      options,
      ...(typeof question.multiple === "boolean" ? { multiple: question.multiple } : {}),
      ...(typeof question.custom === "boolean" ? { custom: question.custom } : {}),
    };
  });

  if (questions.length === 0) {
    throw new Error(
      `Malformed Opencode pending question payload '${requestId}': missing questions.`,
    );
  }

  return {
    requestId,
    questions,
  };
};

const readPendingSessionId = (value: unknown): string | undefined => {
  const record = asRecord(value);
  if (!record) {
    return undefined;
  }
  return readString(record, ["sessionID", "sessionId", "session_id"]);
};

const requirePendingSessionId = (kind: "approval" | "question", value: unknown): string => {
  const sessionId = readPendingSessionId(value);
  if (!sessionId) {
    throw new Error(`Malformed Opencode pending ${kind} payload: missing session id.`);
  }
  return sessionId;
};

const hasCompletedAssistantMessage = (value: unknown): boolean => {
  const record = asRecord(value);
  const time = record ? asRecord(record.time) : null;
  return typeof time?.completed === "number";
};

type MappedSubagentPart = Extract<AgentStreamPart, { kind: "subagent" }>;
type ChildSessionLink = {
  externalSessionId: string;
  createdAtMs: number;
};
type HistoryPatchContext = {
  workingDirectory: string;
  sessionDiffByMessageId: Map<string, FileDiff[]>;
};

const CHILD_SESSION_START_TOLERANCE_MS = 5_000;

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

const readChildSessionCreatedAt = (session: Session): number | undefined => {
  const record = asRecord(session);
  const time = record ? asRecord(record.time) : null;
  const created = time?.created;
  return typeof created === "number" ? created : undefined;
};

const toChildSessionLink = (session: Session): ChildSessionLink | null => {
  if (typeof session.id !== "string" || session.id.trim().length === 0) {
    return null;
  }
  const createdAtMs = readChildSessionCreatedAt(session);
  if (typeof createdAtMs !== "number") {
    return null;
  }

  return {
    externalSessionId: session.id,
    createdAtMs,
  };
};

const listChildSessionLinks = async (
  client: OpencodeClient,
  input: {
    workingDirectory: string;
    externalSessionId: string;
  },
): Promise<ChildSessionLink[]> => {
  const childrenApi = (client as OpencodeClient & { session?: { children?: unknown } }).session
    ?.children;
  if (typeof childrenApi !== "function") {
    throw new Error(
      "OpenCode SDK does not expose session.children(); cannot hydrate subagent transcript links.",
    );
  }

  const response = await client.session.children({
    sessionID: input.externalSessionId,
    directory: input.workingDirectory,
  });
  return unwrapData(response, `list child sessions for ${input.externalSessionId}`)
    .map(toChildSessionLink)
    .filter((entry): entry is ChildSessionLink => entry !== null)
    .sort((left, right) => left.createdAtMs - right.createdAtMs);
};

const takeChildSessionLinkForSubagentPart = (
  childLinks: ChildSessionLink[],
  part: MappedSubagentPart,
): ChildSessionLink | undefined => {
  const startedAtMs = part.startedAtMs;
  if (part.externalSessionId || typeof startedAtMs !== "number") {
    return undefined;
  }

  const matchIndex = childLinks.findIndex(
    (entry) => Math.abs(entry.createdAtMs - startedAtMs) <= CHILD_SESSION_START_TOLERANCE_MS,
  );
  if (matchIndex < 0) {
    return undefined;
  }

  return childLinks.splice(matchIndex, 1)[0];
};

const linkSubagentPartToChildSession = (
  part: MappedSubagentPart,
  childLinks: ChildSessionLink[],
): MappedSubagentPart => {
  const childLink = takeChildSessionLinkForSubagentPart(childLinks, part);
  if (!childLink) {
    return part;
  }

  return {
    ...part,
    externalSessionId: childLink.externalSessionId,
  };
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

const toComparableFilePath = (filePath: string, workingDirectory: string): string => {
  const trimmed = filePath.trim();
  return toProjectRelativePath(trimmed, workingDirectory).replace(/\\/g, "/").replace(/^\.\//, "");
};

const readToolInputFilePath = (part: Extract<AgentStreamPart, { kind: "tool" }>): string | null => {
  if (!part.input) {
    return null;
  }
  return readString(part.input, ["filePath", "file_path", "path", "file"]) ?? null;
};

const readPartMessageId = (part: Part): string | null => {
  const record = asRecord(part);
  return record ? (readString(record, ["messageID", "messageId", "message_id"]) ?? null) : null;
};

const readPatchMessageIds = (parts: Part[]): string[] => {
  const messageIds = new Set<string>();
  for (const part of parts) {
    if (part.type !== "patch") {
      continue;
    }

    const messageId = readPartMessageId(part);
    if (!messageId) {
      continue;
    }
    messageIds.add(messageId);
  }

  return [...messageIds];
};

const loadSessionDiffByMessageId = async (
  runtimeEndpoint: string,
  externalSessionId: string,
  messageIds: string[],
): Promise<Map<string, FileDiff[]>> => {
  const results = await Promise.allSettled(
    messageIds.map(
      async (messageId) =>
        [messageId, await loadSessionDiff(runtimeEndpoint, externalSessionId, messageId)] as const,
    ),
  );
  return new Map(
    results.flatMap((result) => (result.status === "fulfilled" ? [result.value] : [])),
  );
};

const withHistoryFileChanges = (
  part: AgentStreamPart,
  patchContext?: HistoryPatchContext,
): AgentStreamPart => {
  if (!patchContext || part.kind !== "tool" || part.toolType !== "file_edit") {
    return part;
  }
  if (part.fileChanges && part.fileChanges.length > 0) {
    return part;
  }
  const sessionDiff = patchContext.sessionDiffByMessageId.get(part.messageId);
  if (!sessionDiff) {
    return part;
  }
  const inputPath = readToolInputFilePath(part);
  if (!inputPath) {
    return part;
  }
  const inputComparablePath = toComparableFilePath(inputPath, patchContext.workingDirectory);
  const fileChanges = sessionDiff.filter(
    (fileChange) =>
      toComparableFilePath(fileChange.file, patchContext.workingDirectory) === inputComparablePath,
  );
  if (fileChanges.length === 0) {
    return part;
  }

  return {
    ...part,
    fileChanges: [...(part.fileChanges ?? []), ...fileChanges],
  };
};

const normalizeHistoryStreamParts = (
  parts: Part[],
  childSessionLinks: ChildSessionLink[] = [],
  patchContext?: HistoryPatchContext,
): AgentStreamPart[] => {
  const pendingBySignature = new Map<string, string[]>();
  const correlationByExternalSessionId = new Map<string, string>();
  const normalized: AgentStreamPart[] = [];
  const unmatchedChildSessionLinks = [...childSessionLinks];

  for (const rawPart of parts) {
    if (rawPart.type === "patch") {
      continue;
    }

    const rawMapped = mapPartToAgentStreamPart(rawPart);
    if (!rawMapped || rawMapped.kind === "text") {
      continue;
    }

    if (rawMapped.kind !== "subagent") {
      normalized.push(withHistoryFileChanges(rawMapped, patchContext));
      continue;
    }

    const mapped = linkSubagentPartToChildSession(rawMapped, unmatchedChildSessionLinks);
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
    | "subagentPartIdByCorrelationKey"
    | "subagentPartIdByExternalSessionId"
    | "pendingSubagentCorrelationKeysBySignature"
    | "pendingSubagentCorrelationKeys"
  >,
  parts: AgentStreamPart[],
): void => {
  for (const part of parts) {
    if (part.kind !== "subagent") {
      continue;
    }

    bindSubagentPartCorrelation(session, part.partId, part.correlationKey);
    if (part.externalSessionId) {
      bindSubagentExternalSession(
        session,
        part.externalSessionId,
        part.correlationKey,
        part.partId,
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
  const childSessionLinks = await listChildSessionLinks(client, input);
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

  const assistantRawParts = normalizedEntries.flatMap((item) =>
    item.entry.info.role === "assistant" ? item.rawParts : [],
  );
  const patchMessageIds = readPatchMessageIds(assistantRawParts);
  const sessionDiffByMessageId =
    patchMessageIds.length > 0
      ? await loadSessionDiffByMessageId(
          input.runtimeEndpoint,
          input.externalSessionId,
          patchMessageIds,
        )
      : new Map<string, FileDiff[]>();
  const patchContext =
    sessionDiffByMessageId.size > 0
      ? { workingDirectory: input.workingDirectory, sessionDiffByMessageId }
      : undefined;
  const assistantNormalizedPartsByMessageId = new Map(
    normalizeHistoryStreamParts(assistantRawParts, childSessionLinks, patchContext).reduce<
      Map<string, AgentStreamPart[]>
    >((byMessageId, part) => {
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
      | "subagentPartIdByCorrelationKey"
      | "subagentPartIdByExternalSessionId"
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

export const listOpencodeLiveSessionPendingInput = async (
  createClient: ClientFactory,
  input: {
    runtimeEndpoint: string;
    workingDirectory: string;
  },
): Promise<
  Record<
    string,
    {
      approvals: AgentPendingApprovalRequest[];
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
      approvals: AgentPendingApprovalRequest[];
      questions: AgentPendingQuestionRequest[];
    }
  > = {};

  for (const entry of permissions) {
    const sessionId = requirePendingSessionId("approval", entry);
    const normalized = normalizeOpenCodeApprovalRequest(entry);
    bySession[sessionId] ??= { approvals: [], questions: [] };
    bySession[sessionId].approvals.push(normalized);
  }

  for (const entry of questions) {
    const sessionId = requirePendingSessionId("question", entry);
    const normalized = normalizePendingQuestion(entry);
    bySession[sessionId] ??= { approvals: [], questions: [] };
    bySession[sessionId].questions.push(normalized);
  }

  return bySession;
};

export const replyApproval = async (
  session: SessionRecord,
  input: ReplyApprovalInput,
): Promise<void> => {
  const response = await session.client.permission.reply({
    directory: session.input.workingDirectory,
    requestID: input.requestId,
    reply: toOpenCodePermissionReply(input.outcome),
    ...(input.message ? { message: input.message } : {}),
  });
  if (response.error) {
    throw toOpenCodeRequestError("reply to permission request", response.error, response.response);
  }
};

export const replyQuestion = async (
  session: SessionRecord,
  input: ReplyQuestionInput,
): Promise<void> => {
  const response = await session.client.question.reply({
    directory: session.input.workingDirectory,
    requestID: input.requestId,
    answers: input.answers,
  });
  if (response.error) {
    throw toOpenCodeRequestError("reply to question request", response.error, response.response);
  }
};

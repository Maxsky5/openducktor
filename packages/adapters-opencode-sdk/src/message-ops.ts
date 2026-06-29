import type { OpencodeClient, Part, Session } from "@opencode-ai/sdk/v2/client";
import type {
  AgentSessionHistoryMessage,
  AgentSessionTodoItem,
  AgentStreamPart,
  AgentUserMessageDisplayPart,
} from "@openducktor/core";
import { AGENT_SESSION_SYSTEM_PROMPT_PREFIX } from "@openducktor/core";
import { unwrapData } from "./data-utils";
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
import { mapOpenCodeBackgroundTaskResultPart } from "./opencode-background-task-result";
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
      "OpenCode SDK does not expose session.children(); cannot load subagent transcript links.",
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

const normalizeHistoryStreamParts = (
  parts: Part[],
  childSessionLinks: ChildSessionLink[] = [],
  timestamp?: string,
): AgentStreamPart[] => {
  const pendingBySignature = new Map<string, string[]>();
  const correlationByExternalSessionId = new Map<string, string>();
  const normalized: AgentStreamPart[] = [];
  const unmatchedChildSessionLinks = [...childSessionLinks];

  for (const rawPart of parts) {
    if (rawPart.type === "patch") {
      continue;
    }

    if (rawPart.type === "text") {
      const backgroundTaskResult = mapOpenCodeBackgroundTaskResultPart(rawPart, {
        ...(timestamp ? { timestamp } : {}),
      });
      if (backgroundTaskResult) {
        normalized.push(backgroundTaskResult);
      }
      continue;
    }

    const rawMapped = mapPartToAgentStreamPart(rawPart);
    if (!rawMapped || rawMapped.kind === "text") {
      continue;
    }

    if (rawMapped.kind !== "subagent") {
      normalized.push(rawMapped);
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
  const assistantNormalizedPartsByMessageId = new Map(
    normalizeHistoryStreamParts(assistantRawParts, childSessionLinks).reduce<
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
        : normalizeHistoryStreamParts(item.rawParts, [], item.timestamp),
  }));

  const pendingAssistantReverseIndex = [...entries]
    .reverse()
    .findIndex(
      (item) =>
        item.entry.info.role === "assistant" && !hasCompletedAssistantMessage(item.entry.info),
    );
  const pendingAssistantIndex =
    pendingAssistantReverseIndex >= 0 ? entries.length - 1 - pendingAssistantReverseIndex : -1;

  const history: AgentSessionHistoryMessage[] = [];
  let lastRenderedSystemPrompt: string | null = null;

  for (const [index, item] of entries.entries()) {
    if (item.entry.info.role === "user") {
      const systemPrompt = item.entry.info.system?.trim() ?? "";
      if (systemPrompt.length > 0 && systemPrompt !== lastRenderedSystemPrompt) {
        history.push({
          messageId: `system-prompt:${item.entry.info.id}`,
          role: "system",
          timestamp: item.timestamp,
          text: `${AGENT_SESSION_SYSTEM_PROMPT_PREFIX}${systemPrompt}`,
          parts: [],
        });
        lastRenderedSystemPrompt = systemPrompt;
      }
    }

    if (item.entry.info.role === "assistant") {
      history.push({
        messageId: item.entry.info.id,
        role: "assistant",
        timestamp: item.timestamp,
        text: item.text,
        ...(typeof item.totalTokens === "number" ? { totalTokens: item.totalTokens } : {}),
        ...(item.model ? { model: item.model } : {}),
        parts: item.parts,
      });
      continue;
    }

    history.push({
      messageId: item.entry.info.id,
      role: "user",
      timestamp: item.timestamp,
      text: item.text,
      displayParts: item.displayParts ?? [],
      state: pendingAssistantIndex >= 0 && index > pendingAssistantIndex ? "queued" : "read",
      ...(item.model ? { model: item.model } : {}),
      parts: item.parts,
    });
  }

  return history;
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

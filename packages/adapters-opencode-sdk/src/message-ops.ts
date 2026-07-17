import type { OpencodeClient, Part, Session } from "@opencode-ai/sdk/v2/client";
import type {
  AgentSessionHistoryMessage,
  AgentSessionTodoItem,
  AgentStreamPart,
  AgentUserMessageDisplayPart,
} from "@openducktor/core";
import { AGENT_SESSION_SYSTEM_PROMPT_PREFIX } from "@openducktor/core";
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
import { mapOpenCodeBackgroundTaskResultPart } from "./opencode-background-task-result";
import { toOpenCodeRequestError } from "./request-errors";
import { toIsoFromEpoch } from "./session-runtime-utils";
import { mapPartToAgentStreamPart } from "./stream-part-mapper";
import { normalizeTodoList } from "./todo-normalizers";
import type { ClientFactory } from "./types";

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

const isCompactionMarkerEntry = (entry: { parts: Part[] }): boolean =>
  entry.parts.some((part) => asRecord(part)?.type === "compaction");

type MappedSubagentPart = Extract<AgentStreamPart, { kind: "subagent" }>;
type ChildSessionLink = {
  externalSessionId: string;
  createdAtMs: number;
};
type HistoryStreamPartNormalizationState = {
  pendingBySignature: Map<string, string[]>;
  correlationByExternalSessionId: Map<string, string>;
  unmatchedChildSessionLinks: ChildSessionLink[];
  pendingBackgroundTaskResultsByExternalSessionId: Map<string, MappedSubagentPart[]>;
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

const queuePendingBackgroundTaskResult = (
  state: HistoryStreamPartNormalizationState,
  externalSessionId: string,
  part: MappedSubagentPart,
): void => {
  const pending = state.pendingBackgroundTaskResultsByExternalSessionId.get(externalSessionId);
  const next = [...(pending?.filter((entry) => entry.partId !== part.partId) ?? []), part];
  state.pendingBackgroundTaskResultsByExternalSessionId.set(externalSessionId, next);
};

const flushPendingBackgroundTaskResults = (
  state: HistoryStreamPartNormalizationState,
  externalSessionId: string,
  correlationKey: string,
): MappedSubagentPart[] => {
  const pending = state.pendingBackgroundTaskResultsByExternalSessionId.get(externalSessionId);
  if (!pending || pending.length === 0) {
    return [];
  }

  state.pendingBackgroundTaskResultsByExternalSessionId.delete(externalSessionId);
  state.correlationByExternalSessionId.set(externalSessionId, correlationKey);
  removePendingSubagentCorrelationKey(state.pendingBySignature, correlationKey);
  return pending.map((part) => ({
    ...part,
    correlationKey,
  }));
};

const createHistoryStreamPartNormalizationState = (
  childSessionLinks: ChildSessionLink[],
): HistoryStreamPartNormalizationState => ({
  pendingBySignature: new Map<string, string[]>(),
  correlationByExternalSessionId: new Map<string, string>(),
  unmatchedChildSessionLinks: [...childSessionLinks],
  pendingBackgroundTaskResultsByExternalSessionId: new Map<string, MappedSubagentPart[]>(),
});

const normalizeHistoryStreamParts = (
  parts: Part[],
  state: HistoryStreamPartNormalizationState,
  timestamp?: string,
): AgentStreamPart[] => {
  const normalized: AgentStreamPart[] = [];

  for (const rawPart of parts) {
    if (rawPart.type === "patch") {
      continue;
    }

    if (rawPart.type === "text") {
      const backgroundTaskResult = mapOpenCodeBackgroundTaskResultPart(rawPart, {
        ...(timestamp ? { timestamp } : {}),
      });
      if (backgroundTaskResult) {
        const externalSessionId = backgroundTaskResult.externalSessionId;
        if (!externalSessionId) {
          normalized.push(backgroundTaskResult);
          continue;
        }

        const correlationKey = state.correlationByExternalSessionId.get(externalSessionId);
        if (!correlationKey) {
          queuePendingBackgroundTaskResult(state, externalSessionId, backgroundTaskResult);
          continue;
        }

        const mapped = {
          ...backgroundTaskResult,
          correlationKey,
        };
        state.correlationByExternalSessionId.set(externalSessionId, correlationKey);
        removePendingSubagentCorrelationKey(state.pendingBySignature, correlationKey);
        normalized.push(mapped);
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

    const mapped = linkSubagentPartToChildSession(rawMapped, state.unmatchedChildSessionLinks);
    const signature = buildSubagentSignature(mapped);
    if (rawPart.type === "subtask") {
      const correlationKey = buildPartScopedSubagentCorrelationKey(mapped, rawPart.id);
      if (signature) {
        enqueuePendingSubagentCorrelationKey(state.pendingBySignature, signature, correlationKey);
      }
      if (mapped.externalSessionId) {
        state.correlationByExternalSessionId.set(mapped.externalSessionId, correlationKey);
      }

      normalized.push({
        ...mapped,
        correlationKey,
      });
      if (mapped.externalSessionId) {
        normalized.push(
          ...flushPendingBackgroundTaskResults(state, mapped.externalSessionId, correlationKey),
        );
      }
      continue;
    }

    const sessionCorrelationKey = mapped.externalSessionId
      ? state.correlationByExternalSessionId.get(mapped.externalSessionId)
      : undefined;
    const pendingCorrelationKeys = signature
      ? peekPendingSubagentCorrelationKeys(state.pendingBySignature, signature)
      : [];
    const queuedCorrelationKey =
      pendingCorrelationKeys.length === 1 && signature
        ? dequeuePendingSubagentCorrelationKey(state.pendingBySignature, signature)
        : undefined;
    const correlationKey =
      sessionCorrelationKey ??
      queuedCorrelationKey ??
      (mapped.externalSessionId
        ? ["session", mapped.messageId, mapped.externalSessionId].join(":")
        : buildPartScopedSubagentCorrelationKey(mapped, rawPart.id));

    if (mapped.externalSessionId) {
      state.correlationByExternalSessionId.set(mapped.externalSessionId, correlationKey);
      removePendingSubagentCorrelationKey(state.pendingBySignature, correlationKey);
    }

    normalized.push({
      ...mapped,
      correlationKey,
    });
    if (mapped.externalSessionId) {
      normalized.push(
        ...flushPendingBackgroundTaskResults(state, mapped.externalSessionId, correlationKey),
      );
    }
  }

  return normalized;
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
    .filter((entry) => !isCompactionMarkerEntry(entry))
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

  const historyPartNormalizationState =
    createHistoryStreamPartNormalizationState(childSessionLinks);
  const entries = normalizedEntries.map((item) => ({
    ...item,
    parts: normalizeHistoryStreamParts(
      item.rawParts,
      historyPartNormalizationState,
      item.timestamp,
    ),
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

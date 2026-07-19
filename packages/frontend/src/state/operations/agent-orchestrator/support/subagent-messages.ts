import type { AgentChatMessage, AgentChatMessageMeta } from "@/types/agent-orchestrator";
import {
  applyPreferredMessageTimestamp,
  type MessageTimestamp,
  preferredMessageTimestamp,
} from "./message-timestamp";
import {
  findLastSessionMessageByRole,
  getSessionMessagesSlice,
  removeSessionMessageById,
  type SessionMessageOwner,
  upsertSessionMessage,
} from "./messages";

export type SubagentMeta = Extract<AgentChatMessageMeta, { kind: "subagent" }>;
export type SubagentMessage = AgentChatMessage & {
  role: "system";
  meta: SubagentMeta;
};

export const toSubagentMessageId = (correlationKey: string): string => `subagent:${correlationKey}`;

const isTerminalSubagentStatus = (status: SubagentMeta["status"]): boolean => {
  return status === "completed" || status === "cancelled" || status === "error";
};

export const isSubagentMessage = (
  message: AgentChatMessage | null | undefined,
): message is SubagentMessage => {
  return message?.role === "system" && message.meta?.kind === "subagent";
};

const SUBAGENT_STATUS_PRECEDENCE: Record<SubagentMeta["status"], number> = {
  pending: 0,
  running: 1,
  completed: 2,
  cancelled: 3,
  error: 4,
};

const resolveSubagentStatus = (
  existingStatus: SubagentMeta["status"] | undefined,
  incomingStatus: SubagentMeta["status"],
): SubagentMeta["status"] => {
  if (!existingStatus) {
    return incomingStatus;
  }
  return SUBAGENT_STATUS_PRECEDENCE[incomingStatus] > SUBAGENT_STATUS_PRECEDENCE[existingStatus]
    ? incomingStatus
    : existingStatus;
};

const isLaterSubagentRestart = (
  existingMeta: SubagentMeta | null | undefined,
  incomingMeta: SubagentMeta,
): boolean =>
  incomingMeta.status === "running" &&
  typeof existingMeta?.endedAtMs === "number" &&
  typeof incomingMeta.startedAtMs === "number" &&
  incomingMeta.startedAtMs > existingMeta.endedAtMs;

const isPreviousRunTerminalUpdate = (
  existingMeta: SubagentMeta | null | undefined,
  incomingMeta: SubagentMeta,
): boolean =>
  existingMeta?.status === "running" &&
  isTerminalSubagentStatus(incomingMeta.status) &&
  typeof existingMeta.startedAtMs === "number" &&
  typeof incomingMeta.endedAtMs === "number" &&
  incomingMeta.endedAtMs < existingMeta.startedAtMs;

export const formatSubagentContent = (meta: {
  agent?: string;
  prompt?: string;
  description?: string;
  externalSessionId?: string;
}): string => {
  const agentLabel = meta.agent?.trim() || "subagent";
  const summary =
    meta.description?.trim() ||
    meta.prompt?.trim() ||
    (meta.externalSessionId
      ? `Session ${meta.externalSessionId.slice(0, 8)}`
      : "Subagent activity");

  return `Subagent (${agentLabel}): ${summary}`;
};

export const createSubagentMessage = ({
  id,
  timestamp,
  timestampIsApproximate,
  meta,
}: {
  id?: string;
  timestamp: string;
  timestampIsApproximate?: true;
  meta: SubagentMeta;
}): SubagentMessage => {
  return {
    id: id ?? toSubagentMessageId(meta.correlationKey),
    role: "system",
    content: formatSubagentContent(meta),
    timestamp,
    ...(timestampIsApproximate ? { timestampIsApproximate: true } : {}),
    meta,
  };
};

const isPartScopedSubagentKey = (correlationKey: string): boolean =>
  correlationKey.startsWith("part:");

const isSessionScopedSubagentKey = (correlationKey: string): boolean =>
  correlationKey.startsWith("session:");

const canLinkSessionScopedSubagentToPartScopedRow = (
  incoming: Pick<SubagentMeta, "correlationKey" | "externalSessionId" | "agent" | "prompt">,
  candidate: SubagentMessage,
): boolean => {
  return Boolean(
    incoming.externalSessionId &&
      isSessionScopedSubagentKey(incoming.correlationKey) &&
      !candidate.meta.externalSessionId &&
      isPartScopedSubagentKey(candidate.meta.correlationKey) &&
      typeof incoming.agent === "string" &&
      typeof incoming.prompt === "string" &&
      candidate.meta.agent === incoming.agent &&
      candidate.meta.prompt === incoming.prompt,
  );
};

const findLastSubagentMessage = (
  owner: SessionMessageOwner,
  predicate: (message: SubagentMessage) => boolean,
): SubagentMessage | undefined => {
  const message = findLastSessionMessageByRole(
    owner,
    "system",
    (message) => isSubagentMessage(message) && predicate(message),
  );
  return isSubagentMessage(message) ? message : undefined;
};

const resolveSubagentMessageUpdateTarget = (
  owner: SessionMessageOwner,
  incoming: Pick<SubagentMeta, "correlationKey" | "externalSessionId" | "agent" | "prompt">,
): { message: SubagentMessage | undefined; duplicateMessageId: string | null } => {
  const correlationMessage = findLastSubagentMessage(
    owner,
    (message) => message.meta.correlationKey === incoming.correlationKey,
  );
  const sessionMessage = incoming.externalSessionId
    ? findLastSubagentMessage(
        owner,
        (message) => message.meta.externalSessionId === incoming.externalSessionId,
      )
    : undefined;
  const partScopedRowMatches =
    correlationMessage || sessionMessage
      ? []
      : getSessionMessagesSlice(owner, 0).filter(
          (message): message is SubagentMessage =>
            isSubagentMessage(message) &&
            canLinkSessionScopedSubagentToPartScopedRow(incoming, message),
        );
  const bridgedPartScopedMessage =
    partScopedRowMatches.length === 1 ? partScopedRowMatches[0] : undefined;
  const message = correlationMessage ?? sessionMessage ?? bridgedPartScopedMessage;
  const duplicateMessageId =
    correlationMessage &&
    sessionMessage &&
    correlationMessage.id !== sessionMessage.id &&
    message?.id === correlationMessage.id
      ? sessionMessage.id
      : null;

  return { message, duplicateMessageId };
};

const mergeSubagentMeta = (
  existingMeta: SubagentMeta | null | undefined,
  incomingMeta: SubagentMeta,
  options?: {
    startedAtMsFallback?: number;
  },
): SubagentMeta => {
  const isRestart = isLaterSubagentRestart(existingMeta, incomingMeta);
  const isPreviousRunUpdate = isPreviousRunTerminalUpdate(existingMeta, incomingMeta);
  const status =
    isRestart || isPreviousRunUpdate
      ? "running"
      : resolveSubagentStatus(existingMeta?.status, incomingMeta.status);
  const metadata =
    existingMeta?.metadata && incomingMeta.metadata
      ? { ...existingMeta.metadata, ...incomingMeta.metadata }
      : (incomingMeta.metadata ?? existingMeta?.metadata);
  let startedAtMs = incomingMeta.startedAtMs ?? existingMeta?.startedAtMs;
  if (isRestart) {
    startedAtMs = incomingMeta.startedAtMs;
  } else if (isPreviousRunUpdate) {
    startedAtMs = existingMeta?.startedAtMs;
  } else if (
    existingMeta?.status === "running" &&
    incomingMeta.status === "running" &&
    typeof existingMeta.startedAtMs === "number" &&
    typeof incomingMeta.startedAtMs === "number"
  ) {
    startedAtMs = Math.max(existingMeta.startedAtMs, incomingMeta.startedAtMs);
  } else if (
    typeof existingMeta?.startedAtMs === "number" &&
    typeof incomingMeta.startedAtMs === "number"
  ) {
    startedAtMs = Math.min(existingMeta.startedAtMs, incomingMeta.startedAtMs);
  } else {
    startedAtMs ??= options?.startedAtMsFallback;
  }

  let endedAtMs: number | undefined;
  if (isRestart || isPreviousRunUpdate) {
    endedAtMs = undefined;
  } else if (
    typeof existingMeta?.endedAtMs === "number" &&
    typeof incomingMeta.endedAtMs === "number"
  ) {
    endedAtMs = Math.max(existingMeta.endedAtMs, incomingMeta.endedAtMs);
  } else if (isTerminalSubagentStatus(status)) {
    endedAtMs = incomingMeta.endedAtMs ?? existingMeta?.endedAtMs;
  }
  const agent = incomingMeta.agent ?? existingMeta?.agent;
  const prompt = incomingMeta.prompt ?? existingMeta?.prompt;
  const description = isPreviousRunUpdate
    ? existingMeta?.description
    : (incomingMeta.description ?? existingMeta?.description);
  let error: string | undefined;
  if (isRestart) {
    error = incomingMeta.error;
  } else if (isPreviousRunUpdate) {
    error = existingMeta?.error;
  } else {
    error = incomingMeta.error ?? existingMeta?.error;
  }
  const externalSessionId = incomingMeta.externalSessionId ?? existingMeta?.externalSessionId;
  const executionMode = incomingMeta.executionMode ?? existingMeta?.executionMode;
  const sourceMessageId = incomingMeta.sourceMessageId ?? existingMeta?.sourceMessageId;

  return {
    kind: "subagent",
    partId: incomingMeta.partId,
    correlationKey: incomingMeta.correlationKey,
    ...(sourceMessageId ? { sourceMessageId } : {}),
    status,
    ...(typeof agent === "string" ? { agent } : {}),
    ...(typeof prompt === "string" ? { prompt } : {}),
    ...(typeof description === "string" ? { description } : {}),
    ...(typeof error === "string" ? { error } : {}),
    ...(typeof externalSessionId === "string" ? { externalSessionId } : {}),
    ...(executionMode ? { executionMode } : {}),
    ...(metadata ? { metadata } : {}),
    ...(typeof startedAtMs === "number" ? { startedAtMs } : {}),
    ...(typeof endedAtMs === "number" ? { endedAtMs } : {}),
  };
};

export const upsertSubagentMessage = ({
  owner,
  incomingMeta,
  timestamp,
  startedAtMsFallback,
}: {
  owner: SessionMessageOwner;
  incomingMeta: SubagentMeta;
  timestamp: string;
  startedAtMsFallback?: number;
}): SessionMessageOwner["messages"] => {
  const { message: existingMessage, duplicateMessageId } = resolveSubagentMessageUpdateTarget(
    owner,
    incomingMeta,
  );
  const nextMeta = mergeSubagentMeta(
    existingMessage?.meta ?? null,
    incomingMeta,
    typeof startedAtMsFallback === "number" ? { startedAtMsFallback } : undefined,
  );
  const ownerWithoutDuplicate =
    duplicateMessageId === null
      ? owner
      : { ...owner, messages: removeSessionMessageById(owner, duplicateMessageId) };
  const nextTimestamp = preferredMessageTimestamp(existingMessage ?? { timestamp }, { timestamp });

  return upsertSessionMessage(
    ownerWithoutDuplicate,
    createSubagentMessage({
      id: existingMessage?.id ?? toSubagentMessageId(incomingMeta.correlationKey),
      ...nextTimestamp,
      meta: nextMeta,
    }),
  );
};

const chooseSubagentDescription = (
  loadedMeta: SubagentMeta,
  currentMeta: SubagentMeta,
  resolvedStatus: SubagentMeta["status"],
): string | undefined => {
  const currentMatchesResolvedStatus = currentMeta.status === resolvedStatus;
  const loadedMatchesResolvedStatus = loadedMeta.status === resolvedStatus;

  if (currentMatchesResolvedStatus && !loadedMatchesResolvedStatus) {
    return currentMeta.description ?? loadedMeta.description;
  }
  if (loadedMatchesResolvedStatus && !currentMatchesResolvedStatus) {
    return loadedMeta.description ?? currentMeta.description;
  }

  return loadedMeta.description ?? currentMeta.description;
};

export const mergeSubagentMessages = (
  loadedMessage: SubagentMessage,
  currentMessage: SubagentMessage,
): AgentChatMessage => {
  const loadedMeta = loadedMessage.meta;
  const currentMeta = currentMessage.meta;
  const nextMeta = mergeSubagentMeta(loadedMeta, {
    ...currentMeta,
    partId: loadedMeta.partId,
    correlationKey: loadedMeta.correlationKey,
  });
  const description = chooseSubagentDescription(loadedMeta, currentMeta, nextMeta.status);
  const resolvedMeta = {
    ...nextMeta,
    ...(typeof description === "string" ? { description } : {}),
  };

  return applyPreferredMessageTimestamp(
    createSubagentMessage({
      id: loadedMessage.id,
      timestamp: loadedMessage.timestamp,
      ...(loadedMessage.timestampIsApproximate ? { timestampIsApproximate: true } : {}),
      meta: resolvedMeta,
    }),
    loadedMessage,
    currentMessage,
  );
};

const matchesLoadedSubagent = (
  loadedMessage: AgentChatMessage,
  candidate: AgentChatMessage,
): boolean => {
  if (!isSubagentMessage(loadedMessage) || !isSubagentMessage(candidate)) {
    return false;
  }
  if (candidate.id === loadedMessage.id) {
    return false;
  }

  const loadedSessionId = loadedMessage.meta.externalSessionId;
  if (loadedSessionId) {
    return candidate.meta.externalSessionId === loadedSessionId;
  }

  return false;
};

const canAbsorbLoadedPartSubagentIntoCurrentSessionRow = (
  loadedMessage: AgentChatMessage,
  candidate: AgentChatMessage,
): boolean => {
  if (!isSubagentMessage(loadedMessage) || !isSubagentMessage(candidate)) {
    return false;
  }
  if (loadedMessage.meta.externalSessionId || !candidate.meta.externalSessionId) {
    return false;
  }
  if (!isPartScopedSubagentKey(loadedMessage.meta.correlationKey)) {
    return false;
  }
  if (!isSessionScopedSubagentKey(candidate.meta.correlationKey)) {
    return false;
  }

  const loadedAgent = loadedMessage.meta.agent?.trim();
  const candidateAgent = candidate.meta.agent?.trim();
  const loadedPrompt = loadedMessage.meta.prompt?.trim();
  const candidatePrompt = candidate.meta.prompt?.trim();

  if (!loadedAgent || !candidateAgent || !loadedPrompt || !candidatePrompt) {
    return false;
  }

  return loadedAgent === candidateAgent && loadedPrompt === candidatePrompt;
};

export const findCurrentSubagentMessagesForLoadedHistory = ({
  currentOwner,
  loadedMessage,
  sameIdCurrentMessage,
  absorbedCurrentMessageIds,
}: {
  currentOwner: SessionMessageOwner;
  loadedMessage: SubagentMessage;
  sameIdCurrentMessage: AgentChatMessage | undefined;
  absorbedCurrentMessageIds: ReadonlySet<string>;
}): AgentChatMessage[] => {
  const matches: AgentChatMessage[] = [];
  const seenIds = new Set<string>();
  if (sameIdCurrentMessage && !absorbedCurrentMessageIds.has(sameIdCurrentMessage.id)) {
    matches.push(sameIdCurrentMessage);
    seenIds.add(sameIdCurrentMessage.id);
  }

  const currentSlice = getSessionMessagesSlice(currentOwner, 0);
  const bridgedSessionRows: AgentChatMessage[] = [];
  for (let index = currentSlice.length - 1; index >= 0; index -= 1) {
    const candidate = currentSlice[index];
    if (!candidate || seenIds.has(candidate.id) || absorbedCurrentMessageIds.has(candidate.id)) {
      continue;
    }
    if (matchesLoadedSubagent(loadedMessage, candidate)) {
      matches.push(candidate);
      seenIds.add(candidate.id);
      continue;
    }
    if (canAbsorbLoadedPartSubagentIntoCurrentSessionRow(loadedMessage, candidate)) {
      bridgedSessionRows.push(candidate);
    }
  }

  if (matches.length === 0 && bridgedSessionRows.length === 1) {
    const [bridgedSessionRow] = bridgedSessionRows;
    if (bridgedSessionRow) {
      matches.push(bridgedSessionRow);
    }
  }

  return matches;
};

const resolvePreferredLoadedCorrelationKey = (
  existingMeta: SubagentMeta,
  incomingMeta: SubagentMeta,
): string => {
  if (
    existingMeta.correlationKey !== incomingMeta.correlationKey &&
    incomingMeta.externalSessionId &&
    !existingMeta.externalSessionId
  ) {
    return incomingMeta.correlationKey;
  }
  if (
    existingMeta.correlationKey !== incomingMeta.correlationKey &&
    existingMeta.externalSessionId &&
    !incomingMeta.externalSessionId
  ) {
    return existingMeta.correlationKey;
  }
  if (isPartScopedSubagentKey(existingMeta.correlationKey)) {
    return existingMeta.correlationKey;
  }
  if (isPartScopedSubagentKey(incomingMeta.correlationKey)) {
    return incomingMeta.correlationKey;
  }
  if (existingMeta.correlationKey.startsWith("spawn:")) {
    return existingMeta.correlationKey;
  }
  if (incomingMeta.correlationKey.startsWith("spawn:")) {
    return incomingMeta.correlationKey;
  }

  return existingMeta.correlationKey;
};

const matchesLoadedSubagentMessage = (
  existingMessage: SubagentMessage,
  incomingMessage: SubagentMessage,
): boolean => {
  if (existingMessage.meta.correlationKey === incomingMessage.meta.correlationKey) {
    return true;
  }

  const existingSessionId = existingMessage.meta.externalSessionId;
  const incomingSessionId = incomingMessage.meta.externalSessionId;
  return Boolean(existingSessionId && incomingSessionId && existingSessionId === incomingSessionId);
};

const matchesLoadedSubagentActivity = (
  existingMessage: SubagentMessage,
  incomingMessage: SubagentMessage,
): boolean => {
  const existingAgent = existingMessage.meta.agent;
  const incomingAgent = incomingMessage.meta.agent;
  const existingPrompt = existingMessage.meta.prompt;
  const incomingPrompt = incomingMessage.meta.prompt;

  return (
    existingMessage.timestamp === incomingMessage.timestamp &&
    typeof existingAgent === "string" &&
    typeof incomingAgent === "string" &&
    existingAgent === incomingAgent &&
    typeof existingPrompt === "string" &&
    typeof incomingPrompt === "string" &&
    existingPrompt === incomingPrompt
  );
};

const shouldIgnoreIncomingHistorySubagent = (
  existingMessage: SubagentMessage,
  incomingMessage: SubagentMessage,
): boolean => {
  return Boolean(
    existingMessage.meta.externalSessionId &&
      !incomingMessage.meta.externalSessionId &&
      existingMessage.meta.correlationKey !== incomingMessage.meta.correlationKey &&
      matchesLoadedSubagentActivity(existingMessage, incomingMessage),
  );
};

const canMergeHistorySubagentMessage = (
  existingMessage: SubagentMessage,
  incomingMessage: SubagentMessage,
): boolean => {
  if (matchesLoadedSubagentMessage(existingMessage, incomingMessage)) {
    return true;
  }

  return Boolean(
    incomingMessage.meta.externalSessionId &&
      !existingMessage.meta.externalSessionId &&
      matchesLoadedSubagentActivity(existingMessage, incomingMessage),
  );
};

const mergeHistorySubagentMessages = (
  existingMessage: SubagentMessage,
  incomingMessage: SubagentMessage,
): SubagentMessage => {
  const existingMeta = existingMessage.meta;
  const incomingMeta = incomingMessage.meta;
  const correlationKey = resolvePreferredLoadedCorrelationKey(existingMeta, incomingMeta);
  const nextMeta = mergeSubagentMeta(existingMeta, {
    ...incomingMeta,
    correlationKey,
  });

  const timestamp: MessageTimestamp = preferredMessageTimestamp(existingMessage, incomingMessage);
  return createSubagentMessage({
    id: toSubagentMessageId(correlationKey),
    ...timestamp,
    meta: nextMeta,
  });
};

const findLastHistorySubagentIndex = (
  messages: AgentChatMessage[],
  incomingMessage: SubagentMessage,
  predicate: (existingMessage: SubagentMessage, incomingMessage: SubagentMessage) => boolean,
): number => {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const entry = messages[index];
    if (!isSubagentMessage(entry)) {
      continue;
    }
    if (predicate(entry, incomingMessage)) {
      return index;
    }
  }

  return -1;
};

export const appendHistorySubagentMessage = (
  messages: AgentChatMessage[],
  incomingMessage: SubagentMessage,
): void => {
  const ignoredIndex = findLastHistorySubagentIndex(
    messages,
    incomingMessage,
    shouldIgnoreIncomingHistorySubagent,
  );
  if (ignoredIndex >= 0) {
    return;
  }

  const existingIndex = findLastHistorySubagentIndex(
    messages,
    incomingMessage,
    canMergeHistorySubagentMessage,
  );
  if (existingIndex >= 0) {
    const existingMessage = messages[existingIndex];
    if (isSubagentMessage(existingMessage)) {
      messages[existingIndex] = mergeHistorySubagentMessages(existingMessage, incomingMessage);
      return;
    }
  }

  messages.push(incomingMessage);
};

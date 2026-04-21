import {
  findFirstChangedSessionMessageIndex,
  forEachSessionMessage,
  getSessionMessageAt,
  getSessionMessagesSlice,
  isFinalAssistantChatMessage,
} from "@/state/operations/agent-orchestrator/support/messages";
import type {
  AgentChatMessage,
  AgentSessionMessages,
  AgentSessionState,
  SessionMessagesState,
} from "@/types/agent-orchestrator";

/** Initial number of user turns rendered from the bottom of the transcript. */
export const CHAT_TURN_WINDOW_INIT = 10;
/** Number of older user turns revealed per upward backfill step. */
export const CHAT_TURN_WINDOW_BATCH = 8;

export type AgentChatWindowRow =
  | {
      kind: "turn_duration";
      key: string;
      durationMs: number;
    }
  | {
      kind: "message";
      key: string;
      message: AgentChatMessage;
    };

export type AgentChatWindowTurn = {
  key: string;
  start: number;
  end: number;
};

type AgentChatWindowAggregateMetadata = {
  hasAttachmentMessages: boolean;
  lastUserMessageId: string | null;
  activeStreamingAssistantMessageId: string | null;
};

type AgentChatWindowMetadataTimeline = {
  hasAttachmentMessagesByMessageIndex: boolean[];
  lastUserMessageIdByMessageIndex: Array<string | null>;
  activeStreamingAssistantMessageIdByMessageIndex: Array<string | null>;
};

type AgentChatWindowRowsCoreState = {
  rows: AgentChatWindowRow[];
  rowStartByMessageIndex: number[];
  rebuildStartByMessageIndex: number[];
  latestRebuildStartMessageIndex: number;
  turns: AgentChatWindowTurn[];
};

export type AgentChatWindowRowsState = AgentChatWindowRowsCoreState &
  AgentChatWindowMetadataTimeline &
  AgentChatWindowAggregateMetadata;

type AgentChatWindowResolvedState = Pick<
  AgentChatWindowRowsState,
  | "rows"
  | "turns"
  | "hasAttachmentMessages"
  | "lastUserMessageId"
  | "activeStreamingAssistantMessageId"
>;

export type AgentChatWindowRowsCacheEntry = AgentChatWindowRowsState & {
  messages: AgentSessionState["messages"];
  rawMessageSignatures: string[] | null;
};

const CHAT_WINDOW_ROWS_CACHE_LIMIT = 6;

const toAgentChatWindowRowsCacheKey = (sessionId: string, showThinkingMessages: boolean): string =>
  `${sessionId}:${showThinkingMessages ? "thinking:on" : "thinking:off"}`;

const touchAgentChatWindowRowsCacheEntry = (
  cache: Map<string, AgentChatWindowRowsCacheEntry>,
  cacheKey: string,
  entry: AgentChatWindowRowsCacheEntry,
): void => {
  if (cache.has(cacheKey)) {
    cache.delete(cacheKey);
  }

  cache.set(cacheKey, entry);

  while (cache.size > CHAT_WINDOW_ROWS_CACHE_LIMIT) {
    const oldestKey = cache.keys().next().value;
    if (typeof oldestKey !== "string") {
      break;
    }
    cache.delete(oldestKey);
  }
};

type BuildAgentChatWindowRowsOptions = {
  showThinkingMessages: boolean;
};

const isSessionMessagesState = (
  messages: AgentSessionMessages,
): messages is SessionMessagesState => {
  return (
    typeof messages === "object" &&
    messages !== null &&
    "count" in messages &&
    "version" in messages
  );
};

const buildAgentChatMessageSignature = (message: AgentChatMessage): string => {
  return JSON.stringify([
    message.id,
    message.role,
    message.content,
    message.timestamp,
    message.meta ?? null,
  ]);
};

const buildRawMessageSignatures = (messages: AgentSessionMessages): string[] | null => {
  if (!Array.isArray(messages)) {
    return null;
  }

  return messages.map(buildAgentChatMessageSignature);
};

const areSessionMessageContainersEquivalent = (
  previousMessages: AgentSessionMessages,
  nextMessages: AgentSessionMessages,
  sessionId: string,
): boolean => {
  if (isSessionMessagesState(previousMessages) && isSessionMessagesState(nextMessages)) {
    if (previousMessages === nextMessages) {
      return true;
    }

    return (
      previousMessages.sessionId === sessionId &&
      nextMessages.sessionId === sessionId &&
      previousMessages.version === nextMessages.version &&
      previousMessages.count === nextMessages.count
    );
  }

  return false;
};

const findFirstChangedRawMessageSignatureIndex = (
  previousSignatures: string[],
  nextMessages: AgentSessionMessages,
): number => {
  const nextSignatures = buildRawMessageSignatures(nextMessages);
  if (!nextSignatures) {
    return 0;
  }

  if (nextSignatures.length < previousSignatures.length) {
    return 0;
  }

  const sharedLength = Math.min(previousSignatures.length, nextSignatures.length);
  let changedTailIndex = sharedLength - 1;
  while (changedTailIndex >= 0) {
    if (previousSignatures[changedTailIndex] !== nextSignatures[changedTailIndex]) {
      break;
    }
    changedTailIndex -= 1;
  }

  if (changedTailIndex >= 0) {
    while (changedTailIndex > 0) {
      if (previousSignatures[changedTailIndex - 1] === nextSignatures[changedTailIndex - 1]) {
        break;
      }
      changedTailIndex -= 1;
    }
    return changedTailIndex;
  }

  return nextSignatures.length > previousSignatures.length ? previousSignatures.length : -1;
};

const findFirstChangedCachedMessageIndex = (
  cacheEntry: AgentChatWindowRowsCacheEntry,
  session: AgentSessionState,
): number => {
  if (Array.isArray(cacheEntry.messages) && Array.isArray(session.messages)) {
    const previousSignatures = cacheEntry.rawMessageSignatures;
    if (!previousSignatures) {
      return 0;
    }

    return findFirstChangedRawMessageSignatureIndex(previousSignatures, session.messages);
  }

  return findFirstChangedChatMessageIndex(cacheEntry.messages, session);
};

const appendMessageRows = (
  rows: AgentChatWindowRow[],
  rowStartByMessageIndex: number[],
  sessionId: string,
  message: AgentChatMessage,
  messageIndex: number,
  showThinkingMessages: boolean,
): void => {
  rowStartByMessageIndex[messageIndex] = rows.length;

  if (message.role === "thinking" && !showThinkingMessages) {
    return;
  }

  const assistantMeta = message.meta?.kind === "assistant" ? message.meta : null;
  const turnDurationMs = assistantMeta?.durationMs;
  const shouldShowTurnDuration =
    isFinalAssistantChatMessage(message) &&
    typeof turnDurationMs === "number" &&
    turnDurationMs > 0;

  if (shouldShowTurnDuration) {
    rows.push({
      kind: "turn_duration",
      // Scope row identity to the active session to avoid cross-session cache reuse.
      key: `${sessionId}:${message.id}:duration`,
      durationMs: turnDurationMs,
    });
  }

  rows.push({
    kind: "message",
    // Message IDs can repeat across sessions; include session ID for stable row keys.
    key: `${sessionId}:${message.id}`,
    message,
  });
};

const getPrefixMetadata = (
  cacheEntry: AgentChatWindowRowsCacheEntry,
  rebuildStartMessageIndex: number,
): AgentChatWindowAggregateMetadata => {
  const previousMessageIndex = rebuildStartMessageIndex - 1;
  if (previousMessageIndex < 0) {
    return {
      hasAttachmentMessages: false,
      lastUserMessageId: null,
      activeStreamingAssistantMessageId: null,
    };
  }

  return {
    hasAttachmentMessages:
      cacheEntry.hasAttachmentMessagesByMessageIndex[previousMessageIndex] ?? false,
    lastUserMessageId: cacheEntry.lastUserMessageIdByMessageIndex[previousMessageIndex] ?? null,
    activeStreamingAssistantMessageId:
      cacheEntry.activeStreamingAssistantMessageIdByMessageIndex[previousMessageIndex] ?? null,
  };
};

const rebaseIncrementalMetadata = ({
  suffixRowsState,
  prefixMetadata,
  sessionStatus,
}: {
  suffixRowsState: AgentChatWindowRowsState;
  prefixMetadata: AgentChatWindowAggregateMetadata;
  sessionStatus: AgentSessionState["status"];
}): AgentChatWindowMetadataTimeline => {
  return {
    hasAttachmentMessagesByMessageIndex: suffixRowsState.hasAttachmentMessagesByMessageIndex.map(
      (value) => prefixMetadata.hasAttachmentMessages || value,
    ),
    lastUserMessageIdByMessageIndex: suffixRowsState.lastUserMessageIdByMessageIndex.map(
      (value) => value ?? prefixMetadata.lastUserMessageId,
    ),
    activeStreamingAssistantMessageIdByMessageIndex:
      suffixRowsState.activeStreamingAssistantMessageIdByMessageIndex.map((value) =>
        sessionStatus === "running"
          ? (value ?? prefixMetadata.activeStreamingAssistantMessageId)
          : null,
      ),
  };
};

const toResolvedWindowRowsState = (
  cacheEntry: AgentChatWindowRowsCacheEntry,
  sessionStatus: AgentSessionState["status"],
): AgentChatWindowResolvedState => {
  return {
    rows: cacheEntry.rows,
    turns: cacheEntry.turns,
    hasAttachmentMessages: cacheEntry.hasAttachmentMessages,
    lastUserMessageId: cacheEntry.lastUserMessageId,
    activeStreamingAssistantMessageId:
      sessionStatus === "running" ? cacheEntry.activeStreamingAssistantMessageId : null,
  };
};

const createWindowRowsCacheEntry = (
  sessionMessages: AgentSessionState["messages"],
  rowsState: AgentChatWindowRowsState,
): AgentChatWindowRowsCacheEntry => {
  return {
    ...rowsState,
    messages: sessionMessages,
    rawMessageSignatures: buildRawMessageSignatures(sessionMessages),
  };
};

export function buildAgentChatWindowRowsState(
  session: AgentSessionState,
  { showThinkingMessages }: BuildAgentChatWindowRowsOptions,
): AgentChatWindowRowsState {
  const rows: AgentChatWindowRow[] = [];
  const rowStartByMessageIndex: number[] = [];
  const rebuildStartByMessageIndex: number[] = [];
  const hasAttachmentMessagesByMessageIndex: boolean[] = [];
  const lastUserMessageIdByMessageIndex: Array<string | null> = [];
  const activeStreamingAssistantMessageIdByMessageIndex: Array<string | null> = [];
  const turnRowStartIndexes: number[] = [];
  let currentVisibleTurnStartMessageIndex = 0;
  let hasEnteredVisibleTranscript = false;
  let hasAttachmentMessages = false;
  let lastUserMessageId: string | null = null;
  let activeStreamingAssistantMessageId: string | null = null;

  forEachSessionMessage(session, (message, messageIndex) => {
    const isVisibleMessage = !(message.role === "thinking" && !showThinkingMessages);

    if (
      !hasAttachmentMessages &&
      message.meta?.kind === "user" &&
      message.meta.parts?.some((part) => part.kind === "attachment")
    ) {
      hasAttachmentMessages = true;
    }

    if (message.role === "user") {
      lastUserMessageId = message.id;
    }

    if (session.status === "running") {
      const isStreamingAssistantMessage =
        message.role === "assistant" &&
        message.meta?.kind === "assistant" &&
        message.meta.isFinal === false;
      if (isStreamingAssistantMessage) {
        activeStreamingAssistantMessageId = message.id;
      }
    }

    hasAttachmentMessagesByMessageIndex[messageIndex] = hasAttachmentMessages;
    lastUserMessageIdByMessageIndex[messageIndex] = lastUserMessageId;
    activeStreamingAssistantMessageIdByMessageIndex[messageIndex] =
      activeStreamingAssistantMessageId;

    if (isVisibleMessage) {
      if (!hasEnteredVisibleTranscript) {
        currentVisibleTurnStartMessageIndex = messageIndex;
        hasEnteredVisibleTranscript = true;
      }

      if (message.role === "user") {
        currentVisibleTurnStartMessageIndex = messageIndex;
      }
    }

    // If this message changes later, rebuild from the first visible message in its turn.
    rebuildStartByMessageIndex[messageIndex] = currentVisibleTurnStartMessageIndex;

    if (!isVisibleMessage) {
      rowStartByMessageIndex[messageIndex] = rows.length;
      return;
    }

    const nextRowStart = rows.length;
    if (nextRowStart === 0 || message.role === "user") {
      turnRowStartIndexes.push(nextRowStart);
    }

    appendMessageRows(
      rows,
      rowStartByMessageIndex,
      session.sessionId,
      message,
      messageIndex,
      showThinkingMessages,
    );
  });

  return {
    rows,
    rowStartByMessageIndex,
    rebuildStartByMessageIndex,
    hasAttachmentMessagesByMessageIndex,
    lastUserMessageIdByMessageIndex,
    activeStreamingAssistantMessageIdByMessageIndex,
    latestRebuildStartMessageIndex: currentVisibleTurnStartMessageIndex,
    turns: turnRowStartIndexes.map((start, index) => ({
      key: rows[start]?.key ?? `turn-${index}`,
      start,
      end: (turnRowStartIndexes[index + 1] ?? rows.length) - 1,
    })),
    hasAttachmentMessages,
    lastUserMessageId,
    activeStreamingAssistantMessageId,
  };
}

export function resolveAgentChatWindowRowsState({
  session,
  showThinkingMessages,
  cache,
}: {
  session: AgentSessionState;
  showThinkingMessages: boolean;
  cache: Map<string, AgentChatWindowRowsCacheEntry>;
}): Pick<AgentChatWindowRowsState, keyof AgentChatWindowResolvedState> {
  const cacheKey = toAgentChatWindowRowsCacheKey(session.sessionId, showThinkingMessages);
  const cacheEntry = cache.get(cacheKey);

  if (cacheEntry) {
    if (
      areSessionMessageContainersEquivalent(
        cacheEntry.messages,
        session.messages,
        session.sessionId,
      )
    ) {
      touchAgentChatWindowRowsCacheEntry(cache, cacheKey, cacheEntry);
      return toResolvedWindowRowsState(cacheEntry, session.status);
    }

    const firstChangedMessageIndex = findFirstChangedCachedMessageIndex(cacheEntry, session);
    if (firstChangedMessageIndex < 0) {
      touchAgentChatWindowRowsCacheEntry(cache, cacheKey, cacheEntry);
      return toResolvedWindowRowsState(cacheEntry, session.status);
    }

    const rebuildStartMessageIndex = (() => {
      const cachedRebuildStart = cacheEntry.rebuildStartByMessageIndex[firstChangedMessageIndex];
      if (typeof cachedRebuildStart === "number") {
        return cachedRebuildStart;
      }

      const changedMessage = getSessionMessageAt(session, firstChangedMessageIndex);
      if (changedMessage?.role === "user") {
        return firstChangedMessageIndex;
      }

      return cacheEntry.latestRebuildStartMessageIndex;
    })();

    if (rebuildStartMessageIndex > 0) {
      const prefixMetadata = getPrefixMetadata(cacheEntry, rebuildStartMessageIndex);
      const prefixRowCount =
        cacheEntry.rowStartByMessageIndex[rebuildStartMessageIndex] ?? cacheEntry.rows.length;
      const rebuiltRows = cacheEntry.rows.slice(0, prefixRowCount);
      const rebuiltRowStartByMessageIndex = cacheEntry.rowStartByMessageIndex.slice(
        0,
        rebuildStartMessageIndex,
      );
      const suffixRowsState = buildAgentChatWindowRowsState(
        {
          ...session,
          messages: getSessionMessagesSlice(session, rebuildStartMessageIndex),
        },
        { showThinkingMessages },
      );
      const rebasedSuffixMetadata = rebaseIncrementalMetadata({
        suffixRowsState,
        prefixMetadata,
        sessionStatus: session.status,
      });

      for (let index = 0; index < suffixRowsState.rowStartByMessageIndex.length; index += 1) {
        const rowStart = suffixRowsState.rowStartByMessageIndex[index];
        if (typeof rowStart !== "number") {
          continue;
        }
        rebuiltRowStartByMessageIndex[rebuildStartMessageIndex + index] = prefixRowCount + rowStart;
      }

      const rebuiltTurns = cacheEntry.turns.slice();
      while (rebuiltTurns.length > 0) {
        const lastTurn = rebuiltTurns[rebuiltTurns.length - 1];
        if (!lastTurn || lastTurn.start < prefixRowCount) {
          break;
        }
        rebuiltTurns.pop();
      }
      rebuiltTurns.push(
        ...suffixRowsState.turns.map((turn) => ({
          key: turn.key,
          start: prefixRowCount + turn.start,
          end: prefixRowCount + turn.end,
        })),
      );
      rebuiltRows.push(...suffixRowsState.rows);

      const nextCacheEntry = createWindowRowsCacheEntry(session.messages, {
        rows: rebuiltRows,
        rowStartByMessageIndex: rebuiltRowStartByMessageIndex,
        rebuildStartByMessageIndex: [
          ...cacheEntry.rebuildStartByMessageIndex.slice(0, rebuildStartMessageIndex),
          ...suffixRowsState.rebuildStartByMessageIndex.map(
            (index) => rebuildStartMessageIndex + index,
          ),
        ],
        hasAttachmentMessagesByMessageIndex: [
          ...cacheEntry.hasAttachmentMessagesByMessageIndex.slice(0, rebuildStartMessageIndex),
          ...rebasedSuffixMetadata.hasAttachmentMessagesByMessageIndex,
        ],
        lastUserMessageIdByMessageIndex: [
          ...cacheEntry.lastUserMessageIdByMessageIndex.slice(0, rebuildStartMessageIndex),
          ...rebasedSuffixMetadata.lastUserMessageIdByMessageIndex,
        ],
        activeStreamingAssistantMessageIdByMessageIndex: [
          ...cacheEntry.activeStreamingAssistantMessageIdByMessageIndex.slice(
            0,
            rebuildStartMessageIndex,
          ),
          ...rebasedSuffixMetadata.activeStreamingAssistantMessageIdByMessageIndex,
        ],
        latestRebuildStartMessageIndex:
          rebuildStartMessageIndex + suffixRowsState.latestRebuildStartMessageIndex,
        turns: rebuiltTurns,
        hasAttachmentMessages:
          prefixMetadata.hasAttachmentMessages || suffixRowsState.hasAttachmentMessages,
        lastUserMessageId: suffixRowsState.lastUserMessageId ?? prefixMetadata.lastUserMessageId,
        activeStreamingAssistantMessageId:
          session.status === "running"
            ? (suffixRowsState.activeStreamingAssistantMessageId ??
              prefixMetadata.activeStreamingAssistantMessageId)
            : null,
      });
      touchAgentChatWindowRowsCacheEntry(cache, cacheKey, nextCacheEntry);
      return toResolvedWindowRowsState(nextCacheEntry, session.status);
    }
  }

  const rebuiltRowsState = buildAgentChatWindowRowsState(session, { showThinkingMessages });
  const nextCacheEntry = createWindowRowsCacheEntry(session.messages, rebuiltRowsState);
  touchAgentChatWindowRowsCacheEntry(cache, cacheKey, nextCacheEntry);
  return toResolvedWindowRowsState(nextCacheEntry, session.status);
}

export function buildAgentChatWindowRows(
  session: AgentSessionState,
  { showThinkingMessages }: BuildAgentChatWindowRowsOptions,
): AgentChatWindowRow[] {
  return buildAgentChatWindowRowsState(session, { showThinkingMessages }).rows;
}

export function findFirstChangedChatMessageIndex(
  previousMessages: AgentSessionState["messages"] | null,
  nextSession: Pick<AgentSessionState, "sessionId" | "messages">,
): number {
  return findFirstChangedSessionMessageIndex(previousMessages, nextSession);
}

export function buildAgentChatWindowTurns(rows: AgentChatWindowRow[]): AgentChatWindowTurn[] {
  if (rows.length === 0) {
    return [];
  }

  const turnStartIndices: number[] = [0];

  for (let rowIndex = 1; rowIndex < rows.length; rowIndex += 1) {
    const row = rows[rowIndex];
    if (row?.kind !== "message" || row.message.role !== "user") {
      continue;
    }

    turnStartIndices.push(rowIndex);
  }

  return turnStartIndices.map((start, index) => ({
    key: rows[start]?.key ?? `turn-${index}`,
    start,
    end: (turnStartIndices[index + 1] ?? rows.length) - 1,
  }));
}

export function getAgentChatInitialTurnStart(turnCount: number): number {
  return turnCount > CHAT_TURN_WINDOW_INIT ? turnCount - CHAT_TURN_WINDOW_INIT : 0;
}

export function getAgentChatWindowRowsKey(
  session: AgentSessionState,
  showThinkingMessages: boolean,
  resolveMessageIdentityToken: (message: AgentChatMessage) => number,
): string {
  const signatureParts: string[] = [
    session.sessionId,
    showThinkingMessages ? "thinking:on" : "thinking:off",
  ];

  forEachSessionMessage(session, (message) => {
    const assistantDurationToken =
      message.meta?.kind === "assistant" && typeof message.meta.durationMs === "number"
        ? String(message.meta.durationMs)
        : "";
    signatureParts.push(
      String(resolveMessageIdentityToken(message)),
      message.id,
      message.role,
      assistantDurationToken,
    );
  });

  return signatureParts.join("\u001f");
}

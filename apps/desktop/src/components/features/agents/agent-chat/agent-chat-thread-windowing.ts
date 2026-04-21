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

export type AgentChatWindowRowsCacheEntry = {
  messages: AgentSessionState["messages"];
  rows: AgentChatWindowRow[];
  rowStartByMessageIndex: number[];
  rebuildStartByMessageIndex: number[];
  hasAttachmentMessagesByMessageIndex: boolean[];
  lastUserMessageIdByMessageIndex: Array<string | null>;
  activeStreamingAssistantMessageIdByMessageIndex: Array<string | null>;
  latestRebuildStartMessageIndex: number;
  turns: AgentChatWindowTurn[];
  hasAttachmentMessages: boolean;
  lastUserMessageId: string | null;
  activeStreamingAssistantMessageId: string | null;
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

export type AgentChatWindowRowsState = {
  rows: AgentChatWindowRow[];
  rowStartByMessageIndex: number[];
  rebuildStartByMessageIndex: number[];
  hasAttachmentMessagesByMessageIndex: boolean[];
  lastUserMessageIdByMessageIndex: Array<string | null>;
  activeStreamingAssistantMessageIdByMessageIndex: Array<string | null>;
  latestRebuildStartMessageIndex: number;
  turns: AgentChatWindowTurn[];
  hasAttachmentMessages: boolean;
  lastUserMessageId: string | null;
  activeStreamingAssistantMessageId: string | null;
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

const areSessionMessageContainersEquivalent = (
  previousMessages: AgentSessionMessages,
  nextMessages: AgentSessionMessages,
  sessionId: string,
): boolean => {
  if (previousMessages === nextMessages) {
    return true;
  }

  if (isSessionMessagesState(previousMessages) && isSessionMessagesState(nextMessages)) {
    return (
      previousMessages.sessionId === sessionId &&
      nextMessages.sessionId === sessionId &&
      previousMessages.version === nextMessages.version &&
      previousMessages.count === nextMessages.count
    );
  }

  return false;
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
): {
  hasAttachmentMessages: boolean;
  lastUserMessageId: string | null;
  activeStreamingAssistantMessageId: string | null;
} => {
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
  const turnStartIndices: number[] = [];
  let currentRebuildStartMessageIndex = 0;
  let hasVisibleMessages = false;
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
      if (!hasVisibleMessages) {
        currentRebuildStartMessageIndex = messageIndex;
        hasVisibleMessages = true;
      }

      if (message.role === "user") {
        currentRebuildStartMessageIndex = messageIndex;
      }
    }

    rebuildStartByMessageIndex[messageIndex] = currentRebuildStartMessageIndex;

    if (!isVisibleMessage) {
      rowStartByMessageIndex[messageIndex] = rows.length;
      return;
    }

    const nextRowStart = rows.length;
    if (nextRowStart === 0 || message.role === "user") {
      turnStartIndices.push(nextRowStart);
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
    latestRebuildStartMessageIndex: currentRebuildStartMessageIndex,
    turns: turnStartIndices.map((start, index) => ({
      key: rows[start]?.key ?? `turn-${index}`,
      start,
      end: (turnStartIndices[index + 1] ?? rows.length) - 1,
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
}): Pick<
  AgentChatWindowRowsState,
  | "rows"
  | "turns"
  | "hasAttachmentMessages"
  | "lastUserMessageId"
  | "activeStreamingAssistantMessageId"
> {
  const cacheKey = toAgentChatWindowRowsCacheKey(session.sessionId, showThinkingMessages);
  const cachedRows = cache.get(cacheKey);

  if (cachedRows) {
    if (
      areSessionMessageContainersEquivalent(
        cachedRows.messages,
        session.messages,
        session.sessionId,
      )
    ) {
      touchAgentChatWindowRowsCacheEntry(cache, cacheKey, cachedRows);
      return {
        rows: cachedRows.rows,
        turns: cachedRows.turns,
        hasAttachmentMessages: cachedRows.hasAttachmentMessages,
        lastUserMessageId: cachedRows.lastUserMessageId,
        activeStreamingAssistantMessageId:
          session.status === "running" ? cachedRows.activeStreamingAssistantMessageId : null,
      };
    }

    const firstChangedMessageIndex = findFirstChangedChatMessageIndex(cachedRows.messages, session);
    if (firstChangedMessageIndex < 0) {
      touchAgentChatWindowRowsCacheEntry(cache, cacheKey, cachedRows);
      return {
        rows: cachedRows.rows,
        turns: cachedRows.turns,
        hasAttachmentMessages: cachedRows.hasAttachmentMessages,
        lastUserMessageId: cachedRows.lastUserMessageId,
        activeStreamingAssistantMessageId:
          session.status === "running" ? cachedRows.activeStreamingAssistantMessageId : null,
      };
    }

    const rebuildStartMessageIndex = (() => {
      const cachedRebuildStart = cachedRows.rebuildStartByMessageIndex[firstChangedMessageIndex];
      if (typeof cachedRebuildStart === "number") {
        return cachedRebuildStart;
      }

      const changedMessage = getSessionMessageAt(session, firstChangedMessageIndex);
      if (changedMessage?.role === "user") {
        return firstChangedMessageIndex;
      }

      return cachedRows.latestRebuildStartMessageIndex;
    })();

    if (rebuildStartMessageIndex > 0) {
      const prefixMetadata = getPrefixMetadata(cachedRows, rebuildStartMessageIndex);
      const prefixRowEnd =
        cachedRows.rowStartByMessageIndex[rebuildStartMessageIndex] ?? cachedRows.rows.length;
      const nextRows = cachedRows.rows.slice(0, prefixRowEnd);
      const nextRowStartByMessageIndex = cachedRows.rowStartByMessageIndex.slice(
        0,
        rebuildStartMessageIndex,
      );
      const incrementalRowsState = buildAgentChatWindowRowsState(
        {
          ...session,
          messages: getSessionMessagesSlice(session, rebuildStartMessageIndex),
        },
        { showThinkingMessages },
      );

      for (let index = 0; index < incrementalRowsState.rowStartByMessageIndex.length; index += 1) {
        const rowStart = incrementalRowsState.rowStartByMessageIndex[index];
        if (typeof rowStart !== "number") {
          continue;
        }
        nextRowStartByMessageIndex[rebuildStartMessageIndex + index] = prefixRowEnd + rowStart;
      }

      const nextTurns = cachedRows.turns.slice();
      while (nextTurns.length > 0) {
        const lastTurn = nextTurns[nextTurns.length - 1];
        if (!lastTurn || lastTurn.start < prefixRowEnd) {
          break;
        }
        nextTurns.pop();
      }
      nextTurns.push(
        ...incrementalRowsState.turns.map((turn) => ({
          key: turn.key,
          start: prefixRowEnd + turn.start,
          end: prefixRowEnd + turn.end,
        })),
      );
      nextRows.push(...incrementalRowsState.rows);

      const nextCacheEntry: AgentChatWindowRowsCacheEntry = {
        messages: session.messages,
        rows: nextRows,
        rowStartByMessageIndex: nextRowStartByMessageIndex,
        rebuildStartByMessageIndex: [
          ...cachedRows.rebuildStartByMessageIndex.slice(0, rebuildStartMessageIndex),
          ...incrementalRowsState.rebuildStartByMessageIndex.map(
            (index) => rebuildStartMessageIndex + index,
          ),
        ],
        hasAttachmentMessagesByMessageIndex: [
          ...cachedRows.hasAttachmentMessagesByMessageIndex.slice(0, rebuildStartMessageIndex),
          ...incrementalRowsState.hasAttachmentMessagesByMessageIndex,
        ],
        lastUserMessageIdByMessageIndex: [
          ...cachedRows.lastUserMessageIdByMessageIndex.slice(0, rebuildStartMessageIndex),
          ...incrementalRowsState.lastUserMessageIdByMessageIndex,
        ],
        activeStreamingAssistantMessageIdByMessageIndex: [
          ...cachedRows.activeStreamingAssistantMessageIdByMessageIndex.slice(
            0,
            rebuildStartMessageIndex,
          ),
          ...incrementalRowsState.activeStreamingAssistantMessageIdByMessageIndex,
        ],
        latestRebuildStartMessageIndex:
          rebuildStartMessageIndex + incrementalRowsState.latestRebuildStartMessageIndex,
        turns: nextTurns,
        hasAttachmentMessages:
          prefixMetadata.hasAttachmentMessages || incrementalRowsState.hasAttachmentMessages,
        lastUserMessageId:
          incrementalRowsState.lastUserMessageId ?? prefixMetadata.lastUserMessageId,
        activeStreamingAssistantMessageId:
          session.status === "running"
            ? (incrementalRowsState.activeStreamingAssistantMessageId ??
              prefixMetadata.activeStreamingAssistantMessageId)
            : null,
      };
      touchAgentChatWindowRowsCacheEntry(cache, cacheKey, nextCacheEntry);
      return {
        rows: nextRows,
        turns: nextTurns,
        hasAttachmentMessages: nextCacheEntry.hasAttachmentMessages,
        lastUserMessageId: nextCacheEntry.lastUserMessageId,
        activeStreamingAssistantMessageId: nextCacheEntry.activeStreamingAssistantMessageId,
      };
    }
  }

  const nextRowsState = buildAgentChatWindowRowsState(session, { showThinkingMessages });
  touchAgentChatWindowRowsCacheEntry(cache, cacheKey, {
    messages: session.messages,
    rows: nextRowsState.rows,
    rowStartByMessageIndex: nextRowsState.rowStartByMessageIndex,
    rebuildStartByMessageIndex: nextRowsState.rebuildStartByMessageIndex,
    hasAttachmentMessagesByMessageIndex: nextRowsState.hasAttachmentMessagesByMessageIndex,
    lastUserMessageIdByMessageIndex: nextRowsState.lastUserMessageIdByMessageIndex,
    activeStreamingAssistantMessageIdByMessageIndex:
      nextRowsState.activeStreamingAssistantMessageIdByMessageIndex,
    latestRebuildStartMessageIndex: nextRowsState.latestRebuildStartMessageIndex,
    turns: nextRowsState.turns,
    hasAttachmentMessages: nextRowsState.hasAttachmentMessages,
    lastUserMessageId: nextRowsState.lastUserMessageId,
    activeStreamingAssistantMessageId: nextRowsState.activeStreamingAssistantMessageId,
  });
  return {
    rows: nextRowsState.rows,
    turns: nextRowsState.turns,
    hasAttachmentMessages: nextRowsState.hasAttachmentMessages,
    lastUserMessageId: nextRowsState.lastUserMessageId,
    activeStreamingAssistantMessageId: nextRowsState.activeStreamingAssistantMessageId,
  };
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

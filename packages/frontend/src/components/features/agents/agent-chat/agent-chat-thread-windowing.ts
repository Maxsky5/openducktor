import {
  forEachSessionMessage,
  getSessionMessageAt,
  getSessionMessageCount,
  isFinalAssistantChatMessage,
} from "@/state/operations/agent-orchestrator/support/messages";
import type {
  AgentChatMessage,
  AgentSessionMessages,
  SessionMessagesState,
} from "@/types/agent-orchestrator";
import type { AgentChatThreadSession } from "./agent-chat.types";

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

export type AgentChatWindowRowsState = AgentChatWindowAggregateMetadata & {
  rows: AgentChatWindowRow[];
  turns: AgentChatWindowTurn[];
};

type AgentChatWindowResolvedState = Pick<
  AgentChatWindowRowsState,
  | "rows"
  | "turns"
  | "hasAttachmentMessages"
  | "lastUserMessageId"
  | "activeStreamingAssistantMessageId"
>;

export type AgentChatWindowRowsCacheEntry = AgentChatWindowRowsState & {
  messages: AgentChatThreadSession["messages"];
};

const CHAT_WINDOW_ROWS_CACHE_LIMIT = 6;

const toAgentChatWindowRowsCacheKey = (
  externalSessionId: string,
  showThinkingMessages: boolean,
): string => `${externalSessionId}:${showThinkingMessages ? "thinking:on" : "thinking:off"}`;

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

export type AgentChatWindowRowsStateBuilder = {
  step: (maxMessages?: number) => number;
  isDone: () => boolean;
  complete: () => AgentChatWindowRowsState;
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
  externalSessionId: string,
): boolean => {
  if (isSessionMessagesState(previousMessages) && isSessionMessagesState(nextMessages)) {
    if (previousMessages === nextMessages) {
      return true;
    }

    return (
      previousMessages.externalSessionId === externalSessionId &&
      nextMessages.externalSessionId === externalSessionId &&
      previousMessages.version === nextMessages.version &&
      previousMessages.count === nextMessages.count
    );
  }

  return false;
};

const appendMessageRows = (
  rows: AgentChatWindowRow[],
  externalSessionId: string,
  message: AgentChatMessage,
  showThinkingMessages: boolean,
): void => {
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
      key: `${externalSessionId}:${message.id}:duration`,
      durationMs: turnDurationMs,
    });
  }

  rows.push({
    kind: "message",
    // Message IDs can repeat across sessions; include session ID for stable row keys.
    key: `${externalSessionId}:${message.id}`,
    message,
  });
};

const findActiveStreamingAssistantMessageId = (rows: AgentChatWindowRow[]): string | null => {
  for (let index = rows.length - 1; index >= 0; index -= 1) {
    const row = rows[index];
    if (
      row?.kind === "message" &&
      row.message.role === "assistant" &&
      row.message.meta?.kind === "assistant" &&
      row.message.meta.isFinal === false
    ) {
      return row.message.id;
    }
  }

  return null;
};

const toResolvedWindowRowsState = (
  cacheEntry: AgentChatWindowRowsCacheEntry,
  sessionStatus: AgentChatThreadSession["status"],
): AgentChatWindowResolvedState => {
  return {
    rows: cacheEntry.rows,
    turns: cacheEntry.turns,
    hasAttachmentMessages: cacheEntry.hasAttachmentMessages,
    lastUserMessageId: cacheEntry.lastUserMessageId,
    activeStreamingAssistantMessageId:
      sessionStatus === "running"
        ? (cacheEntry.activeStreamingAssistantMessageId ??
          findActiveStreamingAssistantMessageId(cacheEntry.rows))
        : null,
  };
};

const createWindowRowsCacheEntry = (
  sessionMessages: AgentChatThreadSession["messages"],
  rowsState: AgentChatWindowRowsState,
): AgentChatWindowRowsCacheEntry => {
  return {
    ...rowsState,
    messages: sessionMessages,
  };
};

export const writeAgentChatWindowRowsCacheEntry = ({
  session,
  showThinkingMessages,
  rowsState,
  cache,
}: {
  session: AgentChatThreadSession;
  showThinkingMessages: boolean;
  rowsState: AgentChatWindowRowsState;
  cache: Map<string, AgentChatWindowRowsCacheEntry>;
}): AgentChatWindowRowsCacheEntry => {
  const cacheKey = toAgentChatWindowRowsCacheKey(session.externalSessionId, showThinkingMessages);
  const cacheEntry = createWindowRowsCacheEntry(session.messages, rowsState);
  touchAgentChatWindowRowsCacheEntry(cache, cacheKey, cacheEntry);
  return cacheEntry;
};

export const peekReusableAgentChatWindowRowsState = ({
  session,
  showThinkingMessages,
  cache,
}: {
  session: AgentChatThreadSession;
  showThinkingMessages: boolean;
  cache: Map<string, AgentChatWindowRowsCacheEntry>;
}): Pick<AgentChatWindowRowsState, keyof AgentChatWindowResolvedState> | null => {
  const cacheKey = toAgentChatWindowRowsCacheKey(session.externalSessionId, showThinkingMessages);
  const cacheEntry = cache.get(cacheKey);
  if (!cacheEntry) {
    return null;
  }

  if (
    !areSessionMessageContainersEquivalent(
      cacheEntry.messages,
      session.messages,
      session.externalSessionId,
    )
  ) {
    return null;
  }

  touchAgentChatWindowRowsCacheEntry(cache, cacheKey, cacheEntry);
  return toResolvedWindowRowsState(cacheEntry, session.status);
};

export function createAgentChatWindowRowsStateBuilder(
  session: AgentChatThreadSession,
  { showThinkingMessages }: BuildAgentChatWindowRowsOptions,
): AgentChatWindowRowsStateBuilder {
  const rows: AgentChatWindowRow[] = [];
  const turnRowStartIndexes: number[] = [];
  const messageCount = getSessionMessageCount(session);
  let hasAttachmentMessages = false;
  let lastUserMessageId: string | null = null;
  let activeStreamingAssistantMessageId: string | null = null;
  let nextMessageIndex = 0;

  const processMessage = (message: AgentChatMessage): void => {
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

    if (!isVisibleMessage) {
      return;
    }

    const nextRowStart = rows.length;
    if (nextRowStart === 0 || message.role === "user") {
      turnRowStartIndexes.push(nextRowStart);
    }

    appendMessageRows(rows, session.externalSessionId, message, showThinkingMessages);
  };

  return {
    step(maxMessages = Number.POSITIVE_INFINITY): number {
      let processedCount = 0;
      while (processedCount < maxMessages && nextMessageIndex < messageCount) {
        const message = getSessionMessageAt(session, nextMessageIndex);
        if (message) {
          processMessage(message);
        }
        nextMessageIndex += 1;
        processedCount += 1;
      }
      return processedCount;
    },
    isDone(): boolean {
      return nextMessageIndex >= messageCount;
    },
    complete(): AgentChatWindowRowsState {
      if (nextMessageIndex < messageCount) {
        this.step();
      }

      return {
        rows,
        turns: turnRowStartIndexes.map((start, index) => ({
          key: rows[start]?.key ?? `turn-${index}`,
          start,
          end: (turnRowStartIndexes[index + 1] ?? rows.length) - 1,
        })),
        hasAttachmentMessages,
        lastUserMessageId,
        activeStreamingAssistantMessageId,
      };
    },
  };
}

export function buildAgentChatWindowRowsState(
  session: AgentChatThreadSession,
  { showThinkingMessages }: BuildAgentChatWindowRowsOptions,
): AgentChatWindowRowsState {
  return createAgentChatWindowRowsStateBuilder(session, { showThinkingMessages }).complete();
}

export function buildAgentChatWindowRows(
  session: AgentChatThreadSession,
  { showThinkingMessages }: BuildAgentChatWindowRowsOptions,
): AgentChatWindowRow[] {
  return buildAgentChatWindowRowsState(session, { showThinkingMessages }).rows;
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
  session: AgentChatThreadSession,
  showThinkingMessages: boolean,
  resolveMessageIdentityToken: (message: AgentChatMessage) => number,
): string {
  const signatureParts: string[] = [
    session.externalSessionId,
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

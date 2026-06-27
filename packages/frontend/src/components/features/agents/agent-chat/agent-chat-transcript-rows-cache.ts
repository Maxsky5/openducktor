import { isAgentSessionActivityWorking } from "@/lib/agent-session-activity-state";
import { agentSessionIdentityKey } from "@/lib/agent-session-identity";
import { areSessionMessagesSameRevision } from "@/state/operations/agent-orchestrator/support/messages";
import type { AgentChatThreadSession } from "./agent-chat.types";
import type { AgentChatWindowRow, AgentChatWindowRowsState } from "./agent-chat-thread-windowing";

const TRANSCRIPT_ROWS_CACHE_LIMIT = 6;

export type TranscriptRowsCacheValue = Pick<
  AgentChatWindowRowsState,
  | "rows"
  | "turns"
  | "hasAttachmentMessages"
  | "lastUserMessageId"
  | "activeStreamingAssistantMessageId"
>;

export type TranscriptRowsCacheEntry = AgentChatWindowRowsState & {
  messages: AgentChatThreadSession["messages"];
};

export type TranscriptRowsCache = Map<string, TranscriptRowsCacheEntry>;

const toTranscriptRowsCacheKey = (sessionKey: string, showThinkingMessages: boolean): string =>
  `${sessionKey}:${showThinkingMessages ? "thinking:on" : "thinking:off"}`;

const touchTranscriptRowsCacheEntry = (
  cache: TranscriptRowsCache,
  cacheKey: string,
  entry: TranscriptRowsCacheEntry,
): void => {
  if (cache.has(cacheKey)) {
    cache.delete(cacheKey);
  }

  cache.set(cacheKey, entry);

  while (cache.size > TRANSCRIPT_ROWS_CACHE_LIMIT) {
    const oldestKey = cache.keys().next().value;
    if (typeof oldestKey !== "string") {
      break;
    }
    cache.delete(oldestKey);
  }
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

const toTranscriptRowsCacheValue = (
  cacheEntry: TranscriptRowsCacheEntry,
  activityState: AgentChatThreadSession["activityState"],
): TranscriptRowsCacheValue => {
  return {
    rows: cacheEntry.rows,
    turns: cacheEntry.turns,
    hasAttachmentMessages: cacheEntry.hasAttachmentMessages,
    lastUserMessageId: cacheEntry.lastUserMessageId,
    activeStreamingAssistantMessageId: isAgentSessionActivityWorking(activityState)
      ? (cacheEntry.activeStreamingAssistantMessageId ??
        findActiveStreamingAssistantMessageId(cacheEntry.rows))
      : null,
  };
};

export const createTranscriptRowsCache = (): TranscriptRowsCache =>
  new Map<string, TranscriptRowsCacheEntry>();

export const writeTranscriptRowsCacheEntry = ({
  session,
  showThinkingMessages,
  rowsState,
  cache,
}: {
  session: AgentChatThreadSession;
  showThinkingMessages: boolean;
  rowsState: AgentChatWindowRowsState;
  cache: TranscriptRowsCache;
}): void => {
  const cacheKey = toTranscriptRowsCacheKey(agentSessionIdentityKey(session), showThinkingMessages);
  touchTranscriptRowsCacheEntry(cache, cacheKey, {
    ...rowsState,
    messages: session.messages,
  });
};

export const peekReusableTranscriptRowsState = ({
  session,
  showThinkingMessages,
  cache,
  touch = true,
}: {
  session: AgentChatThreadSession;
  showThinkingMessages: boolean;
  cache: TranscriptRowsCache;
  touch?: boolean;
}): TranscriptRowsCacheValue | null => {
  const cacheKey = toTranscriptRowsCacheKey(agentSessionIdentityKey(session), showThinkingMessages);
  const cacheEntry = cache.get(cacheKey);
  if (!cacheEntry) {
    return null;
  }

  if (
    !areSessionMessagesSameRevision(
      { externalSessionId: session.externalSessionId, messages: cacheEntry.messages },
      session,
    )
  ) {
    return null;
  }

  if (touch) {
    touchTranscriptRowsCacheEntry(cache, cacheKey, cacheEntry);
  }
  return toTranscriptRowsCacheValue(cacheEntry, session.activityState);
};

// Intentionally returns the latest entry for this session key without revision validation.
// Callers must apply strict safety gates before reusing any prefix rows from it.
export const peekTranscriptRowsCacheEntry = ({
  session,
  showThinkingMessages,
  cache,
}: {
  session: AgentChatThreadSession;
  showThinkingMessages: boolean;
  cache: TranscriptRowsCache;
}): TranscriptRowsCacheEntry | null => {
  const cacheKey = toTranscriptRowsCacheKey(agentSessionIdentityKey(session), showThinkingMessages);
  return cache.get(cacheKey) ?? null;
};

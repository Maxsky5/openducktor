import { isAgentSessionActivityWorking } from "@/lib/agent-session-activity-state";
import { agentSessionIdentityKey } from "@/lib/agent-session-identity";
import { areSessionMessagesSameRevision } from "@/state/operations/agent-orchestrator/support/messages";
import type { AgentChatThreadSession } from "./agent-chat.types";
import {
  type AgentChatTranscriptModel,
  findActiveStreamingAssistantMessageIdInRows,
} from "./agent-chat-transcript-model";

const TRANSCRIPT_MODEL_CACHE_LIMIT = 6;

export type TranscriptModelCacheValue = Pick<
  AgentChatTranscriptModel,
  | "rows"
  | "turnAnchors"
  | "hasAttachmentMessages"
  | "lastUserMessageId"
  | "lastUserMessageKey"
  | "activeStreamingAssistantMessageId"
>;

export type TranscriptModelCacheEntry = AgentChatTranscriptModel & {
  messages: AgentChatThreadSession["messages"];
};

export type TranscriptModelCache = Map<string, TranscriptModelCacheEntry>;

const toTranscriptModelCacheKey = (sessionKey: string, showThinkingMessages: boolean): string =>
  `${sessionKey}:${showThinkingMessages ? "thinking:on" : "thinking:off"}`;

const touchTranscriptModelCacheEntry = (
  cache: TranscriptModelCache,
  cacheKey: string,
  entry: TranscriptModelCacheEntry,
): void => {
  if (cache.has(cacheKey)) {
    cache.delete(cacheKey);
  }

  cache.set(cacheKey, entry);

  while (cache.size > TRANSCRIPT_MODEL_CACHE_LIMIT) {
    const oldestKey = cache.keys().next().value;
    if (typeof oldestKey !== "string") {
      break;
    }
    cache.delete(oldestKey);
  }
};

const toTranscriptModelCacheValue = (
  cacheEntry: TranscriptModelCacheEntry,
  activityState: AgentChatThreadSession["activityState"],
): TranscriptModelCacheValue => {
  return {
    rows: cacheEntry.rows,
    turnAnchors: cacheEntry.turnAnchors,
    hasAttachmentMessages: cacheEntry.hasAttachmentMessages,
    lastUserMessageId: cacheEntry.lastUserMessageId,
    lastUserMessageKey: cacheEntry.lastUserMessageKey,
    activeStreamingAssistantMessageId: isAgentSessionActivityWorking(activityState)
      ? (cacheEntry.activeStreamingAssistantMessageId ??
        findActiveStreamingAssistantMessageIdInRows(cacheEntry.rows))
      : null,
  };
};

export const createTranscriptModelCache = (): TranscriptModelCache =>
  new Map<string, TranscriptModelCacheEntry>();

export const writeTranscriptModelCacheEntry = ({
  session,
  showThinkingMessages,
  transcriptModel,
  cache,
}: {
  session: AgentChatThreadSession;
  showThinkingMessages: boolean;
  transcriptModel: AgentChatTranscriptModel;
  cache: TranscriptModelCache;
}): void => {
  const cacheKey = toTranscriptModelCacheKey(
    agentSessionIdentityKey(session),
    showThinkingMessages,
  );
  touchTranscriptModelCacheEntry(cache, cacheKey, {
    ...transcriptModel,
    messages: session.messages,
  });
};

export const peekReusableTranscriptModelState = ({
  session,
  showThinkingMessages,
  cache,
  touch = true,
}: {
  session: AgentChatThreadSession;
  showThinkingMessages: boolean;
  cache: TranscriptModelCache;
  touch?: boolean;
}): TranscriptModelCacheValue | null => {
  const cacheKey = toTranscriptModelCacheKey(
    agentSessionIdentityKey(session),
    showThinkingMessages,
  );
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
    touchTranscriptModelCacheEntry(cache, cacheKey, cacheEntry);
  }
  return toTranscriptModelCacheValue(cacheEntry, session.activityState);
};

// Intentionally returns the latest entry for this session key without revision validation.
// Callers must apply strict safety gates before reusing any prefix rows from it.
export const peekTranscriptModelCacheEntry = ({
  session,
  showThinkingMessages,
  cache,
}: {
  session: AgentChatThreadSession;
  showThinkingMessages: boolean;
  cache: TranscriptModelCache;
}): TranscriptModelCacheEntry | null => {
  const cacheKey = toTranscriptModelCacheKey(
    agentSessionIdentityKey(session),
    showThinkingMessages,
  );
  return cache.get(cacheKey) ?? null;
};

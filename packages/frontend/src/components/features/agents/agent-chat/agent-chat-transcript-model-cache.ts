import { hasRuntimeType } from "@openducktor/contracts";
import { agentSessionIdentityKey } from "@/lib/agent-session-identity";
import { areSessionMessagesSameRevision } from "@/state/operations/agent-orchestrator/support/messages";
import type { AgentChatTranscriptSession } from "./agent-chat.types";
import type { AgentChatTranscriptModel } from "./agent-chat-transcript-model";

const TRANSCRIPT_MODEL_CACHE_LIMIT = 6;

export type TranscriptModelCacheEntry = AgentChatTranscriptModel & {
  messages: AgentChatTranscriptSession["messages"];
};

export type TranscriptModelCache = Map<string, TranscriptModelCacheEntry>;

export type TranscriptModelCacheLookup = {
  current: TranscriptModelCacheEntry | null;
  latest: TranscriptModelCacheEntry | null;
};

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
    if (!hasRuntimeType(oldestKey, "string")) {
      break;
    }
    cache.delete(oldestKey);
  }
};

export const createTranscriptModelCache = (): TranscriptModelCache =>
  new Map<string, TranscriptModelCacheEntry>();

export const writeTranscriptModelCacheEntry = ({
  session,
  showThinkingMessages,
  transcriptModel,
  cache,
}: {
  session: AgentChatTranscriptSession;
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

export const readTranscriptModelCache = ({
  session,
  showThinkingMessages,
  cache,
  touchCurrent = false,
}: {
  session: AgentChatTranscriptSession;
  showThinkingMessages: boolean;
  cache: TranscriptModelCache;
  touchCurrent?: boolean;
}): TranscriptModelCacheLookup => {
  const cacheKey = toTranscriptModelCacheKey(
    agentSessionIdentityKey(session),
    showThinkingMessages,
  );
  const cacheEntry = cache.get(cacheKey);
  if (!cacheEntry) {
    return { current: null, latest: null };
  }

  const isCurrent = areSessionMessagesSameRevision(
    { externalSessionId: session.externalSessionId, messages: cacheEntry.messages },
    session,
  );

  if (isCurrent && touchCurrent) {
    touchTranscriptModelCacheEntry(cache, cacheKey, cacheEntry);
  }
  return {
    current: isCurrent ? cacheEntry : null,
    latest: cacheEntry,
  };
};

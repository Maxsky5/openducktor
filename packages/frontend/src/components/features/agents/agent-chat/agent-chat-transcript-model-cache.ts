import { agentSessionIdentityKey } from "@/lib/agent-session-identity";
import { areSessionMessagesSameRevision } from "@/state/operations/agent-orchestrator/support/messages";
import type { AgentChatTranscriptSession } from "./agent-chat.types";
import type { AgentChatTranscriptModel } from "./agent-chat-transcript-model";

const MAX_ENTRIES = 6;

export type TranscriptModelCacheEntry = AgentChatTranscriptModel & {
  session: AgentChatTranscriptSession;
  // Queried history has no live baseline and must stay outside store updates.
  baseline: AgentChatTranscriptSession["messages"] | null;
  showThinkingMessages: boolean;
};

export type TranscriptModelCache = Map<string, TranscriptModelCacheEntry>;

export type TranscriptModelCacheLookup = {
  current: TranscriptModelCacheEntry | null;
  latest: TranscriptModelCacheEntry | null;
};

export const createTranscriptModelCache = (): TranscriptModelCache =>
  new Map<string, TranscriptModelCacheEntry>();

export const writeTranscriptModelCacheEntry = ({
  session,
  showThinkingMessages,
  transcriptModel,
  cache,
  touch = true,
  baseline = null,
}: {
  session: AgentChatTranscriptSession;
  showThinkingMessages: boolean;
  transcriptModel: AgentChatTranscriptModel;
  cache: TranscriptModelCache;
  touch?: boolean;
  baseline?: AgentChatTranscriptSession["messages"] | null;
}): void => {
  const cacheKey = keyFor(agentSessionIdentityKey(session), showThinkingMessages);
  const entry = {
    ...transcriptModel,
    session,
    baseline,
    showThinkingMessages,
  };
  if (touch) {
    touchEntry(cache, cacheKey, entry);
  } else if (cache.has(cacheKey)) {
    cache.set(cacheKey, entry);
  }
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
  const cacheKey = keyFor(agentSessionIdentityKey(session), showThinkingMessages);
  const cacheEntry = cache.get(cacheKey);
  if (!cacheEntry) {
    return { current: null, latest: null };
  }

  const isCurrent = areSessionMessagesSameRevision(cacheEntry.session, session);

  if (isCurrent && touchCurrent) {
    touchEntry(cache, cacheKey, cacheEntry);
  }
  return {
    current: isCurrent ? cacheEntry : null,
    latest: cacheEntry,
  };
};

const keyFor = (sessionKey: string, showThinkingMessages: boolean): string =>
  `${sessionKey}:${showThinkingMessages ? "thinking:on" : "thinking:off"}`;

const touchEntry = (
  cache: TranscriptModelCache,
  cacheKey: string,
  entry: TranscriptModelCacheEntry,
): void => {
  cache.delete(cacheKey);
  cache.set(cacheKey, entry);

  while (cache.size > MAX_ENTRIES) {
    const oldestKey = cache.keys().next().value;
    if (oldestKey === undefined) {
      break;
    }
    cache.delete(oldestKey);
  }
};

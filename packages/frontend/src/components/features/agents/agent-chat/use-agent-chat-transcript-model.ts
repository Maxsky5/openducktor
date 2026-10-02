import {
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from "react";
import { isAgentSessionActivityWorking } from "@/lib/agent-session-activity-state";
import { agentSessionIdentityKey } from "@/lib/agent-session-identity";
import type { AgentSessionsStore } from "@/state/agent-sessions-store";
import { AgentSessionsContext } from "@/state/app-state-contexts";
import {
  areSessionMessagesSameRevision,
  getSessionMessageCount,
  getSessionMessagesRevision,
} from "@/state/operations/agent-orchestrator/support/messages";
import type { AgentChatTranscriptSession } from "./agent-chat.types";
import { AgentChatTranscriptCacheContext } from "./agent-chat-transcript-cache-context";
import { toAgentChatTranscriptSession } from "./agent-chat-transcript-session";
import { withClaudeSkillMentions } from "./claude-skill-mentions";
import { buildTranscriptModel, MAX_SYNC_MESSAGES } from "./agent-chat-transcript-model-build";
import {
  type AgentChatTranscriptModel,
  type AgentChatTranscriptRow,
  type AgentChatTurnAnchor,
  createAgentChatTranscriptModelBuilder,
} from "./agent-chat-transcript-model";
import {
  createTranscriptModelCache,
  readTranscriptModelCache,
  type TranscriptModelCache,
  writeTranscriptModelCacheEntry,
} from "./agent-chat-transcript-model-cache";

type CacheBuild = {
  session: AgentChatTranscriptSession;
  baseline: AgentChatTranscriptSession["messages"];
  stop: () => void;
};

type Revision = {
  sessionKey: string | null;
  activityState: AgentChatTranscriptSession["activityState"];
  showThinkingMessages: boolean;
  messagesSessionKey: string | null;
  version: number | null;
  count: number | null;
};

export type TranscriptModelState = AgentChatTranscriptModel & {
  revision: Revision;
};

export const useAgentChatTranscriptModel = ({
  session,
  showThinkingMessages,
}: {
  session: AgentChatTranscriptSession | null;
  showThinkingMessages: boolean;
}) => {
  const sessionStore = useContext(AgentSessionsContext);
  const sharedCache = useContext(AgentChatTranscriptCacheContext);
  const [cache] = useState(() =>
    createInitialCache(session, showThinkingMessages, sessionStore, sharedCache),
  );
  const sessionRef = useRef(session);
  const buildsRef = useRef(new Map<string, CacheBuild>());
  const shownKeyRef = useRef<string | null>(null);
  const revision = useMemo(
    () => buildRevision(session, showThinkingMessages),
    [session, showThinkingMessages],
  );
  const buildKey = JSON.stringify([
    revision.sessionKey,
    revision.messagesSessionKey,
    revision.version,
    revision.count,
  ]);
  const [, publishCacheWrite] = useReducer((generation: number) => generation + 1, 0);
  const cacheLookup = session
    ? readTranscriptModelCache({ session, showThinkingMessages, cache })
    : { current: null, latest: null };
  const shownModel =
    cacheLookup.current ??
    (shownKeyRef.current === revision.sessionKey ? cacheLookup.latest : null);
  let transcriptState = EMPTY_STATE;
  if (session && shownModel) {
    transcriptState = toModelState({
      session,
      revision: cacheLookup.current
        ? revision
        : buildRevision(session, showThinkingMessages, shownModel.session.messages),
      transcriptModel: shownModel,
    });
  }
  const hasRowsForActiveSession = shownModel !== null;
  const hasCurrentRowsForActiveSession = cacheLookup.current !== null;
  const isTranscriptModelMissing = Boolean(session && !hasRowsForActiveSession);
  const isTranscriptModelPending = Boolean(session && !hasCurrentRowsForActiveSession);

  useLayoutEffect(() => {
    sessionRef.current = session;
    shownKeyRef.current = shownModel ? revision.sessionKey : null;
  }, [session, shownModel, revision.sessionKey]);
  useLayoutEffect(
    () => () => {
      // A hidden chat must require current rows when it returns.
      shownKeyRef.current = null;
    },
    [],
  );

  const warmCache = useCallback(() => {
    if (!sessionStore) {
      return;
    }
    const builds = buildsRef.current;
    for (const [cacheKey, entry] of cache) {
      const liveSession = sessionStore.getSessionSnapshot(entry.session);
      const activeSession = sessionRef.current;
      const isSelected =
        activeSession !== null &&
        agentSessionIdentityKey(activeSession) === agentSessionIdentityKey(entry.session);
      const existingBuild = builds.get(cacheKey);
      if (!liveSession || isSelected || entry.baseline === null) {
        existingBuild?.stop();
        builds.delete(cacheKey);
        continue;
      }
      if (
        existingBuild &&
        areSessionMessagesSameRevision(
          {
            externalSessionId: liveSession.externalSessionId,
            messages: existingBuild.baseline,
          },
          liveSession,
        )
      ) {
        continue;
      }
      if (
        areSessionMessagesSameRevision(
          { externalSessionId: liveSession.externalSessionId, messages: entry.baseline },
          liveSession,
        )
      ) {
        existingBuild?.stop();
        builds.delete(cacheKey);
        continue;
      }

      const skillReferences = entry.session.skillReferences;
      const transcriptSession = toAgentChatTranscriptSession(liveSession);
      const nextSession = skillReferences
        ? { ...withClaudeSkillMentions(transcriptSession, skillReferences), skillReferences }
        : transcriptSession;
      existingBuild?.stop();
      const build: CacheBuild = {
        session: nextSession,
        baseline: liveSession.messages,
        stop: () => {},
      };
      // A build can finish before it returns, so track it before starting work.
      builds.set(cacheKey, build);
      if (areSessionMessagesSameRevision(entry.session, nextSession)) {
        continue;
      }
      build.stop = buildTranscriptModel({
        session: nextSession,
        showThinkingMessages: entry.showThinkingMessages,
        previous: entry,
        onComplete: (transcriptModel) => {
          build.stop = () => {};
          writeTranscriptModelCacheEntry({
            session: nextSession,
            showThinkingMessages: entry.showThinkingMessages,
            transcriptModel,
            cache,
            touch: false,
            baseline: liveSession.messages,
          });
          const selected = sessionRef.current;
          if (
            selected &&
            agentSessionIdentityKey(selected) === agentSessionIdentityKey(nextSession)
          ) {
            publishCacheWrite();
          }
        },
      });
    }
    stopEvictedBuilds(cache, builds);
  }, [cache, sessionStore]);

  useEffect(() => {
    if (!sessionStore) {
      return;
    }
    const builds = buildsRef.current;
    const unsubscribe = sessionStore.subscribe(warmCache);
    return () => {
      unsubscribe();
      for (const build of builds.values()) {
        build.stop();
      }
      builds.clear();
    };
  }, [sessionStore, warmCache]);

  useEffect(() => {
    // Deselection can stop a selected build without another store event.
    warmCache();
  }, [revision.sessionKey, warmCache]);

  useEffect(() => {
    void buildKey;
    const currentSession = sessionRef.current;
    if (!currentSession) {
      return;
    }

    const currentSessionKey = agentSessionIdentityKey(currentSession);
    for (const [cacheKey, build] of buildsRef.current) {
      if (agentSessionIdentityKey(build.session) === currentSessionKey) {
        build.stop();
        buildsRef.current.delete(cacheKey);
      }
    }
    const currentCacheLookup = readTranscriptModelCache({
      session: currentSession,
      showThinkingMessages,
      cache,
      touchCurrent: true,
    });
    if (currentCacheLookup.current) {
      return;
    }

    const baseline = readLiveMessages(currentSession, sessionStore);
    return buildTranscriptModel({
      session: currentSession,
      showThinkingMessages,
      previous: currentCacheLookup.latest,
      onComplete: (transcriptModel) => {
        writeTranscriptModelCacheEntry({
          session: currentSession,
          showThinkingMessages,
          transcriptModel,
          cache,
          baseline,
        });
        stopEvictedBuilds(cache, buildsRef.current);
        publishCacheWrite();
      },
    });
  }, [buildKey, cache, showThinkingMessages, sessionStore]);

  return {
    transcriptState,
    hasRowsForActiveSession,
    hasCurrentRowsForActiveSession,
    isTranscriptModelMissing,
    isTranscriptModelPending,
  } satisfies {
    transcriptState: TranscriptModelState;
    hasRowsForActiveSession: boolean;
    hasCurrentRowsForActiveSession: boolean;
    isTranscriptModelMissing: boolean;
    isTranscriptModelPending: boolean;
  };
};

const stopEvictedBuilds = (cache: TranscriptModelCache, builds: Map<string, CacheBuild>): void => {
  for (const [cacheKey, build] of builds) {
    if (!cache.has(cacheKey)) {
      build.stop();
      builds.delete(cacheKey);
    }
  }
};

const createInitialCache = (
  session: AgentChatTranscriptSession | null,
  showThinkingMessages: boolean,
  sessionStore: AgentSessionsStore | null,
  sharedCache: TranscriptModelCache | null,
): TranscriptModelCache => {
  const cache = sharedCache ?? createTranscriptModelCache();
  if (
    !session ||
    getSessionMessageCount(session) > MAX_SYNC_MESSAGES ||
    readTranscriptModelCache({ session, showThinkingMessages, cache }).latest
  ) {
    return cache;
  }

  const transcriptModel = createAgentChatTranscriptModelBuilder(session, {
    showThinkingMessages,
  }).complete();
  writeTranscriptModelCacheEntry({
    session,
    showThinkingMessages,
    transcriptModel,
    cache,
    baseline: readLiveMessages(session, sessionStore),
  });
  return cache;
};

const readLiveMessages = (
  session: AgentChatTranscriptSession,
  sessionStore: AgentSessionsStore | null,
): AgentChatTranscriptSession["messages"] | null => {
  const source = sessionStore?.getSessionSnapshot(session);
  if (!source) {
    return null;
  }
  const projected = withClaudeSkillMentions(
    toAgentChatTranscriptSession(source),
    session.skillReferences ?? [],
  );
  return areSessionMessagesSameRevision(projected, session) ? source.messages : null;
};

const buildRevision = (
  session: AgentChatTranscriptSession | null,
  showThinkingMessages: boolean,
  messages: AgentChatTranscriptSession["messages"] | null = session?.messages ?? null,
): Revision => {
  if (!session || !messages) {
    return EMPTY_REVISION;
  }

  const messagesRevision = getSessionMessagesRevision({
    externalSessionId: session.externalSessionId,
    messages,
  });
  const sessionKey = agentSessionIdentityKey(session);

  return {
    sessionKey,
    activityState: session.activityState,
    showThinkingMessages,
    messagesSessionKey:
      messagesRevision.externalSessionId === session.externalSessionId ? sessionKey : null,
    version: messagesRevision.version,
    count: messagesRevision.count,
  };
};

const toModelState = ({
  session,
  revision,
  transcriptModel,
}: {
  session: AgentChatTranscriptSession;
  revision: Revision;
  transcriptModel: AgentChatTranscriptModel;
}): TranscriptModelState => {
  return {
    revision,
    rows: transcriptModel.rows,
    turnAnchors: transcriptModel.turnAnchors,
    hasAttachmentMessages: transcriptModel.hasAttachmentMessages,
    lastUserMessageKey: transcriptModel.lastUserMessageKey,
    activeStreamingAssistantMessageId: isAgentSessionActivityWorking(session.activityState)
      ? transcriptModel.activeStreamingAssistantMessageId
      : null,
  };
};

const EMPTY_REVISION: Revision = Object.freeze({
  sessionKey: null,
  activityState: null,
  showThinkingMessages: false,
  messagesSessionKey: null,
  version: null,
  count: null,
});

const EMPTY_STATE: TranscriptModelState = Object.freeze({
  revision: EMPTY_REVISION,
  rows: new Array<AgentChatTranscriptRow>(),
  turnAnchors: new Array<AgentChatTurnAnchor>(),
  hasAttachmentMessages: false,
  lastUserMessageKey: null,
  activeStreamingAssistantMessageId: null,
});

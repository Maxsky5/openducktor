import {
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { isAgentSessionActivityWorking } from "../../lib/agent-session-activity-state";
import { agentSessionIdentityKey } from "../../lib/agent-session-identity";
import type { AgentSessionsStore } from "../agent-sessions-store";
import { AgentSessionsContext } from "../session-contexts";
import {
  areSessionMessagesSameRevision,
  getSessionMessageCount,
  getSessionMessagesRevision,
} from "../agent-orchestrator/support/messages";
import type { AgentChatTranscriptSession } from "./agent-chat-transcript.types";
import { AgentChatTranscriptCacheContext } from "./agent-chat-transcript-cache-context";
import { toAgentChatTranscriptSession } from "./agent-chat-transcript-session";
import { withClaudeSkillMentions } from "./claude-skill-mentions";
import {
  buildTranscriptModelInChunks,
  MAX_SYNC_MESSAGES,
  updateTranscriptModelAtOnce,
} from "./agent-chat-transcript-model-build";
import {
  type AgentChatTranscriptModel,
  type AgentChatTranscriptRow,
  type AgentChatTurnAnchor,
  type AgentChatUserMessageAnchor,
  createAgentChatTranscriptModelBuilder,
} from "./agent-chat-transcript-model";
import {
  createTranscriptModelCache,
  readTranscriptModelCache,
  type TranscriptModelCache,
  type TranscriptModelCacheLookup,
  writeTranscriptModelCacheEntry,
} from "./agent-chat-transcript-model-cache";

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
  const keeper = useContext(AgentChatTranscriptCacheContext);
  const readLifetime = useCallback(
    () => (session ? (sessionStore?.getSessionSource(session)?.lifetime ?? null) : null),
    [session, sessionStore],
  );
  const lifetime = useSyncExternalStore(
    sessionStore?.subscribe ?? subscribeEmpty,
    readLifetime,
    readLifetime,
  );
  const [cache] = useState(() => keeper?.cache ?? createTranscriptModelCache());
  const sessionRef = useRef(session);
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
    ? readCurrentTranscriptModel({ session, showThinkingMessages, cache, lifetime, sessionStore })
    : EMPTY_LOOKUP;
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
  // This chat builds its own session, so the keeper leaves it while the chat shows.
  const shownSessionKey = revision.sessionKey;
  useLayoutEffect(() => {
    if (!keeper || shownSessionKey === null) return;
    return keeper.show(shownSessionKey);
  }, [keeper, shownSessionKey]);

  useEffect(() => {
    void buildKey;
    const currentSession = sessionRef.current;
    if (!currentSession) {
      return;
    }

    const currentCacheLookup = readTranscriptModelCache({
      session: currentSession,
      showThinkingMessages,
      cache,
      touchCurrent: true,
      lifetime,
    });
    if (currentCacheLookup.current) {
      return;
    }

    // The render already applied any change that updates at once.
    const baseline = readLiveMessages(currentSession, sessionStore);
    return buildTranscriptModelInChunks({
      session: currentSession,
      showThinkingMessages,
      previous: currentCacheLookup.latest,
      onComplete: (transcriptModel) => {
        if ((sessionStore?.getSessionSource(currentSession)?.lifetime ?? null) !== lifetime) return;
        writeTranscriptModelCacheEntry({
          session: currentSession,
          showThinkingMessages,
          transcriptModel,
          cache,
          baseline,
          lifetime,
        });
        publishCacheWrite();
      },
    });
  }, [buildKey, cache, lifetime, showThinkingMessages, sessionStore]);

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

const subscribeEmpty = (): (() => void) => () => {};

const EMPTY_LOOKUP: TranscriptModelCacheLookup = Object.freeze({ current: null, latest: null });

/**
 * The cached model of `session`. A change that updates at once, such as streamed text or messages
 * that came while the chat was out of view, updates the cache during render, so the chat never
 * shows older messages or a skeleton frame. A small transcript without a cached model builds at
 * once. Other changes wait for the chunked build of the effect.
 */
const readCurrentTranscriptModel = ({
  session,
  showThinkingMessages,
  cache,
  lifetime,
  sessionStore,
}: {
  session: AgentChatTranscriptSession;
  showThinkingMessages: boolean;
  cache: TranscriptModelCache;
  lifetime: symbol | null;
  sessionStore: AgentSessionsStore | null;
}): TranscriptModelCacheLookup => {
  const lookup = readTranscriptModelCache({ session, showThinkingMessages, cache, lifetime });
  if (lookup.current) {
    return lookup;
  }
  let transcriptModel: AgentChatTranscriptModel | null = null;
  if (lookup.latest) {
    transcriptModel = updateTranscriptModelAtOnce({
      session,
      showThinkingMessages,
      previous: lookup.latest,
    });
  } else if (getSessionMessageCount(session) <= MAX_SYNC_MESSAGES) {
    transcriptModel = createAgentChatTranscriptModelBuilder(session, {
      showThinkingMessages,
    }).complete();
  }
  if (!transcriptModel) {
    return lookup;
  }
  writeTranscriptModelCacheEntry({
    session,
    showThinkingMessages,
    transcriptModel,
    cache,
    baseline: readLiveMessages(session, sessionStore),
    lifetime,
  });
  return readTranscriptModelCache({ session, showThinkingMessages, cache, lifetime });
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
    userMessageAnchors: transcriptModel.userMessageAnchors,
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
  userMessageAnchors: new Array<AgentChatUserMessageAnchor>(),
  hasAttachmentMessages: false,
  lastUserMessageKey: null,
  activeStreamingAssistantMessageId: null,
});

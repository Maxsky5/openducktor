import {
  startTransition,
  useEffect,
  useLayoutEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from "react";
import { isAgentSessionActivityWorking } from "@/lib/agent-session-activity-state";
import { agentSessionIdentityKey } from "@/lib/agent-session-identity";
import {
  findFirstChangedSessionMessageIndex,
  getSessionMessageAt,
  getSessionMessageCount,
  getSessionMessagesRevision,
} from "@/state/operations/agent-orchestrator/support/messages";
import type { AgentChatTranscriptSession } from "./agent-chat.types";
import {
  type AgentChatTranscriptRow,
  type AgentChatTurnAnchor,
  createAgentChatTranscriptModelBuilder,
  updateAgentChatTranscriptModelFromPrefix,
} from "./agent-chat-transcript-model";
import {
  createTranscriptModelCache,
  readTranscriptModelCache,
  type TranscriptModelCache,
  type TranscriptModelCacheEntry,
  writeTranscriptModelCacheEntry,
} from "./agent-chat-transcript-model-cache";

const EMPTY_ROWS: AgentChatTranscriptRow[] = [];
const TRANSCRIPT_DERIVATION_CHUNK_BUDGET_MS = 6;
const TRANSCRIPT_DERIVATION_MAX_MESSAGES_PER_CHUNK = 250;
const TRANSCRIPT_DERIVATION_SYNC_MESSAGE_LIMIT = 100;

type TranscriptModelRevision = {
  sessionKey: string | null;
  activityState: AgentChatTranscriptSession["activityState"];
  showThinkingMessages: boolean;
  messagesSessionKey: string | null;
  version: number | null;
  count: number | null;
};

export type TranscriptModelState = {
  revision: TranscriptModelRevision;
  rows: AgentChatTranscriptRow[];
  turnAnchors: AgentChatTurnAnchor[];
  hasAttachmentMessages: boolean;
  lastUserMessageKey: string | null;
  activeStreamingAssistantMessageId: string | null;
};

const EMPTY_TRANSCRIPT_MODEL_REVISION: TranscriptModelRevision = Object.freeze({
  sessionKey: null,
  activityState: null,
  showThinkingMessages: false,
  messagesSessionKey: null,
  version: null,
  count: null,
});

const EMPTY_TRANSCRIPT_MODEL_STATE: TranscriptModelState = Object.freeze({
  revision: EMPTY_TRANSCRIPT_MODEL_REVISION,
  rows: EMPTY_ROWS,
  turnAnchors: new Array<AgentChatTurnAnchor>(),
  hasAttachmentMessages: false,
  lastUserMessageKey: null,
  activeStreamingAssistantMessageId: null,
});

const buildTranscriptModelRevision = (
  session: AgentChatTranscriptSession | null,
  showThinkingMessages: boolean,
  messages: AgentChatTranscriptSession["messages"] | null = session?.messages ?? null,
): TranscriptModelRevision => {
  if (!session || !messages) {
    return EMPTY_TRANSCRIPT_MODEL_REVISION;
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

const toTranscriptModelState = ({
  session,
  revision,
  transcriptModel,
}: {
  session: AgentChatTranscriptSession;
  revision: TranscriptModelRevision;
  transcriptModel: Pick<
    TranscriptModelState,
    | "rows"
    | "turnAnchors"
    | "hasAttachmentMessages"
    | "lastUserMessageKey"
    | "activeStreamingAssistantMessageId"
  >;
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

const createInitialTranscriptModelCache = (
  session: AgentChatTranscriptSession | null,
  showThinkingMessages: boolean,
): TranscriptModelCache => {
  const cache = createTranscriptModelCache();
  if (!session || getSessionMessageCount(session) > TRANSCRIPT_DERIVATION_SYNC_MESSAGE_LIMIT) {
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
  });
  return cache;
};

const now = (): number => {
  return typeof globalThis.performance?.now === "function"
    ? globalThis.performance.now()
    : Date.now();
};

type IncrementalTranscriptModelPlan = {
  mode: "append" | "replace-tail";
  startMessageIndex: number;
};

const isMessageIdInPrefix = (
  messages: AgentChatTranscriptSession["messages"],
  messageId: string,
  endIndex: number,
): boolean => {
  for (let index = 0; index < endIndex; index += 1) {
    if (messages.items[index]?.id === messageId) {
      return true;
    }
  }
  return false;
};

const arePrefixMessagesUnchanged = ({
  previousCacheEntry,
  currentSession,
  endIndex,
}: {
  previousCacheEntry: TranscriptModelCacheEntry;
  currentSession: AgentChatTranscriptSession;
  endIndex: number;
}): boolean => {
  for (let index = 0; index < endIndex; index += 1) {
    if (previousCacheEntry.messages.items[index] !== getSessionMessageAt(currentSession, index)) {
      return false;
    }
  }
  return true;
};

const getIncrementalTranscriptModelPlan = ({
  previousCacheEntry,
  currentSession,
}: {
  previousCacheEntry: TranscriptModelCacheEntry | null;
  currentSession: AgentChatTranscriptSession;
}): IncrementalTranscriptModelPlan | null => {
  if (!previousCacheEntry) {
    return null;
  }

  const firstChangedMessageIndex = findFirstChangedSessionMessageIndex(
    previousCacheEntry.messages,
    currentSession,
  );
  if (firstChangedMessageIndex < 0) {
    return null;
  }

  const previousMessageCount = previousCacheEntry.messages.items.length;
  const currentMessageCount = getSessionMessageCount(currentSession);
  const changedMessageCount = currentMessageCount - firstChangedMessageIndex;
  const previousChangedMessage = previousCacheEntry.messages.items[firstChangedMessageIndex];
  const currentChangedMessage = currentSession.messages.items[firstChangedMessageIndex];
  const isTailAppend = firstChangedMessageIndex >= previousMessageCount;
  const isAssistantTailEdit = Boolean(
    previousChangedMessage &&
    currentChangedMessage &&
    firstChangedMessageIndex === previousMessageCount - 1 &&
    previousChangedMessage.id === currentChangedMessage.id &&
    previousChangedMessage.role === "assistant" &&
    currentChangedMessage.role === "assistant",
  );

  if (isAssistantTailEdit) {
    if (
      !arePrefixMessagesUnchanged({
        previousCacheEntry,
        currentSession,
        endIndex: firstChangedMessageIndex,
      }) ||
      (currentChangedMessage &&
        isMessageIdInPrefix(
          previousCacheEntry.messages,
          currentChangedMessage.id,
          firstChangedMessageIndex,
        ))
    ) {
      return null;
    }
  }

  if (
    currentMessageCount < previousMessageCount ||
    changedMessageCount < 0 ||
    changedMessageCount > TRANSCRIPT_DERIVATION_SYNC_MESSAGE_LIMIT ||
    (!isTailAppend && !isAssistantTailEdit)
  ) {
    return null;
  }

  return {
    mode: isTailAppend ? "append" : "replace-tail",
    startMessageIndex: firstChangedMessageIndex,
  };
};

export const useAgentChatTranscriptModel = ({
  session,
  showThinkingMessages,
}: {
  session: AgentChatTranscriptSession | null;
  showThinkingMessages: boolean;
}) => {
  const [rowsCache] = useState(() =>
    createInitialTranscriptModelCache(session, showThinkingMessages),
  );
  const derivationSessionRef = useRef(session);
  const derivationTokenRef = useRef(0);
  const activeRevision = useMemo(
    () => buildTranscriptModelRevision(session, showThinkingMessages),
    [session, showThinkingMessages],
  );
  const derivationRevisionKey = JSON.stringify([
    activeRevision.sessionKey,
    activeRevision.messagesSessionKey,
    activeRevision.version,
    activeRevision.count,
  ]);
  const [, publishCacheWrite] = useReducer((generation: number) => generation + 1, 0);
  const cacheLookup = session
    ? readTranscriptModelCache({ session, showThinkingMessages, cache: rowsCache })
    : { current: null, latest: null };
  const displayedTranscriptModel = cacheLookup.current ?? cacheLookup.latest;
  let displayedTranscriptState = EMPTY_TRANSCRIPT_MODEL_STATE;
  if (session && displayedTranscriptModel) {
    displayedTranscriptState = toTranscriptModelState({
      session,
      revision: cacheLookup.current
        ? activeRevision
        : buildTranscriptModelRevision(
            session,
            showThinkingMessages,
            displayedTranscriptModel.messages,
          ),
      transcriptModel: displayedTranscriptModel,
    });
  }
  const hasRowsForActiveSession = displayedTranscriptModel !== null;
  const hasCurrentRowsForActiveSession = cacheLookup.current !== null;
  const isTranscriptModelMissing = Boolean(session && !hasRowsForActiveSession);
  const isTranscriptModelPending = Boolean(session && !hasCurrentRowsForActiveSession);

  useLayoutEffect(() => {
    derivationSessionRef.current = session;
  }, [session]);

  useEffect(() => {
    void derivationRevisionKey;
    derivationTokenRef.current += 1;
    const derivationToken = derivationTokenRef.current;
    const currentSession = derivationSessionRef.current;

    if (!currentSession) {
      return;
    }

    const currentCacheLookup = readTranscriptModelCache({
      session: currentSession,
      showThinkingMessages,
      cache: rowsCache,
      touchCurrent: true,
    });
    if (currentCacheLookup.current) {
      return;
    }

    const previousCacheEntry = currentCacheLookup.latest;
    const incrementalPlan = getIncrementalTranscriptModelPlan({
      previousCacheEntry,
      currentSession,
    });
    if (previousCacheEntry && incrementalPlan) {
      const transcriptModel = updateAgentChatTranscriptModelFromPrefix({
        session: currentSession,
        showThinkingMessages,
        previousTranscriptModel: previousCacheEntry,
        startMessageIndex: incrementalPlan.startMessageIndex,
        mode: incrementalPlan.mode,
      });
      if (transcriptModel) {
        writeTranscriptModelCacheEntry({
          session: currentSession,
          showThinkingMessages,
          transcriptModel,
          cache: rowsCache,
        });
        if (derivationTokenRef.current === derivationToken) {
          // Bounded incremental derivation intentionally publishes current selected rows immediately
          // so large running sessions stay responsive as new tail messages stream in.
          publishCacheWrite();
        }
        return;
      }
    }

    const builder = createAgentChatTranscriptModelBuilder(currentSession, {
      showThinkingMessages,
    });
    let scheduledWorkId: ReturnType<typeof globalThis.setTimeout> | null = null;
    const scheduleNextChunk = (): void => {
      scheduledWorkId = globalThis.setTimeout(() => {
        scheduledWorkId = null;
        if (derivationTokenRef.current !== derivationToken) {
          return;
        }

        const chunkStartedAt = now();
        let processedInChunk = 0;
        while (
          !builder.isDone() &&
          processedInChunk < TRANSCRIPT_DERIVATION_MAX_MESSAGES_PER_CHUNK &&
          now() - chunkStartedAt < TRANSCRIPT_DERIVATION_CHUNK_BUDGET_MS
        ) {
          processedInChunk += builder.step(1);
        }

        if (derivationTokenRef.current !== derivationToken) {
          return;
        }

        if (!builder.isDone()) {
          scheduleNextChunk();
          return;
        }

        const transcriptModel = builder.complete();
        writeTranscriptModelCacheEntry({
          session: currentSession,
          showThinkingMessages,
          transcriptModel,
          cache: rowsCache,
        });
        startTransition(() => {
          if (derivationTokenRef.current === derivationToken) {
            publishCacheWrite();
          }
        });
      }, 0);
    };

    scheduleNextChunk();

    return () => {
      if (scheduledWorkId) {
        globalThis.clearTimeout(scheduledWorkId);
      }
    };
  }, [derivationRevisionKey, rowsCache, showThinkingMessages]);

  const transcriptState = useMemo(() => {
    if (!hasRowsForActiveSession) {
      return EMPTY_TRANSCRIPT_MODEL_STATE;
    }

    if (isAgentSessionActivityWorking(session?.activityState)) {
      return displayedTranscriptState;
    }

    if (displayedTranscriptState.activeStreamingAssistantMessageId === null) {
      return displayedTranscriptState;
    }

    return {
      ...displayedTranscriptState,
      activeStreamingAssistantMessageId: null,
    };
  }, [displayedTranscriptState, hasRowsForActiveSession, session?.activityState]);

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

import { startTransition, useEffect, useMemo, useReducer, useRef } from "react";
import { isAgentSessionActivityWorking } from "@/lib/agent-session-activity-state";
import { agentSessionIdentityKey } from "@/lib/agent-session-identity";
import {
  findFirstChangedSessionMessageIndex,
  getSessionMessageCount,
  getSessionMessagesRevision,
} from "@/state/operations/agent-orchestrator/support/messages";
import type { AgentChatThreadSession } from "./agent-chat.types";
import {
  type AgentChatWindowRow,
  type AgentChatWindowTurn,
  buildAgentChatWindowRowsStateFromPrefix,
  createAgentChatWindowRowsStateBuilder,
} from "./agent-chat-thread-windowing";
import {
  createTranscriptRowsCache,
  peekReusableTranscriptRowsState,
  peekTranscriptRowsCacheEntry,
  type TranscriptRowsCache,
  writeTranscriptRowsCacheEntry,
} from "./agent-chat-transcript-rows-cache";

const EMPTY_ROWS: AgentChatWindowRow[] = [];
const TRANSCRIPT_DERIVATION_CHUNK_BUDGET_MS = 6;
const TRANSCRIPT_DERIVATION_MAX_MESSAGES_PER_CHUNK = 250;
const TRANSCRIPT_DERIVATION_SYNC_MESSAGE_LIMIT = 100;

type TranscriptRowsRevision = {
  sessionKey: string | null;
  activityState: AgentChatThreadSession["activityState"];
  showThinkingMessages: boolean;
  messagesSessionKey: string | null;
  version: number | null;
  count: number | null;
};

export type TranscriptRowsState = {
  revision: TranscriptRowsRevision;
  rows: AgentChatWindowRow[];
  turns: AgentChatWindowTurn[];
  hasAttachmentMessages: boolean;
  lastUserMessageId: string | null;
  activeStreamingAssistantMessageId: string | null;
};

const EMPTY_TRANSCRIPT_ROWS_REVISION: TranscriptRowsRevision = Object.freeze({
  sessionKey: null,
  activityState: null,
  showThinkingMessages: false,
  messagesSessionKey: null,
  version: null,
  count: null,
});

const EMPTY_TRANSCRIPT_ROWS_STATE: TranscriptRowsState = Object.freeze({
  revision: EMPTY_TRANSCRIPT_ROWS_REVISION,
  rows: EMPTY_ROWS,
  turns: [] as AgentChatWindowTurn[],
  hasAttachmentMessages: false,
  lastUserMessageId: null,
  activeStreamingAssistantMessageId: null,
});

const buildTranscriptRowsRevision = (
  session: AgentChatThreadSession | null,
  showThinkingMessages: boolean,
): TranscriptRowsRevision => {
  if (!session) {
    return EMPTY_TRANSCRIPT_ROWS_REVISION;
  }

  const messagesRevision = getSessionMessagesRevision(session);
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

const toTranscriptRowsState = ({
  session,
  revision,
  rowsState,
}: {
  session: AgentChatThreadSession;
  revision: TranscriptRowsRevision;
  rowsState: Pick<
    TranscriptRowsState,
    | "rows"
    | "turns"
    | "hasAttachmentMessages"
    | "lastUserMessageId"
    | "activeStreamingAssistantMessageId"
  >;
}): TranscriptRowsState => {
  return {
    revision,
    rows: rowsState.rows,
    turns: rowsState.turns,
    hasAttachmentMessages: rowsState.hasAttachmentMessages,
    lastUserMessageId: rowsState.lastUserMessageId,
    activeStreamingAssistantMessageId: isAgentSessionActivityWorking(session.activityState)
      ? rowsState.activeStreamingAssistantMessageId
      : null,
  };
};

const buildImmediateTranscriptRowsState = ({
  session,
  showThinkingMessages,
  cache,
}: {
  session: AgentChatThreadSession;
  showThinkingMessages: boolean;
  cache: TranscriptRowsCache;
}): TranscriptRowsState => {
  const rowsState = createAgentChatWindowRowsStateBuilder(session, {
    showThinkingMessages,
  }).complete();
  writeTranscriptRowsCacheEntry({
    session,
    showThinkingMessages,
    rowsState,
    cache,
  });

  return toTranscriptRowsState({
    session,
    revision: buildTranscriptRowsRevision(session, showThinkingMessages),
    rowsState,
  });
};

const areTranscriptRowsRevisionsEqual = (
  left: TranscriptRowsRevision,
  right: TranscriptRowsRevision,
): boolean => {
  return (
    left.sessionKey === right.sessionKey &&
    left.activityState === right.activityState &&
    left.showThinkingMessages === right.showThinkingMessages &&
    left.messagesSessionKey === right.messagesSessionKey &&
    left.version === right.version &&
    left.count === right.count
  );
};

const toTranscriptRowsRevisionKey = (revision: TranscriptRowsRevision): string => {
  return [
    revision.sessionKey ?? "",
    revision.activityState ?? "",
    revision.showThinkingMessages ? "thinking:on" : "thinking:off",
    revision.messagesSessionKey ?? "",
    revision.version ?? "",
    revision.count ?? "",
  ].join("\u001f");
};

const now = (): number => {
  return typeof globalThis.performance?.now === "function"
    ? globalThis.performance.now()
    : Date.now();
};

export const useAgentChatTranscriptRows = ({
  session,
  showThinkingMessages,
}: {
  session: AgentChatThreadSession | null;
  showThinkingMessages: boolean;
}): {
  transcriptState: TranscriptRowsState;
  hasRowsForActiveSession: boolean;
  hasCurrentRowsForActiveSession: boolean;
  isTranscriptRowsMissing: boolean;
  isTranscriptRowsPending: boolean;
} => {
  const rowsCacheRef = useRef<TranscriptRowsCache | null>(null);
  if (rowsCacheRef.current === null) {
    rowsCacheRef.current = createTranscriptRowsCache();
  }
  const rowsCache = rowsCacheRef.current;
  const derivationTokenRef = useRef(0);
  const activeRevision = useMemo(
    () => buildTranscriptRowsRevision(session, showThinkingMessages),
    [session, showThinkingMessages],
  );
  const activeRevisionKey = useMemo(
    () => toTranscriptRowsRevisionKey(activeRevision),
    [activeRevision],
  );
  const [resolvedTranscriptState, dispatchResolvedTranscriptState] = useReducer(
    (_current: TranscriptRowsState, next: TranscriptRowsState) => next,
    undefined,
    () => {
      if (!session || getSessionMessageCount(session) > TRANSCRIPT_DERIVATION_SYNC_MESSAGE_LIMIT) {
        return EMPTY_TRANSCRIPT_ROWS_STATE;
      }

      return buildImmediateTranscriptRowsState({
        session,
        showThinkingMessages,
        cache: rowsCache,
      });
    },
  );
  const activeSessionRef = useRef(session);
  const activeRevisionRef = useRef(activeRevision);
  const resolvedTranscriptStateRef = useRef(resolvedTranscriptState);
  activeSessionRef.current = session;
  activeRevisionRef.current = activeRevision;
  resolvedTranscriptStateRef.current = resolvedTranscriptState;
  const hasResolvedRowsForActiveSession = Boolean(
    session &&
      resolvedTranscriptState.revision.sessionKey === agentSessionIdentityKey(session) &&
      resolvedTranscriptState.revision.showThinkingMessages === showThinkingMessages,
  );
  const cachedTranscriptState = useMemo(() => {
    if (!session || hasResolvedRowsForActiveSession) {
      return null;
    }

    const reusableRowsState = peekReusableTranscriptRowsState({
      session,
      showThinkingMessages,
      cache: rowsCache,
      touch: false,
    });
    if (!reusableRowsState) {
      return null;
    }

    return toTranscriptRowsState({
      session,
      revision: activeRevision,
      rowsState: reusableRowsState,
    });
  }, [activeRevision, hasResolvedRowsForActiveSession, rowsCache, session, showThinkingMessages]);
  const displayedTranscriptState = cachedTranscriptState ?? resolvedTranscriptState;
  const hasRowsForActiveSession = Boolean(
    session &&
      displayedTranscriptState.revision.sessionKey === agentSessionIdentityKey(session) &&
      displayedTranscriptState.revision.showThinkingMessages === showThinkingMessages,
  );
  const hasCurrentRowsForActiveSession = Boolean(
    session && areTranscriptRowsRevisionsEqual(displayedTranscriptState.revision, activeRevision),
  );
  const isTranscriptRowsMissing = Boolean(session && !hasRowsForActiveSession);
  const isTranscriptRowsPending = Boolean(session && !hasCurrentRowsForActiveSession);

  useEffect(() => {
    // activeRevisionKey intentionally triggers this effect; async work reads refs below.
    void activeRevisionKey;
    derivationTokenRef.current += 1;
    const derivationToken = derivationTokenRef.current;
    const currentSession = activeSessionRef.current;
    const currentRevision = activeRevisionRef.current;

    if (!currentSession) {
      dispatchResolvedTranscriptState(EMPTY_TRANSCRIPT_ROWS_STATE);
      return;
    }

    if (
      areTranscriptRowsRevisionsEqual(resolvedTranscriptStateRef.current.revision, currentRevision)
    ) {
      return;
    }

    const reusableRowsState = peekReusableTranscriptRowsState({
      session: currentSession,
      showThinkingMessages,
      cache: rowsCache,
    });
    if (reusableRowsState) {
      const nextTranscriptState = toTranscriptRowsState({
        session: currentSession,
        revision: currentRevision,
        rowsState: reusableRowsState,
      });
      startTransition(() => {
        if (derivationTokenRef.current === derivationToken) {
          dispatchResolvedTranscriptState(nextTranscriptState);
        }
      });
      return;
    }

    const previousCacheEntry = peekTranscriptRowsCacheEntry({
      session: currentSession,
      showThinkingMessages,
      cache: rowsCache,
    });
    const firstChangedMessageIndex = previousCacheEntry
      ? findFirstChangedSessionMessageIndex(previousCacheEntry.messages, currentSession)
      : 0;
    const changedMessageCount = getSessionMessageCount(currentSession) - firstChangedMessageIndex;
    const previousMessageCount = previousCacheEntry?.messages.items.length ?? 0;
    const currentMessageCount = getSessionMessageCount(currentSession);
    const isNoShrink = currentMessageCount >= previousMessageCount;
    const previousChangedMessage = previousCacheEntry?.messages.items[firstChangedMessageIndex];
    const currentChangedMessage = currentSession.messages.items[firstChangedMessageIndex];
    const isTailAppend = Boolean(
      previousCacheEntry && firstChangedMessageIndex >= previousMessageCount,
    );
    const isAssistantTailEdit = Boolean(
      previousChangedMessage &&
        currentChangedMessage &&
        firstChangedMessageIndex === previousMessageCount - 1 &&
        previousChangedMessage.id === currentChangedMessage.id &&
        previousChangedMessage.role === "assistant" &&
        currentChangedMessage.role === "assistant",
    );
    if (
      previousCacheEntry &&
      firstChangedMessageIndex >= 0 &&
      isNoShrink &&
      changedMessageCount >= 0 &&
      changedMessageCount <= TRANSCRIPT_DERIVATION_SYNC_MESSAGE_LIMIT &&
      (isTailAppend || isAssistantTailEdit)
    ) {
      const rowsState = buildAgentChatWindowRowsStateFromPrefix({
        session: currentSession,
        showThinkingMessages,
        previousRowsState: previousCacheEntry,
        startMessageIndex: firstChangedMessageIndex,
      });
      writeTranscriptRowsCacheEntry({
        session: currentSession,
        showThinkingMessages,
        rowsState,
        cache: rowsCache,
      });
      dispatchResolvedTranscriptState(
        toTranscriptRowsState({
          session: currentSession,
          revision: currentRevision,
          rowsState,
        }),
      );
      return;
    }

    const builder = createAgentChatWindowRowsStateBuilder(currentSession, { showThinkingMessages });
    if (getSessionMessageCount(currentSession) <= TRANSCRIPT_DERIVATION_SYNC_MESSAGE_LIMIT) {
      const rowsState = builder.complete();
      writeTranscriptRowsCacheEntry({
        session: currentSession,
        showThinkingMessages,
        rowsState,
        cache: rowsCache,
      });
      dispatchResolvedTranscriptState(
        toTranscriptRowsState({
          session: currentSession,
          revision: currentRevision,
          rowsState,
        }),
      );
      return;
    }

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

        const rowsState = builder.complete();
        writeTranscriptRowsCacheEntry({
          session: currentSession,
          showThinkingMessages,
          rowsState,
          cache: rowsCache,
        });
        const nextTranscriptState = toTranscriptRowsState({
          session: currentSession,
          revision: currentRevision,
          rowsState,
        });
        startTransition(() => {
          if (derivationTokenRef.current === derivationToken) {
            dispatchResolvedTranscriptState(nextTranscriptState);
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
  }, [activeRevisionKey, rowsCache, showThinkingMessages]);

  const transcriptState = useMemo(() => {
    if (!hasRowsForActiveSession) {
      return EMPTY_TRANSCRIPT_ROWS_STATE;
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
    isTranscriptRowsMissing,
    isTranscriptRowsPending,
  };
};

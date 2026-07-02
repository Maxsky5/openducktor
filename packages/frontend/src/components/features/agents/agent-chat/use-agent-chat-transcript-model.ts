import { startTransition, useEffect, useMemo, useReducer, useRef } from "react";
import { isAgentSessionActivityWorking } from "@/lib/agent-session-activity-state";
import { agentSessionIdentityKey } from "@/lib/agent-session-identity";
import {
  findFirstChangedSessionMessageIndex,
  getSessionMessageAt,
  getSessionMessageCount,
  getSessionMessagesRevision,
} from "@/state/operations/agent-orchestrator/support/messages";
import type { AgentChatThreadSession } from "./agent-chat.types";
import {
  type AgentChatTranscriptRow,
  type AgentChatTurnAnchor,
  createAgentChatTranscriptModelBuilder,
  updateAgentChatTranscriptModelFromPrefix,
} from "./agent-chat-transcript-model";
import {
  createTranscriptModelCache,
  peekReusableTranscriptModelState,
  peekTranscriptModelCacheEntry,
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
  activityState: AgentChatThreadSession["activityState"];
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
  turnAnchors: [] as AgentChatTurnAnchor[],
  hasAttachmentMessages: false,
  lastUserMessageKey: null,
  activeStreamingAssistantMessageId: null,
});

const buildTranscriptModelRevision = (
  session: AgentChatThreadSession | null,
  showThinkingMessages: boolean,
): TranscriptModelRevision => {
  if (!session) {
    return EMPTY_TRANSCRIPT_MODEL_REVISION;
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

const toTranscriptModelState = ({
  session,
  revision,
  transcriptModel,
}: {
  session: AgentChatThreadSession;
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

const buildImmediateTranscriptModelState = ({
  session,
  showThinkingMessages,
  cache,
}: {
  session: AgentChatThreadSession;
  showThinkingMessages: boolean;
  cache: TranscriptModelCache;
}): TranscriptModelState => {
  const transcriptModel = createAgentChatTranscriptModelBuilder(session, {
    showThinkingMessages,
  }).complete();
  writeTranscriptModelCacheEntry({
    session,
    showThinkingMessages,
    transcriptModel,
    cache,
  });

  return toTranscriptModelState({
    session,
    revision: buildTranscriptModelRevision(session, showThinkingMessages),
    transcriptModel,
  });
};

const areTranscriptModelRevisionsEqual = (
  left: TranscriptModelRevision,
  right: TranscriptModelRevision,
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

const toTranscriptModelRevisionKey = (revision: TranscriptModelRevision): string => {
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

type IncrementalTranscriptModelPlan = {
  mode: "append" | "replace-tail";
  startMessageIndex: number;
};

const isMessageIdInPrefix = (
  messages: AgentChatThreadSession["messages"],
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
  currentSession: AgentChatThreadSession;
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
  currentSession: AgentChatThreadSession;
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
  session: AgentChatThreadSession | null;
  showThinkingMessages: boolean;
}): {
  transcriptState: TranscriptModelState;
  hasRowsForActiveSession: boolean;
  hasCurrentRowsForActiveSession: boolean;
  isTranscriptModelMissing: boolean;
  isTranscriptModelPending: boolean;
} => {
  const rowsCacheRef = useRef<TranscriptModelCache | null>(null);
  if (rowsCacheRef.current === null) {
    rowsCacheRef.current = createTranscriptModelCache();
  }
  const rowsCache = rowsCacheRef.current;
  const derivationTokenRef = useRef(0);
  const activeRevision = useMemo(
    () => buildTranscriptModelRevision(session, showThinkingMessages),
    [session, showThinkingMessages],
  );
  const activeRevisionKey = useMemo(
    () => toTranscriptModelRevisionKey(activeRevision),
    [activeRevision],
  );
  const [resolvedTranscriptState, dispatchResolvedTranscriptState] = useReducer(
    (_current: TranscriptModelState, next: TranscriptModelState) => next,
    undefined,
    () => {
      if (!session || getSessionMessageCount(session) > TRANSCRIPT_DERIVATION_SYNC_MESSAGE_LIMIT) {
        return EMPTY_TRANSCRIPT_MODEL_STATE;
      }

      return buildImmediateTranscriptModelState({
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
  const displayedTranscriptState = resolvedTranscriptState;
  const hasRowsForActiveSession = Boolean(
    session &&
      displayedTranscriptState.revision.sessionKey === agentSessionIdentityKey(session) &&
      displayedTranscriptState.revision.showThinkingMessages === showThinkingMessages,
  );
  const hasCurrentRowsForActiveSession = Boolean(
    session && areTranscriptModelRevisionsEqual(displayedTranscriptState.revision, activeRevision),
  );
  const isTranscriptModelMissing = Boolean(session && !hasRowsForActiveSession);
  const isTranscriptModelPending = Boolean(session && !hasCurrentRowsForActiveSession);

  useEffect(() => {
    // activeRevisionKey intentionally triggers this effect; async work reads refs below.
    void activeRevisionKey;
    derivationTokenRef.current += 1;
    const derivationToken = derivationTokenRef.current;
    const currentSession = activeSessionRef.current;
    const currentRevision = activeRevisionRef.current;

    if (!currentSession) {
      dispatchResolvedTranscriptState(EMPTY_TRANSCRIPT_MODEL_STATE);
      return;
    }

    if (
      areTranscriptModelRevisionsEqual(resolvedTranscriptStateRef.current.revision, currentRevision)
    ) {
      return;
    }

    const reusableTranscriptModel = peekReusableTranscriptModelState({
      session: currentSession,
      showThinkingMessages,
      cache: rowsCache,
    });
    if (reusableTranscriptModel) {
      const nextTranscriptState = toTranscriptModelState({
        session: currentSession,
        revision: currentRevision,
        transcriptModel: reusableTranscriptModel,
      });
      startTransition(() => {
        if (derivationTokenRef.current === derivationToken) {
          dispatchResolvedTranscriptState(nextTranscriptState);
        }
      });
      return;
    }

    const previousCacheEntry = peekTranscriptModelCacheEntry({
      session: currentSession,
      showThinkingMessages,
      cache: rowsCache,
    });
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
          dispatchResolvedTranscriptState(
            toTranscriptModelState({
              session: currentSession,
              revision: currentRevision,
              transcriptModel,
            }),
          );
        }
        return;
      }
    }

    const builder = createAgentChatTranscriptModelBuilder(currentSession, { showThinkingMessages });
    if (getSessionMessageCount(currentSession) <= TRANSCRIPT_DERIVATION_SYNC_MESSAGE_LIMIT) {
      const transcriptModel = builder.complete();
      writeTranscriptModelCacheEntry({
        session: currentSession,
        showThinkingMessages,
        transcriptModel,
        cache: rowsCache,
      });
      dispatchResolvedTranscriptState(
        toTranscriptModelState({
          session: currentSession,
          revision: currentRevision,
          transcriptModel,
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

        const transcriptModel = builder.complete();
        writeTranscriptModelCacheEntry({
          session: currentSession,
          showThinkingMessages,
          transcriptModel,
          cache: rowsCache,
        });
        const nextTranscriptState = toTranscriptModelState({
          session: currentSession,
          revision: currentRevision,
          transcriptModel,
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
  };
};

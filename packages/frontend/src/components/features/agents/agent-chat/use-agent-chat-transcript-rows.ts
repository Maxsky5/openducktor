import { startTransition, useEffect, useMemo, useReducer, useRef } from "react";
import { getSessionMessageCount } from "@/state/operations/agent-orchestrator/support/messages";
import type { SessionMessagesState } from "@/types/agent-orchestrator";
import type { AgentChatThreadSession } from "./agent-chat.types";
import {
  type AgentChatWindowRow,
  type AgentChatWindowRowsCacheEntry,
  type AgentChatWindowTurn,
  createAgentChatWindowRowsStateBuilder,
  peekReusableAgentChatWindowRowsState,
  writeAgentChatWindowRowsCacheEntry,
} from "./agent-chat-thread-windowing";

const EMPTY_ROWS: AgentChatWindowRow[] = [];
const TRANSCRIPT_DERIVATION_CHUNK_BUDGET_MS = 6;
const TRANSCRIPT_DERIVATION_MAX_MESSAGES_PER_CHUNK = 250;
const TRANSCRIPT_DERIVATION_SYNC_MESSAGE_LIMIT = 100;

type TranscriptRowsRevision = {
  externalSessionId: string | null;
  sessionStatus: AgentChatThreadSession["status"] | null;
  showThinkingMessages: boolean;
  messagesKind: "state" | "array" | "none";
  messagesExternalSessionId: string | null;
  version: number | null;
  count: number | null;
  rawSessionToken: number | null;
};

const rawSessionTokenBySession = new WeakMap<AgentChatThreadSession, number>();
let nextRawSessionToken = 1;

export type TranscriptRowsState = {
  revision: TranscriptRowsRevision;
  rows: AgentChatWindowRow[];
  turns: AgentChatWindowTurn[];
  hasAttachmentMessages: boolean;
  lastUserMessageId: string | null;
  activeStreamingAssistantMessageId: string | null;
};

const EMPTY_TRANSCRIPT_ROWS_REVISION: TranscriptRowsRevision = Object.freeze({
  externalSessionId: null,
  sessionStatus: null,
  showThinkingMessages: false,
  messagesKind: "none",
  messagesExternalSessionId: null,
  version: null,
  count: null,
  rawSessionToken: null,
});

const EMPTY_TRANSCRIPT_ROWS_STATE: TranscriptRowsState = Object.freeze({
  revision: EMPTY_TRANSCRIPT_ROWS_REVISION,
  rows: EMPTY_ROWS,
  turns: [] as AgentChatWindowTurn[],
  hasAttachmentMessages: false,
  lastUserMessageId: null,
  activeStreamingAssistantMessageId: null,
});

const isSessionMessagesState = (
  messages: AgentChatThreadSession["messages"],
): messages is SessionMessagesState => {
  return (
    typeof messages === "object" &&
    messages !== null &&
    "count" in messages &&
    "version" in messages
  );
};

const buildTranscriptRowsRevision = (
  session: AgentChatThreadSession | null,
  showThinkingMessages: boolean,
): TranscriptRowsRevision => {
  if (!session) {
    return EMPTY_TRANSCRIPT_ROWS_REVISION;
  }

  if (isSessionMessagesState(session.messages)) {
    return {
      externalSessionId: session.externalSessionId,
      sessionStatus: session.status,
      showThinkingMessages,
      messagesKind: "state",
      messagesExternalSessionId: session.messages.externalSessionId,
      version: session.messages.version,
      count: session.messages.count,
      rawSessionToken: null,
    };
  }

  const rawSessionToken = (() => {
    if (!Array.isArray(session.messages)) {
      return null;
    }

    const cachedToken = rawSessionTokenBySession.get(session);
    if (typeof cachedToken === "number") {
      return cachedToken;
    }

    const nextToken = nextRawSessionToken;
    nextRawSessionToken += 1;
    rawSessionTokenBySession.set(session, nextToken);
    return nextToken;
  })();

  return {
    externalSessionId: session.externalSessionId,
    sessionStatus: session.status,
    showThinkingMessages,
    messagesKind: Array.isArray(session.messages) ? "array" : "none",
    messagesExternalSessionId: null,
    version: null,
    count: getSessionMessageCount(session),
    rawSessionToken,
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
    activeStreamingAssistantMessageId:
      session.status === "running" ? rowsState.activeStreamingAssistantMessageId : null,
  };
};

const buildImmediateTranscriptRowsState = ({
  session,
  showThinkingMessages,
  cache,
}: {
  session: AgentChatThreadSession;
  showThinkingMessages: boolean;
  cache: Map<string, AgentChatWindowRowsCacheEntry>;
}): TranscriptRowsState => {
  const rowsState = createAgentChatWindowRowsStateBuilder(session, {
    showThinkingMessages,
  }).complete();
  writeAgentChatWindowRowsCacheEntry({
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
    left.externalSessionId === right.externalSessionId &&
    left.sessionStatus === right.sessionStatus &&
    left.showThinkingMessages === right.showThinkingMessages &&
    left.messagesKind === right.messagesKind &&
    left.messagesExternalSessionId === right.messagesExternalSessionId &&
    left.version === right.version &&
    left.count === right.count &&
    left.rawSessionToken === right.rawSessionToken
  );
};

const toTranscriptRowsRevisionKey = (revision: TranscriptRowsRevision): string => {
  return [
    revision.externalSessionId ?? "",
    revision.sessionStatus ?? "",
    revision.showThinkingMessages ? "thinking:on" : "thinking:off",
    revision.messagesKind,
    revision.messagesExternalSessionId ?? "",
    revision.version ?? "",
    revision.count ?? "",
    revision.rawSessionToken ?? "",
  ].join("\u001f");
};

const scheduleAfterSwitchPaint = (callback: () => void): (() => void) => {
  let timeoutId: ReturnType<typeof globalThis.setTimeout> | null = null;
  let frameId: number | null = null;
  let cancelled = false;

  const run = (): void => {
    if (cancelled) {
      return;
    }
    timeoutId = globalThis.setTimeout(() => {
      timeoutId = null;
      if (!cancelled) {
        callback();
      }
    }, 0);
  };

  if (typeof globalThis.requestAnimationFrame === "function") {
    frameId = globalThis.requestAnimationFrame(run);
  } else {
    run();
  }

  return () => {
    cancelled = true;
    if (frameId !== null && typeof globalThis.cancelAnimationFrame === "function") {
      globalThis.cancelAnimationFrame(frameId);
    }
    if (timeoutId !== null) {
      globalThis.clearTimeout(timeoutId);
    }
  };
};

const now = (): number => {
  return typeof globalThis.performance?.now === "function"
    ? globalThis.performance.now()
    : Date.now();
};

export const useAgentChatTranscriptRows = ({
  session,
  showThinkingMessages,
  shouldPauseDerivation,
}: {
  session: AgentChatThreadSession | null;
  showThinkingMessages: boolean;
  shouldPauseDerivation: boolean;
}): {
  transcriptState: TranscriptRowsState;
  hasRowsForActiveSession: boolean;
  hasCurrentRowsForActiveSession: boolean;
  isTranscriptRowsMissing: boolean;
  isTranscriptRowsPending: boolean;
} => {
  const rowsCacheRef = useRef<Map<string, AgentChatWindowRowsCacheEntry> | null>(null);
  if (rowsCacheRef.current === null) {
    rowsCacheRef.current = new Map<string, AgentChatWindowRowsCacheEntry>();
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
      if (
        !session ||
        shouldPauseDerivation ||
        getSessionMessageCount(session) > TRANSCRIPT_DERIVATION_SYNC_MESSAGE_LIMIT
      ) {
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
  const hasRowsForActiveSession = Boolean(
    session &&
      resolvedTranscriptState.revision.externalSessionId === session.externalSessionId &&
      resolvedTranscriptState.revision.showThinkingMessages === showThinkingMessages,
  );
  const hasCurrentRowsForActiveSession = Boolean(
    session && areTranscriptRowsRevisionsEqual(resolvedTranscriptState.revision, activeRevision),
  );
  const isTranscriptRowsMissing = Boolean(
    session && !shouldPauseDerivation && !hasRowsForActiveSession,
  );
  const isTranscriptRowsPending = Boolean(
    session && !shouldPauseDerivation && !hasCurrentRowsForActiveSession,
  );

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
      shouldPauseDerivation ||
      areTranscriptRowsRevisionsEqual(resolvedTranscriptStateRef.current.revision, currentRevision)
    ) {
      return;
    }

    const reusableRowsState = peekReusableAgentChatWindowRowsState({
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

    const builder = createAgentChatWindowRowsStateBuilder(currentSession, { showThinkingMessages });
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
        writeAgentChatWindowRowsCacheEntry({
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

    const cancelAfterPaint = scheduleAfterSwitchPaint(scheduleNextChunk);

    return () => {
      cancelAfterPaint();
      if (scheduledWorkId) {
        globalThis.clearTimeout(scheduledWorkId);
      }
    };
  }, [activeRevisionKey, rowsCache, shouldPauseDerivation, showThinkingMessages]);

  const transcriptState = useMemo(() => {
    if (!hasRowsForActiveSession) {
      return EMPTY_TRANSCRIPT_ROWS_STATE;
    }

    if (session?.status === "running") {
      return resolvedTranscriptState;
    }

    if (resolvedTranscriptState.activeStreamingAssistantMessageId === null) {
      return resolvedTranscriptState;
    }

    return {
      ...resolvedTranscriptState,
      activeStreamingAssistantMessageId: null,
    };
  }, [hasRowsForActiveSession, resolvedTranscriptState, session?.status]);

  return {
    transcriptState,
    hasRowsForActiveSession,
    hasCurrentRowsForActiveSession,
    isTranscriptRowsMissing,
    isTranscriptRowsPending,
  };
};

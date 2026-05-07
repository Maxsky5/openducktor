import { startTransition, useEffect, useMemo, useRef, useState } from "react";
import { getSessionMessageCount } from "@/state/operations/agent-orchestrator/support/messages";
import type { AgentSessionState, SessionMessagesState } from "@/types/agent-orchestrator";
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
  sessionStatus: AgentSessionState["status"] | null;
  showThinkingMessages: boolean;
  messagesKind: "state" | "array" | "none";
  messagesExternalSessionId: string | null;
  version: number | null;
  count: number | null;
  rawMessages: AgentSessionState["messages"] | null;
  rawMessagesToken: number | null;
};

const rawMessagesTokenByArray = new WeakMap<object, number>();
let nextRawMessagesToken = 1;

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
  rawMessages: null,
  rawMessagesToken: null,
});

export const EMPTY_TRANSCRIPT_ROWS_STATE: TranscriptRowsState = Object.freeze({
  revision: EMPTY_TRANSCRIPT_ROWS_REVISION,
  rows: EMPTY_ROWS,
  turns: [] as AgentChatWindowTurn[],
  hasAttachmentMessages: false,
  lastUserMessageId: null,
  activeStreamingAssistantMessageId: null,
});

const isSessionMessagesState = (
  messages: AgentSessionState["messages"],
): messages is SessionMessagesState => {
  return (
    typeof messages === "object" &&
    messages !== null &&
    "count" in messages &&
    "version" in messages
  );
};

const buildTranscriptRowsRevision = (
  session: AgentSessionState | null,
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
      rawMessages: null,
      rawMessagesToken: null,
    };
  }

  const rawMessagesToken = (() => {
    if (!Array.isArray(session.messages)) {
      return null;
    }

    const cachedToken = rawMessagesTokenByArray.get(session.messages);
    if (typeof cachedToken === "number") {
      return cachedToken;
    }

    const nextToken = nextRawMessagesToken;
    nextRawMessagesToken += 1;
    rawMessagesTokenByArray.set(session.messages, nextToken);
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
    rawMessages: session.messages,
    rawMessagesToken,
  };
};

const buildImmediateTranscriptRowsState = ({
  session,
  showThinkingMessages,
  cache,
}: {
  session: AgentSessionState;
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

  return {
    revision: buildTranscriptRowsRevision(session, showThinkingMessages),
    rows: rowsState.rows,
    turns: rowsState.turns,
    hasAttachmentMessages: rowsState.hasAttachmentMessages,
    lastUserMessageId: rowsState.lastUserMessageId,
    activeStreamingAssistantMessageId:
      session.status === "running" ? rowsState.activeStreamingAssistantMessageId : null,
  };
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
    left.rawMessages === right.rawMessages &&
    left.rawMessagesToken === right.rawMessagesToken
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
    revision.rawMessagesToken ?? "",
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
  session: AgentSessionState | null;
  showThinkingMessages: boolean;
  shouldPauseDerivation: boolean;
}): {
  transcriptState: TranscriptRowsState;
  hasRowsForActiveSession: boolean;
  hasCurrentRowsForActiveSession: boolean;
  isTranscriptRowsMissing: boolean;
  isTranscriptRowsPending: boolean;
} => {
  const rowsCacheRef = useRef<Map<string, AgentChatWindowRowsCacheEntry>>(new Map());
  const derivationTokenRef = useRef(0);
  const activeRevision = useMemo(
    () => buildTranscriptRowsRevision(session, showThinkingMessages),
    [session, showThinkingMessages],
  );
  const activeRevisionKey = useMemo(
    () => toTranscriptRowsRevisionKey(activeRevision),
    [activeRevision],
  );
  const [resolvedTranscriptState, setResolvedTranscriptState] = useState<TranscriptRowsState>(
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
        cache: rowsCacheRef.current,
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
    void activeRevisionKey;
    derivationTokenRef.current += 1;
    const derivationToken = derivationTokenRef.current;
    const currentSession = activeSessionRef.current;
    const currentRevision = activeRevisionRef.current;

    if (!currentSession) {
      setResolvedTranscriptState(EMPTY_TRANSCRIPT_ROWS_STATE);
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
      cache: rowsCacheRef.current,
    });
    if (reusableRowsState) {
      const nextTranscriptState: TranscriptRowsState = {
        revision: currentRevision,
        ...reusableRowsState,
      };
      startTransition(() => {
        if (derivationTokenRef.current === derivationToken) {
          setResolvedTranscriptState(nextTranscriptState);
        }
      });
      return;
    }

    const messageCount = getSessionMessageCount(currentSession);

    if (
      resolvedTranscriptStateRef.current.revision.externalSessionId ===
        currentSession.externalSessionId &&
      messageCount <= TRANSCRIPT_DERIVATION_SYNC_MESSAGE_LIMIT
    ) {
      const nextTranscriptState = buildImmediateTranscriptRowsState({
        session: currentSession,
        showThinkingMessages,
        cache: rowsCacheRef.current,
      });
      startTransition(() => {
        if (derivationTokenRef.current === derivationToken) {
          setResolvedTranscriptState(nextTranscriptState);
        }
      });
      return;
    }

    if (messageCount <= TRANSCRIPT_DERIVATION_SYNC_MESSAGE_LIMIT) {
      let cancelled = false;
      const publishRows = (): void => {
        if (cancelled || derivationTokenRef.current !== derivationToken) {
          return;
        }
        const nextTranscriptState = buildImmediateTranscriptRowsState({
          session: currentSession,
          showThinkingMessages,
          cache: rowsCacheRef.current,
        });
        startTransition(() => {
          if (!cancelled && derivationTokenRef.current === derivationToken) {
            setResolvedTranscriptState(nextTranscriptState);
          }
        });
      };

      if (typeof globalThis.requestAnimationFrame === "function") {
        const frameId = globalThis.requestAnimationFrame(publishRows);
        return () => {
          cancelled = true;
          globalThis.cancelAnimationFrame(frameId);
        };
      }

      const timeoutId = globalThis.setTimeout(publishRows, 0);
      return () => {
        cancelled = true;
        globalThis.clearTimeout(timeoutId);
      };
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
          cache: rowsCacheRef.current,
        });
        const nextTranscriptState: TranscriptRowsState = {
          revision: currentRevision,
          rows: rowsState.rows,
          turns: rowsState.turns,
          hasAttachmentMessages: rowsState.hasAttachmentMessages,
          lastUserMessageId: rowsState.lastUserMessageId,
          activeStreamingAssistantMessageId:
            currentSession.status === "running"
              ? rowsState.activeStreamingAssistantMessageId
              : null,
        };
        startTransition(() => {
          if (derivationTokenRef.current === derivationToken) {
            setResolvedTranscriptState(nextTranscriptState);
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
  }, [activeRevisionKey, shouldPauseDerivation, showThinkingMessages]);

  const transcriptState = useMemo(() => {
    if (!hasRowsForActiveSession) {
      return EMPTY_TRANSCRIPT_ROWS_STATE;
    }

    if (session?.status === "running") {
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

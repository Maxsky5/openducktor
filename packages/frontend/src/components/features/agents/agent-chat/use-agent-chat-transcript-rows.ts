import { startTransition, useEffect, useMemo, useReducer, useRef } from "react";
import { agentSessionIdentityKey } from "@/lib/agent-session-identity";
import {
  getSessionMessageCount,
  getSessionMessagesRevision,
} from "@/state/operations/agent-orchestrator/support/messages";
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
  sessionKey: string | null;
  sessionStatus: AgentChatThreadSession["status"] | null;
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
  sessionStatus: null,
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
    sessionStatus: session.status,
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
    left.sessionKey === right.sessionKey &&
    left.sessionStatus === right.sessionStatus &&
    left.showThinkingMessages === right.showThinkingMessages &&
    left.messagesSessionKey === right.messagesSessionKey &&
    left.version === right.version &&
    left.count === right.count
  );
};

const toTranscriptRowsRevisionKey = (revision: TranscriptRowsRevision): string => {
  return [
    revision.sessionKey ?? "",
    revision.sessionStatus ?? "",
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
  const hasRowsForActiveSession = Boolean(
    session &&
      resolvedTranscriptState.revision.sessionKey === agentSessionIdentityKey(session) &&
      resolvedTranscriptState.revision.showThinkingMessages === showThinkingMessages,
  );
  const hasCurrentRowsForActiveSession = Boolean(
    session && areTranscriptRowsRevisionsEqual(resolvedTranscriptState.revision, activeRevision),
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
    if (getSessionMessageCount(currentSession) <= TRANSCRIPT_DERIVATION_SYNC_MESSAGE_LIMIT) {
      const rowsState = builder.complete();
      writeAgentChatWindowRowsCacheEntry({
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

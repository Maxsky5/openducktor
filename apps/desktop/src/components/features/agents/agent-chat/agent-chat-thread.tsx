import { AlertTriangle, LoaderCircle, RefreshCcw, Sparkles } from "lucide-react";
import {
  memo,
  type ReactElement,
  type RefObject,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
} from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  findLastUserSessionMessage,
  getSessionMessageAt,
  getSessionMessagesSlice,
  someSessionMessage,
} from "@/state/operations/agent-orchestrator/support/messages";
import type { AgentChatMessage, AgentSessionState } from "@/types/agent-orchestrator";
import { resolveAgentAccentColor } from "../agent-accent-color";
import type { AgentChatThreadModel } from "./agent-chat.types";
import { resolveActiveStreamingAssistantMessageId } from "./agent-chat-streaming";
import { AgentChatThreadRow } from "./agent-chat-thread-row";
import { getAgentChatThreadState } from "./agent-chat-thread-state";
import {
  type AgentChatWindowRow,
  type AgentChatWindowTurn,
  buildAgentChatWindowRowsState,
  findFirstChangedChatMessageIndex,
} from "./agent-chat-thread-windowing";
import { AgentSessionPermissionCard } from "./agent-session-permission-card";
import { AgentSessionQuestionCard } from "./agent-session-question-card";
import {
  AgentSessionTodoPanel,
  getActionableSessionTodo,
  getVisibleSessionTodos,
} from "./agent-session-todo-panel";
import { ScrollToBottomButton } from "./scroll-to-bottom-button";
import { ScrollToTopButton } from "./scroll-to-top-button";
import { useAgentChatDeferredTranscript } from "./use-agent-chat-deferred-transcript";
import { useAgentChatLoadingOverlay } from "./use-agent-chat-loading-overlay";
import { useAgentChatRowMotion } from "./use-agent-chat-row-motion";
import { useAgentChatTurnStaging } from "./use-agent-chat-turn-staging";
import { useAgentChatWindow } from "./use-agent-chat-window";

type AgentChatThreadMotionRowProps = {
  row: AgentChatWindowRow;
  isStreamingAssistantMessage: boolean;
  sessionAgentColors: Record<string, string>;
  sessionTaskId: AgentSessionState["taskId"] | null;
  sessionRole: AgentSessionState["role"] | null;
  sessionWorkingDirectory: AgentSessionState["workingDirectory"] | null;
  sessionRuntimeKind: AgentSessionState["runtimeKind"] | null;
  resolveRowRef: (rowKey: string) => (element: HTMLDivElement | null) => void;
};

type AgentChatTranscriptProps = {
  activeStreamingAssistantMessageId: string | null;
  hasSession: boolean;
  emptyState: AgentChatThreadModel["emptyState"];
  isStarting: boolean;
  isSending: boolean;
  isInteractionEnabled: boolean;
  sessionAgentColors: Record<string, string>;
  sessionTaskId: AgentSessionState["taskId"] | null;
  sessionRole: AgentSessionState["role"] | null;
  sessionWorkingDirectory: AgentSessionState["workingDirectory"] | null;
  sessionRuntimeKind: AgentSessionState["runtimeKind"] | null;
  messagesContainerRef: AgentChatThreadModel["messagesContainerRef"];
  messagesContentRef: RefObject<HTMLDivElement | null>;
  renderedTurns: AgentChatRenderedTurn[];
  allowTurnContainment: boolean;
  resolveRowRef: (rowKey: string) => (element: HTMLDivElement | null) => void;
  statusOverlay: {
    kind: "runtime_waiting" | "session_loading";
    title: string;
    description: string;
  } | null;
  showRuntimeBlockedCard: boolean;
  blockedReason: string | null;
  isLoadingChecks: boolean;
  onRefreshChecks: () => void;
  showSessionLoadingOverlay: boolean;
};

const AgentChatStatusOverlay = memo(function AgentChatStatusOverlay({
  title,
  description,
}: {
  title: string;
  description: string;
}): ReactElement {
  return (
    <div className="sticky top-0 z-20 mb-4">
      <div className="mx-auto flex max-w-3xl items-start gap-3 rounded-xl border border-border bg-card/95 px-4 py-3 text-sm shadow-sm backdrop-blur supports-[backdrop-filter]:bg-card/85">
        <div className="mt-0.5 rounded-full bg-muted p-2 text-muted-foreground">
          <LoaderCircle className="size-4 animate-spin" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="font-medium text-foreground">{title}</p>
          <p className="text-muted-foreground">{description}</p>
        </div>
      </div>
    </div>
  );
});

type AgentChatRenderedTurn = {
  key: string;
  rows: AgentChatWindowRow[];
  isActive: boolean;
};

const messageHasAttachmentDisplayParts = (message: AgentChatMessage): boolean => {
  return Boolean(
    message.meta?.kind === "user" && message.meta.parts?.some((part) => part.kind === "attachment"),
  );
};

type AgentChatBottomStackProps = {
  sessionId: string;
  pendingQuestions: AgentSessionState["pendingQuestions"];
  pendingPermissions: AgentSessionState["pendingPermissions"];
  todos: AgentSessionState["todos"];
  sessionRuntimeDataError: string | null;
  canSubmitQuestionAnswers: boolean;
  isSubmittingQuestionByRequestId: AgentChatThreadModel["isSubmittingQuestionByRequestId"];
  onSubmitQuestionAnswers: AgentChatThreadModel["onSubmitQuestionAnswers"];
  canReplyToPermissions: boolean;
  isSubmittingPermissionByRequestId: AgentChatThreadModel["isSubmittingPermissionByRequestId"];
  permissionReplyErrorByRequestId: AgentChatThreadModel["permissionReplyErrorByRequestId"];
  onReplyPermission: AgentChatThreadModel["onReplyPermission"];
  todoPanelCollapsed: boolean;
  isSessionWorking: boolean;
  sessionAccentColor: string | undefined;
  onToggleTodoPanel: () => void;
};

const EMPTY_ROWS: AgentChatWindowRow[] = [];
type RowsCacheEntry = {
  sessionId: string;
  showThinkingMessages: boolean;
  messages: AgentSessionState["messages"];
  rows: AgentChatWindowRow[];
  rowStartByMessageIndex: number[];
  rebuildStartByMessageIndex: number[];
  latestRebuildStartMessageIndex: number;
  turns: AgentChatWindowTurn[];
};
const TURN_CONTENT_VISIBILITY_STYLE = {
  contentVisibility: "auto",
  containIntrinsicSize: "auto 500px",
} as const;

const areChatRowsEquivalent = (left: AgentChatWindowRow, right: AgentChatWindowRow): boolean => {
  if (left === right) {
    return true;
  }
  if (left.kind !== right.kind || left.key !== right.key) {
    return false;
  }
  if (left.kind === "turn_duration" && right.kind === "turn_duration") {
    return left.durationMs === right.durationMs;
  }
  return left.kind === "message" && right.kind === "message" && left.message === right.message;
};

const AgentChatThreadMotionRow = memo(
  function AgentChatThreadMotionRow({
    row,
    isStreamingAssistantMessage,
    sessionAgentColors,
    sessionTaskId,
    sessionRole,
    sessionWorkingDirectory,
    sessionRuntimeKind,
    resolveRowRef,
  }: AgentChatThreadMotionRowProps): ReactElement {
    return (
      <div ref={resolveRowRef(row.key)} data-row-key={row.key} className="agent-chat-row-motion">
        <AgentChatThreadRow
          row={row}
          isStreamingAssistantMessage={isStreamingAssistantMessage}
          sessionTaskId={sessionTaskId}
          sessionRole={sessionRole}
          sessionAgentColors={sessionAgentColors}
          sessionWorkingDirectory={sessionWorkingDirectory}
          sessionRuntimeKind={sessionRuntimeKind}
        />
      </div>
    );
  },
  (previousProps, nextProps) => {
    return (
      previousProps.sessionTaskId === nextProps.sessionTaskId &&
      previousProps.sessionRole === nextProps.sessionRole &&
      previousProps.sessionRuntimeKind === nextProps.sessionRuntimeKind &&
      previousProps.sessionWorkingDirectory === nextProps.sessionWorkingDirectory &&
      previousProps.isStreamingAssistantMessage === nextProps.isStreamingAssistantMessage &&
      previousProps.sessionAgentColors === nextProps.sessionAgentColors &&
      previousProps.resolveRowRef === nextProps.resolveRowRef &&
      areChatRowsEquivalent(previousProps.row, nextProps.row)
    );
  },
);

const AgentChatTurnGroup = memo(function AgentChatTurnGroup({
  turn,
  activeStreamingAssistantMessageId,
  sessionAgentColors,
  sessionTaskId,
  sessionRole,
  sessionWorkingDirectory,
  sessionRuntimeKind,
  resolveRowRef,
  allowTurnContainment,
}: {
  turn: AgentChatRenderedTurn;
  activeStreamingAssistantMessageId: string | null;
  sessionAgentColors: Record<string, string>;
  sessionTaskId: AgentSessionState["taskId"] | null;
  sessionRole: AgentSessionState["role"] | null;
  sessionWorkingDirectory: AgentSessionState["workingDirectory"] | null;
  sessionRuntimeKind: AgentSessionState["runtimeKind"] | null;
  resolveRowRef: (rowKey: string) => (element: HTMLDivElement | null) => void;
  allowTurnContainment: boolean;
}): ReactElement {
  return (
    <div style={!allowTurnContainment || turn.isActive ? undefined : TURN_CONTENT_VISIBILITY_STYLE}>
      {turn.rows.map((row) => (
        <AgentChatThreadMotionRow
          key={row.key}
          row={row}
          isStreamingAssistantMessage={
            row.kind === "message" && row.message.id === activeStreamingAssistantMessageId
          }
          sessionTaskId={sessionTaskId}
          sessionRole={sessionRole}
          sessionAgentColors={sessionAgentColors}
          sessionWorkingDirectory={sessionWorkingDirectory}
          sessionRuntimeKind={sessionRuntimeKind}
          resolveRowRef={resolveRowRef}
        />
      ))}
    </div>
  );
});

const AgentChatTranscript = memo(function AgentChatTranscript({
  activeStreamingAssistantMessageId,
  hasSession,
  emptyState,
  isStarting,
  isSending,
  isInteractionEnabled,
  sessionAgentColors,
  sessionTaskId,
  sessionRole,
  sessionWorkingDirectory,
  sessionRuntimeKind,
  messagesContainerRef,
  messagesContentRef,
  renderedTurns,
  allowTurnContainment,
  resolveRowRef,
  statusOverlay,
  showRuntimeBlockedCard,
  blockedReason,
  isLoadingChecks,
  onRefreshChecks,
  showSessionLoadingOverlay,
}: AgentChatTranscriptProps): ReactElement {
  const visibleStatusOverlay =
    statusOverlay !== null &&
    (statusOverlay.kind === "runtime_waiting" || showSessionLoadingOverlay)
      ? statusOverlay
      : null;

  return (
    <div
      ref={messagesContainerRef}
      className="agent-chat-scroll-region hide-scrollbar relative min-h-0 flex-1 overflow-y-auto px-4 pb-4 pt-4"
    >
      {visibleStatusOverlay ? (
        <AgentChatStatusOverlay
          title={visibleStatusOverlay.title}
          description={visibleStatusOverlay.description}
        />
      ) : null}

      {showRuntimeBlockedCard ? (
        <div className="mb-4 flex items-start justify-between gap-3 rounded-xl border border-destructive-border bg-destructive-surface px-4 py-3 text-sm text-destructive-muted shadow-sm">
          <div className="flex min-w-0 items-start gap-2">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" />
            <p className="min-w-0">{blockedReason}</p>
          </div>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-8 border-destructive-border bg-card text-destructive-muted hover:bg-destructive-surface"
            disabled={isLoadingChecks}
            onClick={onRefreshChecks}
          >
            <RefreshCcw className={cn("size-3.5", isLoadingChecks ? "animate-spin" : "")} />
            Recheck
          </Button>
        </div>
      ) : null}

      <div ref={messagesContentRef} className="space-y-1">
        {!hasSession ? (
          <div className="space-y-3 rounded-lg border border-dashed border-input bg-card p-4 text-sm text-muted-foreground">
            <p>{emptyState?.title ?? "No transcript available."}</p>
            {emptyState?.actionLabel && emptyState.onAction ? (
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={
                  !isInteractionEnabled ||
                  isStarting ||
                  isSending ||
                  emptyState.actionDisabled ||
                  emptyState.isActionPending
                }
                onClick={emptyState.onAction}
              >
                {emptyState.isActionPending ? (
                  <LoaderCircle className="size-3.5 animate-spin" />
                ) : (
                  <Sparkles className="size-3.5" />
                )}
                {emptyState.actionLabel}
              </Button>
            ) : null}
          </div>
        ) : null}

        {hasSession
          ? renderedTurns.map((turn) => (
              <AgentChatTurnGroup
                key={turn.key}
                turn={turn}
                activeStreamingAssistantMessageId={activeStreamingAssistantMessageId}
                sessionTaskId={sessionTaskId}
                sessionRole={sessionRole}
                sessionAgentColors={sessionAgentColors}
                sessionWorkingDirectory={sessionWorkingDirectory}
                sessionRuntimeKind={sessionRuntimeKind}
                resolveRowRef={resolveRowRef}
                allowTurnContainment={allowTurnContainment}
              />
            ))
          : null}
      </div>
    </div>
  );
});

const AgentChatBottomStack = memo(function AgentChatBottomStack({
  sessionId,
  pendingQuestions,
  pendingPermissions,
  todos,
  sessionRuntimeDataError,
  canSubmitQuestionAnswers,
  isSubmittingQuestionByRequestId,
  onSubmitQuestionAnswers,
  canReplyToPermissions,
  isSubmittingPermissionByRequestId,
  permissionReplyErrorByRequestId,
  onReplyPermission,
  todoPanelCollapsed,
  isSessionWorking,
  sessionAccentColor,
  onToggleTodoPanel,
}: AgentChatBottomStackProps): ReactElement {
  const hasVisibleTodo = getActionableSessionTodo(getVisibleSessionTodos(todos)) !== null;
  const shouldAddComposerGap = !hasVisibleTodo;

  return (
    <div
      className={cn(
        "agent-chat-bottom-stack shrink-0 space-y-2 px-4 pt-3",
        shouldAddComposerGap ? "pb-3" : "pb-0",
      )}
    >
      {pendingQuestions.map((request) => (
        <AgentSessionQuestionCard
          key={`${sessionId}:${request.requestId}`}
          request={request}
          disabled={!canSubmitQuestionAnswers}
          isSubmitting={Boolean(isSubmittingQuestionByRequestId[request.requestId])}
          onSubmit={onSubmitQuestionAnswers}
        />
      ))}

      {pendingPermissions.map((request) => (
        <div key={`${sessionId}:${request.requestId}`} className="relative z-30">
          <AgentSessionPermissionCard
            request={request}
            disabled={!canReplyToPermissions}
            isSubmitting={Boolean(isSubmittingPermissionByRequestId[request.requestId])}
            errorMessage={permissionReplyErrorByRequestId[request.requestId]}
            onReply={onReplyPermission}
          />
        </div>
      ))}

      {sessionRuntimeDataError ? (
        <div className="border border-input border-b-0 border-l-0 bg-card">
          <div
            className={cn(
              "px-3 py-2 text-sm text-destructive",
              sessionAccentColor ? "border-l-4" : "border-l border-input",
            )}
            style={sessionAccentColor ? { borderLeftColor: sessionAccentColor } : undefined}
          >
            {sessionRuntimeDataError}
          </div>
        </div>
      ) : null}

      <AgentSessionTodoPanel
        todos={todos}
        collapsed={todoPanelCollapsed}
        isSessionWorking={isSessionWorking}
        accentColor={sessionAccentColor}
        onToggleCollapse={onToggleTodoPanel}
      />
    </div>
  );
});

export function AgentChatThread({ model }: { model: AgentChatThreadModel }): ReactElement {
  const {
    session,
    showThinkingMessages,
    isSessionViewLoading,
    isSessionHistoryLoading,
    isWaitingForRuntimeReadiness,
    readinessState,
    isInteractionEnabled,
    blockedReason,
    isLoadingChecks,
    onRefreshChecks,
    emptyState,
    isStarting,
    isSending,
    sessionAgentColors,
    canSubmitQuestionAnswers,
    isSubmittingQuestionByRequestId,
    onSubmitQuestionAnswers,
    canReplyToPermissions,
    isSubmittingPermissionByRequestId,
    permissionReplyErrorByRequestId,
    onReplyPermission,
    sessionRuntimeDataError,
    isSessionWorking,
    todoPanelCollapsed,
    onToggleTodoPanel,
    messagesContainerRef,
    scrollToBottomOnSendRef,
    syncBottomAfterComposerLayoutRef,
  } = model;
  const activeSessionId = session?.sessionId ?? null;
  const { isTranscriptRenderDeferred } = useAgentChatDeferredTranscript({
    activeSessionId,
    shouldDefer: isSessionViewLoading || isSessionHistoryLoading,
  });
  const {
    isTranscriptLoading,
    hideTranscriptWhileHydrating,
    statusOverlay,
    showRuntimeBlockedCard,
  } = getAgentChatThreadState({
    isSessionViewLoading,
    isSessionHistoryLoading,
    isWaitingForRuntimeReadiness,
    readinessState,
    blockedReason,
    isTranscriptRenderDeferred,
  });
  const rowsCacheRef = useRef<RowsCacheEntry | null>(null);

  const transcriptState = useMemo(() => {
    if (!session || hideTranscriptWhileHydrating) {
      rowsCacheRef.current = null;
      return {
        rows: EMPTY_ROWS,
        turns: [] as AgentChatWindowTurn[],
      };
    }

    const cachedRows = rowsCacheRef.current;
    if (
      cachedRows &&
      cachedRows.sessionId === session.sessionId &&
      cachedRows.showThinkingMessages === showThinkingMessages
    ) {
      const firstChangedMessageIndex = findFirstChangedChatMessageIndex(
        cachedRows.messages,
        session,
      );
      if (firstChangedMessageIndex < 0) {
        return {
          rows: cachedRows.rows,
          turns: cachedRows.turns,
        };
      }

      const rebuildStartMessageIndex = (() => {
        const cachedRebuildStart = cachedRows.rebuildStartByMessageIndex[firstChangedMessageIndex];
        if (typeof cachedRebuildStart === "number") {
          return cachedRebuildStart;
        }

        const changedMessage = getSessionMessageAt(session, firstChangedMessageIndex);
        if (changedMessage?.role === "user") {
          return firstChangedMessageIndex;
        }

        return cachedRows.latestRebuildStartMessageIndex;
      })();
      if (rebuildStartMessageIndex > 0) {
        const prefixRowEnd =
          cachedRows.rowStartByMessageIndex[rebuildStartMessageIndex] ?? cachedRows.rows.length;
        const nextRows = cachedRows.rows.slice(0, prefixRowEnd);
        const nextRowStartByMessageIndex = cachedRows.rowStartByMessageIndex.slice(
          0,
          rebuildStartMessageIndex,
        );
        const incrementalRowsState = buildAgentChatWindowRowsState(
          {
            ...session,
            messages: getSessionMessagesSlice(session, rebuildStartMessageIndex),
          },
          { showThinkingMessages },
        );

        for (
          let index = 0;
          index < incrementalRowsState.rowStartByMessageIndex.length;
          index += 1
        ) {
          const rowStart = incrementalRowsState.rowStartByMessageIndex[index];
          if (typeof rowStart !== "number") {
            continue;
          }
          nextRowStartByMessageIndex[rebuildStartMessageIndex + index] = prefixRowEnd + rowStart;
        }

        const nextTurns = cachedRows.turns.slice();
        while (nextTurns.length > 0) {
          const lastTurn = nextTurns[nextTurns.length - 1];
          if (!lastTurn || lastTurn.start < prefixRowEnd) {
            break;
          }
          nextTurns.pop();
        }
        nextTurns.push(
          ...incrementalRowsState.turns.map((turn) => ({
            key: turn.key,
            start: prefixRowEnd + turn.start,
            end: prefixRowEnd + turn.end,
            rows: turn.rows,
          })),
        );
        nextRows.push(...incrementalRowsState.rows);
        rowsCacheRef.current = {
          sessionId: session.sessionId,
          showThinkingMessages,
          messages: session.messages,
          rows: nextRows,
          rowStartByMessageIndex: nextRowStartByMessageIndex,
          rebuildStartByMessageIndex: [
            ...cachedRows.rebuildStartByMessageIndex.slice(0, rebuildStartMessageIndex),
            ...incrementalRowsState.rebuildStartByMessageIndex.map(
              (index) => rebuildStartMessageIndex + index,
            ),
          ],
          latestRebuildStartMessageIndex:
            rebuildStartMessageIndex + incrementalRowsState.latestRebuildStartMessageIndex,
          turns: nextTurns,
        };
        return {
          rows: nextRows,
          turns: nextTurns,
        };
      }
    }

    const nextRowsState = buildAgentChatWindowRowsState(session, { showThinkingMessages });
    rowsCacheRef.current = {
      sessionId: session.sessionId,
      showThinkingMessages,
      messages: session.messages,
      rows: nextRowsState.rows,
      rowStartByMessageIndex: nextRowsState.rowStartByMessageIndex,
      rebuildStartByMessageIndex: nextRowsState.rebuildStartByMessageIndex,
      latestRebuildStartMessageIndex: nextRowsState.latestRebuildStartMessageIndex,
      turns: nextRowsState.turns,
    };
    return {
      rows: nextRowsState.rows,
      turns: nextRowsState.turns,
    };
  }, [hideTranscriptWhileHydrating, session, showThinkingMessages]);
  const rows = transcriptState.rows;
  const transcriptTurns = transcriptState.turns;

  const messagesContentRef = useRef<HTMLDivElement | null>(null);
  const {
    windowedRows,
    windowedTurns,
    windowStart,
    isNearBottom,
    isNearTop,
    scrollToBottom,
    scrollToTop,
    scrollToBottomOnSend,
  } = useAgentChatWindow({
    rows,
    turns: transcriptTurns,
    activeSessionId,
    isSessionViewLoading: isTranscriptLoading,
    isSessionWorking,
    messagesContainerRef,
    messagesContentRef,
    syncBottomAfterComposerLayoutRef,
  });

  useLayoutEffect(() => {
    scrollToBottomOnSendRef.current = scrollToBottomOnSend;
  }, [scrollToBottomOnSend, scrollToBottomOnSendRef]);

  const showSessionLoadingOverlay = useAgentChatLoadingOverlay({
    sessionId: activeSessionId,
    isSessionViewLoading: statusOverlay?.kind === "session_loading",
  });
  const sessionRole = session?.role ?? null;
  const sessionRuntimeKind = session?.runtimeKind ?? null;
  const sessionTaskId = session?.taskId ?? null;
  const sessionSelectedModel = session?.selectedModel ?? null;
  const sessionAccentColor = useMemo(() => {
    const profileId = sessionSelectedModel?.profileId;
    if (!profileId) {
      return undefined;
    }

    return resolveAgentAccentColor(profileId, sessionAgentColors[profileId]);
  }, [sessionAgentColors, sessionSelectedModel?.profileId]);
  const sessionWorkingDirectory = session?.workingDirectory ?? null;
  const rowKeys = useMemo(() => windowedRows.map((row) => row.key), [windowedRows]);
  const hasAttachmentMessages = useMemo(() => {
    return session ? someSessionMessage(session, messageHasAttachmentDisplayParts) : false;
  }, [session]);
  // Attachment-bearing sessions are kept fully materialized because staged turn reveal and
  // containment can under-measure transcript height during hydration and break bottom pinning.
  const stagedTurns = useAgentChatTurnStaging({
    activeSessionId,
    windowStart,
    turns: windowedTurns,
    disabled: hasAttachmentMessages,
  });
  const rowRefByKeyRef = useRef<Map<string, (element: HTMLDivElement | null) => void>>(new Map());
  const { registerRowElement } = useAgentChatRowMotion({
    activeSessionId,
    rowKeys,
    windowStart,
  });
  const hasVisibleTodo = session
    ? getActionableSessionTodo(getVisibleSessionTodos(session.todos)) !== null
    : false;
  const hasBottomStack = Boolean(
    session &&
      (session.pendingQuestions.length > 0 ||
        session.pendingPermissions.length > 0 ||
        hasVisibleTodo ||
        sessionRuntimeDataError),
  );

  const resolveRowRef = useCallback(
    (rowKey: string) => {
      const cached = rowRefByKeyRef.current.get(rowKey);
      if (cached) {
        return cached;
      }

      const nextRef = registerRowElement(rowKey);
      rowRefByKeyRef.current.set(rowKey, nextRef);
      return nextRef;
    },
    [registerRowElement],
  );
  const activeTurnKey = useMemo(() => {
    if (!session || !isSessionWorking) {
      return null;
    }

    const latestUserMessage = findLastUserSessionMessage(session);
    return latestUserMessage ? `${session.sessionId}:${latestUserMessage.id}` : null;
  }, [isSessionWorking, session]);
  const activeStreamingAssistantMessageId = useMemo(() => {
    return resolveActiveStreamingAssistantMessageId(session);
  }, [session]);
  const renderedTurns = useMemo(() => {
    return stagedTurns.map((turn) => ({
      key: turn.key,
      rows: turn.rows,
      isActive: turn.key === activeTurnKey,
    }));
  }, [activeTurnKey, stagedTurns]);
  const allowTurnContainment = !hasAttachmentMessages;
  const bottomStackRef = useRef<HTMLDivElement | null>(null);
  const bottomStackHeightRef = useRef<number | null>(null);

  useEffect(() => {
    if (!hasBottomStack) {
      bottomStackHeightRef.current = null;
      return;
    }

    const bottomStack = bottomStackRef.current;
    if (!bottomStack || typeof ResizeObserver === "undefined") {
      return;
    }

    const syncAfterBottomStackResize = (height: number) => {
      if (!Number.isFinite(height)) {
        return;
      }

      if (
        bottomStackHeightRef.current !== null &&
        Math.abs(bottomStackHeightRef.current - height) < 0.5
      ) {
        return;
      }

      bottomStackHeightRef.current = height;
      syncBottomAfterComposerLayoutRef.current?.();
    };

    const observer = new ResizeObserver((entries) => {
      const matchingEntry = entries.find((entry) => entry.target === bottomStack) ?? entries[0];
      const nextHeight =
        matchingEntry?.contentRect.height ?? bottomStack.getBoundingClientRect().height;
      syncAfterBottomStackResize(nextHeight);
    });

    observer.observe(bottomStack);
    syncAfterBottomStackResize(bottomStack.getBoundingClientRect().height);

    return () => {
      observer.disconnect();
    };
  }, [hasBottomStack, syncBottomAfterComposerLayoutRef]);

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <AgentChatTranscript
        activeStreamingAssistantMessageId={activeStreamingAssistantMessageId}
        hasSession={session !== null}
        emptyState={emptyState}
        isStarting={isStarting}
        isSending={isSending}
        isInteractionEnabled={isInteractionEnabled}
        sessionAgentColors={sessionAgentColors}
        sessionTaskId={sessionTaskId}
        sessionRole={sessionRole}
        sessionWorkingDirectory={sessionWorkingDirectory}
        sessionRuntimeKind={sessionRuntimeKind}
        messagesContainerRef={messagesContainerRef}
        messagesContentRef={messagesContentRef}
        renderedTurns={rows.length > 0 && !hideTranscriptWhileHydrating ? renderedTurns : []}
        allowTurnContainment={allowTurnContainment}
        resolveRowRef={resolveRowRef}
        statusOverlay={statusOverlay}
        showRuntimeBlockedCard={showRuntimeBlockedCard}
        blockedReason={blockedReason}
        isLoadingChecks={isLoadingChecks}
        onRefreshChecks={onRefreshChecks}
        showSessionLoadingOverlay={showSessionLoadingOverlay}
      />

      {hasBottomStack && session ? (
        <div ref={bottomStackRef}>
          <AgentChatBottomStack
            sessionId={session.sessionId}
            pendingQuestions={session.pendingQuestions}
            pendingPermissions={session.pendingPermissions}
            todos={session.todos}
            canSubmitQuestionAnswers={canSubmitQuestionAnswers}
            isSubmittingQuestionByRequestId={isSubmittingQuestionByRequestId}
            onSubmitQuestionAnswers={onSubmitQuestionAnswers}
            canReplyToPermissions={canReplyToPermissions}
            isSubmittingPermissionByRequestId={isSubmittingPermissionByRequestId}
            permissionReplyErrorByRequestId={permissionReplyErrorByRequestId}
            onReplyPermission={onReplyPermission}
            sessionRuntimeDataError={sessionRuntimeDataError}
            todoPanelCollapsed={todoPanelCollapsed}
            isSessionWorking={isSessionWorking}
            sessionAccentColor={sessionAccentColor}
            onToggleTodoPanel={onToggleTodoPanel}
          />
        </div>
      ) : null}
      {session ? <ScrollToTopButton visible={!isNearTop} onClick={scrollToTop} /> : null}
      {session ? <ScrollToBottomButton visible={!isNearBottom} onClick={scrollToBottom} /> : null}
    </div>
  );
}

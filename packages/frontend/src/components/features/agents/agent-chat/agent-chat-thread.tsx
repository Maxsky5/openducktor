import type { AgentSessionTodoItem } from "@openducktor/core";
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
import type { AgentSessionState } from "@/types/agent-orchestrator";
import { resolveAgentSessionAccentColor } from "../agent-accent-color";
import type { AgentChatThreadModel } from "./agent-chat.types";
import { useAgentChatSettings } from "./agent-chat-settings-context";
import { AgentChatThreadRow } from "./agent-chat-thread-row";
import { type AgentChatThreadState, getAgentChatThreadState } from "./agent-chat-thread-state";
import type { AgentChatWindowRow } from "./agent-chat-thread-windowing";
import { AgentSessionApprovalCard } from "./agent-session-approval-card";
import { AgentSessionQuestionCard } from "./agent-session-question-card";
import { AgentSessionTodoPanel } from "./agent-session-todo-panel";
import { getActionableSessionTodo, getVisibleSessionTodos } from "./agent-session-todo-panel-model";
import { ScrollToBottomButton } from "./scroll-to-bottom-button";
import { ScrollToTopButton } from "./scroll-to-top-button";
import { useAgentChatDeferredTranscript } from "./use-agent-chat-deferred-transcript";
import { useAgentChatRowMotion } from "./use-agent-chat-row-motion";
import { useAgentChatRowStaging } from "./use-agent-chat-row-staging";
import { useAgentChatTranscriptRows } from "./use-agent-chat-transcript-rows";
import { useAgentChatTurnStaging } from "./use-agent-chat-turn-staging";
import { useAgentChatWindow } from "./use-agent-chat-window";

type AgentChatThreadMotionRowProps = {
  row: AgentChatWindowRow;
  isStreamingAssistantMessage: boolean;
  sessionAgentColors: Record<string, string>;
  sessionWorkingDirectory: AgentSessionState["workingDirectory"] | null;
  sessionRuntimeKind: AgentSessionState["runtimeKind"] | null;
  subagentPendingApprovalCount: number;
  subagentPendingQuestionCount: number;
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
  sessionWorkingDirectory: AgentSessionState["workingDirectory"] | null;
  sessionRuntimeKind: AgentSessionState["runtimeKind"] | null;
  subagentPendingApprovalCountByExternalSessionId: AgentChatThreadModel["subagentPendingApprovalCountByExternalSessionId"];
  subagentPendingQuestionCountByExternalSessionId: AgentChatThreadModel["subagentPendingQuestionCountByExternalSessionId"];
  messagesContainerRef: AgentChatThreadModel["messagesContainerRef"];
  messagesContentRef: RefObject<HTMLDivElement | null>;
  renderedTurns: AgentChatRenderedTurn[];
  allowTurnContainment: boolean;
  resolveRowRef: (rowKey: string) => (element: HTMLDivElement | null) => void;
  transcriptNotice: AgentChatThreadState["transcriptNotice"];
  runtimeReadiness: AgentChatThreadModel["runtimeReadiness"];
};

const AgentChatTranscriptNotice = memo(function AgentChatTranscriptNotice({
  notice,
  runtimeReadiness,
}: {
  notice: NonNullable<AgentChatThreadState["transcriptNotice"]>;
  runtimeReadiness: AgentChatThreadModel["runtimeReadiness"];
}): ReactElement {
  const isLoadingNotice = notice.kind === "runtime_waiting" || notice.kind === "session_loading";
  const isRuntimeBlocked = notice.kind === "runtime_blocked";

  return (
    <div className="sticky top-0 z-20 mb-4">
      <div
        className={cn(
          "mx-auto flex max-w-3xl items-start gap-3 rounded-xl border px-4 py-3 text-sm shadow-sm backdrop-blur",
          isLoadingNotice
            ? "border-border bg-card/95 supports-[backdrop-filter]:bg-card/85"
            : "border-destructive-border bg-destructive-surface text-destructive-muted",
        )}
      >
        <div
          className={cn(
            "mt-0.5 rounded-full p-2",
            isLoadingNotice ? "bg-muted text-muted-foreground" : "text-destructive-muted",
          )}
        >
          {isLoadingNotice ? (
            <LoaderCircle className="size-4 animate-spin" />
          ) : (
            <AlertTriangle className="size-4" />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <p className={cn("font-medium", isLoadingNotice ? "text-foreground" : "")}>
            {notice.title}
          </p>
          <p className={isLoadingNotice ? "text-muted-foreground" : ""}>{notice.description}</p>
        </div>
        {isRuntimeBlocked ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-8 border-destructive-border bg-card text-destructive-muted hover:bg-destructive-surface"
            disabled={runtimeReadiness.isLoadingChecks}
            onClick={() => {
              void runtimeReadiness.refreshChecks();
            }}
          >
            <RefreshCcw
              className={cn("size-3.5", runtimeReadiness.isLoadingChecks ? "animate-spin" : "")}
            />
            Recheck
          </Button>
        ) : null}
      </div>
    </div>
  );
});

type AgentChatRenderedTurn = {
  key: string;
  rows: AgentChatWindowRow[];
  isActive: boolean;
};

const EMPTY_RENDERED_TURNS: AgentChatRenderedTurn[] = [];

type AgentChatBottomStackProps = {
  externalSessionId: string;
  pendingQuestions: AgentSessionState["pendingQuestions"];
  pendingApprovals: AgentSessionState["pendingApprovals"];
  todos: AgentSessionTodoItem[];
  sessionRuntimeDataError: string | null;
  canSubmitQuestionAnswers: boolean;
  isSubmittingQuestionByRequestId: AgentChatThreadModel["isSubmittingQuestionByRequestId"];
  onSubmitQuestionAnswers: AgentChatThreadModel["onSubmitQuestionAnswers"];
  canReplyToApprovals: boolean;
  runtimeSupportedApprovalReplyOutcomes: AgentChatThreadModel["runtimeSupportedApprovalReplyOutcomes"];
  isSubmittingApprovalByRequestId: AgentChatThreadModel["isSubmittingApprovalByRequestId"];
  approvalReplyErrorByRequestId: AgentChatThreadModel["approvalReplyErrorByRequestId"];
  onReplyApproval: AgentChatThreadModel["onReplyApproval"];
  todoPanelCollapsed: boolean;
  isSessionWorking: boolean;
  sessionAccentColor: string | undefined;
  onToggleTodoPanel: () => void;
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

const readSubagentPendingApprovalCount = (
  row: AgentChatWindowRow,
  countsByExternalSessionId: AgentChatThreadModel["subagentPendingApprovalCountByExternalSessionId"],
): number => {
  if (row.kind !== "message" || row.message.meta?.kind !== "subagent") {
    return 0;
  }

  const externalSessionId = row.message.meta.externalSessionId;
  return externalSessionId ? (countsByExternalSessionId?.[externalSessionId] ?? 0) : 0;
};

const readSubagentPendingQuestionCount = (
  row: AgentChatWindowRow,
  countsByExternalSessionId: AgentChatThreadModel["subagentPendingQuestionCountByExternalSessionId"],
): number => {
  if (row.kind !== "message" || row.message.meta?.kind !== "subagent") {
    return 0;
  }

  const externalSessionId = row.message.meta.externalSessionId;
  return externalSessionId ? (countsByExternalSessionId?.[externalSessionId] ?? 0) : 0;
};

const AgentChatThreadMotionRow = memo(
  function AgentChatThreadMotionRow({
    row,
    isStreamingAssistantMessage,
    sessionAgentColors,
    sessionWorkingDirectory,
    sessionRuntimeKind,
    subagentPendingApprovalCount,
    subagentPendingQuestionCount,
    resolveRowRef,
  }: AgentChatThreadMotionRowProps): ReactElement {
    return (
      <div ref={resolveRowRef(row.key)} data-row-key={row.key} className="agent-chat-row-motion">
        <AgentChatThreadRow
          row={row}
          isStreamingAssistantMessage={isStreamingAssistantMessage}
          sessionAgentColors={sessionAgentColors}
          sessionWorkingDirectory={sessionWorkingDirectory}
          sessionRuntimeKind={sessionRuntimeKind}
          subagentPendingApprovalCount={subagentPendingApprovalCount}
          subagentPendingQuestionCount={subagentPendingQuestionCount}
        />
      </div>
    );
  },
  (previousProps, nextProps) => {
    return (
      previousProps.sessionRuntimeKind === nextProps.sessionRuntimeKind &&
      previousProps.sessionWorkingDirectory === nextProps.sessionWorkingDirectory &&
      previousProps.subagentPendingApprovalCount === nextProps.subagentPendingApprovalCount &&
      previousProps.subagentPendingQuestionCount === nextProps.subagentPendingQuestionCount &&
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
  sessionWorkingDirectory,
  sessionRuntimeKind,
  subagentPendingApprovalCountByExternalSessionId,
  subagentPendingQuestionCountByExternalSessionId,
  resolveRowRef,
  allowTurnContainment,
}: {
  turn: AgentChatRenderedTurn;
  activeStreamingAssistantMessageId: string | null;
  sessionAgentColors: Record<string, string>;
  sessionWorkingDirectory: AgentSessionState["workingDirectory"] | null;
  sessionRuntimeKind: AgentSessionState["runtimeKind"] | null;
  subagentPendingApprovalCountByExternalSessionId: AgentChatThreadModel["subagentPendingApprovalCountByExternalSessionId"];
  subagentPendingQuestionCountByExternalSessionId: AgentChatThreadModel["subagentPendingQuestionCountByExternalSessionId"];
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
          sessionAgentColors={sessionAgentColors}
          sessionWorkingDirectory={sessionWorkingDirectory}
          sessionRuntimeKind={sessionRuntimeKind}
          subagentPendingApprovalCount={readSubagentPendingApprovalCount(
            row,
            subagentPendingApprovalCountByExternalSessionId,
          )}
          subagentPendingQuestionCount={readSubagentPendingQuestionCount(
            row,
            subagentPendingQuestionCountByExternalSessionId,
          )}
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
  sessionWorkingDirectory,
  sessionRuntimeKind,
  subagentPendingApprovalCountByExternalSessionId,
  subagentPendingQuestionCountByExternalSessionId,
  messagesContainerRef,
  messagesContentRef,
  renderedTurns,
  allowTurnContainment,
  resolveRowRef,
  transcriptNotice,
  runtimeReadiness,
}: AgentChatTranscriptProps): ReactElement {
  return (
    <div
      ref={messagesContainerRef}
      className="agent-chat-scroll-region hide-scrollbar relative min-h-0 flex-1 overflow-y-auto px-4 pb-4 pt-4"
    >
      {transcriptNotice ? (
        <AgentChatTranscriptNotice notice={transcriptNotice} runtimeReadiness={runtimeReadiness} />
      ) : null}

      <div ref={messagesContentRef} className="space-y-1">
        {!hasSession && !transcriptNotice && emptyState ? (
          <div className="space-y-3 rounded-lg border border-dashed border-input bg-card p-4 text-sm text-muted-foreground">
            <p>{emptyState.title}</p>
            {emptyState.actionLabel && emptyState.onAction ? (
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
                sessionAgentColors={sessionAgentColors}
                sessionWorkingDirectory={sessionWorkingDirectory}
                sessionRuntimeKind={sessionRuntimeKind}
                subagentPendingApprovalCountByExternalSessionId={
                  subagentPendingApprovalCountByExternalSessionId
                }
                subagentPendingQuestionCountByExternalSessionId={
                  subagentPendingQuestionCountByExternalSessionId
                }
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
  externalSessionId,
  pendingQuestions,
  pendingApprovals,
  todos,
  sessionRuntimeDataError,
  canSubmitQuestionAnswers,
  isSubmittingQuestionByRequestId,
  onSubmitQuestionAnswers,
  canReplyToApprovals,
  runtimeSupportedApprovalReplyOutcomes,
  isSubmittingApprovalByRequestId,
  approvalReplyErrorByRequestId,
  onReplyApproval,
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
          key={`${externalSessionId}:${request.requestId}`}
          request={request}
          disabled={!canSubmitQuestionAnswers}
          isSubmitting={Boolean(isSubmittingQuestionByRequestId[request.requestId])}
          onSubmit={onSubmitQuestionAnswers}
        />
      ))}

      {pendingApprovals.map((request) => (
        <div key={`${externalSessionId}:${request.requestId}`} className="relative z-30">
          <AgentSessionApprovalCard
            request={request}
            runtimeSupportedReplyOutcomes={runtimeSupportedApprovalReplyOutcomes ?? null}
            disabled={!canReplyToApprovals}
            isSubmitting={Boolean(isSubmittingApprovalByRequestId[request.requestId])}
            errorMessage={approvalReplyErrorByRequestId[request.requestId]}
            onReply={onReplyApproval}
          />
        </div>
      ))}

      {sessionRuntimeDataError ? (
        <div className="rounded-md border border-destructive-border bg-destructive-surface px-3 py-2 text-sm text-destructive-surface-foreground">
          {sessionRuntimeDataError}
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
    sessionLifecycle,
    runtimeReadiness,
    isContextSwitching,
    isInteractionEnabled,
    emptyState,
    isStarting,
    isSending,
    sessionAgentColors,
    subagentPendingApprovalCountByExternalSessionId,
    subagentPendingQuestionCountByExternalSessionId,
    canSubmitQuestionAnswers,
    isSubmittingQuestionByRequestId,
    onSubmitQuestionAnswers,
    canReplyToApprovals,
    runtimeSupportedApprovalReplyOutcomes,
    isSubmittingApprovalByRequestId,
    approvalReplyErrorByRequestId,
    onReplyApproval,
    sessionRuntimeDataError,
    isSessionWorking,
    todoPanelCollapsed,
    onToggleTodoPanel,
    messagesContainerRef,
    scrollToBottomOnSendRef,
    syncBottomAfterComposerLayoutRef,
  } = model;
  const { showThinkingMessages } = useAgentChatSettings();
  const activeExternalSessionId = session?.externalSessionId ?? null;
  const { isTranscriptRenderDeferred } = useAgentChatDeferredTranscript({
    activeExternalSessionId,
    shouldDefer: isContextSwitching,
  });
  const { transcriptState, isTranscriptRowsMissing } = useAgentChatTranscriptRows({
    session,
    showThinkingMessages,
    shouldPauseDerivation: isTranscriptRenderDeferred,
  });
  const { hideTranscriptRows, transcriptNotice } = getAgentChatThreadState({
    sessionLifecycle,
    runtimeReadiness,
    isSessionContextSwitching: isContextSwitching,
    isTranscriptRenderDeferred,
    isTranscriptRowsMissing,
  });

  const shouldResetTranscriptWindowForLoading =
    hideTranscriptRows || transcriptNotice?.kind === "session_loading";
  const rows = transcriptState.rows;
  const transcriptTurns = transcriptState.turns;
  const hasAttachmentMessages = transcriptState.hasAttachmentMessages;

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
    preserveScrollBeforeStagedPrepend,
  } = useAgentChatWindow({
    rows,
    turns: transcriptTurns,
    activeExternalSessionId,
    isSessionViewLoading: shouldResetTranscriptWindowForLoading,
    isSessionWorking,
    messagesContainerRef,
    messagesContentRef,
    syncBottomAfterComposerLayoutRef,
  });

  useLayoutEffect(() => {
    scrollToBottomOnSendRef.current = scrollToBottomOnSend;
  }, [scrollToBottomOnSend, scrollToBottomOnSendRef]);

  const sessionRuntimeKind = session?.runtimeKind ?? null;
  const sessionSelectedModel = session?.selectedModel ?? null;
  const sessionAccentColor = useMemo(() => {
    const profileId = sessionSelectedModel?.profileId;
    return resolveAgentSessionAccentColor({
      agentName: profileId,
      agentColors: sessionAgentColors,
      runtimeKind: sessionRuntimeKind,
    });
  }, [sessionAgentColors, sessionRuntimeKind, sessionSelectedModel?.profileId]);
  const sessionWorkingDirectory = session?.workingDirectory ?? null;
  // Attachment-bearing sessions keep containment disabled because intrinsic-size estimates can
  // under-measure rich attachment rows and break bottom pinning. Row/turn staging still applies so
  // cached large transcripts do not remount hundreds of rows in one synchronous session switch.
  const stagedTurns = useAgentChatTurnStaging({
    activeExternalSessionId,
    windowStart,
    turns: windowedTurns,
    onBeforePrepend: preserveScrollBeforeStagedPrepend,
  });
  const stagedTranscript = useAgentChatRowStaging({
    activeExternalSessionId,
    rows: windowedRows,
    turns: stagedTurns,
    onBeforePrepend: preserveScrollBeforeStagedPrepend,
  });
  const stagedRows = stagedTranscript.rows;
  const stagedWindowTurns = stagedTranscript.turns;
  const rowKeys = useMemo(() => stagedRows.map((row) => row.key), [stagedRows]);
  const rowRefByKeyRef = useRef<Map<string, (element: HTMLDivElement | null) => void> | null>(null);
  if (rowRefByKeyRef.current === null) {
    rowRefByKeyRef.current = new Map();
  }
  const rowRefByKey = rowRefByKeyRef.current;
  const { registerRowElement } = useAgentChatRowMotion({
    activeExternalSessionId,
    rowKeys,
    windowStart,
  });
  const hasVisibleTodo = session
    ? getActionableSessionTodo(getVisibleSessionTodos(session.todos)) !== null
    : false;
  const hasBottomStack = Boolean(
    session &&
      (session.pendingQuestions.length > 0 ||
        session.pendingApprovals.length > 0 ||
        hasVisibleTodo ||
        sessionRuntimeDataError),
  );

  const resolveRowRef = useCallback(
    (rowKey: string) => {
      const cached = rowRefByKey.get(rowKey);
      if (cached) {
        return cached;
      }

      const nextRef = registerRowElement(rowKey);
      rowRefByKey.set(rowKey, nextRef);
      return nextRef;
    },
    [registerRowElement, rowRefByKey],
  );
  // Keep the newest turn measured after completion too. Re-applying content-visibility to the
  // just-finished turn can make the browser anchor around the prompt and jump away from the bottom.
  const latestUserTurnKey = useMemo(() => {
    if (!session || !transcriptState.lastUserMessageId) {
      return null;
    }

    return `${session.externalSessionId}:${transcriptState.lastUserMessageId}`;
  }, [session, transcriptState.lastUserMessageId]);
  const activeStreamingAssistantMessageId = transcriptState.activeStreamingAssistantMessageId;
  const renderedTurns = useMemo(() => {
    return stagedWindowTurns.map((turn) => ({
      key: turn.key,
      rows: stagedRows.slice(turn.start, turn.end + 1),
      isActive: turn.key === latestUserTurnKey,
    }));
  }, [latestUserTurnKey, stagedRows, stagedWindowTurns]);
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
        subagentPendingApprovalCountByExternalSessionId={
          subagentPendingApprovalCountByExternalSessionId
        }
        subagentPendingQuestionCountByExternalSessionId={
          subagentPendingQuestionCountByExternalSessionId
        }
        sessionWorkingDirectory={sessionWorkingDirectory}
        sessionRuntimeKind={sessionRuntimeKind}
        messagesContainerRef={messagesContainerRef}
        messagesContentRef={messagesContentRef}
        renderedTurns={
          rows.length > 0 && !hideTranscriptRows ? renderedTurns : EMPTY_RENDERED_TURNS
        }
        allowTurnContainment={allowTurnContainment}
        resolveRowRef={resolveRowRef}
        transcriptNotice={transcriptNotice}
        runtimeReadiness={runtimeReadiness}
      />

      {hasBottomStack && session ? (
        <div ref={bottomStackRef}>
          <AgentChatBottomStack
            externalSessionId={session.externalSessionId}
            pendingQuestions={session.pendingQuestions}
            pendingApprovals={session.pendingApprovals}
            todos={session.todos}
            canSubmitQuestionAnswers={canSubmitQuestionAnswers}
            isSubmittingQuestionByRequestId={isSubmittingQuestionByRequestId}
            onSubmitQuestionAnswers={onSubmitQuestionAnswers}
            canReplyToApprovals={canReplyToApprovals}
            runtimeSupportedApprovalReplyOutcomes={runtimeSupportedApprovalReplyOutcomes}
            isSubmittingApprovalByRequestId={isSubmittingApprovalByRequestId}
            approvalReplyErrorByRequestId={approvalReplyErrorByRequestId}
            onReplyApproval={onReplyApproval}
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

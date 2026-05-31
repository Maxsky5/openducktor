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
import { AgentChatThreadRow } from "./agent-chat-thread-row";
import { getAgentChatThreadState } from "./agent-chat-thread-state";
import type { AgentChatWindowRow } from "./agent-chat-thread-windowing";
import { AgentSessionApprovalCard } from "./agent-session-approval-card";
import { AgentSessionQuestionCard } from "./agent-session-question-card";
import { AgentSessionTodoPanel } from "./agent-session-todo-panel";
import { getActionableSessionTodo, getVisibleSessionTodos } from "./agent-session-todo-panel-model";
import { ScrollToBottomButton } from "./scroll-to-bottom-button";
import { ScrollToTopButton } from "./scroll-to-top-button";
import { useAgentChatDeferredTranscript } from "./use-agent-chat-deferred-transcript";
import { useAgentChatLoadingOverlay } from "./use-agent-chat-loading-overlay";
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
  sessionRuntimeId: AgentSessionState["runtimeId"] | null;
  expandFileDiffsByDefault: boolean;
  subagentPendingApprovals: AgentSessionState["pendingApprovals"];
  subagentPendingApprovalCount: number;
  subagentPendingQuestions: AgentSessionState["pendingQuestions"];
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
  sessionRuntimeId: AgentSessionState["runtimeId"] | null;
  expandFileDiffsByDefault: boolean;
  subagentPendingApprovalsByExternalSessionId: AgentChatThreadModel["subagentPendingApprovalsByExternalSessionId"];
  subagentPendingApprovalCountByExternalSessionId: AgentChatThreadModel["subagentPendingApprovalCountByExternalSessionId"];
  subagentPendingQuestionsByExternalSessionId: AgentChatThreadModel["subagentPendingQuestionsByExternalSessionId"];
  subagentPendingQuestionCountByExternalSessionId: AgentChatThreadModel["subagentPendingQuestionCountByExternalSessionId"];
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

const EMPTY_RENDERED_TURNS: AgentChatRenderedTurn[] = [];

type AgentChatBottomStackProps = {
  externalSessionId: string;
  pendingQuestions: AgentSessionState["pendingQuestions"];
  pendingApprovals: AgentSessionState["pendingApprovals"];
  todos: AgentSessionState["todos"];
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

const EMPTY_PENDING_APPROVALS: AgentSessionState["pendingApprovals"] = [];
const EMPTY_PENDING_QUESTIONS: AgentSessionState["pendingQuestions"] = [];
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

const readSubagentPendingApprovals = (
  row: AgentChatWindowRow,
  pendingApprovalsByExternalSessionId: AgentChatThreadModel["subagentPendingApprovalsByExternalSessionId"],
): AgentSessionState["pendingApprovals"] => {
  if (row.kind !== "message" || row.message.meta?.kind !== "subagent") {
    return EMPTY_PENDING_APPROVALS;
  }

  const externalSessionId = row.message.meta.externalSessionId;
  return externalSessionId
    ? (pendingApprovalsByExternalSessionId?.[externalSessionId] ?? EMPTY_PENDING_APPROVALS)
    : EMPTY_PENDING_APPROVALS;
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

const readSubagentPendingQuestions = (
  row: AgentChatWindowRow,
  pendingQuestionsByExternalSessionId: AgentChatThreadModel["subagentPendingQuestionsByExternalSessionId"],
): AgentSessionState["pendingQuestions"] => {
  if (row.kind !== "message" || row.message.meta?.kind !== "subagent") {
    return EMPTY_PENDING_QUESTIONS;
  }

  const externalSessionId = row.message.meta.externalSessionId;
  return externalSessionId
    ? (pendingQuestionsByExternalSessionId?.[externalSessionId] ?? EMPTY_PENDING_QUESTIONS)
    : EMPTY_PENDING_QUESTIONS;
};

const AgentChatThreadMotionRow = memo(
  function AgentChatThreadMotionRow({
    row,
    isStreamingAssistantMessage,
    sessionAgentColors,
    sessionWorkingDirectory,
    sessionRuntimeKind,
    sessionRuntimeId,
    expandFileDiffsByDefault,
    subagentPendingApprovals,
    subagentPendingApprovalCount,
    subagentPendingQuestions,
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
          sessionRuntimeId={sessionRuntimeId}
          expandFileDiffsByDefault={expandFileDiffsByDefault}
          subagentPendingApprovals={subagentPendingApprovals}
          subagentPendingApprovalCount={subagentPendingApprovalCount}
          subagentPendingQuestions={subagentPendingQuestions}
          subagentPendingQuestionCount={subagentPendingQuestionCount}
        />
      </div>
    );
  },
  (previousProps, nextProps) => {
    return (
      previousProps.sessionRuntimeKind === nextProps.sessionRuntimeKind &&
      previousProps.sessionRuntimeId === nextProps.sessionRuntimeId &&
      previousProps.sessionWorkingDirectory === nextProps.sessionWorkingDirectory &&
      previousProps.expandFileDiffsByDefault === nextProps.expandFileDiffsByDefault &&
      previousProps.subagentPendingApprovals === nextProps.subagentPendingApprovals &&
      previousProps.subagentPendingApprovalCount === nextProps.subagentPendingApprovalCount &&
      previousProps.subagentPendingQuestions === nextProps.subagentPendingQuestions &&
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
  sessionRuntimeId,
  expandFileDiffsByDefault,
  subagentPendingApprovalsByExternalSessionId,
  subagentPendingApprovalCountByExternalSessionId,
  subagentPendingQuestionsByExternalSessionId,
  subagentPendingQuestionCountByExternalSessionId,
  resolveRowRef,
  allowTurnContainment,
}: {
  turn: AgentChatRenderedTurn;
  activeStreamingAssistantMessageId: string | null;
  sessionAgentColors: Record<string, string>;
  sessionWorkingDirectory: AgentSessionState["workingDirectory"] | null;
  sessionRuntimeKind: AgentSessionState["runtimeKind"] | null;
  sessionRuntimeId: AgentSessionState["runtimeId"] | null;
  expandFileDiffsByDefault: boolean;
  subagentPendingApprovalsByExternalSessionId: AgentChatThreadModel["subagentPendingApprovalsByExternalSessionId"];
  subagentPendingApprovalCountByExternalSessionId: AgentChatThreadModel["subagentPendingApprovalCountByExternalSessionId"];
  subagentPendingQuestionsByExternalSessionId: AgentChatThreadModel["subagentPendingQuestionsByExternalSessionId"];
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
          sessionRuntimeId={sessionRuntimeId}
          expandFileDiffsByDefault={expandFileDiffsByDefault}
          subagentPendingApprovals={readSubagentPendingApprovals(
            row,
            subagentPendingApprovalsByExternalSessionId,
          )}
          subagentPendingApprovalCount={readSubagentPendingApprovalCount(
            row,
            subagentPendingApprovalCountByExternalSessionId,
          )}
          subagentPendingQuestions={readSubagentPendingQuestions(
            row,
            subagentPendingQuestionsByExternalSessionId,
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
  sessionRuntimeId,
  expandFileDiffsByDefault,
  subagentPendingApprovalsByExternalSessionId,
  subagentPendingApprovalCountByExternalSessionId,
  subagentPendingQuestionsByExternalSessionId,
  subagentPendingQuestionCountByExternalSessionId,
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
        {!hasSession && !visibleStatusOverlay ? (
          <div className="space-y-3 rounded-lg border border-dashed border-input bg-card p-4 text-sm text-muted-foreground">
            <p>{emptyState?.title ?? "No conversation available."}</p>
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
                sessionAgentColors={sessionAgentColors}
                sessionWorkingDirectory={sessionWorkingDirectory}
                sessionRuntimeKind={sessionRuntimeKind}
                sessionRuntimeId={sessionRuntimeId}
                expandFileDiffsByDefault={expandFileDiffsByDefault}
                subagentPendingApprovalsByExternalSessionId={
                  subagentPendingApprovalsByExternalSessionId
                }
                subagentPendingApprovalCountByExternalSessionId={
                  subagentPendingApprovalCountByExternalSessionId
                }
                subagentPendingQuestionsByExternalSessionId={
                  subagentPendingQuestionsByExternalSessionId
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
    showThinkingMessages,
    expandFileDiffsByDefault,
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
    subagentPendingApprovalsByExternalSessionId,
    subagentPendingApprovalCountByExternalSessionId,
    subagentPendingQuestionsByExternalSessionId,
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
  const activeExternalSessionId = session?.externalSessionId ?? null;
  const { isTranscriptRenderDeferred } = useAgentChatDeferredTranscript({
    activeExternalSessionId,
    shouldDefer: isSessionViewLoading,
  });
  const { transcriptState, isTranscriptRowsMissing } = useAgentChatTranscriptRows({
    session,
    showThinkingMessages,
    shouldPauseDerivation: isTranscriptRenderDeferred,
  });
  const { hideTranscriptWhileDeferred, statusOverlay, showRuntimeBlockedCard } =
    getAgentChatThreadState({
      isSessionViewLoading,
      isSessionHistoryLoading,
      isWaitingForRuntimeReadiness,
      readinessState,
      blockedReason,
      isTranscriptRenderDeferred,
      isTranscriptRowsMissing,
    });

  const shouldResetTranscriptWindowForLoading =
    isSessionViewLoading ||
    isSessionHistoryLoading ||
    isTranscriptRenderDeferred ||
    isTranscriptRowsMissing;
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
  const sessionRuntimeId = session?.runtimeId ?? null;
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
  const showSessionLoadingOverlay = useAgentChatLoadingOverlay({
    externalSessionId: activeExternalSessionId,
    isSessionViewLoading: statusOverlay?.kind === "session_loading",
  });
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
        subagentPendingApprovalsByExternalSessionId={subagentPendingApprovalsByExternalSessionId}
        subagentPendingApprovalCountByExternalSessionId={
          subagentPendingApprovalCountByExternalSessionId
        }
        subagentPendingQuestionsByExternalSessionId={subagentPendingQuestionsByExternalSessionId}
        subagentPendingQuestionCountByExternalSessionId={
          subagentPendingQuestionCountByExternalSessionId
        }
        sessionWorkingDirectory={sessionWorkingDirectory}
        sessionRuntimeKind={sessionRuntimeKind}
        sessionRuntimeId={sessionRuntimeId}
        expandFileDiffsByDefault={expandFileDiffsByDefault}
        messagesContainerRef={messagesContainerRef}
        messagesContentRef={messagesContentRef}
        renderedTurns={
          rows.length > 0 && !hideTranscriptWhileDeferred ? renderedTurns : EMPTY_RENDERED_TURNS
        }
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

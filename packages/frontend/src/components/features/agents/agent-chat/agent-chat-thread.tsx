import type { AgentSessionTodoItem } from "@openducktor/core";
import { AlertTriangle, Info, LoaderCircle, RefreshCcw, Sparkles } from "lucide-react";
import { memo, type ReactElement, type RefObject, useCallback, useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { AgentChatThreadModel } from "./agent-chat.types";
import { AgentChatTurnGroup } from "./agent-chat-turn-group";
import { AgentSessionApprovalCard } from "./agent-session-approval-card";
import { AgentSessionQuestionCard } from "./agent-session-question-card";
import { AgentSessionTodoPanel } from "./agent-session-todo-panel";
import { getActionableSessionTodo, getVisibleSessionTodos } from "./agent-session-todo-panel-model";
import type { AgentSessionTranscriptTarget } from "./agent-session-transcript-target";
import { ScrollToBottomButton } from "./scroll-to-bottom-button";
import { ScrollToTopButton } from "./scroll-to-top-button";
import {
  type AgentChatRenderedTurn,
  useAgentChatRenderedTranscript,
} from "./use-agent-chat-rendered-transcript";
import { useAgentChatRowMotion } from "./use-agent-chat-row-motion";

type AgentChatTranscriptProps = {
  emptyState: AgentChatThreadModel["emptyState"];
  modelCatalog: AgentChatThreadModel["modelCatalog"];
  isStarting: boolean;
  isSending: boolean;
  isInteractionEnabled: boolean;
  sessionAgentColors: Record<string, string>;
  sessionIdentity: AgentSessionTranscriptTarget | null;
  subagentPendingApprovalCountBySessionKey: AgentChatThreadModel["subagentPendingApprovalCountBySessionKey"];
  subagentPendingQuestionCountBySessionKey: AgentChatThreadModel["subagentPendingQuestionCountBySessionKey"];
  messagesContainerRef: AgentChatThreadModel["messagesContainerRef"];
  messagesContentRef: RefObject<HTMLDivElement | null>;
  renderedTurns: AgentChatRenderedTurn[];
  resolveRowRef: (rowKey: string) => (element: HTMLDivElement | null) => void;
  transcriptNotice: AgentChatThreadModel["transcriptNotice"];
  runtimePresentation: AgentChatThreadModel["runtimePresentation"];
};

const AgentChatTranscriptNotice = memo(function AgentChatTranscriptNotice({
  notice,
}: {
  notice: NonNullable<AgentChatThreadModel["transcriptNotice"]>;
}): ReactElement {
  const isLoadingNotice = notice.severity === "loading";
  const action = notice.action;

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
          {notice.details && notice.details.length > 0 ? (
            <details className="mt-2">
              <summary className="cursor-pointer select-none font-medium">Show details</summary>
              <dl className="mt-2 space-y-1 text-xs">
                {notice.details.map((detail) => (
                  <div key={detail.label} className="grid grid-cols-[auto_1fr] gap-2">
                    <dt className="font-medium">{detail.label}</dt>
                    <dd className="min-w-0 break-words font-mono">{detail.value}</dd>
                  </div>
                ))}
              </dl>
            </details>
          ) : null}
        </div>
        {action ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-8 border-destructive-border bg-card text-destructive-muted hover:bg-destructive-surface"
            disabled={action.disabled}
            onClick={action.onAction}
          >
            <RefreshCcw className={cn("size-3.5", action.isPending ? "animate-spin" : "")} />
            {action.label}
          </Button>
        ) : null}
      </div>
    </div>
  );
});

type AgentChatBottomStackProps = {
  externalSessionId: string;
  pendingQuestions: AgentChatThreadModel["pendingQuestionRequests"];
  pendingApprovals: AgentChatThreadModel["pendingApprovalRequests"];
  todos: readonly AgentSessionTodoItem[];
  sessionAuxiliaryError: string | null;
  runtimeStatusMessage: string | null;
  canSubmitQuestionAnswers: boolean;
  isSubmittingQuestionByRequestId: AgentChatThreadModel["isSubmittingQuestionByRequestId"];
  onSubmitQuestionAnswers: AgentChatThreadModel["onSubmitQuestionAnswers"];
  canReplyToApprovals: boolean;
  runtimeSupportedApprovalReplyOutcomes: AgentChatThreadModel["runtimePresentation"]["supportedApprovalReplyOutcomes"];
  isSubmittingApprovalByRequestId: AgentChatThreadModel["isSubmittingApprovalByRequestId"];
  approvalReplyErrorByRequestId: AgentChatThreadModel["approvalReplyErrorByRequestId"];
  onReplyApproval: AgentChatThreadModel["onReplyApproval"];
  todoPanelCollapsed: boolean;
  isSessionWorking: boolean;
  sessionAccentColor: string | undefined;
  onToggleTodoPanel: () => void;
};

const AgentChatTranscript = memo(function AgentChatTranscript({
  emptyState,
  modelCatalog,
  isStarting,
  isSending,
  isInteractionEnabled,
  sessionAgentColors,
  sessionIdentity,
  subagentPendingApprovalCountBySessionKey,
  subagentPendingQuestionCountBySessionKey,
  messagesContainerRef,
  messagesContentRef,
  renderedTurns,
  resolveRowRef,
  transcriptNotice,
  runtimePresentation,
}: AgentChatTranscriptProps): ReactElement {
  const hasSession = sessionIdentity !== null;

  return (
    <div
      ref={messagesContainerRef}
      className="agent-chat-scroll-region hide-scrollbar relative min-h-0 flex-1 overflow-y-auto px-4 pb-4 pt-4"
    >
      {transcriptNotice ? <AgentChatTranscriptNotice notice={transcriptNotice} /> : null}

      <div ref={messagesContentRef}>
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

        <div>
          {renderedTurns.map((turn) => (
            <AgentChatTurnGroup
              key={turn.key}
              turn={turn}
              modelCatalog={modelCatalog}
              sessionAgentColors={sessionAgentColors}
              sessionIdentity={sessionIdentity}
              runtimePresentation={runtimePresentation}
              subagentPendingApprovalCountBySessionKey={subagentPendingApprovalCountBySessionKey}
              subagentPendingQuestionCountBySessionKey={subagentPendingQuestionCountBySessionKey}
              resolveRowRef={resolveRowRef}
            />
          ))}
        </div>
      </div>
    </div>
  );
});

const AgentChatBottomStack = memo(function AgentChatBottomStack({
  externalSessionId,
  pendingQuestions,
  pendingApprovals,
  todos,
  sessionAuxiliaryError,
  runtimeStatusMessage,
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

      {sessionAuxiliaryError ? (
        <div className="rounded-md border border-destructive-border bg-destructive-surface px-3 py-2 text-sm text-destructive-surface-foreground">
          {sessionAuxiliaryError}
        </div>
      ) : null}

      {runtimeStatusMessage ? (
        <div
          role="status"
          className="flex items-start gap-2 rounded-md border border-info-border bg-info-surface px-3 py-2 text-sm text-info-surface-foreground"
        >
          <Info className="mt-0.5 size-4 shrink-0 text-info-accent" aria-hidden="true" />
          <span>{runtimeStatusMessage}</span>
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
    transcriptTarget,
    displayedSessionKey,
    runtimePresentation,
    isInteractionEnabled,
    emptyState,
    modelCatalog,
    isStarting,
    isSending,
    sessionAgentColors,
    pendingApprovalRequests,
    pendingQuestionRequests,
    subagentPendingApprovalCountBySessionKey,
    subagentPendingQuestionCountBySessionKey,
    todos,
    sessionAccentColor,
    canSubmitQuestionAnswers,
    isSubmittingQuestionByRequestId,
    onSubmitQuestionAnswers,
    canReplyToApprovals,
    isSubmittingApprovalByRequestId,
    approvalReplyErrorByRequestId,
    onReplyApproval,
    sessionAuxiliaryError,
    isSessionWorking,
    shouldResetTranscriptWindow,
    transcriptNotice,
    todoPanelCollapsed,
    onToggleTodoPanel,
    messagesContainerRef,
    scrollToBottomOnSendRef,
    syncBottomAfterComposerLayoutRef,
  } = model;
  const sessionIdentity: AgentSessionTranscriptTarget | null = transcriptTarget;
  const {
    messagesContentRef,
    renderedTurns,
    transcriptNotice: renderedTranscriptNotice,
    isNearBottom,
    isNearTop,
    scrollToBottom,
    scrollToTop,
  } = useAgentChatRenderedTranscript({
    session,
    displayedSessionKey,
    isSessionWorking,
    shouldResetTranscriptWindow,
    transcriptNotice,
    messagesContainerRef,
    scrollToBottomOnSendRef,
    syncBottomAfterComposerLayoutRef,
  });

  const rowRefByKeyRef = useRef<Map<string, (element: HTMLDivElement | null) => void> | null>(null);
  if (rowRefByKeyRef.current === null) {
    rowRefByKeyRef.current = new Map();
  }
  const rowRefByKey = rowRefByKeyRef.current;
  const { registerRowElement } = useAgentChatRowMotion();
  const hasVisibleTodo = getActionableSessionTodo(getVisibleSessionTodos(todos)) !== null;
  const hasWaitingInput = pendingQuestionRequests.length > 0 || pendingApprovalRequests.length > 0;
  const runtimeStatusMessage = isSessionWorking && session ? session.runtimeStatusMessage : null;
  const hasBottomStack = Boolean(
    session && (hasWaitingInput || hasVisibleTodo || sessionAuxiliaryError || runtimeStatusMessage),
  );

  const resolveRowRef = useCallback(
    (rowKey: string) => {
      const cached = rowRefByKey.get(rowKey);
      if (cached) {
        return cached;
      }

      const motionRef = registerRowElement(rowKey);
      rowRefByKey.set(rowKey, motionRef);
      return motionRef;
    },
    [registerRowElement, rowRefByKey],
  );
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
        emptyState={emptyState}
        modelCatalog={modelCatalog}
        isStarting={isStarting}
        isSending={isSending}
        isInteractionEnabled={isInteractionEnabled}
        sessionAgentColors={sessionAgentColors}
        subagentPendingApprovalCountBySessionKey={subagentPendingApprovalCountBySessionKey}
        subagentPendingQuestionCountBySessionKey={subagentPendingQuestionCountBySessionKey}
        sessionIdentity={sessionIdentity}
        runtimePresentation={runtimePresentation}
        messagesContainerRef={messagesContainerRef}
        messagesContentRef={messagesContentRef}
        renderedTurns={renderedTurns}
        resolveRowRef={resolveRowRef}
        transcriptNotice={renderedTranscriptNotice}
      />

      {hasBottomStack && session ? (
        <div ref={bottomStackRef}>
          <AgentChatBottomStack
            externalSessionId={session.externalSessionId}
            pendingQuestions={pendingQuestionRequests}
            pendingApprovals={pendingApprovalRequests}
            todos={todos}
            canSubmitQuestionAnswers={canSubmitQuestionAnswers}
            isSubmittingQuestionByRequestId={isSubmittingQuestionByRequestId}
            onSubmitQuestionAnswers={onSubmitQuestionAnswers}
            canReplyToApprovals={canReplyToApprovals}
            runtimeSupportedApprovalReplyOutcomes={
              runtimePresentation.supportedApprovalReplyOutcomes
            }
            isSubmittingApprovalByRequestId={isSubmittingApprovalByRequestId}
            approvalReplyErrorByRequestId={approvalReplyErrorByRequestId}
            onReplyApproval={onReplyApproval}
            sessionAuxiliaryError={sessionAuxiliaryError}
            runtimeStatusMessage={runtimeStatusMessage}
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

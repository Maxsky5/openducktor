import { AlertTriangle, LoaderCircle, RefreshCcw, Sparkles } from "lucide-react";
import { type ReactElement, useLayoutEffect, useMemo, useRef } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { AgentSessionState } from "@/types/agent-orchestrator";
import { resolveAgentAccentColor } from "../agent-accent-color";
import type { AgentChatThreadModel } from "./agent-chat.types";
import { AgentChatThreadRow } from "./agent-chat-thread-row";
import type { AgentChatWindowRow } from "./agent-chat-thread-windowing";
import { buildAgentChatWindowRows } from "./agent-chat-thread-windowing";
import { AgentSessionPermissionCard } from "./agent-session-permission-card";
import { AgentSessionQuestionCard } from "./agent-session-question-card";
import {
  AgentSessionTodoPanel,
  getActionableSessionTodo,
  getVisibleSessionTodos,
} from "./agent-session-todo-panel";
import { ScrollToBottomButton } from "./scroll-to-bottom-button";
import { ScrollToTopButton } from "./scroll-to-top-button";
import { useAgentChatLoadingOverlay } from "./use-agent-chat-loading-overlay";
import { useAgentChatRowMotion } from "./use-agent-chat-row-motion";
import { useAgentChatWindow } from "./use-agent-chat-window";

type AgentChatThreadMotionRowProps = {
  row: AgentChatWindowRow;
  sessionAgentColors: Record<string, string>;
  sessionRole: AgentSessionState["role"] | null;
  sessionSelectedModel: AgentSessionState["selectedModel"] | null;
  sessionWorkingDirectory: AgentSessionState["workingDirectory"] | null;
  resolveRowRef: (rowKey: string) => (element: HTMLDivElement | null) => void;
};

function AgentChatThreadMotionRow({
  row,
  sessionAgentColors,
  sessionRole,
  sessionSelectedModel,
  sessionWorkingDirectory,
  resolveRowRef,
}: AgentChatThreadMotionRowProps): ReactElement {
  return (
    <div ref={resolveRowRef(row.key)} data-row-key={row.key} className="agent-chat-row-motion">
      <AgentChatThreadRow
        row={row}
        sessionRole={sessionRole}
        sessionSelectedModel={sessionSelectedModel}
        sessionAgentColors={sessionAgentColors}
        sessionWorkingDirectory={sessionWorkingDirectory}
      />
    </div>
  );
}

export function AgentChatThread({ model }: { model: AgentChatThreadModel }): ReactElement {
  const {
    session,
    showThinkingMessages,
    isSessionViewLoading,
    isSessionHistoryLoading,
    agentStudioReady,
    blockedReason,
    isLoadingChecks,
    onRefreshChecks,
    taskSelected,
    canKickoffNewSession,
    kickoffLabel,
    onKickoff,
    isStarting,
    isSending,
    sessionAgentColors,
    isSubmittingQuestionByRequestId,
    onSubmitQuestionAnswers,
    isSubmittingPermissionByRequestId,
    permissionReplyErrorByRequestId,
    onReplyPermission,
    isSessionWorking,
    todoPanelCollapsed,
    onToggleTodoPanel,
    messagesContainerRef,
    scrollToBottomOnSendRef,
  } = model;
  const isTranscriptLoading = isSessionViewLoading || isSessionHistoryLoading;
  const hideTranscriptWhileHydrating = isSessionHistoryLoading;

  const rows = useMemo(() => {
    if (!session || hideTranscriptWhileHydrating) {
      return [];
    }

    return buildAgentChatWindowRows(session, { showThinkingMessages });
  }, [hideTranscriptWhileHydrating, session, showThinkingMessages]);
  const messagesContentRef = useRef<HTMLDivElement | null>(null);
  const activeSessionId = session?.sessionId ?? null;
  const {
    windowedRows,
    windowStart,
    windowEnd,
    isNearBottom,
    isNearTop,
    topSentinelRef,
    bottomSentinelRef,
    scrollToBottom,
    scrollToTop,
    scrollToBottomOnSend,
  } = useAgentChatWindow({
    rows,
    activeSessionId,
    isSessionViewLoading: isTranscriptLoading,
    messagesContainerRef,
    messagesContentRef,
  });

  useLayoutEffect(() => {
    scrollToBottomOnSendRef.current = scrollToBottomOnSend;
  }, [scrollToBottomOnSend, scrollToBottomOnSendRef]);

  const showLoadingOverlay = useAgentChatLoadingOverlay({
    sessionId: activeSessionId,
    isSessionViewLoading: isTranscriptLoading,
  });
  const sessionRole = session?.role ?? null;
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
        hasVisibleTodo),
  );

  const resolveRowRef = (rowKey: string) => {
    const cached = rowRefByKeyRef.current.get(rowKey);
    if (cached) {
      return cached;
    }

    const nextRef = registerRowElement(rowKey);
    rowRefByKeyRef.current.set(rowKey, nextRef);
    return nextRef;
  };

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      {!agentStudioReady ? (
        <div className="mx-4 mt-4 flex items-start justify-between gap-3 rounded-lg border border-destructive-border bg-destructive-surface px-3 py-2 text-sm text-destructive-muted">
          <div className="flex min-w-0 items-start gap-2">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" />
            <p className="min-w-0">{blockedReason}</p>
          </div>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-7 border-destructive-border bg-card text-destructive-muted hover:bg-destructive-surface"
            disabled={isLoadingChecks}
            onClick={onRefreshChecks}
          >
            <RefreshCcw className={cn("size-3.5", isLoadingChecks ? "animate-spin" : "")} />
            Recheck
          </Button>
        </div>
      ) : null}

      <div
        ref={messagesContainerRef}
        className="agent-chat-scroll-region hide-scrollbar relative min-h-0 flex-1 overflow-y-auto px-4 pb-4 pt-4"
      >
        <div ref={messagesContentRef} className="space-y-1">
          {!session ? (
            <div className="space-y-3 rounded-lg border border-dashed border-input bg-card p-4 text-sm text-muted-foreground">
              <p>
                {taskSelected
                  ? isStarting
                    ? "Initializing session..."
                    : "Send a message to start a new session automatically."
                  : "Select a task to begin."}
              </p>
              {canKickoffNewSession ? (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={isStarting || isSending || !taskSelected || !agentStudioReady}
                  onClick={onKickoff}
                >
                  {isStarting ? (
                    <LoaderCircle className="size-3.5 animate-spin" />
                  ) : (
                    <Sparkles className="size-3.5" />
                  )}
                  {kickoffLabel}
                </Button>
              ) : null}
            </div>
          ) : null}

          {session ? (
            rows.length > 0 ? (
              hideTranscriptWhileHydrating ? null : (
                <>
                  {windowStart > 0 ? <div ref={topSentinelRef} className="h-px" /> : null}

                  {windowedRows.map((row) => (
                    <AgentChatThreadMotionRow
                      key={row.key}
                      row={row}
                      sessionRole={sessionRole}
                      sessionSelectedModel={sessionSelectedModel}
                      sessionAgentColors={sessionAgentColors}
                      sessionWorkingDirectory={sessionWorkingDirectory}
                      resolveRowRef={resolveRowRef}
                    />
                  ))}

                  {windowEnd < rows.length - 1 ? (
                    <div ref={bottomSentinelRef} className="h-px" />
                  ) : null}
                </>
              )
            ) : session.messages.length === 0 && !hideTranscriptWhileHydrating ? (
              <div className="rounded-lg border border-dashed border-input bg-card p-4 text-sm text-muted-foreground">
                Loading session history...
              </div>
            ) : null
          ) : null}
        </div>
        {showLoadingOverlay ? (
          <div className="absolute inset-0 z-30 flex items-center justify-center bg-muted">
            <div className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1.5 text-xs font-medium text-muted-foreground shadow-sm">
              <LoaderCircle className="size-3.5 animate-spin" />
              Loading session...
            </div>
          </div>
        ) : null}
      </div>

      {hasBottomStack && session ? (
        <div className="agent-chat-bottom-stack shrink-0 space-y-2 px-4 pb-0 pt-3">
          {session.pendingQuestions.map((request) => (
            <AgentSessionQuestionCard
              key={`${session.sessionId}:${request.requestId}`}
              request={request}
              disabled={!agentStudioReady}
              isSubmitting={Boolean(isSubmittingQuestionByRequestId[request.requestId])}
              onSubmit={onSubmitQuestionAnswers}
            />
          ))}

          {session.pendingPermissions.map((request) => (
            <div key={`${session.sessionId}:${request.requestId}`} className="relative z-30">
              <AgentSessionPermissionCard
                request={request}
                disabled={!agentStudioReady}
                isSubmitting={Boolean(isSubmittingPermissionByRequestId[request.requestId])}
                errorMessage={permissionReplyErrorByRequestId[request.requestId]}
                onReply={onReplyPermission}
              />
            </div>
          ))}

          <AgentSessionTodoPanel
            todos={session.todos}
            collapsed={todoPanelCollapsed}
            isSessionWorking={isSessionWorking}
            accentColor={sessionAccentColor}
            onToggleCollapse={onToggleTodoPanel}
          />
        </div>
      ) : null}
      {session ? <ScrollToTopButton visible={!isNearTop} onClick={scrollToTop} /> : null}
      {session ? <ScrollToBottomButton visible={!isNearBottom} onClick={scrollToBottom} /> : null}
    </div>
  );
}

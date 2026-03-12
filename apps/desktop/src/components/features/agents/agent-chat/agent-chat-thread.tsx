import { AlertTriangle, LoaderCircle, RefreshCcw, Sparkles } from "lucide-react";
import { Fragment, type ReactElement, useMemo, useRef } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { AgentChatMessage } from "@/types/agent-orchestrator";
import type { AgentChatThreadModel } from "./agent-chat.types";
import { AgentChatThreadRow } from "./agent-chat-thread-row";
import type { AgentChatVirtualRow } from "./agent-chat-thread-virtualization";
import { AgentSessionPermissionCard } from "./agent-session-permission-card";
import { AgentSessionQuestionCard } from "./agent-session-question-card";
import { AgentSessionTodoPanel } from "./agent-session-todo-panel";
import { useAgentChatAutoScroll } from "./use-agent-chat-auto-scroll";
import { useAgentChatRowMotion } from "./use-agent-chat-row-motion";
import { useAgentChatVirtualization } from "./use-agent-chat-virtualization";

export function AgentChatThread({ model }: { model: AgentChatThreadModel }): ReactElement {
  const {
    session,
    isSessionViewLoading,
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
    todoPanelCollapsed,
    onToggleTodoPanel,
    todoPanelBottomOffset,
    isPinnedToBottom,
    messagesContainerRef,
    onMessagesPointerDown,
    onMessagesScroll,
    onMessagesTouchMove,
    onMessagesWheel,
  } = model;

  const {
    activeSessionId,
    canRenderVirtualRows,
    hasRenderableSessionRows,
    isPreparingVirtualization,
    registerStaticMeasurementRowElement,
    shouldVirtualize,
    virtualRows,
    virtualRowsToRender,
    virtualizer,
  } = useAgentChatVirtualization({
    session,
    messagesContainerRef,
  });
  const scrollVersion = useMemo(() => {
    const trailingRows = virtualRows.slice(-6).map(toScrollVersionRowToken);

    return [
      activeSessionId ?? "none",
      session?.status ?? "stopped",
      String(virtualRows.length),
      session?.draftAssistantMessageId ?? "",
      String(session?.pendingQuestions.length ?? 0),
      String(session?.pendingPermissions.length ?? 0),
      ...trailingRows,
    ].join("\u001f");
  }, [
    activeSessionId,
    session?.draftAssistantMessageId,
    session?.pendingPermissions.length,
    session?.pendingQuestions.length,
    session?.status,
    virtualRows,
  ]);
  const { isJumpingToLatest } = useAgentChatAutoScroll({
    activeSessionId,
    canScrollToLatest: !isSessionViewLoading && (!shouldVirtualize || canRenderVirtualRows),
    isPinnedToBottom,
    messagesContainerRef,
    scrollVersion,
    shouldVirtualize,
    virtualRowsCount: virtualRows.length,
    virtualizer,
  });
  const sessionRole = session?.role ?? null;
  const sessionSelectedModel = session?.selectedModel ?? null;
  const rowKeys = useMemo(() => virtualRows.map((row) => row.key), [virtualRows]);
  const rowRefByKeyRef = useRef<Map<string, (element: HTMLDivElement | null) => void>>(new Map());
  const shouldRenderVirtualizedThread = canRenderVirtualRows && typeof window !== "undefined";
  const { registerRowElement } = useAgentChatRowMotion({
    activeSessionId,
    rowKeys,
  });

  const resolveRowRef = (rowKey: string) => {
    const cached = rowRefByKeyRef.current.get(rowKey);
    if (cached) {
      return cached;
    }

    const nextRef = registerRowElement(rowKey);
    rowRefByKeyRef.current.set(rowKey, nextRef);
    return nextRef;
  };

  const resolveStaticMeasurementRef = (rowKey: string) => {
    return registerStaticMeasurementRowElement(rowKey);
  };

  const renderThreadRow = (
    row: (typeof virtualRows)[number],
    options?: { measureStaticRow?: boolean },
  ): ReactElement => {
    const motionRef = resolveRowRef(row.key);
    const measurementRef = options?.measureStaticRow ? resolveStaticMeasurementRef(row.key) : null;
    const combinedRef = (element: HTMLDivElement | null) => {
      motionRef(element);
      measurementRef?.(element);
    };

    return (
      <div ref={combinedRef} data-row-key={row.key} className="agent-chat-row-motion">
        <AgentChatThreadRow
          row={row}
          sessionRole={sessionRole}
          sessionSelectedModel={sessionSelectedModel}
          sessionAgentColors={sessionAgentColors}
        />
      </div>
    );
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
        className="relative min-h-0 flex-1 space-y-1 overflow-y-auto p-4 pb-6"
        onPointerDown={onMessagesPointerDown}
        onScroll={onMessagesScroll}
        onTouchMove={onMessagesTouchMove}
        onWheel={onMessagesWheel}
      >
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

        {session && shouldRenderVirtualizedThread ? (
          <div
            style={{
              height: `${virtualizer.getTotalSize()}px`,
              position: "relative",
              width: "100%",
            }}
          >
            {virtualRowsToRender.length > 0
              ? virtualRowsToRender.map(({ row, virtualItem }) => (
                  <div
                    key={virtualItem.key}
                    data-index={virtualItem.index}
                    data-row-key={row.key}
                    ref={virtualizer.measureElement}
                    style={{
                      left: 0,
                      position: "absolute",
                      top: 0,
                      transform: `translateY(${virtualItem.start}px)`,
                      width: "100%",
                    }}
                  >
                    {renderThreadRow(row)}
                  </div>
                ))
              : null}
          </div>
        ) : null}

        {session && (!shouldVirtualize || !shouldRenderVirtualizedThread) ? (
          hasRenderableSessionRows ? (
            virtualRows.map((row) => (
              <Fragment key={row.key}>
                {renderThreadRow(row, { measureStaticRow: shouldVirtualize })}
              </Fragment>
            ))
          ) : (
            <div className="rounded-lg border border-dashed border-input bg-card p-4 text-sm text-muted-foreground">
              Loading session history...
            </div>
          )
        ) : null}

        {session?.pendingQuestions.map((request) => (
          <AgentSessionQuestionCard
            key={`${session.sessionId}:${request.requestId}`}
            request={request}
            disabled={!agentStudioReady}
            isSubmitting={Boolean(isSubmittingQuestionByRequestId[request.requestId])}
            onSubmit={onSubmitQuestionAnswers}
          />
        ))}

        {session?.pendingPermissions.map((request) => (
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
      </div>

      {isSessionViewLoading || isPreparingVirtualization || isJumpingToLatest ? (
        <div className="absolute inset-0 z-30 flex items-center justify-center bg-muted">
          <div className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1.5 text-xs font-medium text-muted-foreground shadow-sm">
            <LoaderCircle className="size-3.5 animate-spin" />
            Loading session history...
          </div>
        </div>
      ) : null}

      {session ? (
        <div
          className="pointer-events-none absolute right-3 z-20"
          style={{ bottom: `${todoPanelBottomOffset}px` }}
        >
          <AgentSessionTodoPanel
            todos={session.todos}
            collapsed={todoPanelCollapsed}
            className="pointer-events-auto"
            onToggleCollapse={onToggleTodoPanel}
          />
        </div>
      ) : null}
    </div>
  );
}

const toScrollVersionRowToken = (row: AgentChatVirtualRow): string => {
  switch (row.kind) {
    case "turn_duration":
      return `${row.key}:${row.durationMs}`;
    case "message":
      return buildMessageScrollVersionToken(row.message);
  }
};

const buildMessageScrollVersionToken = (message: AgentChatMessage): string => {
  const assistantMeta = message.meta?.kind === "assistant" ? message.meta : null;
  const contextToken =
    typeof assistantMeta?.totalTokens === "number"
      ? String(assistantMeta.totalTokens)
      : typeof assistantMeta?.durationMs === "number"
        ? String(assistantMeta.durationMs)
        : "";
  return [
    message.id,
    message.role,
    String(message.content.length),
    message.content.slice(-48),
    contextToken,
  ].join(":");
};

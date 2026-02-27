import { useVirtualizer } from "@tanstack/react-virtual";
import { AlertTriangle, Bot, Brain, LoaderCircle, RefreshCcw, Sparkles } from "lucide-react";
import {
  Fragment,
  type ReactElement,
  type UIEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
} from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { AgentChatThreadModel } from "./agent-chat.types";
import { AgentChatMessageCard } from "./agent-chat-message-card";
import {
  AGENT_CHAT_VIRTUAL_OVERSCAN_ITEMS,
  AGENT_CHAT_VIRTUAL_ROW_GAP_PX,
  AGENT_CHAT_VIRTUALIZATION_MIN_ROW_COUNT,
  type AgentChatVirtualRow,
  buildAgentChatVirtualRows,
} from "./agent-chat-thread-virtualization";
import { AgentSessionPermissionCard } from "./agent-session-permission-card";
import { AgentSessionQuestionCard } from "./agent-session-question-card";
import { AgentSessionTodoPanel } from "./agent-session-todo-panel";
import { AgentTurnDurationSeparator } from "./agent-turn-duration-separator";

export function AgentChatThread({ model }: { model: AgentChatThreadModel }): ReactElement {
  const {
    session,
    roleOptions,
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
    onMessagesScroll,
  } = model;

  const streamingRoleDisplay = session?.draftAssistantText
    ? (roleOptions.find((entry) => entry.role === session.role) ?? null)
    : null;
  const StreamingRoleIcon = streamingRoleDisplay?.icon ?? Bot;
  const streamingRoleLabel = streamingRoleDisplay?.label ?? "Assistant";

  const virtualRows = session ? buildAgentChatVirtualRows(session) : [];
  const shouldVirtualize = virtualRows.length >= AGENT_CHAT_VIRTUALIZATION_MIN_ROW_COUNT;
  const activeSessionId = session?.sessionId ?? null;
  const measuredSessionIdRef = useRef<string | null>(null);
  const measuredRowHeightByKeyRef = useRef<Record<string, number>>({});
  const previousVirtualizedSessionIdRef = useRef<string | null>(null);

  if (measuredSessionIdRef.current !== activeSessionId) {
    measuredSessionIdRef.current = activeSessionId;
    measuredRowHeightByKeyRef.current = {};
  }

  const estimateRowSize = useCallback(
    (index: number): number => {
      const row = virtualRows[index];
      if (!row) {
        return 0;
      }
      const trailingGap = index < virtualRows.length - 1 ? AGENT_CHAT_VIRTUAL_ROW_GAP_PX : 0;
      const measuredHeight = measuredRowHeightByKeyRef.current[row.key];
      if (typeof measuredHeight === "number" && measuredHeight > 0) {
        return measuredHeight + trailingGap;
      }

      return 1 + trailingGap;
    },
    [virtualRows],
  );

  const measureVirtualRowElement = useCallback(
    (element: Element): number => {
      const measuredHeight = element.getBoundingClientRect().height;
      const indexValue = Number.parseInt(element.getAttribute("data-index") ?? "", 10);
      const row =
        Number.isFinite(indexValue) && indexValue >= 0 ? virtualRows[indexValue] : undefined;
      if (row && measuredHeight > 0) {
        const previousHeight = measuredRowHeightByKeyRef.current[row.key];
        if (typeof previousHeight !== "number") {
          measuredRowHeightByKeyRef.current[row.key] = measuredHeight;
        } else if (Math.abs(previousHeight - measuredHeight) > 0.5) {
          measuredRowHeightByKeyRef.current[row.key] = measuredHeight;
        }
      }
      return measuredHeight;
    },
    [virtualRows],
  );

  const resolveRowKey = useCallback(
    (index: number): string | number => {
      return virtualRows[index]?.key ?? index;
    },
    [virtualRows],
  );

  const virtualizer = useVirtualizer({
    count: shouldVirtualize ? virtualRows.length : 0,
    getScrollElement: () => messagesContainerRef.current,
    estimateSize: estimateRowSize,
    measureElement: measureVirtualRowElement,
    getItemKey: resolveRowKey,
    overscan: AGENT_CHAT_VIRTUAL_OVERSCAN_ITEMS,
  });

  useEffect(() => {
    if (!activeSessionId || !shouldVirtualize || virtualRows.length === 0) {
      previousVirtualizedSessionIdRef.current = activeSessionId;
      return;
    }

    const sessionChanged = previousVirtualizedSessionIdRef.current !== activeSessionId;
    previousVirtualizedSessionIdRef.current = activeSessionId;

    if (!sessionChanged && !isPinnedToBottom) {
      return;
    }

    const lastRowIndex = virtualRows.length - 1;
    const scrollToBottom = (): void => {
      if (sessionChanged) {
        virtualizer.measure();
      }
      virtualizer.scrollToIndex(lastRowIndex, { align: "end" });

      const container = messagesContainerRef.current;
      if (!container) {
        return;
      }

      container.scrollTo({ top: container.scrollHeight, behavior: "auto" });
    };

    if (typeof window === "undefined") {
      scrollToBottom();
      return;
    }

    const rafId = window.requestAnimationFrame(() => {
      scrollToBottom();
    });

    return () => {
      window.cancelAnimationFrame(rafId);
    };
  }, [
    activeSessionId,
    isPinnedToBottom,
    messagesContainerRef,
    shouldVirtualize,
    virtualRows.length,
    virtualizer,
  ]);

  const handleMessagesContainerScroll = useCallback(
    (event: UIEvent<HTMLDivElement>): void => {
      onMessagesScroll(event);
    },
    [onMessagesScroll],
  );
  const virtualItems = virtualizer.getVirtualItems();
  const virtualRowsToRender = useMemo(
    () =>
      virtualItems
        .map((virtualItem) => {
          const row = virtualRows[virtualItem.index];
          if (!row) {
            return null;
          }
          return { row, virtualItem };
        })
        .filter(
          (
            entry,
          ): entry is { row: AgentChatVirtualRow; virtualItem: (typeof virtualItems)[number] } =>
            entry !== null,
        ),
    [virtualItems, virtualRows],
  );
  const canRenderVirtualRows = shouldVirtualize && virtualRowsToRender.length > 0;
  const hasRenderableSessionRows = virtualRows.length > 0;

  const renderVirtualRow = useCallback(
    (row: AgentChatVirtualRow): ReactElement => {
      if (row.kind === "turn_duration") {
        return <AgentTurnDurationSeparator durationMs={row.durationMs} />;
      }

      if (row.kind === "message") {
        const isUserMessage = row.message.role === "user";
        return (
          <div className={cn("flow-root", isUserMessage ? "pt-4" : undefined)}>
            <AgentChatMessageCard
              message={row.message}
              sessionRole={session?.role ?? null}
              sessionSelectedModel={session?.selectedModel ?? null}
              sessionAgentColors={sessionAgentColors}
            />
          </div>
        );
      }

      if (row.kind === "draft") {
        return (
          <article className="px-1 py-1 text-sm text-foreground">
            <header className="mb-1 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              <StreamingRoleIcon className="size-3" />
              {streamingRoleLabel} (streaming)
              <LoaderCircle className="size-3 animate-spin" />
            </header>
            <p className="whitespace-pre-wrap leading-6 text-foreground">{row.draftText}</p>
          </article>
        );
      }

      return (
        <div className="flex items-center gap-2 rounded-md border border-dashed border-input bg-card px-3 py-2 text-xs text-muted-foreground">
          <LoaderCircle className="size-3.5 animate-spin text-muted-foreground" />
          <Brain className="size-3.5 text-violet-600" />
          Agent is thinking...
        </div>
      );
    },
    [session, sessionAgentColors, StreamingRoleIcon, streamingRoleLabel],
  );

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      {!agentStudioReady ? (
        <div className="mx-4 mt-4 flex items-start justify-between gap-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
          <div className="flex min-w-0 items-start gap-2">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" />
            <p className="min-w-0">{blockedReason}</p>
          </div>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-7 border-rose-300 bg-card text-rose-700 hover:bg-rose-100"
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
        className="min-h-0 flex-1 space-y-1 overflow-y-auto p-4 pb-6"
        onScroll={handleMessagesContainerScroll}
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

        {session && canRenderVirtualRows ? (
          <div
            style={{
              height: `${virtualizer.getTotalSize()}px`,
              position: "relative",
              width: "100%",
            }}
          >
            {virtualRowsToRender.map(({ row, virtualItem }) => {
              return (
                <div
                  key={virtualItem.key}
                  data-index={virtualItem.index}
                  ref={virtualizer.measureElement}
                  style={{
                    left: 0,
                    position: "absolute",
                    top: 0,
                    transform: `translateY(${virtualItem.start}px)`,
                    width: "100%",
                  }}
                >
                  {renderVirtualRow(row)}
                </div>
              );
            })}
          </div>
        ) : null}

        {session && !canRenderVirtualRows ? (
          hasRenderableSessionRows ? (
            virtualRows.map((row) => <Fragment key={row.key}>{renderVirtualRow(row)}</Fragment>)
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

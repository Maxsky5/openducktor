import { AlertTriangle, Bot, Brain, LoaderCircle, RefreshCcw, Sparkles } from "lucide-react";
import {
  Fragment,
  memo,
  type ReactElement,
  type ReactNode,
  type UIEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { AgentChatThreadModel } from "./agent-chat.types";
import { AgentChatMessageCard } from "./agent-chat-message-card";
import {
  AGENT_CHAT_VIRTUAL_OVERSCAN_PX,
  AGENT_CHAT_VIRTUAL_ROW_GAP_PX,
  AGENT_CHAT_VIRTUALIZATION_MIN_ROW_COUNT,
  type AgentChatVirtualRow,
  buildAgentChatVirtualRows,
  buildVirtualRowLayout,
  findVirtualWindowRange,
  getVirtualWindowEdgeOffsets,
  normalizeVirtualWindowRange,
  type VirtualWindowRange,
} from "./agent-chat-thread-virtualization";
import { AgentSessionPermissionCard } from "./agent-session-permission-card";
import { AgentSessionQuestionCard } from "./agent-session-question-card";
import { AgentSessionTodoPanel } from "./agent-session-todo-panel";
import { AgentTurnDurationSeparator } from "./agent-turn-duration-separator";

const EMPTY_RANGE: VirtualWindowRange = { startIndex: 0, endIndex: -1 };

type MeasuredThreadRowProps = {
  rowKey: string;
  children: ReactNode;
  onMeasuredHeight: (rowKey: string, height: number) => void;
};

const MeasuredThreadRow = memo(function MeasuredThreadRow({
  rowKey,
  children,
  onMeasuredHeight,
}: MeasuredThreadRowProps): ReactElement {
  const rowRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const element = rowRef.current;
    if (!element) {
      return;
    }

    const reportHeight = (): void => {
      const nextHeight = Math.ceil(element.getBoundingClientRect().height);
      if (nextHeight > 0) {
        onMeasuredHeight(rowKey, nextHeight);
      }
    };

    reportHeight();

    if (typeof ResizeObserver === "undefined") {
      return;
    }

    const observer = new ResizeObserver(() => {
      reportHeight();
    });
    observer.observe(element);
    return () => {
      observer.disconnect();
    };
  }, [onMeasuredHeight, rowKey]);

  return <div ref={rowRef}>{children}</div>;
});

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
  const [measuredHeightsByKey, setMeasuredHeightsByKey] = useState<Record<string, number>>({});
  const [visibleRange, setVisibleRange] = useState<VirtualWindowRange>(() =>
    virtualRows.length > 0 ? { startIndex: 0, endIndex: virtualRows.length - 1 } : EMPTY_RANGE,
  );

  const virtualRowHeights = useMemo(
    () =>
      virtualRows.map((row) => {
        return measuredHeightsByKey[row.key] ?? row.estimatedHeightPx;
      }),
    [measuredHeightsByKey, virtualRows],
  );

  const virtualLayout = useMemo(
    () =>
      buildVirtualRowLayout({
        itemHeights: virtualRowHeights,
        gapPx: AGENT_CHAT_VIRTUAL_ROW_GAP_PX,
      }),
    [virtualRowHeights],
  );

  const syncViewport = useCallback((): void => {
    if (!shouldVirtualize) {
      const nextRange =
        virtualRows.length > 0 ? { startIndex: 0, endIndex: virtualRows.length - 1 } : EMPTY_RANGE;
      setVisibleRange((current) => {
        if (
          current.startIndex === nextRange.startIndex &&
          current.endIndex === nextRange.endIndex
        ) {
          return current;
        }
        return nextRange;
      });
      return;
    }

    const container = messagesContainerRef.current;
    if (!container) {
      const fallbackRange =
        virtualRows.length > 0 ? { startIndex: 0, endIndex: virtualRows.length - 1 } : EMPTY_RANGE;
      setVisibleRange((current) => {
        if (
          current.startIndex === fallbackRange.startIndex &&
          current.endIndex === fallbackRange.endIndex
        ) {
          return current;
        }
        return fallbackRange;
      });
      return;
    }

    const maxScrollTop = Math.max(0, virtualLayout.totalHeight - container.clientHeight);
    const clampedScrollTop = Math.min(Math.max(container.scrollTop, 0), maxScrollTop);
    const nextRange = findVirtualWindowRange({
      itemOffsets: virtualLayout.itemOffsets,
      itemHeights: virtualRowHeights,
      totalHeight: virtualLayout.totalHeight,
      viewportStart: clampedScrollTop - AGENT_CHAT_VIRTUAL_OVERSCAN_PX,
      viewportEnd: clampedScrollTop + container.clientHeight + AGENT_CHAT_VIRTUAL_OVERSCAN_PX,
    });

    setVisibleRange((current) => {
      if (current.startIndex === nextRange.startIndex && current.endIndex === nextRange.endIndex) {
        return current;
      }
      return nextRange;
    });
  }, [
    messagesContainerRef,
    shouldVirtualize,
    virtualLayout,
    virtualRowHeights,
    virtualRows.length,
  ]);

  const scheduledSyncRafIdRef = useRef<number | null>(null);
  const scheduleViewportSync = useCallback((): void => {
    if (typeof window === "undefined") {
      syncViewport();
      return;
    }

    if (scheduledSyncRafIdRef.current !== null) {
      return;
    }

    scheduledSyncRafIdRef.current = window.requestAnimationFrame(() => {
      scheduledSyncRafIdRef.current = null;
      syncViewport();
    });
  }, [syncViewport]);

  useEffect(() => {
    syncViewport();
  }, [syncViewport]);

  useEffect(() => {
    if (!shouldVirtualize) {
      return;
    }

    const rowKeySet = new Set(virtualRows.map((row) => row.key));
    setMeasuredHeightsByKey((current) => {
      let changed = false;
      const next: Record<string, number> = {};

      for (const [rowKey, measuredHeight] of Object.entries(current)) {
        if (rowKeySet.has(rowKey)) {
          next[rowKey] = measuredHeight;
          continue;
        }
        changed = true;
      }

      return changed ? next : current;
    });
  }, [shouldVirtualize, virtualRows]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const handleResize = (): void => {
      scheduleViewportSync();
    };

    window.addEventListener("resize", handleResize);
    return () => {
      window.removeEventListener("resize", handleResize);
    };
  }, [scheduleViewportSync]);

  useEffect(() => {
    if (!shouldVirtualize || !isPinnedToBottom) {
      return;
    }

    const container = messagesContainerRef.current;
    if (!container) {
      return;
    }

    container.scrollTo({ top: container.scrollHeight, behavior: "auto" });
  }, [isPinnedToBottom, messagesContainerRef, shouldVirtualize]);

  useEffect(() => {
    if (!shouldVirtualize || typeof ResizeObserver === "undefined") {
      return;
    }

    const container = messagesContainerRef.current;
    if (!container) {
      return;
    }

    const observer = new ResizeObserver(() => {
      scheduleViewportSync();
    });
    observer.observe(container);

    return () => {
      observer.disconnect();
    };
  }, [messagesContainerRef, scheduleViewportSync, shouldVirtualize]);

  useEffect(() => {
    return () => {
      if (scheduledSyncRafIdRef.current !== null && typeof window !== "undefined") {
        window.cancelAnimationFrame(scheduledSyncRafIdRef.current);
      }
    };
  }, []);

  const handleMeasuredRowHeight = useCallback((rowKey: string, height: number): void => {
    setMeasuredHeightsByKey((current) => {
      if (current[rowKey] === height) {
        return current;
      }
      return { ...current, [rowKey]: height };
    });
  }, []);

  const handleMessagesContainerScroll = useCallback(
    (event: UIEvent<HTMLDivElement>): void => {
      onMessagesScroll(event);
      if (shouldVirtualize) {
        scheduleViewportSync();
      }
    },
    [onMessagesScroll, scheduleViewportSync, shouldVirtualize],
  );

  const visibleVirtualRows = useMemo(() => {
    if (!shouldVirtualize) {
      return virtualRows;
    }

    const safeRange = normalizeVirtualWindowRange(visibleRange, virtualRows.length);
    if (safeRange.endIndex < safeRange.startIndex) {
      return [];
    }

    return virtualRows.slice(safeRange.startIndex, safeRange.endIndex + 1);
  }, [shouldVirtualize, virtualRows, visibleRange]);

  const { topSpacerHeight, bottomSpacerHeight } = useMemo(() => {
    if (!shouldVirtualize) {
      return { topSpacerHeight: 0, bottomSpacerHeight: 0 };
    }

    const safeRange = normalizeVirtualWindowRange(visibleRange, virtualRows.length);
    return getVirtualWindowEdgeOffsets({
      range: safeRange,
      itemOffsets: virtualLayout.itemOffsets,
      itemHeights: virtualRowHeights,
      totalHeight: virtualLayout.totalHeight,
    });
  }, [shouldVirtualize, visibleRange, virtualLayout, virtualRowHeights, virtualRows.length]);

  const renderVirtualRow = useCallback(
    (row: AgentChatVirtualRow): ReactElement => {
      if (row.kind === "turn_duration") {
        return <AgentTurnDurationSeparator durationMs={row.durationMs} />;
      }

      if (row.kind === "message") {
        const isUserMessage = row.message.role === "user";
        return (
          <div className={cn(isUserMessage ? "pt-4" : undefined)}>
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
          <article className="px-1 py-1 text-sm text-slate-700">
            <header className="mb-1 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              <StreamingRoleIcon className="size-3" />
              {streamingRoleLabel} (streaming)
              <LoaderCircle className="size-3 animate-spin" />
            </header>
            <p className="whitespace-pre-wrap leading-6 text-slate-700">{row.draftText}</p>
          </article>
        );
      }

      return (
        <div className="flex items-center gap-2 rounded-md border border-dashed border-slate-300 bg-white px-3 py-2 text-xs text-slate-600">
          <LoaderCircle className="size-3.5 animate-spin text-slate-500" />
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
            className="h-7 border-rose-300 bg-white text-rose-700 hover:bg-rose-100"
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
          <div className="space-y-3 rounded-lg border border-dashed border-slate-300 bg-white p-4 text-sm text-slate-500">
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

        {session && shouldVirtualize ? (
          <div>
            {topSpacerHeight > 0 ? <div style={{ height: topSpacerHeight }} /> : null}
            <div className="space-y-1">
              {visibleVirtualRows.map((row) => (
                <MeasuredThreadRow
                  key={row.key}
                  rowKey={row.key}
                  onMeasuredHeight={handleMeasuredRowHeight}
                >
                  {renderVirtualRow(row)}
                </MeasuredThreadRow>
              ))}
            </div>
            {bottomSpacerHeight > 0 ? <div style={{ height: bottomSpacerHeight }} /> : null}
          </div>
        ) : null}

        {session && !shouldVirtualize
          ? virtualRows.map((row) => <Fragment key={row.key}>{renderVirtualRow(row)}</Fragment>)
          : null}

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

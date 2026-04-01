import type { MutableRefObject, RefObject } from "react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef } from "react";
import type { AgentChatWindowRow } from "./agent-chat-thread-windowing";
import { clampWindowRange, createBottomAnchoredWindow } from "./agent-chat-window-shared";
import { useAgentChatHistoryWindow } from "./use-agent-chat-history-window";
import { useAgentChatResizeSync } from "./use-agent-chat-resize-sync";
import { useAgentChatScrollController } from "./use-agent-chat-scroll-controller";
import { useAgentChatSentinelObservers } from "./use-agent-chat-sentinel-observers";
import { useAgentChatWindowRangeController } from "./use-agent-chat-window-range-controller";

type UseAgentChatWindowInput = {
  rows: AgentChatWindowRow[];
  activeSessionId: string | null;
  isSessionViewLoading: boolean;
  isSessionWorking?: boolean;
  messagesContainerRef: RefObject<HTMLDivElement | null>;
  messagesContentRef: RefObject<HTMLDivElement | null>;
  syncBottomAfterComposerLayoutRef?: MutableRefObject<(() => void) | null>;
};

type UseAgentChatWindowResult = {
  windowedRows: AgentChatWindowRow[];
  windowStart: number;
  windowEnd: number;
  isNearBottom: boolean;
  isNearTop: boolean;
  topSentinelRef: (element: HTMLDivElement | null) => void;
  bottomSentinelRef: (element: HTMLDivElement | null) => void;
  scrollToBottom: () => void;
  scrollToTop: () => void;
  scrollToBottomOnSend: () => void;
};

export function useAgentChatWindow({
  rows,
  activeSessionId,
  isSessionViewLoading,
  messagesContainerRef,
  messagesContentRef,
  syncBottomAfterComposerLayoutRef,
}: UseAgentChatWindowInput): UseAgentChatWindowResult {
  const composerLayoutSyncFrameRef = useRef<number | null>(null);
  const composerLayoutSyncSettleFrameRef = useRef<number | null>(null);
  const composerLayoutSyncTokenRef = useRef(0);
  const prevSessionIdRef = useRef<string | null>(null);
  const prevIsSessionViewLoadingRef = useRef(isSessionViewLoading);
  const pendingBottomResetRef = useRef(false);
  const pendingTopRevealRef = useRef(false);
  const initialWindow = createBottomAnchoredWindow(rows.length);
  const {
    isNearBottom,
    isNearTop,
    userScrolledRef,
    userScrollIntentVersionRef,
    isPinnedToBottomRef,
    suppressSentinelsRef,
    isUpdatingRef,
    hasPendingScrollRequest,
    captureScrollAnchor,
    syncBottomIfPinned,
    scrollToBottomOnSend: jumpToBottomOnSend,
    requestWindowScroll,
    applyPendingScrollRequest,
    setBottomAnchoredState,
    setTopAnchoredState,
  } = useAgentChatScrollController({
    messagesContainerRef,
    initialWindow,
  });
  const {
    latestTurnStart,
    turnStart,
    windowStart: historyWindowStart,
    windowedRows: historyWindowedRows,
    resetToLatestTurns,
    revealAllHistory,
  } = useAgentChatHistoryWindow({
    rows,
    isSessionViewLoading,
    messagesContainerRef,
    userScrolledRef,
  });
  const historyRowCount = historyWindowedRows.length;

  useLayoutEffect(() => {
    applyPendingScrollRequest();
  });

  useAgentChatResizeSync({
    messagesContainerRef,
    messagesContentRef,
    syncBottomIfPinned,
  });

  useEffect(() => {
    if (!syncBottomAfterComposerLayoutRef) {
      return;
    }

    const cancelScheduledComposerLayoutSync = () => {
      composerLayoutSyncTokenRef.current += 1;
      if (composerLayoutSyncFrameRef.current !== null) {
        globalThis.cancelAnimationFrame(composerLayoutSyncFrameRef.current);
        composerLayoutSyncFrameRef.current = null;
      }
      if (composerLayoutSyncSettleFrameRef.current !== null) {
        globalThis.cancelAnimationFrame(composerLayoutSyncSettleFrameRef.current);
        composerLayoutSyncSettleFrameRef.current = null;
      }
    };

    syncBottomAfterComposerLayoutRef.current = () => {
      cancelScheduledComposerLayoutSync();
      const requestAnimationFrameFn = globalThis.requestAnimationFrame;
      if (typeof requestAnimationFrameFn !== "function") {
        syncBottomIfPinned({ forcePinned: true });
        return;
      }

      const scheduledToken = composerLayoutSyncTokenRef.current + 1;
      composerLayoutSyncTokenRef.current = scheduledToken;
      const scheduledUserScrollIntentVersion = userScrollIntentVersionRef.current;

      composerLayoutSyncFrameRef.current = requestAnimationFrameFn(() => {
        composerLayoutSyncFrameRef.current = null;
        composerLayoutSyncSettleFrameRef.current = requestAnimationFrameFn(() => {
          composerLayoutSyncSettleFrameRef.current = null;
          if (composerLayoutSyncTokenRef.current !== scheduledToken) {
            return;
          }
          if (userScrollIntentVersionRef.current !== scheduledUserScrollIntentVersion) {
            return;
          }

          syncBottomIfPinned({ forcePinned: true });
        });
      });
    };

    return () => {
      cancelScheduledComposerLayoutSync();
      if (syncBottomAfterComposerLayoutRef.current) {
        syncBottomAfterComposerLayoutRef.current = null;
      }
    };
  }, [syncBottomAfterComposerLayoutRef, syncBottomIfPinned, userScrollIntentVersionRef]);

  const {
    windowRange,
    scrollToBottom: scrollViewportToBottom,
    scrollToTop: scrollViewportToTop,
    shiftWindowUp,
    shiftWindowDown,
  } = useAgentChatWindowRangeController({
    rows: historyWindowedRows,
    rowCount: historyRowCount,
    activeSessionId,
    isSessionViewLoading,
    isPinnedToBottomRef,
    suppressSentinelsRef,
    isUpdatingRef,
    hasPendingScrollRequest,
    captureScrollAnchor,
    requestWindowScroll,
    setBottomAnchoredState,
    setTopAnchoredState,
  });

  const { topSentinelRef, bottomSentinelRef } = useAgentChatSentinelObservers({
    messagesContainerRef,
    rowCount: historyRowCount,
    windowStart: windowRange.start,
    windowEnd: windowRange.end,
    suppressSentinelsRef,
    shiftWindowUp,
    shiftWindowDown,
  });

  const resetLatestTurnsAndPinBottom = useCallback(() => {
    if (turnStart === latestTurnStart) {
      scrollViewportToBottom();
      return;
    }

    pendingBottomResetRef.current = true;
    resetToLatestTurns();
  }, [latestTurnStart, resetToLatestTurns, scrollViewportToBottom, turnStart]);

  useEffect(() => {
    if (prevSessionIdRef.current === activeSessionId) {
      return;
    }

    prevSessionIdRef.current = activeSessionId;
    resetLatestTurnsAndPinBottom();
  }, [activeSessionId, resetLatestTurnsAndPinBottom]);

  useEffect(() => {
    const finishedLoading = prevIsSessionViewLoadingRef.current && !isSessionViewLoading;
    prevIsSessionViewLoadingRef.current = isSessionViewLoading;
    if (!finishedLoading) {
      return;
    }

    resetLatestTurnsAndPinBottom();
  }, [isSessionViewLoading, resetLatestTurnsAndPinBottom]);

  useLayoutEffect(() => {
    if (!pendingBottomResetRef.current) {
      return;
    }

    pendingBottomResetRef.current = false;
    scrollViewportToBottom();
  });

  useLayoutEffect(() => {
    if (!pendingTopRevealRef.current || turnStart !== 0) {
      return;
    }

    pendingTopRevealRef.current = false;
    scrollViewportToTop();
  }, [scrollViewportToTop, turnStart]);

  const effectiveWindow = clampWindowRange(windowRange, historyRowCount);
  const hasVisibleRows = effectiveWindow.end >= effectiveWindow.start;
  const windowedRows = useMemo(
    () =>
      hasVisibleRows
        ? historyWindowedRows.slice(effectiveWindow.start, effectiveWindow.end + 1)
        : [],
    [effectiveWindow.end, effectiveWindow.start, hasVisibleRows, historyWindowedRows],
  );
  const globalWindowStart = hasVisibleRows ? historyWindowStart + effectiveWindow.start : 0;
  const globalWindowEnd = hasVisibleRows ? historyWindowStart + effectiveWindow.end : -1;

  return {
    windowedRows,
    windowStart: globalWindowStart,
    windowEnd: globalWindowEnd,
    isNearBottom,
    isNearTop: isNearTop && turnStart === 0,
    topSentinelRef,
    bottomSentinelRef,
    scrollToBottom: () => {
      resetLatestTurnsAndPinBottom();
    },
    scrollToTop: () => {
      const container = messagesContainerRef.current;
      if (container) {
        container.style.overflowAnchor = "none";
      }

      pendingTopRevealRef.current = true;
      revealAllHistory();
      scrollViewportToTop();
    },
    scrollToBottomOnSend: () => {
      jumpToBottomOnSend();
      resetLatestTurnsAndPinBottom();
    },
  };
}

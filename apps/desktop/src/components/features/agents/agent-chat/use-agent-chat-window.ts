import type { RefCallback, RefObject } from "react";
import { useLayoutEffect } from "react";
import type { AgentChatWindowRow } from "./agent-chat-thread-windowing";
import { clampWindowRange, createBottomAnchoredWindow } from "./agent-chat-window-shared";
import { useAgentChatResizeSync } from "./use-agent-chat-resize-sync";
import { useAgentChatScrollController } from "./use-agent-chat-scroll-controller";
import { useAgentChatSentinelObservers } from "./use-agent-chat-sentinel-observers";
import { useAgentChatWindowRangeController } from "./use-agent-chat-window-range-controller";

type UseAgentChatWindowInput = {
  rows: AgentChatWindowRow[];
  activeSessionId: string | null;
  isSessionViewLoading: boolean;
  messagesContainerRef: RefObject<HTMLDivElement | null>;
  messagesContentRef: RefObject<HTMLDivElement | null>;
};

type UseAgentChatWindowResult = {
  windowedRows: AgentChatWindowRow[];
  windowStart: number;
  windowEnd: number;
  isNearBottom: boolean;
  isNearTop: boolean;
  isAutoFollowingToBottom: boolean;
  topSentinelRef: RefCallback<HTMLDivElement>;
  bottomSentinelRef: RefCallback<HTMLDivElement>;
  scrollToBottom: () => void;
  scrollToTop: () => void;
};

export function useAgentChatWindow({
  rows,
  activeSessionId,
  isSessionViewLoading,
  messagesContainerRef,
  messagesContentRef,
}: UseAgentChatWindowInput): UseAgentChatWindowResult {
  const rowCount = rows.length;
  const initialWindow = createBottomAnchoredWindow(rowCount);
  const {
    isNearBottom,
    isNearTop,
    isAutoFollowingToBottom,
    isPinnedToBottomRef,
    suppressSentinelsRef,
    prevScrollHeightRef,
    shouldCompensateScrollRef,
    isUpdatingRef,
    hasPendingScrollRequest,
    syncBottomIfPinned,
    requestWindowScroll,
    applyPendingScrollRequest,
    setBottomAnchoredState,
    setTopAnchoredState,
  } = useAgentChatScrollController({
    messagesContainerRef,
    initialWindow,
  });

  useLayoutEffect(() => {
    applyPendingScrollRequest();
  });

  useAgentChatResizeSync({
    messagesContainerRef,
    messagesContentRef,
    syncBottomIfPinned,
  });
  const { windowRange, scrollToBottom, scrollToTop, shiftWindowUp, shiftWindowDown } =
    useAgentChatWindowRangeController({
      rowCount,
      activeSessionId,
      isSessionViewLoading,
      messagesContainerRef,
      isPinnedToBottomRef,
      suppressSentinelsRef,
      prevScrollHeightRef,
      shouldCompensateScrollRef,
      isUpdatingRef,
      hasPendingScrollRequest,
      requestWindowScroll,
      setBottomAnchoredState,
      setTopAnchoredState,
    });

  const { topSentinelRef, bottomSentinelRef } = useAgentChatSentinelObservers({
    messagesContainerRef,
    rowCount,
    windowStart: windowRange.start,
    windowEnd: windowRange.end,
    suppressSentinelsRef,
    shiftWindowUp,
    shiftWindowDown,
  });

  const effectiveIsNearTop = isNearTop && windowRange.start === 0;

  const effectiveWindow = clampWindowRange(windowRange, rowCount);
  const hasVisibleRows = effectiveWindow.end >= effectiveWindow.start;
  const windowedRows = hasVisibleRows
    ? rows.slice(effectiveWindow.start, effectiveWindow.end + 1)
    : [];

  return {
    windowedRows,
    windowStart: effectiveWindow.start,
    windowEnd: effectiveWindow.end,
    isNearBottom,
    isNearTop: effectiveIsNearTop,
    isAutoFollowingToBottom,
    topSentinelRef,
    bottomSentinelRef,
    scrollToBottom,
    scrollToTop,
  };
}

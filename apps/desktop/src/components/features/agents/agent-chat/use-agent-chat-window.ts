import type { RefCallback, RefObject } from "react";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { AgentChatWindowRow } from "./agent-chat-thread-windowing";
import { CHAT_OVERSCAN, CHAT_SHIFT_SIZE, CHAT_WINDOW_SIZE } from "./agent-chat-thread-windowing";
import {
  CHAT_AUTO_SCROLL_ANIMATION_DURATION_MS,
  CHAT_MAX_RENDERED_ROWS,
  clampWindowRange,
  createBottomAnchoredWindow,
  EMPTY_WINDOW,
  type WindowRange,
} from "./agent-chat-window-shared";
import { useAgentChatResizeSync } from "./use-agent-chat-resize-sync";
import { useAgentChatScrollController } from "./use-agent-chat-scroll-controller";
import { useAgentChatSentinelObservers } from "./use-agent-chat-sentinel-observers";

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
  const [windowRange, setWindowRange] = useState<WindowRange>(() => initialWindow);
  const prevSessionIdRef = useRef<string | null>(null);
  const prevIsSessionViewLoadingRef = useRef(isSessionViewLoading);
  const prevRowCountRef = useRef(rowCount);
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

  const applyBottomAnchoredWindow = useCallback(() => {
    const nextWindow = createBottomAnchoredWindow(rowCount);
    setWindowRange(nextWindow);
    setBottomAnchoredState(nextWindow.start);
  }, [rowCount, setBottomAnchoredState]);

  useEffect(() => {
    if (prevSessionIdRef.current === activeSessionId) {
      return;
    }

    prevSessionIdRef.current = activeSessionId;
    applyBottomAnchoredWindow();
    requestWindowScroll({
      target: "bottom",
      behavior: "auto",
      suppressSentinels: true,
    });
  }, [activeSessionId, applyBottomAnchoredWindow, requestWindowScroll]);

  useEffect(() => {
    const finishedLoading = prevIsSessionViewLoadingRef.current && !isSessionViewLoading;
    prevIsSessionViewLoadingRef.current = isSessionViewLoading;
    if (!finishedLoading) {
      return;
    }

    applyBottomAnchoredWindow();
    requestWindowScroll({
      target: "bottom",
      behavior: "auto",
      suppressSentinels: true,
    });
  }, [applyBottomAnchoredWindow, isSessionViewLoading, requestWindowScroll]);

  useEffect(() => {
    const previousRowCount = prevRowCountRef.current;
    prevRowCountRef.current = rowCount;

    if (rowCount === 0) {
      setWindowRange(EMPTY_WINDOW);
      setBottomAnchoredState(0);
      return;
    }

    if (rowCount < previousRowCount) {
      setWindowRange((current) => clampWindowRange(current, rowCount));
      return;
    }

    if (rowCount === previousRowCount || !isPinnedToBottomRef.current) {
      return;
    }

    applyBottomAnchoredWindow();
    if (hasPendingScrollRequest()) {
      return;
    }

    requestWindowScroll({
      target: "bottom",
      behavior: "auto",
      suppressSentinels: false,
      animationDurationMs: CHAT_AUTO_SCROLL_ANIMATION_DURATION_MS,
    });
  }, [
    applyBottomAnchoredWindow,
    hasPendingScrollRequest,
    isPinnedToBottomRef,
    requestWindowScroll,
    rowCount,
    setBottomAnchoredState,
  ]);

  useLayoutEffect(() => {
    applyPendingScrollRequest();
  });

  useAgentChatResizeSync({
    messagesContainerRef,
    messagesContentRef,
    syncBottomIfPinned,
  });

  const shiftWindowUp = useCallback(() => {
    if (isUpdatingRef.current || rowCount === 0 || suppressSentinelsRef.current) {
      return;
    }

    setWindowRange((current) => {
      if (current.start <= 0) {
        return current;
      }

      const nextStart = Math.max(0, current.start - CHAT_SHIFT_SIZE);
      const nextRange = clampWindowRange(
        {
          start: nextStart,
          end: Math.min(rowCount - 1, nextStart + CHAT_MAX_RENDERED_ROWS - 1),
        },
        rowCount,
      );
      if (nextRange.start === current.start && nextRange.end === current.end) {
        return current;
      }

      const container = messagesContainerRef.current;
      if (container) {
        prevScrollHeightRef.current = container.scrollHeight;
        shouldCompensateScrollRef.current = true;
      }
      isUpdatingRef.current = true;
      if (typeof window !== "undefined") {
        window.requestAnimationFrame(() => {
          isUpdatingRef.current = false;
        });
      } else {
        isUpdatingRef.current = false;
      }
      return nextRange;
    });
  }, [
    isUpdatingRef,
    messagesContainerRef,
    prevScrollHeightRef,
    rowCount,
    shouldCompensateScrollRef,
    suppressSentinelsRef,
  ]);

  const shiftWindowDown = useCallback(() => {
    if (isUpdatingRef.current || rowCount === 0 || suppressSentinelsRef.current) {
      return;
    }

    setWindowRange((current) => {
      if (current.end >= rowCount - 1) {
        return current;
      }

      const nextEnd = Math.min(rowCount - 1, current.end + CHAT_SHIFT_SIZE);
      const nextRange = clampWindowRange(
        {
          start: Math.max(0, nextEnd - CHAT_MAX_RENDERED_ROWS + 1),
          end: nextEnd,
        },
        rowCount,
      );
      if (nextRange.start === current.start && nextRange.end === current.end) {
        return current;
      }

      isUpdatingRef.current = true;
      if (typeof window !== "undefined") {
        window.requestAnimationFrame(() => {
          isUpdatingRef.current = false;
        });
      } else {
        isUpdatingRef.current = false;
      }
      return nextRange;
    });
  }, [isUpdatingRef, rowCount, suppressSentinelsRef]);

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

  const scrollToBottom = useCallback(() => {
    applyBottomAnchoredWindow();
    requestWindowScroll({
      target: "bottom",
      behavior: "auto",
      suppressSentinels: true,
    });
  }, [applyBottomAnchoredWindow, requestWindowScroll]);

  const scrollToTop = useCallback(() => {
    const nextRange = clampWindowRange(
      {
        start: 0,
        end: Math.min(rowCount - 1, CHAT_WINDOW_SIZE + CHAT_OVERSCAN - 1),
      },
      rowCount,
    );
    setWindowRange(nextRange);
    setTopAnchoredState();
    requestWindowScroll({
      target: "top",
      behavior: "auto",
      suppressSentinels: true,
    });
  }, [requestWindowScroll, rowCount, setTopAnchoredState]);

  const effectiveWindow = clampWindowRange(windowRange, rowCount);
  const windowedRows =
    effectiveWindow.end >= effectiveWindow.start
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

import type { MutableRefObject, RefObject } from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { CHAT_OVERSCAN, CHAT_SHIFT_SIZE, CHAT_WINDOW_SIZE } from "./agent-chat-thread-windowing";
import {
  CHAT_AUTO_SCROLL_ANIMATION_DURATION_MS,
  CHAT_MAX_RENDERED_ROWS,
  clampWindowRange,
  createBottomAnchoredWindow,
  EMPTY_WINDOW,
  type PendingScrollRequest,
  type WindowRange,
} from "./agent-chat-window-shared";

type UseAgentChatWindowRangeControllerInput = {
  rowCount: number;
  activeSessionId: string | null;
  isSessionViewLoading: boolean;
  messagesContainerRef: RefObject<HTMLDivElement | null>;
  isPinnedToBottomRef: MutableRefObject<boolean>;
  suppressSentinelsRef: MutableRefObject<boolean>;
  prevScrollHeightRef: MutableRefObject<number | null>;
  shouldCompensateScrollRef: MutableRefObject<boolean>;
  isUpdatingRef: MutableRefObject<boolean>;
  hasPendingScrollRequest: () => boolean;
  requestWindowScroll: (request: PendingScrollRequest) => void;
  setBottomAnchoredState: (windowStart: number) => void;
  setTopAnchoredState: () => void;
};

type UseAgentChatWindowRangeControllerResult = {
  windowRange: WindowRange;
  scrollToBottom: () => void;
  scrollToTop: () => void;
  shiftWindowUp: () => void;
  shiftWindowDown: () => void;
};

export function useAgentChatWindowRangeController({
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
}: UseAgentChatWindowRangeControllerInput): UseAgentChatWindowRangeControllerResult {
  const initialWindow = createBottomAnchoredWindow(rowCount);
  const [windowRange, setWindowRange] = useState<WindowRange>(() => initialWindow);
  const prevSessionIdRef = useRef<string | null>(null);
  const prevIsSessionViewLoadingRef = useRef(isSessionViewLoading);
  const prevRowCountRef = useRef(rowCount);

  const releaseWindowUpdateLock = useCallback(() => {
    isUpdatingRef.current = true;
    globalThis.requestAnimationFrame(() => {
      isUpdatingRef.current = false;
    });
  }, [isUpdatingRef]);

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
      if (isPinnedToBottomRef.current) {
        const nextWindow = createBottomAnchoredWindow(rowCount);
        setWindowRange(nextWindow);
        setBottomAnchoredState(nextWindow.start);
        return;
      }
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
      releaseWindowUpdateLock();
      return nextRange;
    });
  }, [
    isUpdatingRef,
    messagesContainerRef,
    prevScrollHeightRef,
    releaseWindowUpdateLock,
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

      if (nextRange.end === rowCount - 1) {
        setBottomAnchoredState(nextRange.start);
      }
      releaseWindowUpdateLock();
      return nextRange;
    });
  }, [isUpdatingRef, releaseWindowUpdateLock, rowCount, suppressSentinelsRef]);

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

  return {
    windowRange,
    scrollToBottom,
    scrollToTop,
    shiftWindowUp,
    shiftWindowDown,
  };
}

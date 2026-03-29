import type { MutableRefObject } from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { AgentChatWindowRow } from "./agent-chat-thread-windowing";
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
  rows: AgentChatWindowRow[];
  rowCount: number;
  activeSessionId: string | null;
  isSessionViewLoading: boolean;
  isSessionWorking: boolean;
  isPinnedToBottomRef: MutableRefObject<boolean>;
  shouldAutoFollowLiveUpdatesRef: MutableRefObject<boolean>;
  suppressSentinelsRef: MutableRefObject<boolean>;
  isUpdatingRef: MutableRefObject<boolean>;
  hasPendingScrollRequest: () => boolean;
  captureScrollAnchor: (rowKey: string) => void;
  captureViewportAnchor: (options?: { allowedRowKeys?: ReadonlySet<string> }) => boolean;
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
  rows,
  rowCount,
  activeSessionId,
  isSessionViewLoading,
  isSessionWorking,
  isPinnedToBottomRef,
  shouldAutoFollowLiveUpdatesRef,
  suppressSentinelsRef,
  isUpdatingRef,
  hasPendingScrollRequest,
  captureScrollAnchor,
  captureViewportAnchor,
  requestWindowScroll,
  setBottomAnchoredState,
  setTopAnchoredState,
}: UseAgentChatWindowRangeControllerInput): UseAgentChatWindowRangeControllerResult {
  const initialWindow = createBottomAnchoredWindow(rowCount);
  const [windowRange, setWindowRange] = useState<WindowRange>(() => initialWindow);
  const windowRangeRef = useRef(initialWindow);
  const prevSessionIdRef = useRef<string | null>(null);
  const prevIsSessionViewLoadingRef = useRef(isSessionViewLoading);
  const prevRowCountRef = useRef(rowCount);
  const sentinelUnlockFrameRef = useRef<number | null>(null);

  const setWindowRangeState = useCallback((nextRange: WindowRange) => {
    windowRangeRef.current = nextRange;
    setWindowRange(nextRange);
  }, []);

  const releaseWindowUpdateLock = useCallback(() => {
    isUpdatingRef.current = true;
    globalThis.requestAnimationFrame(() => {
      isUpdatingRef.current = false;
    });
  }, [isUpdatingRef]);

  const suppressSentinelsForWindowShift = useCallback(() => {
    suppressSentinelsRef.current = true;
    if (sentinelUnlockFrameRef.current !== null) {
      globalThis.cancelAnimationFrame(sentinelUnlockFrameRef.current);
    }
    sentinelUnlockFrameRef.current = globalThis.requestAnimationFrame(() => {
      suppressSentinelsRef.current = false;
      sentinelUnlockFrameRef.current = null;
    });
  }, [suppressSentinelsRef]);

  const applyBottomAnchoredWindow = useCallback(() => {
    const nextWindow = createBottomAnchoredWindow(rowCount);
    setWindowRangeState(nextWindow);
    setBottomAnchoredState(nextWindow.start);
  }, [rowCount, setBottomAnchoredState, setWindowRangeState]);

  useEffect(() => {
    windowRangeRef.current = windowRange;
  }, [windowRange]);

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
      setWindowRangeState(EMPTY_WINDOW);
      setBottomAnchoredState(0);
      return;
    }

    if (rowCount < previousRowCount) {
      if (isPinnedToBottomRef.current) {
        const nextWindow = createBottomAnchoredWindow(rowCount);
        setWindowRangeState(nextWindow);
        setBottomAnchoredState(nextWindow.start);
        return;
      }
      setWindowRangeState(clampWindowRange(windowRangeRef.current, rowCount));
      return;
    }

    if (rowCount === previousRowCount || !isPinnedToBottomRef.current) {
      return;
    }

    if (isSessionWorking && !shouldAutoFollowLiveUpdatesRef.current) {
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
    isSessionWorking,
    isPinnedToBottomRef,
    requestWindowScroll,
    rowCount,
    setBottomAnchoredState,
    setWindowRangeState,
    shouldAutoFollowLiveUpdatesRef,
  ]);

  const shiftWindowUp = useCallback(() => {
    if (isUpdatingRef.current || rowCount === 0 || suppressSentinelsRef.current) {
      return;
    }

    const current = windowRangeRef.current;
    if (current.start <= 0) {
      return;
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
      return;
    }

    const capturedViewportAnchor = captureViewportAnchor();
    if (!capturedViewportAnchor) {
      const anchorRow = rows[current.start];
      if (anchorRow) {
        captureScrollAnchor(anchorRow.key);
      }
    }
    suppressSentinelsForWindowShift();
    releaseWindowUpdateLock();
    setWindowRangeState(nextRange);
  }, [
    captureScrollAnchor,
    captureViewportAnchor,
    isUpdatingRef,
    releaseWindowUpdateLock,
    rowCount,
    setWindowRangeState,
    suppressSentinelsForWindowShift,
    suppressSentinelsRef,
    rows,
  ]);

  const shiftWindowDown = useCallback(() => {
    if (isUpdatingRef.current || rowCount === 0 || suppressSentinelsRef.current) {
      return;
    }

    const current = windowRangeRef.current;
    if (current.end >= rowCount - 1) {
      return;
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
      return;
    }

    const reachedBottom = nextRange.end === rowCount - 1;
    if (!reachedBottom) {
      const survivingRowKeys = new Set(
        rows.slice(nextRange.start, current.end + 1).map((row) => row.key),
      );
      const capturedViewportAnchor = captureViewportAnchor({ allowedRowKeys: survivingRowKeys });
      if (!capturedViewportAnchor) {
        const anchorRow = rows[nextRange.start];
        if (anchorRow) {
          captureScrollAnchor(anchorRow.key);
        }
      }
    }
    suppressSentinelsForWindowShift();
    if (reachedBottom) {
      setBottomAnchoredState(nextRange.start);
      requestWindowScroll({
        target: "bottom",
        behavior: "auto",
        suppressSentinels: false,
      });
    }
    releaseWindowUpdateLock();
    setWindowRangeState(nextRange);
  }, [
    captureScrollAnchor,
    captureViewportAnchor,
    isUpdatingRef,
    releaseWindowUpdateLock,
    rowCount,
    requestWindowScroll,
    setBottomAnchoredState,
    setWindowRangeState,
    suppressSentinelsForWindowShift,
    suppressSentinelsRef,
    rows,
  ]);

  useEffect(() => {
    return () => {
      if (sentinelUnlockFrameRef.current !== null) {
        globalThis.cancelAnimationFrame(sentinelUnlockFrameRef.current);
      }
    };
  }, []);

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
    setWindowRangeState(nextRange);
    setTopAnchoredState();
    requestWindowScroll({
      target: "top",
      behavior: "auto",
      suppressSentinels: true,
    });
  }, [requestWindowScroll, rowCount, setTopAnchoredState, setWindowRangeState]);

  return {
    windowRange,
    scrollToBottom,
    scrollToTop,
    shiftWindowUp,
    shiftWindowDown,
  };
}

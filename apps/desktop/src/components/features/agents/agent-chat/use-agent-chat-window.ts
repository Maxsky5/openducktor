import type { RefCallback, RefObject } from "react";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { AgentChatWindowRow } from "./agent-chat-thread-windowing";
import { CHAT_OVERSCAN, CHAT_SHIFT_SIZE, CHAT_WINDOW_SIZE } from "./agent-chat-thread-windowing";

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

type WindowRange = {
  start: number;
  end: number;
};

type PendingScrollRequest = {
  target: "top" | "bottom";
  behavior: ScrollBehavior;
  suppressSentinels: boolean;
  animationDurationMs?: number;
};

const CHAT_AUTO_SCROLL_ANIMATION_DURATION_MS = 500;
const CHAT_SCROLL_EDGE_THRESHOLD_PX = 48;
const CHAT_SENTINEL_ROOT_MARGIN_PX = 200;
const CHAT_MAX_RENDERED_ROWS = CHAT_WINDOW_SIZE + CHAT_OVERSCAN * 2;
const EMPTY_WINDOW: WindowRange = { start: 0, end: -1 };

const clampWindowRange = (range: WindowRange, rowCount: number): WindowRange => {
  if (rowCount <= 0) {
    return EMPTY_WINDOW;
  }

  const maxIndex = rowCount - 1;
  const end = Math.max(0, Math.min(range.end, maxIndex));
  const start = Math.max(0, Math.min(range.start, end));
  return { start, end };
};

const createBottomAnchoredWindow = (rowCount: number): WindowRange => {
  if (rowCount <= 0) {
    return EMPTY_WINDOW;
  }

  return clampWindowRange(
    {
      start: Math.max(0, rowCount - CHAT_WINDOW_SIZE - CHAT_OVERSCAN),
      end: rowCount - 1,
    },
    rowCount,
  );
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
  const [isNearBottom, setIsNearBottom] = useState(true);
  const [isNearTop, setIsNearTop] = useState(initialWindow.start === 0);
  const [isAutoFollowingToBottom, setIsAutoFollowingToBottom] = useState(false);
  const topObserverRef = useRef<IntersectionObserver | null>(null);
  const bottomObserverRef = useRef<IntersectionObserver | null>(null);
  const isUpdatingRef = useRef(false);
  const prevScrollHeightRef = useRef<number | null>(null);
  const shouldCompensateScrollRef = useRef(false);
  const prevSessionIdRef = useRef<string | null>(activeSessionId);
  const prevIsSessionViewLoadingRef = useRef(isSessionViewLoading);
  const prevRowCountRef = useRef(rowCount);
  const isPinnedToBottomRef = useRef(true);
  const pendingScrollRequestRef = useRef<PendingScrollRequest | null>(null);
  const suppressSentinelsRef = useRef(false);
  const sentinelUnlockFrameRef = useRef<number | null>(null);
  const scrollAnimationFrameRef = useRef<number | null>(null);
  const scrollAnimationCleanupRef = useRef<(() => void) | null>(null);
  const isBottomAutoFollowAnimationRef = useRef(false);
  const contentResizeFrameRef = useRef<number | null>(null);
  const observedContentHeightRef = useRef<number | null>(null);
  const containerResizeFrameRef = useRef<number | null>(null);
  const observedContainerHeightRef = useRef<number | null>(null);

  const cancelScrollAnimation = useCallback((skipStateUpdate = false) => {
    if (scrollAnimationFrameRef.current !== null && typeof window !== "undefined") {
      window.cancelAnimationFrame(scrollAnimationFrameRef.current);
    }
    scrollAnimationFrameRef.current = null;

    scrollAnimationCleanupRef.current?.();
    scrollAnimationCleanupRef.current = null;

    const wasBottomAutoFollow = isBottomAutoFollowAnimationRef.current;
    isBottomAutoFollowAnimationRef.current = false;
    if (!skipStateUpdate && wasBottomAutoFollow) {
      setIsAutoFollowingToBottom(false);
    }
  }, []);

  const animateScrollTo = useCallback(
    (
      container: HTMLDivElement,
      resolveTargetTop: () => number,
      durationMs: number,
      trackBottomAutoFollow: boolean,
    ) => {
      cancelScrollAnimation();

      const initialTargetTop = resolveTargetTop();
      if (typeof window === "undefined") {
        container.scrollTop = initialTargetTop;
        return;
      }

      const startTop = container.scrollTop;
      const initialDelta = initialTargetTop - startTop;
      if (Math.abs(initialDelta) < 1 || durationMs <= 0) {
        container.scrollTop = initialTargetTop;
        return;
      }

      if (trackBottomAutoFollow) {
        isBottomAutoFollowAnimationRef.current = true;
        setIsAutoFollowingToBottom(true);
      }

      const handleUserInterrupt = () => {
        cancelScrollAnimation();
      };

      container.addEventListener("wheel", handleUserInterrupt, { passive: true });
      container.addEventListener("touchstart", handleUserInterrupt, { passive: true });
      container.addEventListener("pointerdown", handleUserInterrupt, { passive: true });
      scrollAnimationCleanupRef.current = () => {
        container.removeEventListener("wheel", handleUserInterrupt);
        container.removeEventListener("touchstart", handleUserInterrupt);
        container.removeEventListener("pointerdown", handleUserInterrupt);
      };

      let startTime: number | null = null;
      const step = (timestamp: number) => {
        if (startTime === null) {
          startTime = timestamp;
        }

        const elapsed = timestamp - startTime;
        const progress = Math.min(1, elapsed / durationMs);
        const currentTargetTop = resolveTargetTop();
        container.scrollTop = startTop + (currentTargetTop - startTop) * progress;

        if (progress >= 1) {
          container.scrollTop = resolveTargetTop();
          cancelScrollAnimation();
          return;
        }

        scrollAnimationFrameRef.current = window.requestAnimationFrame(step);
      };

      scrollAnimationFrameRef.current = window.requestAnimationFrame(step);
    },
    [cancelScrollAnimation],
  );

  const requestWindowScroll = useCallback(
    (request: PendingScrollRequest) => {
      cancelScrollAnimation();
      pendingScrollRequestRef.current = request;
      if (!request.suppressSentinels) {
        return;
      }

      suppressSentinelsRef.current = true;
      if (sentinelUnlockFrameRef.current !== null && typeof window !== "undefined") {
        window.cancelAnimationFrame(sentinelUnlockFrameRef.current);
        sentinelUnlockFrameRef.current = null;
      }
    },
    [cancelScrollAnimation],
  );

  const applyBottomAnchoredWindow = useCallback(() => {
    const nextWindow = createBottomAnchoredWindow(rowCount);
    setWindowRange(nextWindow);
    setIsNearBottom(true);
    setIsNearTop(nextWindow.start === 0);
    isPinnedToBottomRef.current = true;
  }, [rowCount]);

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
      setIsNearBottom(true);
      setIsNearTop(true);
      isPinnedToBottomRef.current = true;
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
    if (pendingScrollRequestRef.current) {
      return;
    }

    requestWindowScroll({
      target: "bottom",
      behavior: "auto",
      suppressSentinels: false,
      animationDurationMs: CHAT_AUTO_SCROLL_ANIMATION_DURATION_MS,
    });
  }, [applyBottomAnchoredWindow, requestWindowScroll, rowCount]);

  useLayoutEffect(() => {
    if (!shouldCompensateScrollRef.current) {
      return;
    }

    shouldCompensateScrollRef.current = false;
    const previousScrollHeight = prevScrollHeightRef.current;
    prevScrollHeightRef.current = null;
    const container = messagesContainerRef.current;
    if (!container || previousScrollHeight === null) {
      return;
    }

    const delta = container.scrollHeight - previousScrollHeight;
    if (delta > 0) {
      container.scrollTop += delta;
    }
  });

  useLayoutEffect(() => {
    const request = pendingScrollRequestRef.current;
    if (!request) {
      return;
    }

    pendingScrollRequestRef.current = null;
    const container = messagesContainerRef.current;
    if (!container) {
      cancelScrollAnimation();
      suppressSentinelsRef.current = false;
      return;
    }

    if (typeof request.animationDurationMs === "number") {
      animateScrollTo(
        container,
        () =>
          request.target === "bottom"
            ? Math.max(0, container.scrollHeight - container.clientHeight)
            : 0,
        request.animationDurationMs,
        request.target === "bottom",
      );
    } else {
      container.scrollTo({
        top: request.target === "bottom" ? container.scrollHeight : 0,
        behavior: request.behavior,
      });
    }

    if (!request.suppressSentinels) {
      return;
    }

    if (typeof window === "undefined") {
      suppressSentinelsRef.current = false;
      return;
    }

    sentinelUnlockFrameRef.current = window.requestAnimationFrame(() => {
      suppressSentinelsRef.current = false;
      sentinelUnlockFrameRef.current = null;
    });
  });

  useEffect(() => {
    const container = messagesContainerRef.current;
    const content = messagesContentRef.current;
    if (!container || !content) {
      observedContentHeightRef.current = null;
      return;
    }

    observedContentHeightRef.current = content.scrollHeight;
    if (typeof ResizeObserver === "undefined") {
      return;
    }

    const syncAfterResize = () => {
      contentResizeFrameRef.current = null;
      const nextContainer = messagesContainerRef.current;
      const nextContent = messagesContentRef.current;
      if (!nextContainer || !nextContent) {
        return;
      }

      const previousHeight = observedContentHeightRef.current;
      const nextHeight = nextContent.scrollHeight;
      observedContentHeightRef.current = nextHeight;
      if (previousHeight === null || previousHeight === nextHeight) {
        return;
      }

      if (pendingScrollRequestRef.current?.target === "bottom" || suppressSentinelsRef.current) {
        return;
      }

      if (isBottomAutoFollowAnimationRef.current) {
        setIsNearBottom(true);
        return;
      }

      if (!isPinnedToBottomRef.current) {
        return;
      }

      nextContainer.scrollTo({
        top: nextContainer.scrollHeight,
        behavior: "auto",
      });
      setIsNearBottom(true);
      setIsNearTop(false);
    };

    const scheduleResizeSync = () => {
      if (typeof window === "undefined") {
        syncAfterResize();
        return;
      }

      if (contentResizeFrameRef.current !== null) {
        return;
      }

      contentResizeFrameRef.current = window.requestAnimationFrame(() => {
        syncAfterResize();
      });
    };

    const observer = new ResizeObserver(() => {
      scheduleResizeSync();
    });
    observer.observe(content);

    return () => {
      observer.disconnect();
      if (contentResizeFrameRef.current !== null && typeof window !== "undefined") {
        window.cancelAnimationFrame(contentResizeFrameRef.current);
        contentResizeFrameRef.current = null;
      }
    };
  }, [messagesContainerRef, messagesContentRef]);

  useEffect(() => {
    const container = messagesContainerRef.current;
    if (!container) {
      observedContainerHeightRef.current = null;
      return;
    }

    observedContainerHeightRef.current = container.clientHeight;
    if (typeof ResizeObserver === "undefined") {
      return;
    }

    const syncAfterResize = () => {
      containerResizeFrameRef.current = null;
      const nextContainer = messagesContainerRef.current;
      if (!nextContainer) {
        return;
      }

      const previousHeight = observedContainerHeightRef.current;
      const nextHeight = nextContainer.clientHeight;
      observedContainerHeightRef.current = nextHeight;
      if (previousHeight === null || previousHeight === nextHeight) {
        return;
      }

      if (pendingScrollRequestRef.current?.target === "bottom" || suppressSentinelsRef.current) {
        return;
      }

      if (isBottomAutoFollowAnimationRef.current) {
        setIsNearBottom(true);
        return;
      }

      if (!isPinnedToBottomRef.current) {
        return;
      }

      nextContainer.scrollTo({
        top: nextContainer.scrollHeight,
        behavior: "auto",
      });
      setIsNearBottom(true);
      setIsNearTop(false);
    };

    const scheduleResizeSync = () => {
      if (typeof window === "undefined") {
        syncAfterResize();
        return;
      }

      if (containerResizeFrameRef.current !== null) {
        return;
      }

      containerResizeFrameRef.current = window.requestAnimationFrame(() => {
        syncAfterResize();
      });
    };

    const observer = new ResizeObserver(() => {
      scheduleResizeSync();
    });
    observer.observe(container);

    return () => {
      observer.disconnect();
      if (containerResizeFrameRef.current !== null && typeof window !== "undefined") {
        window.cancelAnimationFrame(containerResizeFrameRef.current);
        containerResizeFrameRef.current = null;
      }
    };
  }, [messagesContainerRef]);

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
  }, [messagesContainerRef, rowCount]);

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
  }, [rowCount]);

  const topSentinelRef = useCallback<RefCallback<HTMLDivElement>>(
    (element) => {
      topObserverRef.current?.disconnect();
      topObserverRef.current = null;
      if (!element || windowRange.start <= 0 || typeof IntersectionObserver === "undefined") {
        return;
      }

      const observer = new IntersectionObserver(
        (entries) => {
          const entry = entries[0];
          if (entry?.isIntersecting) {
            shiftWindowUp();
          }
        },
        {
          root: messagesContainerRef.current,
          rootMargin: `${CHAT_SENTINEL_ROOT_MARGIN_PX}px 0px 0px 0px`,
        },
      );
      observer.observe(element);
      topObserverRef.current = observer;
    },
    [messagesContainerRef, shiftWindowUp, windowRange.start],
  );

  const bottomSentinelRef = useCallback<RefCallback<HTMLDivElement>>(
    (element) => {
      bottomObserverRef.current?.disconnect();
      bottomObserverRef.current = null;
      if (
        !element ||
        windowRange.end >= rowCount - 1 ||
        typeof IntersectionObserver === "undefined"
      ) {
        return;
      }

      const observer = new IntersectionObserver(
        (entries) => {
          const entry = entries[0];
          if (entry?.isIntersecting) {
            shiftWindowDown();
          }
        },
        {
          root: messagesContainerRef.current,
          rootMargin: `0px 0px ${CHAT_SENTINEL_ROOT_MARGIN_PX}px 0px`,
        },
      );
      observer.observe(element);
      bottomObserverRef.current = observer;
    },
    [messagesContainerRef, rowCount, shiftWindowDown, windowRange.end],
  );

  useEffect(() => {
    const container = messagesContainerRef.current;
    if (!container) {
      return;
    }

    const handleScroll = () => {
      const nearBottom =
        container.scrollHeight - container.scrollTop - container.clientHeight <=
        CHAT_SCROLL_EDGE_THRESHOLD_PX;
      const nearTop = container.scrollTop <= CHAT_SCROLL_EDGE_THRESHOLD_PX;
      setIsNearBottom(nearBottom);
      setIsNearTop(nearTop && windowRange.start === 0);
      isPinnedToBottomRef.current = nearBottom;
    };

    handleScroll();
    container.addEventListener("scroll", handleScroll, { passive: true });
    return () => {
      container.removeEventListener("scroll", handleScroll);
    };
  }, [messagesContainerRef, windowRange.start]);

  const scrollToBottom = useCallback(() => {
    applyBottomAnchoredWindow();
    setIsNearBottom(true);
    setIsNearTop(false);
    isPinnedToBottomRef.current = true;
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
    isPinnedToBottomRef.current = false;
    setIsNearBottom(false);
    setIsNearTop(true);
    requestWindowScroll({
      target: "top",
      behavior: "auto",
      suppressSentinels: true,
    });
  }, [requestWindowScroll, rowCount]);

  useEffect(() => {
    return () => {
      if (sentinelUnlockFrameRef.current !== null && typeof window !== "undefined") {
        window.cancelAnimationFrame(sentinelUnlockFrameRef.current);
      }
      if (contentResizeFrameRef.current !== null && typeof window !== "undefined") {
        window.cancelAnimationFrame(contentResizeFrameRef.current);
      }
      if (containerResizeFrameRef.current !== null && typeof window !== "undefined") {
        window.cancelAnimationFrame(containerResizeFrameRef.current);
      }
      cancelScrollAnimation(true);
      topObserverRef.current?.disconnect();
      bottomObserverRef.current?.disconnect();
    };
  }, [cancelScrollAnimation]);

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
    isNearTop,
    isAutoFollowingToBottom,
    topSentinelRef,
    bottomSentinelRef,
    scrollToBottom,
    scrollToTop,
  };
}

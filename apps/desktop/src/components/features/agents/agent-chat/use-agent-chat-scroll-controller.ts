import type { MutableRefObject, RefObject } from "react";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  CHAT_SCROLL_EDGE_THRESHOLD_PX,
  type PendingScrollRequest,
  type WindowRange,
} from "./agent-chat-window-shared";

type UseAgentChatScrollControllerInput = {
  messagesContainerRef: RefObject<HTMLDivElement | null>;
  initialWindow: WindowRange;
};

type UseAgentChatScrollControllerResult = {
  isNearBottom: boolean;
  isNearTop: boolean;
  isAutoFollowingToBottom: boolean;
  isPinnedToBottomRef: MutableRefObject<boolean>;
  suppressSentinelsRef: MutableRefObject<boolean>;
  isUpdatingRef: MutableRefObject<boolean>;
  hasPendingScrollRequest: () => boolean;
  captureScrollAnchor: (rowKey: string) => void;
  syncBottomIfPinned: () => void;
  scrollToBottomOnSend: () => void;
  requestWindowScroll: (request: PendingScrollRequest) => void;
  applyPendingScrollRequest: () => void;
  setBottomAnchoredState: (windowStart: number) => void;
  setTopAnchoredState: () => void;
};

export function useAgentChatScrollController({
  messagesContainerRef,
  initialWindow,
}: UseAgentChatScrollControllerInput): UseAgentChatScrollControllerResult {
  const [isNearBottom, setIsNearBottom] = useState(true);
  const [isNearTop, setIsNearTop] = useState(initialWindow.start === 0);
  const [isAutoFollowingToBottom, setIsAutoFollowingToBottom] = useState(false);
  const isPinnedToBottomRef = useRef(true);
  const pendingScrollRequestRef = useRef<PendingScrollRequest | null>(null);
  const suppressSentinelsRef = useRef(false);
  const sentinelUnlockFrameRef = useRef<number | null>(null);
  const scrollAnimationFrameRef = useRef<number | null>(null);
  const scrollAnimationCleanupRef = useRef<(() => void) | null>(null);
  const isBottomAutoFollowAnimationRef = useRef(false);
  const isUpdatingRef = useRef(false);
  const lastScrollTopRef = useRef<number | null>(null);
  const pendingScrollAnchorRef = useRef<{ rowKey: string; topOffset: number } | null>(null);

  const getRowElementByKey = useCallback(
    (container: HTMLDivElement, rowKey: string): HTMLElement | null => {
      if (typeof container.querySelectorAll !== "function") {
        return null;
      }

      const rowElements = container.querySelectorAll<HTMLElement>("[data-row-key]");
      for (const rowElement of rowElements) {
        if (rowElement.dataset.rowKey === rowKey) {
          return rowElement;
        }
      }

      return null;
    },
    [],
  );

  const captureScrollAnchor = useCallback(
    (rowKey: string) => {
      const container = messagesContainerRef.current;
      if (!container || typeof container.getBoundingClientRect !== "function") {
        pendingScrollAnchorRef.current = null;
        return;
      }

      const rowElement = getRowElementByKey(container, rowKey);
      if (!rowElement || typeof rowElement.getBoundingClientRect !== "function") {
        pendingScrollAnchorRef.current = null;
        return;
      }

      const containerTop = container.getBoundingClientRect().top;
      const rowTop = rowElement.getBoundingClientRect().top;
      pendingScrollAnchorRef.current = {
        rowKey,
        topOffset: rowTop - containerTop,
      };
    },
    [getRowElementByKey, messagesContainerRef],
  );

  const cancelScrollAnimation = useCallback((skipStateUpdate = false) => {
    if (scrollAnimationFrameRef.current !== null) {
      globalThis.cancelAnimationFrame(scrollAnimationFrameRef.current);
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

        scrollAnimationFrameRef.current = globalThis.requestAnimationFrame(step);
      };

      scrollAnimationFrameRef.current = globalThis.requestAnimationFrame(step);
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
      if (sentinelUnlockFrameRef.current !== null) {
        globalThis.cancelAnimationFrame(sentinelUnlockFrameRef.current);
        sentinelUnlockFrameRef.current = null;
      }
    },
    [cancelScrollAnimation],
  );

  const applyPendingScrollRequest = useCallback(() => {
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

    sentinelUnlockFrameRef.current = globalThis.requestAnimationFrame(() => {
      suppressSentinelsRef.current = false;
      sentinelUnlockFrameRef.current = null;
    });
  }, [animateScrollTo, cancelScrollAnimation, messagesContainerRef]);

  const syncBottomIfPinned = useCallback(() => {
    const container = messagesContainerRef.current;
    if (!container) {
      return;
    }

    if (pendingScrollRequestRef.current?.target === "bottom" || suppressSentinelsRef.current) {
      return;
    }

    if (isUpdatingRef.current && !isPinnedToBottomRef.current) {
      return;
    }

    if (isBottomAutoFollowAnimationRef.current) {
      setIsNearBottom(true);
      return;
    }

    const distanceFromBottom =
      container.scrollHeight - container.scrollTop - container.clientHeight;
    const isWithinBottomThreshold = distanceFromBottom <= CHAT_SCROLL_EDGE_THRESHOLD_PX;
    if (!isPinnedToBottomRef.current && !isWithinBottomThreshold) {
      return;
    }

    container.scrollTo({
      top: container.scrollHeight,
      behavior: "auto",
    });
    isPinnedToBottomRef.current = true;
    setIsNearBottom(true);
    setIsNearTop(false);
  }, [messagesContainerRef]);

  const setBottomAnchoredState = useCallback((windowStart: number) => {
    setIsNearBottom(true);
    setIsNearTop(windowStart === 0);
    isPinnedToBottomRef.current = true;
  }, []);

  const setTopAnchoredState = useCallback(() => {
    isPinnedToBottomRef.current = false;
    setIsNearBottom(false);
    setIsNearTop(true);
  }, []);

  /**
   * Immediately scrolls the messages container to the bottom when the user sends a message.
   * Cancels any in-flight auto-follow animation to prevent the animation from overriding
   * the instant scroll position.
   */
  const scrollToBottomOnSend = useCallback(() => {
    const container = messagesContainerRef.current;
    if (!container) return;
    cancelScrollAnimation(true);
    container.scrollTo({
      top: container.scrollHeight,
      behavior: "instant",
    });
  }, [cancelScrollAnimation, messagesContainerRef]);

  // Intentionally runs after every render so a pending anchor captured in refs
  // is applied on the next commit regardless of which state update caused it.
  useLayoutEffect(() => {
    const pendingScrollAnchor = pendingScrollAnchorRef.current;
    if (!pendingScrollAnchor) {
      return;
    }

    pendingScrollAnchorRef.current = null;
    const container = messagesContainerRef.current;
    if (!container || typeof container.getBoundingClientRect !== "function") {
      return;
    }

    const rowElement = getRowElementByKey(container, pendingScrollAnchor.rowKey);
    if (!rowElement || typeof rowElement.getBoundingClientRect !== "function") {
      return;
    }

    const containerTop = container.getBoundingClientRect().top;
    const nextTopOffset = rowElement.getBoundingClientRect().top - containerTop;
    const delta = nextTopOffset - pendingScrollAnchor.topOffset;
    if (Math.abs(delta) >= 1) {
      container.scrollTop += delta;
    }
  });

  useEffect(() => {
    const container = messagesContainerRef.current;
    if (!container) {
      return;
    }

    const handleScroll = () => {
      const previousScrollTop = lastScrollTopRef.current;
      const nextScrollTop = container.scrollTop;
      lastScrollTopRef.current = nextScrollTop;
      const didScrollTopChange =
        previousScrollTop !== null && Math.abs(nextScrollTop - previousScrollTop) > 0.5;
      const nearBottom =
        container.scrollHeight - nextScrollTop - container.clientHeight <=
        CHAT_SCROLL_EDGE_THRESHOLD_PX;
      const nearTop = nextScrollTop <= CHAT_SCROLL_EDGE_THRESHOLD_PX;

      const shouldPreservePinnedState =
        isPinnedToBottomRef.current && !didScrollTopChange && !nearBottom;

      const isEffectivelyPinned =
        isBottomAutoFollowAnimationRef.current || nearBottom || shouldPreservePinnedState;

      setIsNearBottom(isEffectivelyPinned);
      setIsNearTop(nearTop);
      isPinnedToBottomRef.current = isEffectivelyPinned;
    };

    handleScroll();
    container.addEventListener("scroll", handleScroll, { passive: true });
    return () => {
      container.removeEventListener("scroll", handleScroll);
    };
  }, [messagesContainerRef]);

  useEffect(() => {
    return () => {
      if (sentinelUnlockFrameRef.current !== null) {
        globalThis.cancelAnimationFrame(sentinelUnlockFrameRef.current);
      }
      cancelScrollAnimation(true);
    };
  }, [cancelScrollAnimation]);

  return {
    isNearBottom,
    isNearTop,
    isAutoFollowingToBottom,
    isPinnedToBottomRef,
    suppressSentinelsRef,
    isUpdatingRef,
    hasPendingScrollRequest: () => pendingScrollRequestRef.current !== null,
    captureScrollAnchor,
    syncBottomIfPinned,
    scrollToBottomOnSend,
    requestWindowScroll,
    applyPendingScrollRequest,
    setBottomAnchoredState,
    setTopAnchoredState,
  };
}

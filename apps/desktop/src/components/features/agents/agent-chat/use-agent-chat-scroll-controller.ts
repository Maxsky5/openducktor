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
  prevScrollHeightRef: MutableRefObject<number | null>;
  shouldCompensateScrollRef: MutableRefObject<boolean>;
  isUpdatingRef: MutableRefObject<boolean>;
  hasPendingScrollRequest: () => boolean;
  syncBottomIfPinned: () => void;
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
  const prevScrollHeightRef = useRef<number | null>(null);
  const shouldCompensateScrollRef = useRef(false);
  const isUpdatingRef = useRef(false);

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

    if (typeof window === "undefined") {
      suppressSentinelsRef.current = false;
      return;
    }

    sentinelUnlockFrameRef.current = window.requestAnimationFrame(() => {
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

    if (isBottomAutoFollowAnimationRef.current) {
      setIsNearBottom(true);
      return;
    }

    if (!isPinnedToBottomRef.current) {
      return;
    }

    container.scrollTo({
      top: container.scrollHeight,
      behavior: "auto",
    });
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

      const isEffectivelyPinned = isBottomAutoFollowAnimationRef.current || nearBottom;

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
      if (sentinelUnlockFrameRef.current !== null && typeof window !== "undefined") {
        window.cancelAnimationFrame(sentinelUnlockFrameRef.current);
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
    prevScrollHeightRef,
    shouldCompensateScrollRef,
    isUpdatingRef,
    hasPendingScrollRequest: () => pendingScrollRequestRef.current !== null,
    syncBottomIfPinned,
    requestWindowScroll,
    applyPendingScrollRequest,
    setBottomAnchoredState,
    setTopAnchoredState,
  };
}

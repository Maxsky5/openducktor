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
  userScrolledRef: MutableRefObject<boolean>;
  userScrollIntentVersionRef: MutableRefObject<number>;
  isPinnedToBottomRef: MutableRefObject<boolean>;
  suppressSentinelsRef: MutableRefObject<boolean>;
  isUpdatingRef: MutableRefObject<boolean>;
  hasPendingScrollRequest: () => boolean;
  captureScrollAnchor: (rowKey: string) => void;
  syncBottomIfPinned: (options?: { forcePinned?: boolean }) => void;
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
  const isPinnedToBottomRef = useRef(true);
  const userScrolledRef = useRef(false);
  const userScrollIntentVersionRef = useRef(0);
  const pendingScrollRequestRef = useRef<PendingScrollRequest | null>(null);
  const suppressSentinelsRef = useRef(false);
  const sentinelUnlockFrameRef = useRef<number | null>(null);
  const scrollAnimationFrameRef = useRef<number | null>(null);
  const scrollAnimationCleanupRef = useRef<(() => void) | null>(null);
  const isBottomAutoFollowAnimationRef = useRef(false);
  const isUpdatingRef = useRef(false);
  const lastScrollTopRef = useRef<number | null>(null);
  const pendingScrollAnchorRef = useRef<{ rowKey: string; topOffset: number } | null>(null);

  const syncUserScrolled = useCallback((isPinnedToBottom: boolean) => {
    userScrolledRef.current = !isPinnedToBottom;
  }, []);

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

  const cancelScrollAnimation = useCallback(() => {
    if (scrollAnimationFrameRef.current !== null) {
      globalThis.cancelAnimationFrame(scrollAnimationFrameRef.current);
    }
    scrollAnimationFrameRef.current = null;

    scrollAnimationCleanupRef.current?.();
    scrollAnimationCleanupRef.current = null;
    isBottomAutoFollowAnimationRef.current = false;
  }, []);

  const animateScrollTo = useCallback(
    (container: HTMLDivElement, resolveTargetTop: () => number, durationMs: number) => {
      cancelScrollAnimation();

      const initialTargetTop = resolveTargetTop();
      const startTop = container.scrollTop;
      const initialDelta = initialTargetTop - startTop;
      if (Math.abs(initialDelta) < 1 || durationMs <= 0) {
        container.scrollTop = initialTargetTop;
        return;
      }

      isBottomAutoFollowAnimationRef.current = true;

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

  const syncBottomIfPinned = useCallback(
    (options?: { forcePinned?: boolean }) => {
      const container = messagesContainerRef.current;
      if (!container) {
        return;
      }
      const forcePinned = options?.forcePinned === true;

      if (pendingScrollRequestRef.current?.target === "bottom" || suppressSentinelsRef.current) {
        return;
      }

      if (isUpdatingRef.current && !isPinnedToBottomRef.current && !forcePinned) {
        return;
      }

      if (isBottomAutoFollowAnimationRef.current) {
        setIsNearBottom(true);
        syncUserScrolled(true);
        return;
      }

      const distanceFromBottom =
        container.scrollHeight - container.scrollTop - container.clientHeight;
      const isWithinBottomThreshold = distanceFromBottom <= CHAT_SCROLL_EDGE_THRESHOLD_PX;
      if (!forcePinned && !isPinnedToBottomRef.current && !isWithinBottomThreshold) {
        return;
      }

      container.scrollTo({
        top: container.scrollHeight,
        behavior: "auto",
      });
      isPinnedToBottomRef.current = true;
      syncUserScrolled(true);
      setIsNearBottom(true);
      setIsNearTop(false);
    },
    [messagesContainerRef, syncUserScrolled],
  );

  const setBottomAnchoredState = useCallback(
    (windowStart: number) => {
      setIsNearBottom(true);
      setIsNearTop(windowStart === 0);
      isPinnedToBottomRef.current = true;
      syncUserScrolled(true);
    },
    [syncUserScrolled],
  );

  const setTopAnchoredState = useCallback(() => {
    isPinnedToBottomRef.current = false;
    syncUserScrolled(false);
    setIsNearBottom(false);
    setIsNearTop(true);
  }, [syncUserScrolled]);

  const scrollToBottomOnSend = useCallback(() => {
    const container = messagesContainerRef.current;
    if (!container) {
      return;
    }

    cancelScrollAnimation();
    container.scrollTo({
      top: container.scrollHeight,
      behavior: "instant",
    });
    isPinnedToBottomRef.current = true;
    syncUserScrolled(true);
  }, [cancelScrollAnimation, messagesContainerRef, syncUserScrolled]);

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

    const registerUserScrollIntent = () => {
      userScrollIntentVersionRef.current += 1;
    };

    const handleWheel = (event: WheelEvent) => {
      registerUserScrollIntent();
      if (event.deltaY >= 0) {
        return;
      }

      const target = event.target instanceof Element ? event.target : undefined;
      const nestedScrollable = target?.closest("[data-scrollable]");
      if (nestedScrollable && nestedScrollable !== container) {
        return;
      }

      if (container.scrollHeight - container.clientHeight > 1) {
        isPinnedToBottomRef.current = false;
        syncUserScrolled(false);
      }
    };

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
        previousScrollTop !== null &&
        isPinnedToBottomRef.current &&
        !didScrollTopChange &&
        !nearBottom;

      const isEffectivelyPinned =
        isBottomAutoFollowAnimationRef.current || nearBottom || shouldPreservePinnedState;

      setIsNearBottom(isEffectivelyPinned);
      setIsNearTop(nearTop);
      isPinnedToBottomRef.current = isEffectivelyPinned;
      syncUserScrolled(isEffectivelyPinned);
    };

    handleScroll();
    container.addEventListener("wheel", handleWheel, { passive: true });
    container.addEventListener("touchstart", registerUserScrollIntent, { passive: true });
    container.addEventListener("pointerdown", registerUserScrollIntent, { passive: true });
    container.addEventListener("scroll", handleScroll, { passive: true });
    return () => {
      container.removeEventListener("wheel", handleWheel);
      container.removeEventListener("touchstart", registerUserScrollIntent);
      container.removeEventListener("pointerdown", registerUserScrollIntent);
      container.removeEventListener("scroll", handleScroll);
    };
  }, [messagesContainerRef, syncUserScrolled]);

  useEffect(() => {
    const container = messagesContainerRef.current;
    if (!container) {
      return;
    }

    container.style.overflowAnchor = userScrolledRef.current ? "auto" : "none";
  }, [messagesContainerRef]);

  useEffect(() => {
    return () => {
      if (sentinelUnlockFrameRef.current !== null) {
        globalThis.cancelAnimationFrame(sentinelUnlockFrameRef.current);
      }
      cancelScrollAnimation();
    };
  }, [cancelScrollAnimation]);

  return {
    isNearBottom,
    isNearTop,
    userScrolledRef,
    userScrollIntentVersionRef,
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

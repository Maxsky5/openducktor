import type { MutableRefObject, RefObject } from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { CHAT_SCROLL_EDGE_THRESHOLD_PX } from "./agent-chat-window-shared";

type UseAgentChatScrollControllerInput = {
  messagesContainerRef: RefObject<HTMLDivElement | null>;
  messagesContentRef: RefObject<HTMLDivElement | null>;
  isSessionWorking: boolean;
};

type UseAgentChatScrollControllerResult = {
  isNearBottom: boolean;
  isNearTop: boolean;
  userScrolledRef: MutableRefObject<boolean>;
  userScrollIntentVersionRef: MutableRefObject<number>;
  forceScrollToBottom: () => void;
  refreshScrollState: () => void;
};

const AUTO_SCROLL_MARK_TTL_MS = 1500;

export function useAgentChatScrollController({
  messagesContainerRef,
  messagesContentRef,
  isSessionWorking,
}: UseAgentChatScrollControllerInput): UseAgentChatScrollControllerResult {
  const [userScrolled, setUserScrolled] = useState(false);

  const nearBottomRef = useRef(true);
  const nearTopRef = useRef(true);
  const [buttonState, setButtonState] = useState({ nearBottom: true, nearTop: true });

  const userScrolledRef = useRef(false);
  const userScrollIntentVersionRef = useRef(0);
  const autoScrollRef = useRef<{ time: number; top: number } | null>(null);
  const autoScrollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const updateNearEdges = useCallback((nearBottom: boolean, nearTop: boolean) => {
    const changed = nearBottomRef.current !== nearBottom || nearTopRef.current !== nearTop;
    nearBottomRef.current = nearBottom;
    nearTopRef.current = nearTop;
    if (changed) {
      setButtonState({ nearBottom, nearTop });
    }
  }, []);

  const setUserScrolledState = useCallback((nextValue: boolean) => {
    userScrolledRef.current = nextValue;
    setUserScrolled(nextValue);
  }, []);

  const canScroll = useCallback((element: HTMLDivElement) => {
    return element.scrollHeight - element.clientHeight > 1;
  }, []);

  const distanceFromBottom = useCallback((element: HTMLDivElement) => {
    return element.scrollHeight - element.clientHeight - element.scrollTop;
  }, []);

  const refreshScrollState = useCallback(() => {
    const container = messagesContainerRef.current;
    if (!container) {
      return;
    }

    const nearBottom =
      !canScroll(container) || distanceFromBottom(container) < CHAT_SCROLL_EDGE_THRESHOLD_PX;
    const nearTop = container.scrollTop <= CHAT_SCROLL_EDGE_THRESHOLD_PX;

    if (nearBottom && userScrolledRef.current) {
      setUserScrolledState(false);
      container.style.overflowAnchor = "none";
    }

    updateNearEdges(nearBottom, nearTop);
  }, [canScroll, distanceFromBottom, messagesContainerRef, setUserScrolledState, updateNearEdges]);

  const markAutoScroll = useCallback((element: HTMLDivElement) => {
    autoScrollRef.current = {
      time: Date.now(),
      top: Math.max(0, element.scrollHeight - element.clientHeight),
    };

    if (autoScrollTimerRef.current !== null) {
      clearTimeout(autoScrollTimerRef.current);
    }

    autoScrollTimerRef.current = setTimeout(() => {
      autoScrollRef.current = null;
      autoScrollTimerRef.current = null;
    }, AUTO_SCROLL_MARK_TTL_MS);
  }, []);

  const isAutoScrollEvent = useCallback((element: HTMLDivElement) => {
    const autoScroll = autoScrollRef.current;
    if (!autoScroll) {
      return false;
    }

    if (Date.now() - autoScroll.time > AUTO_SCROLL_MARK_TTL_MS) {
      autoScrollRef.current = null;
      return false;
    }

    return Math.abs(element.scrollTop - autoScroll.top) < 2;
  }, []);

  const scrollToBottomNow = useCallback(
    (force: boolean) => {
      const container = messagesContainerRef.current;
      if (!container) {
        return;
      }

      if (!force && userScrolledRef.current) {
        return;
      }

      if (force && userScrolledRef.current) {
        setUserScrolledState(false);
      }

      const distance = distanceFromBottom(container);
      if (distance < 2) {
        markAutoScroll(container);
        updateNearEdges(true, container.scrollTop <= CHAT_SCROLL_EDGE_THRESHOLD_PX);
        return;
      }

      markAutoScroll(container);
      container.scrollTop = container.scrollHeight;
      updateNearEdges(true, false);
    },
    [
      distanceFromBottom,
      markAutoScroll,
      messagesContainerRef,
      setUserScrolledState,
      updateNearEdges,
    ],
  );

  const stopFollowing = useCallback(() => {
    const container = messagesContainerRef.current;
    if (!container) {
      return;
    }

    if (!canScroll(container) || userScrolledRef.current) {
      return;
    }

    userScrollIntentVersionRef.current += 1;
    setUserScrolledState(true);
  }, [canScroll, messagesContainerRef, setUserScrolledState]);

  useEffect(() => {
    const container = messagesContainerRef.current;
    if (!container) {
      return;
    }

    const updateOverflowAnchor = () => {
      container.style.overflowAnchor = userScrolledRef.current ? "auto" : "none";
    };

    const handleWheel = (event: WheelEvent) => {
      if (event.deltaY >= 0) {
        return;
      }

      userScrollIntentVersionRef.current += 1;

      const target = event.target instanceof Element ? event.target : undefined;
      const nestedScrollable = target?.closest("[data-scrollable]");
      if (nestedScrollable && nestedScrollable !== container) {
        return;
      }

      stopFollowing();
    };

    const handlePointerDown = () => {
      userScrollIntentVersionRef.current += 1;
    };

    const handleTouchStart = () => {
      userScrollIntentVersionRef.current += 1;
    };

    const handleScroll = () => {
      const nearBottom =
        !canScroll(container) || distanceFromBottom(container) < CHAT_SCROLL_EDGE_THRESHOLD_PX;
      const nearTop = container.scrollTop <= CHAT_SCROLL_EDGE_THRESHOLD_PX;

      updateNearEdges(nearBottom, nearTop);

      if (!canScroll(container)) {
        if (userScrolledRef.current) {
          setUserScrolledState(false);
          updateOverflowAnchor();
        }
        return;
      }

      if (nearBottom) {
        if (userScrolledRef.current) {
          setUserScrolledState(false);
          updateOverflowAnchor();
        }
        return;
      }

      if (!userScrolledRef.current && isAutoScrollEvent(container)) {
        scrollToBottomNow(false);
        return;
      }

      if (!userScrolledRef.current && userScrollIntentVersionRef.current === 0) {
        scrollToBottomNow(false);
        return;
      }

      if (!userScrolledRef.current) {
        setUserScrolledState(true);
        updateOverflowAnchor();
      }
    };

    updateOverflowAnchor();
    handleScroll();

    container.addEventListener("wheel", handleWheel, { passive: true });
    container.addEventListener("pointerdown", handlePointerDown, { passive: true });
    container.addEventListener("touchstart", handleTouchStart, { passive: true });
    container.addEventListener("scroll", handleScroll, { passive: true });

    return () => {
      container.removeEventListener("wheel", handleWheel);
      container.removeEventListener("pointerdown", handlePointerDown);
      container.removeEventListener("touchstart", handleTouchStart);
      container.removeEventListener("scroll", handleScroll);
    };
  }, [
    canScroll,
    distanceFromBottom,
    isAutoScrollEvent,
    messagesContainerRef,
    scrollToBottomNow,
    setUserScrolledState,
    stopFollowing,
    updateNearEdges,
  ]);

  useEffect(() => {
    const container = messagesContainerRef.current;
    if (!container) {
      return;
    }

    container.style.overflowAnchor = userScrolled ? "auto" : "none";
  }, [messagesContainerRef, userScrolled]);

  useEffect(() => {
    if (!isSessionWorking) {
      return;
    }

    if (!userScrolledRef.current) {
      scrollToBottomNow(true);
    }
  }, [isSessionWorking, scrollToBottomNow]);

  useEffect(() => {
    const content = messagesContentRef.current;
    if (!content || typeof ResizeObserver === "undefined") {
      return;
    }

    const observer = new ResizeObserver(() => {
      refreshScrollState();
      if (userScrolledRef.current) {
        return;
      }

      scrollToBottomNow(false);
    });
    observer.observe(content);

    return () => {
      observer.disconnect();
    };
  }, [messagesContentRef, refreshScrollState, scrollToBottomNow]);

  useEffect(() => {
    return () => {
      if (autoScrollTimerRef.current !== null) {
        clearTimeout(autoScrollTimerRef.current);
      }
    };
  }, []);

  return {
    isNearBottom: buttonState.nearBottom,
    isNearTop: buttonState.nearTop,
    userScrolledRef,
    userScrollIntentVersionRef,
    forceScrollToBottom: () => scrollToBottomNow(true),
    refreshScrollState,
  };
}

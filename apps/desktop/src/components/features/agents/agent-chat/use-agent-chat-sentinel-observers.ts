import type { MutableRefObject, RefCallback, RefObject } from "react";
import { useCallback, useEffect, useRef } from "react";
import { CHAT_SENTINEL_ROOT_MARGIN_PX } from "./agent-chat-window-shared";

type UseAgentChatSentinelObserversInput = {
  messagesContainerRef: RefObject<HTMLDivElement | null>;
  rowCount: number;
  windowStart: number;
  windowEnd: number;
  suppressSentinelsRef: MutableRefObject<boolean>;
  shiftWindowUp: () => void;
  shiftWindowDown: () => void;
};

type UseAgentChatSentinelObserversResult = {
  topSentinelRef: RefCallback<HTMLDivElement>;
  bottomSentinelRef: RefCallback<HTMLDivElement>;
};

export function useAgentChatSentinelObservers({
  messagesContainerRef,
  rowCount,
  windowStart,
  windowEnd,
  suppressSentinelsRef,
  shiftWindowUp,
  shiftWindowDown,
}: UseAgentChatSentinelObserversInput): UseAgentChatSentinelObserversResult {
  void suppressSentinelsRef;
  const topObserverRef = useRef<IntersectionObserver | null>(null);
  const bottomObserverRef = useRef<IntersectionObserver | null>(null);

  const topSentinelRef = useCallback<RefCallback<HTMLDivElement>>(
    (element) => {
      topObserverRef.current?.disconnect();
      topObserverRef.current = null;
      if (!element || windowStart <= 0 || typeof IntersectionObserver === "undefined") {
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
    [messagesContainerRef, shiftWindowUp, windowStart],
  );

  const bottomSentinelRef = useCallback<RefCallback<HTMLDivElement>>(
    (element) => {
      bottomObserverRef.current?.disconnect();
      bottomObserverRef.current = null;
      if (!element || windowEnd >= rowCount - 1 || typeof IntersectionObserver === "undefined") {
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
    [messagesContainerRef, rowCount, shiftWindowDown, windowEnd],
  );

  useEffect(() => {
    return () => {
      topObserverRef.current?.disconnect();
      bottomObserverRef.current?.disconnect();
    };
  }, []);

  return {
    topSentinelRef,
    bottomSentinelRef,
  };
}

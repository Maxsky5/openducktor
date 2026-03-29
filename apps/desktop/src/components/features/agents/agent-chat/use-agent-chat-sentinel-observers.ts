import type { MutableRefObject, RefCallback, RefObject } from "react";
import { useCallback, useEffect, useRef } from "react";
import { CHAT_SENTINEL_ROOT_MARGIN_PX } from "./agent-chat-window-shared";

type UseAgentChatSentinelObserversInput = {
  messagesContainerRef: RefObject<HTMLDivElement | null>;
  rowCount: number;
  windowStart: number;
  windowEnd: number;
  isUpdatingRef: MutableRefObject<boolean>;
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
  isUpdatingRef,
  suppressSentinelsRef,
  shiftWindowUp,
  shiftWindowDown,
}: UseAgentChatSentinelObserversInput): UseAgentChatSentinelObserversResult {
  const topObserverRef = useRef<IntersectionObserver | null>(null);
  const bottomObserverRef = useRef<IntersectionObserver | null>(null);
  const topShiftArmedRef = useRef(true);
  const bottomShiftArmedRef = useRef(true);

  const topSentinelRef = useCallback<RefCallback<HTMLDivElement>>(
    (element) => {
      topObserverRef.current?.disconnect();
      topObserverRef.current = null;
      if (!element || windowStart <= 0) {
        return;
      }

      const observer = new IntersectionObserver(
        (entries) => {
          const entry = entries[0];
          if (!entry) {
            return;
          }

          if (!entry.isIntersecting) {
            topShiftArmedRef.current = true;
            return;
          }

          if (suppressSentinelsRef.current || isUpdatingRef.current || !topShiftArmedRef.current) {
            return;
          }

          topShiftArmedRef.current = false;
          shiftWindowUp();
        },
        {
          root: messagesContainerRef.current,
          rootMargin: `${CHAT_SENTINEL_ROOT_MARGIN_PX}px 0px 0px 0px`,
        },
      );
      observer.observe(element);
      topObserverRef.current = observer;
    },
    [isUpdatingRef, messagesContainerRef, shiftWindowUp, suppressSentinelsRef, windowStart],
  );

  const bottomSentinelRef = useCallback<RefCallback<HTMLDivElement>>(
    (element) => {
      bottomObserverRef.current?.disconnect();
      bottomObserverRef.current = null;
      if (!element || windowEnd >= rowCount - 1) {
        return;
      }

      const observer = new IntersectionObserver(
        (entries) => {
          const entry = entries[0];
          if (!entry) {
            return;
          }

          if (!entry.isIntersecting) {
            bottomShiftArmedRef.current = true;
            return;
          }

          if (
            suppressSentinelsRef.current ||
            isUpdatingRef.current ||
            !bottomShiftArmedRef.current
          ) {
            return;
          }

          bottomShiftArmedRef.current = false;
          shiftWindowDown();
        },
        {
          root: messagesContainerRef.current,
          rootMargin: `0px 0px ${CHAT_SENTINEL_ROOT_MARGIN_PX}px 0px`,
        },
      );
      observer.observe(element);
      bottomObserverRef.current = observer;
    },
    [
      isUpdatingRef,
      messagesContainerRef,
      rowCount,
      shiftWindowDown,
      suppressSentinelsRef,
      windowEnd,
    ],
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

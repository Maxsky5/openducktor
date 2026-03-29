import type { MutableRefObject, RefObject } from "react";
import { useEffect } from "react";
import { CHAT_WINDOW_SHIFT_EDGE_THRESHOLD_PX } from "./agent-chat-window-shared";

type UseAgentChatScrollEdgeShiftsInput = {
  messagesContainerRef: RefObject<HTMLDivElement | null>;
  rowCount: number;
  windowStart: number;
  windowEnd: number;
  isHistoryNavigationRef: MutableRefObject<boolean>;
  isUpdatingRef: MutableRefObject<boolean>;
  suppressSentinelsRef: MutableRefObject<boolean>;
  shiftWindowUp: () => void;
  shiftWindowDown: () => void;
};

export function useAgentChatScrollEdgeShifts({
  messagesContainerRef,
  rowCount,
  windowStart,
  windowEnd,
  isHistoryNavigationRef,
  isUpdatingRef,
  suppressSentinelsRef,
  shiftWindowUp,
  shiftWindowDown,
}: UseAgentChatScrollEdgeShiftsInput): void {
  useEffect(() => {
    const container = messagesContainerRef.current;
    if (!container) {
      return;
    }

    const maybeShiftWindowForScrollEdge = () => {
      if (rowCount === 0 || isUpdatingRef.current || suppressSentinelsRef.current) {
        return;
      }

      if (windowStart > 0 && container.scrollTop <= CHAT_WINDOW_SHIFT_EDGE_THRESHOLD_PX) {
        shiftWindowUp();
        return;
      }

      const distanceFromBottom =
        container.scrollHeight - container.scrollTop - container.clientHeight;
      if (
        isHistoryNavigationRef.current &&
        windowEnd < rowCount - 1 &&
        distanceFromBottom <= CHAT_WINDOW_SHIFT_EDGE_THRESHOLD_PX
      ) {
        shiftWindowDown();
      }
    };

    container.addEventListener("scroll", maybeShiftWindowForScrollEdge, { passive: true });
    return () => {
      container.removeEventListener("scroll", maybeShiftWindowForScrollEdge);
    };
  }, [
    isHistoryNavigationRef,
    isUpdatingRef,
    messagesContainerRef,
    rowCount,
    shiftWindowDown,
    shiftWindowUp,
    suppressSentinelsRef,
    windowEnd,
    windowStart,
  ]);
}

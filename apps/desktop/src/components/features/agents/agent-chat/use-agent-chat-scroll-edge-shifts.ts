import type { MutableRefObject, RefObject } from "react";
import { useEffect } from "react";
import { CHAT_WINDOW_SHIFT_EDGE_THRESHOLD_PX } from "./agent-chat-window-shared";

type UseAgentChatScrollEdgeShiftsInput = {
  messagesContainerRef: RefObject<HTMLDivElement | null>;
  rowCount: number;
  windowStart: number;
  windowEnd: number;
  topSpacerHeight: number;
  renderedContentHeight: number;
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
  topSpacerHeight,
  renderedContentHeight,
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
      if (
        rowCount === 0 ||
        renderedContentHeight <= 0 ||
        isUpdatingRef.current ||
        suppressSentinelsRef.current
      ) {
        return;
      }

      const distanceFromRenderedTop = container.scrollTop - topSpacerHeight;
      if (windowStart > 0 && distanceFromRenderedTop <= CHAT_WINDOW_SHIFT_EDGE_THRESHOLD_PX) {
        shiftWindowUp();
        return;
      }

      const distanceFromRenderedBottom =
        topSpacerHeight + renderedContentHeight - (container.scrollTop + container.clientHeight);
      if (
        isHistoryNavigationRef.current &&
        windowEnd < rowCount - 1 &&
        distanceFromRenderedBottom <= CHAT_WINDOW_SHIFT_EDGE_THRESHOLD_PX
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
    renderedContentHeight,
    shiftWindowDown,
    shiftWindowUp,
    suppressSentinelsRef,
    topSpacerHeight,
    windowEnd,
    windowStart,
  ]);
}

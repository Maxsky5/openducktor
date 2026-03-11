import type { RefObject } from "react";
import { useCallback, useEffect, useRef } from "react";
import {
  CHAT_PROGRAMMATIC_AUTOSCROLL_DATASET,
  CHAT_PROGRAMMATIC_AUTOSCROLL_TIMEOUT_MS,
} from "./use-agent-chat-layout";
import type { AgentChatVirtualizer } from "./use-agent-chat-virtualization";

const CHAT_AUTOSCROLL_DURATION_MS = 500;
const CHAT_AUTOSCROLL_MIN_DELTA_PX = 0.1;
const CHAT_AUTOSCROLL_MIN_STEP_PX = 1;

type UseAgentChatAutoScrollInput = {
  activeSessionId: string | null;
  isPinnedToBottom: boolean;
  messagesContainerRef: RefObject<HTMLDivElement | null>;
  scrollVersion: string;
  shouldVirtualize: boolean;
  virtualRowsCount: number;
  virtualizer: AgentChatVirtualizer;
};

export function useAgentChatAutoScroll({
  activeSessionId,
  isPinnedToBottom,
  messagesContainerRef,
  scrollVersion,
  shouldVirtualize,
  virtualRowsCount,
  virtualizer,
}: UseAgentChatAutoScrollInput): void {
  const previousSessionIdRef = useRef<string | null>(null);
  const previousScrollVersionRef = useRef<string | null>(null);
  const autoscrollMarkerClearTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const smoothScrollStateRef = useRef<{
    initialDistancePx: number;
    lastTimestampMs: number | null;
    targetTop: number;
  } | null>(null);

  const markProgrammaticAutoScroll = useCallback((container: HTMLDivElement): void => {
    container.dataset[CHAT_PROGRAMMATIC_AUTOSCROLL_DATASET] = "true";
    if (autoscrollMarkerClearTimeoutRef.current !== null) {
      clearTimeout(autoscrollMarkerClearTimeoutRef.current);
    }
    autoscrollMarkerClearTimeoutRef.current = setTimeout(() => {
      delete container.dataset[CHAT_PROGRAMMATIC_AUTOSCROLL_DATASET];
      autoscrollMarkerClearTimeoutRef.current = null;
    }, CHAT_PROGRAMMATIC_AUTOSCROLL_TIMEOUT_MS);
  }, []);

  const scheduleScrollToBottom = useCallback(
    (behavior: ScrollBehavior, sessionChanged: boolean): void => {
      const container = messagesContainerRef.current;
      if (!container || typeof window === "undefined") {
        return;
      }

      const cancelPendingAnimation = (): void => {
        if (animationFrameRef.current !== null) {
          window.cancelAnimationFrame(animationFrameRef.current);
          animationFrameRef.current = null;
        }
        smoothScrollStateRef.current = null;
      };

      const resolveMaxScrollTop = (element: HTMLDivElement): number => {
        return Math.max(0, element.scrollHeight - element.clientHeight);
      };

      const applyScrollTop = (targetTop: number): void => {
        const maxScrollTop = resolveMaxScrollTop(container);
        const clampedTop = Math.min(Math.max(targetTop, 0), maxScrollTop);
        container.scrollTo({
          top: clampedTop,
          behavior: "auto",
        });
        container.scrollTop = clampedTop;
      };

      if (shouldVirtualize && virtualRowsCount > 0) {
        if (sessionChanged) {
          virtualizer.measure();
          virtualizer.scrollToIndex(virtualRowsCount - 1, {
            align: "end",
            behavior: "auto",
          });
        } else {
          virtualizer.measure();
        }
      }

      markProgrammaticAutoScroll(container);
      const targetTop = resolveMaxScrollTop(container);

      if (behavior === "auto") {
        cancelPendingAnimation();
        applyScrollTop(targetTop);
        return;
      }

      const currentDistance = Math.abs(targetTop - container.scrollTop);
      if (smoothScrollStateRef.current === null) {
        smoothScrollStateRef.current = {
          initialDistancePx: Math.max(currentDistance, CHAT_AUTOSCROLL_MIN_STEP_PX),
          lastTimestampMs: null,
          targetTop,
        };
      } else {
        smoothScrollStateRef.current = {
          initialDistancePx: Math.max(
            smoothScrollStateRef.current.initialDistancePx,
            currentDistance,
            CHAT_AUTOSCROLL_MIN_STEP_PX,
          ),
          lastTimestampMs: smoothScrollStateRef.current.lastTimestampMs,
          targetTop,
        };
      }

      if (animationFrameRef.current !== null) {
        return;
      }

      const step = (timestampMs: number): void => {
        const currentContainer = messagesContainerRef.current;
        const smoothScrollState = smoothScrollStateRef.current;
        if (!currentContainer || smoothScrollState === null) {
          animationFrameRef.current = null;
          return;
        }

        const liveTargetTop = resolveMaxScrollTop(currentContainer);
        smoothScrollState.targetTop = liveTargetTop;
        if (smoothScrollState.lastTimestampMs === null) {
          smoothScrollState.lastTimestampMs = timestampMs;
          animationFrameRef.current = window.requestAnimationFrame(step);
          return;
        }

        const elapsedMs = Math.max(0, timestampMs - smoothScrollState.lastTimestampMs);
        smoothScrollState.lastTimestampMs = timestampMs;
        const distance = smoothScrollState.targetTop - currentContainer.scrollTop;
        const direction = Math.sign(distance);
        const maxStepPx = Math.max(
          CHAT_AUTOSCROLL_MIN_STEP_PX,
          (smoothScrollState.initialDistancePx / CHAT_AUTOSCROLL_DURATION_MS) * elapsedMs,
        );
        const nextTop =
          currentContainer.scrollTop + direction * Math.min(Math.abs(distance), maxStepPx);
        applyScrollTop(nextTop);

        if (
          Math.abs(smoothScrollState.targetTop - currentContainer.scrollTop) <=
          CHAT_AUTOSCROLL_MIN_DELTA_PX
        ) {
          applyScrollTop(smoothScrollState.targetTop);
          smoothScrollStateRef.current = null;
          animationFrameRef.current = null;
          return;
        }

        animationFrameRef.current = window.requestAnimationFrame(step);
      };

      animationFrameRef.current = window.requestAnimationFrame(step);
    },
    [
      markProgrammaticAutoScroll,
      messagesContainerRef,
      shouldVirtualize,
      virtualRowsCount,
      virtualizer,
    ],
  );

  useEffect(() => {
    return () => {
      if (autoscrollMarkerClearTimeoutRef.current !== null) {
        clearTimeout(autoscrollMarkerClearTimeoutRef.current);
      }
      if (animationFrameRef.current !== null && typeof window !== "undefined") {
        window.cancelAnimationFrame(animationFrameRef.current);
      }
      smoothScrollStateRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!activeSessionId) {
      previousSessionIdRef.current = null;
      previousScrollVersionRef.current = null;
      smoothScrollStateRef.current = null;
      return;
    }

    const sessionChanged = previousSessionIdRef.current !== activeSessionId;
    previousSessionIdRef.current = activeSessionId;
    if (!sessionChanged) {
      return;
    }

    previousScrollVersionRef.current = scrollVersion;

    if (!isPinnedToBottom || virtualRowsCount === 0) {
      smoothScrollStateRef.current = null;
      return;
    }

    scheduleScrollToBottom(sessionChanged ? "auto" : "smooth", sessionChanged);
  }, [activeSessionId, isPinnedToBottom, scheduleScrollToBottom, scrollVersion, virtualRowsCount]);

  useEffect(() => {
    if (!activeSessionId || !isPinnedToBottom || virtualRowsCount === 0) {
      smoothScrollStateRef.current = null;
      return;
    }

    const previousScrollVersion = previousScrollVersionRef.current;
    previousScrollVersionRef.current = scrollVersion;
    if (previousScrollVersion === null || previousScrollVersion === scrollVersion) {
      return;
    }

    scheduleScrollToBottom("smooth", false);
  }, [activeSessionId, isPinnedToBottom, scheduleScrollToBottom, scrollVersion, virtualRowsCount]);
}

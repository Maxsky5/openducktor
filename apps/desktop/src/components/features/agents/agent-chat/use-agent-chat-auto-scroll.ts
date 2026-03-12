import type { RefObject } from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { CHAT_PROGRAMMATIC_AUTOSCROLL_DATASET } from "./use-agent-chat-layout";
import type { AgentChatVirtualizer } from "./use-agent-chat-virtualization";

const CHAT_AUTOSCROLL_DURATION_MS = 500;
const CHAT_AUTOSCROLL_MIN_DELTA_PX = 0.1;
const CHAT_AUTOSCROLL_MIN_STEP_PX = 1;
const CHAT_SESSION_JUMP_SETTLE_THRESHOLD_PX = 4;
const CHAT_SESSION_JUMP_MAX_SETTLE_FRAMES = 24;
const CHAT_SESSION_JUMP_STABLE_BOTTOM_FRAMES = 2;

type UseAgentChatAutoScrollInput = {
  activeSessionId: string | null;
  canScrollToLatest: boolean;
  isPinnedToBottom: boolean;
  messagesContainerRef: RefObject<HTMLDivElement | null>;
  scrollVersion: string;
  shouldVirtualize: boolean;
  virtualRowsCount: number;
  virtualizer: AgentChatVirtualizer;
};

export function useAgentChatAutoScroll({
  activeSessionId,
  canScrollToLatest,
  isPinnedToBottom,
  messagesContainerRef,
  scrollVersion,
  shouldVirtualize,
  virtualRowsCount,
  virtualizer,
}: UseAgentChatAutoScrollInput): { isJumpingToLatest: boolean } {
  const previousSessionIdRef = useRef<string | null>(null);
  const previousScrollVersionRef = useRef<string | null>(null);
  const pendingSessionJumpRef = useRef<string | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const sessionJumpCorrectionFrameRef = useRef<number | null>(null);
  const sessionJumpSettleFrameRef = useRef<number | null>(null);
  const sessionJumpStableFrameCountRef = useRef(0);
  const sessionJumpLastMaxScrollTopRef = useRef<number | null>(null);
  const [isJumpingToLatest, setIsJumpingToLatest] = useState(false);
  const smoothScrollStateRef = useRef<{
    initialDistancePx: number;
    lastTimestampMs: number | null;
    targetTop: number;
  } | null>(null);

  const markProgrammaticAutoScroll = useCallback(
    (container: HTMLDivElement, targetTop: number): void => {
      container.dataset[CHAT_PROGRAMMATIC_AUTOSCROLL_DATASET] = String(targetTop);
    },
    [],
  );

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
        if (sessionJumpCorrectionFrameRef.current !== null) {
          window.cancelAnimationFrame(sessionJumpCorrectionFrameRef.current);
          sessionJumpCorrectionFrameRef.current = null;
        }
        if (sessionJumpSettleFrameRef.current !== null) {
          window.cancelAnimationFrame(sessionJumpSettleFrameRef.current);
          sessionJumpSettleFrameRef.current = null;
        }
        sessionJumpStableFrameCountRef.current = 0;
        sessionJumpLastMaxScrollTopRef.current = null;
        smoothScrollStateRef.current = null;
        setIsJumpingToLatest(false);
      };

      const resolveMaxScrollTop = (element: HTMLDivElement): number => {
        return Math.max(0, element.scrollHeight - element.clientHeight);
      };

      const applyScrollTop = (targetTop: number): void => {
        const maxScrollTop = resolveMaxScrollTop(container);
        const clampedTop = Math.min(Math.max(targetTop, 0), maxScrollTop);
        markProgrammaticAutoScroll(container, clampedTop);
        container.scrollTo({
          top: clampedTop,
          behavior: "auto",
        });
        container.scrollTop = clampedTop;
      };

      if (shouldVirtualize && virtualRowsCount > 0) {
        virtualizer.measure();
      }

      const targetTop = resolveMaxScrollTop(container);

      if (behavior === "auto") {
        cancelPendingAnimation();
        if (sessionChanged) {
          setIsJumpingToLatest(true);
          const finishWhenBottomSettles = (remainingFrames: number): void => {
            const currentContainer = messagesContainerRef.current;
            if (!currentContainer) {
              sessionJumpSettleFrameRef.current = null;
              sessionJumpStableFrameCountRef.current = 0;
              sessionJumpLastMaxScrollTopRef.current = null;
              setIsJumpingToLatest(false);
              return;
            }

            if (shouldVirtualize && virtualRowsCount > 0) {
              virtualizer.measure();
            }
            const nextMaxScrollTop = resolveMaxScrollTop(currentContainer);
            applyScrollTop(nextMaxScrollTop);

            const remainingDistance = Math.abs(nextMaxScrollTop - currentContainer.scrollTop);
            const previousMaxScrollTop = sessionJumpLastMaxScrollTopRef.current;
            const maxScrollTopStable =
              previousMaxScrollTop !== null &&
              Math.abs(previousMaxScrollTop - nextMaxScrollTop) <=
                CHAT_SESSION_JUMP_SETTLE_THRESHOLD_PX;
            sessionJumpLastMaxScrollTopRef.current = nextMaxScrollTop;
            sessionJumpStableFrameCountRef.current =
              remainingDistance <= CHAT_SESSION_JUMP_SETTLE_THRESHOLD_PX && maxScrollTopStable
                ? sessionJumpStableFrameCountRef.current + 1
                : 0;
            if (
              sessionJumpStableFrameCountRef.current >= CHAT_SESSION_JUMP_STABLE_BOTTOM_FRAMES ||
              remainingFrames <= 0
            ) {
              applyScrollTop(resolveMaxScrollTop(currentContainer));
              sessionJumpSettleFrameRef.current = null;
              sessionJumpStableFrameCountRef.current = 0;
              sessionJumpLastMaxScrollTopRef.current = null;
              setIsJumpingToLatest(false);
              return;
            }

            sessionJumpSettleFrameRef.current = window.requestAnimationFrame(() => {
              finishWhenBottomSettles(remainingFrames - 1);
            });
          };
          const firstCorrectionFrame = window.requestAnimationFrame(() => {
            sessionJumpCorrectionFrameRef.current = window.requestAnimationFrame(() => {
              sessionJumpCorrectionFrameRef.current = null;
              finishWhenBottomSettles(CHAT_SESSION_JUMP_MAX_SETTLE_FRAMES);
            });
          });
          sessionJumpCorrectionFrameRef.current = firstCorrectionFrame;
          return;
        }
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

        const liveTargetTop = Math.max(
          0,
          currentContainer.scrollHeight - currentContainer.clientHeight,
        );
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
      if (animationFrameRef.current !== null && typeof window !== "undefined") {
        window.cancelAnimationFrame(animationFrameRef.current);
      }
      const container = messagesContainerRef.current;
      if (container) {
        delete container.dataset[CHAT_PROGRAMMATIC_AUTOSCROLL_DATASET];
      }
      if (sessionJumpCorrectionFrameRef.current !== null && typeof window !== "undefined") {
        window.cancelAnimationFrame(sessionJumpCorrectionFrameRef.current);
      }
      if (sessionJumpSettleFrameRef.current !== null && typeof window !== "undefined") {
        window.cancelAnimationFrame(sessionJumpSettleFrameRef.current);
      }
      sessionJumpStableFrameCountRef.current = 0;
      sessionJumpLastMaxScrollTopRef.current = null;
      smoothScrollStateRef.current = null;
      pendingSessionJumpRef.current = null;
    };
  }, [messagesContainerRef]);

  useEffect(() => {
    if (!activeSessionId) {
      previousSessionIdRef.current = null;
      previousScrollVersionRef.current = null;
      pendingSessionJumpRef.current = null;
      smoothScrollStateRef.current = null;
      setIsJumpingToLatest(false);
      return;
    }

    const previousSessionId = previousSessionIdRef.current;
    const firstSessionSelection = previousSessionId === null;
    const sessionChanged = previousSessionId !== null && previousSessionId !== activeSessionId;
    if (sessionChanged || firstSessionSelection) {
      previousSessionIdRef.current = activeSessionId;
      previousScrollVersionRef.current = scrollVersion;
      pendingSessionJumpRef.current = activeSessionId;
    }

    const shouldJumpForSessionSwitch = pendingSessionJumpRef.current === activeSessionId;
    if (!shouldJumpForSessionSwitch || virtualRowsCount === 0 || !canScrollToLatest) {
      return;
    }

    scheduleScrollToBottom("auto", true);
    pendingSessionJumpRef.current = null;
  }, [activeSessionId, canScrollToLatest, scheduleScrollToBottom, scrollVersion, virtualRowsCount]);

  useEffect(() => {
    if (!activeSessionId || !isPinnedToBottom || virtualRowsCount === 0 || !canScrollToLatest) {
      smoothScrollStateRef.current = null;
      return;
    }
    if (pendingSessionJumpRef.current === activeSessionId) {
      return;
    }

    const previousScrollVersion = previousScrollVersionRef.current;
    previousScrollVersionRef.current = scrollVersion;
    if (previousScrollVersion === null || previousScrollVersion === scrollVersion) {
      return;
    }

    scheduleScrollToBottom("smooth", false);
  }, [
    activeSessionId,
    canScrollToLatest,
    isPinnedToBottom,
    scheduleScrollToBottom,
    scrollVersion,
    virtualRowsCount,
  ]);

  return { isJumpingToLatest };
}

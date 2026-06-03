import {
  startTransition,
  useCallback,
  useEffect,
  useLayoutEffect,
  useReducer,
  useRef,
} from "react";

type UseAgentChatDeferredTranscriptArgs = {
  activeExternalSessionId: string | null;
  shouldDefer: boolean;
};

type UseAgentChatDeferredTranscriptResult = {
  isTranscriptRenderDeferred: boolean;
};

export function useAgentChatDeferredTranscript({
  activeExternalSessionId,
  shouldDefer,
}: UseAgentChatDeferredTranscriptArgs): UseAgentChatDeferredTranscriptResult {
  const [renderedSessionId, dispatchRenderedSessionId] = useReducer(
    (_current: string | null, next: string | null) => next,
    activeExternalSessionId,
  );
  const pendingDeferralCleanupRef = useRef<(() => void) | null>(null);

  const cancelPendingDeferral = useCallback((): void => {
    pendingDeferralCleanupRef.current?.();
    pendingDeferralCleanupRef.current = null;
  }, []);

  useLayoutEffect(() => {
    if (shouldDefer) {
      return;
    }

    cancelPendingDeferral();
    if (renderedSessionId === activeExternalSessionId) {
      return;
    }

    dispatchRenderedSessionId(activeExternalSessionId);
  }, [activeExternalSessionId, cancelPendingDeferral, renderedSessionId, shouldDefer]);

  useEffect(() => {
    if (!shouldDefer) {
      return;
    }

    cancelPendingDeferral();

    if (renderedSessionId === activeExternalSessionId) {
      return;
    }

    if (activeExternalSessionId === null) {
      startTransition(() => {
        dispatchRenderedSessionId(activeExternalSessionId);
      });
      return;
    }

    const nextSessionId = activeExternalSessionId;
    let frameId: number | null = globalThis.requestAnimationFrame(() => {
      frameId = null;
      const timeoutId = setTimeout(() => {
        timerId = null;
        startTransition(() => {
          dispatchRenderedSessionId(nextSessionId);
        });
      }, 0);
      timerId = timeoutId;
    });
    let timerId: ReturnType<typeof setTimeout> | null = null;

    const cleanup = () => {
      const cleanupTimerId = timerId;
      if (cleanupTimerId !== null) {
        clearTimeout(cleanupTimerId);
        timerId = null;
      }
      const cleanupFrameId = frameId;
      if (cleanupFrameId !== null) {
        globalThis.cancelAnimationFrame(cleanupFrameId);
        frameId = null;
      }
    };
    pendingDeferralCleanupRef.current = cleanup;

    return cleanup;
  }, [activeExternalSessionId, cancelPendingDeferral, renderedSessionId, shouldDefer]);

  useEffect(() => {
    return () => {
      cancelPendingDeferral();
    };
  }, [cancelPendingDeferral]);

  return {
    isTranscriptRenderDeferred: shouldDefer && renderedSessionId !== activeExternalSessionId,
  };
}

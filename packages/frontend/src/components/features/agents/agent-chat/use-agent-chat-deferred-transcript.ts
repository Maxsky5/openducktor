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
  const frameRef = useRef<number | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const cancelPendingDeferral = useCallback((): void => {
    if (frameRef.current !== null) {
      globalThis.cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
    }
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
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
    frameRef.current = globalThis.requestAnimationFrame(() => {
      frameRef.current = null;
      timerRef.current = setTimeout(() => {
        timerRef.current = null;
        startTransition(() => {
          dispatchRenderedSessionId(nextSessionId);
        });
      }, 0);
    });

    return () => {
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      if (frameRef.current !== null) {
        globalThis.cancelAnimationFrame(frameRef.current);
        frameRef.current = null;
      }
    };
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

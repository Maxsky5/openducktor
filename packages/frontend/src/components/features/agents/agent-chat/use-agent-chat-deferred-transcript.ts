import { startTransition, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

type UseAgentChatDeferredTranscriptArgs = {
  activeSessionId: string | null;
  shouldDefer: boolean;
};

type UseAgentChatDeferredTranscriptResult = {
  isTranscriptRenderDeferred: boolean;
};

export function useAgentChatDeferredTranscript({
  activeSessionId,
  shouldDefer,
}: UseAgentChatDeferredTranscriptArgs): UseAgentChatDeferredTranscriptResult {
  const [renderedSessionId, setRenderedSessionId] = useState<string | null>(activeSessionId);
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
    if (renderedSessionId === activeSessionId) {
      return;
    }

    setRenderedSessionId(activeSessionId);
  }, [activeSessionId, cancelPendingDeferral, renderedSessionId, shouldDefer]);

  useEffect(() => {
    if (!shouldDefer) {
      return;
    }

    cancelPendingDeferral();

    if (renderedSessionId === activeSessionId) {
      return;
    }

    if (activeSessionId === null) {
      startTransition(() => {
        setRenderedSessionId(activeSessionId);
      });
      return;
    }

    const nextSessionId = activeSessionId;
    frameRef.current = globalThis.requestAnimationFrame(() => {
      frameRef.current = null;
      timerRef.current = setTimeout(() => {
        timerRef.current = null;
        startTransition(() => {
          setRenderedSessionId(nextSessionId);
        });
      }, 0);
    });
  }, [activeSessionId, cancelPendingDeferral, renderedSessionId, shouldDefer]);

  useEffect(() => {
    return () => {
      cancelPendingDeferral();
    };
  }, [cancelPendingDeferral]);

  return {
    isTranscriptRenderDeferred: shouldDefer && renderedSessionId !== activeSessionId,
  };
}

import { startTransition, useCallback, useEffect, useRef, useState } from "react";

type UseAgentChatDeferredTranscriptArgs = {
  activeSessionId: string | null;
};

type UseAgentChatDeferredTranscriptResult = {
  isTranscriptRenderDeferred: boolean;
};

export function useAgentChatDeferredTranscript({
  activeSessionId,
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

  useEffect(() => {
    cancelPendingDeferral();

    if (renderedSessionId === activeSessionId) {
      return;
    }

    if (activeSessionId === null) {
      startTransition(() => {
        setRenderedSessionId(null);
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
  }, [activeSessionId, cancelPendingDeferral, renderedSessionId]);

  useEffect(() => {
    return () => {
      cancelPendingDeferral();
    };
  }, [cancelPendingDeferral]);

  return {
    isTranscriptRenderDeferred: renderedSessionId !== activeSessionId,
  };
}

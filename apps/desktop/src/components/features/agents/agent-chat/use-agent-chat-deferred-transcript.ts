import { startTransition, useEffect, useRef, useState } from "react";

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

  useEffect(() => {
    if (renderedSessionId === activeSessionId) {
      return;
    }

    if (frameRef.current !== null && typeof globalThis.cancelAnimationFrame === "function") {
      globalThis.cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
    }
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }

    if (activeSessionId === null) {
      startTransition(() => {
        setRenderedSessionId(null);
      });
      return;
    }

    const requestAnimationFrameFn = globalThis.requestAnimationFrame;
    if (typeof requestAnimationFrameFn !== "function") {
      startTransition(() => {
        setRenderedSessionId(activeSessionId);
      });
      return;
    }

    const nextSessionId = activeSessionId;
    frameRef.current = requestAnimationFrameFn(() => {
      frameRef.current = null;
      timerRef.current = setTimeout(() => {
        timerRef.current = null;
        startTransition(() => {
          setRenderedSessionId(nextSessionId);
        });
      }, 0);
    });
  }, [activeSessionId, renderedSessionId]);

  useEffect(() => {
    return () => {
      if (frameRef.current !== null && typeof globalThis.cancelAnimationFrame === "function") {
        globalThis.cancelAnimationFrame(frameRef.current);
      }
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current);
      }
    };
  }, []);

  return {
    isTranscriptRenderDeferred: renderedSessionId !== activeSessionId,
  };
}

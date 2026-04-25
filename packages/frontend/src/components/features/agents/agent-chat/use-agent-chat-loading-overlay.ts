import { useEffect, useLayoutEffect, useRef, useState } from "react";

const SAME_SESSION_LOADING_OVERLAY_DELAY_MS = 120;

type UseAgentChatLoadingOverlayArgs = {
  sessionId: string | null;
  isSessionViewLoading: boolean;
};

export function useAgentChatLoadingOverlay({
  sessionId,
  isSessionViewLoading,
}: UseAgentChatLoadingOverlayArgs): boolean {
  const [settledSessionId, setSettledSessionId] = useState<string | null>(() =>
    !isSessionViewLoading ? sessionId : null,
  );
  const [isSameSessionLoadingVisible, setIsSameSessionLoadingVisible] = useState(false);
  const loadingDelayTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (loadingDelayTimeoutRef.current !== null) {
      clearTimeout(loadingDelayTimeoutRef.current);
      loadingDelayTimeoutRef.current = null;
    }

    const isSameSessionLoading = isSessionViewLoading && sessionId === settledSessionId;
    if (!isSameSessionLoading) {
      setIsSameSessionLoadingVisible(false);
      return;
    }

    loadingDelayTimeoutRef.current = setTimeout(() => {
      setIsSameSessionLoadingVisible(true);
      loadingDelayTimeoutRef.current = null;
    }, SAME_SESSION_LOADING_OVERLAY_DELAY_MS);

    return () => {
      if (loadingDelayTimeoutRef.current !== null) {
        clearTimeout(loadingDelayTimeoutRef.current);
        loadingDelayTimeoutRef.current = null;
      }
    };
  }, [isSessionViewLoading, sessionId, settledSessionId]);

  useLayoutEffect(() => {
    if (isSessionViewLoading) {
      return;
    }
    if (settledSessionId === sessionId) {
      return;
    }
    setSettledSessionId(sessionId);
  }, [sessionId, isSessionViewLoading, settledSessionId]);

  const isCrossSessionLoading = isSessionViewLoading && sessionId !== settledSessionId;

  return isCrossSessionLoading || isSameSessionLoadingVisible;
}

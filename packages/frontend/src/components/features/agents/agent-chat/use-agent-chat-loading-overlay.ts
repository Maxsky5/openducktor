import { useEffect, useLayoutEffect, useRef, useState } from "react";

const SAME_SESSION_LOADING_OVERLAY_DELAY_MS = 120;

type UseAgentChatLoadingOverlayArgs = {
  externalSessionId: string | null;
  isSessionViewLoading: boolean;
};

export function useAgentChatLoadingOverlay({
  externalSessionId,
  isSessionViewLoading,
}: UseAgentChatLoadingOverlayArgs): boolean {
  const [settledSessionId, setSettledSessionId] = useState<string | null>(() =>
    !isSessionViewLoading ? externalSessionId : null,
  );
  const [isSameSessionLoadingVisible, setIsSameSessionLoadingVisible] = useState(false);
  const loadingDelayTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (loadingDelayTimeoutRef.current !== null) {
      clearTimeout(loadingDelayTimeoutRef.current);
      loadingDelayTimeoutRef.current = null;
    }

    const isSameSessionLoading = isSessionViewLoading && externalSessionId === settledSessionId;
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
  }, [isSessionViewLoading, externalSessionId, settledSessionId]);

  useLayoutEffect(() => {
    if (isSessionViewLoading) {
      return;
    }
    if (settledSessionId === externalSessionId) {
      return;
    }
    setSettledSessionId(externalSessionId);
  }, [externalSessionId, isSessionViewLoading, settledSessionId]);

  const isCrossSessionLoading = isSessionViewLoading && externalSessionId !== settledSessionId;

  return isCrossSessionLoading || isSameSessionLoadingVisible;
}

import { useLayoutEffect, useState } from "react";

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

  useLayoutEffect(() => {
    if (isSessionViewLoading) {
      return;
    }
    if (settledSessionId === sessionId) {
      return;
    }
    setSettledSessionId(sessionId);
  }, [sessionId, isSessionViewLoading, settledSessionId]);

  return sessionId !== settledSessionId;
}

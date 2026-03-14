import { useLayoutEffect, useState } from "react";

type UseAgentChatLoadingOverlayArgs = {
  sessionId: string | null;
  isSessionViewLoading: boolean;
  hasRenderableSessionRows: boolean;
  hasSessionHistory: boolean;
  isPreparingVirtualization: boolean;
  isJumpingToLatest: boolean;
};

const isReadyToDisplay = ({
  sessionId,
  isSessionViewLoading,
  hasRenderableSessionRows,
  hasSessionHistory,
  isPreparingVirtualization,
  isJumpingToLatest,
}: UseAgentChatLoadingOverlayArgs): boolean => {
  if (isSessionViewLoading || isPreparingVirtualization || isJumpingToLatest) {
    return false;
  }

  if (sessionId === null) {
    return true;
  }

  return hasRenderableSessionRows || hasSessionHistory;
};

const resolveInitialSettledSessionId = (args: UseAgentChatLoadingOverlayArgs): string | null => {
  return isReadyToDisplay(args) ? args.sessionId : null;
};

export function useAgentChatLoadingOverlay(args: UseAgentChatLoadingOverlayArgs): boolean {
  const [settledSessionId, setSettledSessionId] = useState<string | null>(() =>
    resolveInitialSettledSessionId(args),
  );
  const ready = isReadyToDisplay(args);
  const isPendingSessionDisplay = args.sessionId !== settledSessionId;

  useLayoutEffect(() => {
    if (!ready) {
      return;
    }

    if (settledSessionId === args.sessionId) {
      return;
    }

    setSettledSessionId(args.sessionId);
  }, [args.sessionId, ready, settledSessionId]);

  return isPendingSessionDisplay;
}

import { useEffect, useLayoutEffect, useReducer, useRef } from "react";

const SAME_SESSION_LOADING_OVERLAY_DELAY_MS = 120;

type UseAgentChatLoadingOverlayArgs = {
  externalSessionId: string | null;
  isSessionViewLoading: boolean;
};

type LoadingOverlayState = {
  settledSessionId: string | null;
  isSameSessionLoadingVisible: boolean;
};

type LoadingOverlayAction =
  | { type: "sameSessionLoadingHidden" }
  | { type: "sameSessionLoadingShown" }
  | { type: "sessionSettled"; externalSessionId: string | null };

const loadingOverlayReducer = (
  state: LoadingOverlayState,
  action: LoadingOverlayAction,
): LoadingOverlayState => {
  switch (action.type) {
    case "sameSessionLoadingHidden":
      return { ...state, isSameSessionLoadingVisible: false };
    case "sameSessionLoadingShown":
      return { ...state, isSameSessionLoadingVisible: true };
    case "sessionSettled":
      return { ...state, settledSessionId: action.externalSessionId };
  }
};

export function useAgentChatLoadingOverlay({
  externalSessionId,
  isSessionViewLoading,
}: UseAgentChatLoadingOverlayArgs): boolean {
  const [state, dispatch] = useReducer(loadingOverlayReducer, {
    settledSessionId: !isSessionViewLoading ? externalSessionId : null,
    isSameSessionLoadingVisible: false,
  });
  const { settledSessionId, isSameSessionLoadingVisible } = state;
  const loadingDelayTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (loadingDelayTimeoutRef.current !== null) {
      clearTimeout(loadingDelayTimeoutRef.current);
      loadingDelayTimeoutRef.current = null;
    }

    const isSameSessionLoading = isSessionViewLoading && externalSessionId === settledSessionId;
    if (!isSameSessionLoading) {
      dispatch({ type: "sameSessionLoadingHidden" });
      return;
    }

    loadingDelayTimeoutRef.current = setTimeout(() => {
      dispatch({ type: "sameSessionLoadingShown" });
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
    dispatch({ type: "sessionSettled", externalSessionId });
  }, [externalSessionId, isSessionViewLoading, settledSessionId]);

  const isCrossSessionLoading = isSessionViewLoading && externalSessionId !== settledSessionId;

  return isCrossSessionLoading || isSameSessionLoadingVisible;
}

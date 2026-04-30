import type { MutableRefObject, RefObject } from "react";
import { useCallback, useEffect, useLayoutEffect, useRef } from "react";
import type { AgentChatWindowRow, AgentChatWindowTurn } from "./agent-chat-thread-windowing";
import { useAgentChatHistoryWindow } from "./use-agent-chat-history-window";
import { useAgentChatScrollController } from "./use-agent-chat-scroll-controller";

type UseAgentChatWindowInput = {
  rows: AgentChatWindowRow[];
  turns?: AgentChatWindowTurn[];
  activeExternalSessionId: string | null;
  isSessionViewLoading: boolean;
  isSessionWorking?: boolean;
  messagesContainerRef: RefObject<HTMLDivElement | null>;
  messagesContentRef: RefObject<HTMLDivElement | null>;
  syncBottomAfterComposerLayoutRef?: MutableRefObject<(() => void) | null>;
};

type UseAgentChatWindowResult = {
  windowedRows: AgentChatWindowRow[];
  windowedTurns: AgentChatWindowTurn[];
  windowStart: number;
  isNearBottom: boolean;
  isNearTop: boolean;
  preserveScrollBeforeStagedPrepend: () => void;
  scrollToBottom: () => void;
  scrollToTop: () => void;
  scrollToBottomOnSend: () => void;
};

type StagedPrependScrollSnapshot = {
  externalSessionId: string | null;
  beforeScrollHeight: number;
  beforeScrollTop: number;
};

export function useAgentChatWindow({
  rows,
  turns,
  activeExternalSessionId,
  isSessionViewLoading,
  isSessionWorking = false,
  messagesContainerRef,
  messagesContentRef,
  syncBottomAfterComposerLayoutRef,
}: UseAgentChatWindowInput): UseAgentChatWindowResult {
  const composerLayoutSyncFrameRef = useRef<number | null>(null);
  const composerLayoutSyncSettleFrameRef = useRef<number | null>(null);
  const composerLayoutSyncTokenRef = useRef(0);
  const prevSessionIdRef = useRef<string | null>(null);
  const prevIsSessionViewLoadingRef = useRef(isSessionViewLoading);
  const stagedPrependScrollSnapshotRef = useRef<StagedPrependScrollSnapshot | null>(null);
  const {
    isNearBottom,
    isNearTop,
    userScrolledRef,
    userScrollIntentVersionRef,
    forceScrollToBottom,
    refreshScrollState,
  } = useAgentChatScrollController({
    activeExternalSessionId,
    messagesContainerRef,
    messagesContentRef,
    isSessionWorking,
  });
  const {
    latestTurnStart,
    turnStart,
    windowStart,
    windowedRows,
    windowedTurns,
    resetToLatestTurns,
    revealAllHistory,
  } = useAgentChatHistoryWindow({
    rows,
    isSessionViewLoading,
    activeExternalSessionId,
    messagesContainerRef,
    userScrolledRef,
    ...(turns ? { turns } : {}),
  });
  const pendingBottomResetRef = useRef(false);
  const visibleWindowKey = `${windowStart}:${windowedRows.length}`;
  const isFollowingTranscript = useCallback(() => {
    return !userScrolledRef.current;
  }, [userScrolledRef]);

  const preserveScrollBeforeStagedPrepend = useCallback(() => {
    if (!userScrolledRef.current || stagedPrependScrollSnapshotRef.current !== null) {
      return;
    }

    const container = messagesContainerRef.current;
    if (!container) {
      return;
    }

    stagedPrependScrollSnapshotRef.current = {
      externalSessionId: activeExternalSessionId,
      beforeScrollHeight: container.scrollHeight,
      beforeScrollTop: container.scrollTop,
    };
  }, [activeExternalSessionId, messagesContainerRef, userScrolledRef]);

  const resetLatestTurnsAndPinBottom = useCallback(() => {
    if (turnStart === latestTurnStart) {
      forceScrollToBottom();
      return;
    }

    pendingBottomResetRef.current = true;
    resetToLatestTurns();
  }, [forceScrollToBottom, latestTurnStart, resetToLatestTurns, turnStart]);

  useLayoutEffect(() => {
    if (prevSessionIdRef.current === activeExternalSessionId) {
      return;
    }

    prevSessionIdRef.current = activeExternalSessionId;
    stagedPrependScrollSnapshotRef.current = null;
    resetLatestTurnsAndPinBottom();
  }, [activeExternalSessionId, resetLatestTurnsAndPinBottom]);

  useLayoutEffect(() => {
    const finishedLoading = prevIsSessionViewLoadingRef.current && !isSessionViewLoading;
    prevIsSessionViewLoadingRef.current = isSessionViewLoading;
    if (!finishedLoading) {
      return;
    }

    resetLatestTurnsAndPinBottom();
  }, [isSessionViewLoading, resetLatestTurnsAndPinBottom]);

  useEffect(() => {
    if (!syncBottomAfterComposerLayoutRef) {
      return;
    }

    const cancelScheduledComposerLayoutSync = () => {
      composerLayoutSyncTokenRef.current += 1;
      if (composerLayoutSyncFrameRef.current !== null) {
        globalThis.cancelAnimationFrame(composerLayoutSyncFrameRef.current);
        composerLayoutSyncFrameRef.current = null;
      }
      if (composerLayoutSyncSettleFrameRef.current !== null) {
        globalThis.cancelAnimationFrame(composerLayoutSyncSettleFrameRef.current);
        composerLayoutSyncSettleFrameRef.current = null;
      }
    };

    syncBottomAfterComposerLayoutRef.current = () => {
      if (!isFollowingTranscript()) {
        return;
      }

      cancelScheduledComposerLayoutSync();
      const requestAnimationFrameFn = globalThis.requestAnimationFrame;
      if (typeof requestAnimationFrameFn !== "function") {
        forceScrollToBottom();
        return;
      }

      const scheduledToken = composerLayoutSyncTokenRef.current + 1;
      composerLayoutSyncTokenRef.current = scheduledToken;
      const scheduledUserScrollIntentVersion = userScrollIntentVersionRef.current;

      composerLayoutSyncFrameRef.current = requestAnimationFrameFn(() => {
        composerLayoutSyncFrameRef.current = null;
        composerLayoutSyncSettleFrameRef.current = requestAnimationFrameFn(() => {
          composerLayoutSyncSettleFrameRef.current = null;
          if (composerLayoutSyncTokenRef.current !== scheduledToken) {
            return;
          }
          if (userScrollIntentVersionRef.current !== scheduledUserScrollIntentVersion) {
            return;
          }

          forceScrollToBottom();
        });
      });
    };

    return () => {
      cancelScheduledComposerLayoutSync();
      if (syncBottomAfterComposerLayoutRef.current) {
        syncBottomAfterComposerLayoutRef.current = null;
      }
    };
  }, [
    forceScrollToBottom,
    isFollowingTranscript,
    syncBottomAfterComposerLayoutRef,
    userScrollIntentVersionRef,
  ]);

  useLayoutEffect(() => {
    void visibleWindowKey;

    if (!pendingBottomResetRef.current) {
      return;
    }

    pendingBottomResetRef.current = false;
    forceScrollToBottom();
  }, [forceScrollToBottom, visibleWindowKey]);

  // Intentionally checks staged prepends after every commit: staging happens in sibling hooks after
  // this hook computes its window, so the window key can remain unchanged while the DOM grows above
  // the viewport. The expensive scroll-state refresh stays gated in the next effect.
  useLayoutEffect(() => {
    const pendingStagedPrepend = stagedPrependScrollSnapshotRef.current;
    const container = messagesContainerRef.current;
    let restoredStagedPrepend = false;
    if (
      pendingStagedPrepend &&
      pendingStagedPrepend.externalSessionId === activeExternalSessionId &&
      container
    ) {
      stagedPrependScrollSnapshotRef.current = null;
      const scrollHeightDelta = container.scrollHeight - pendingStagedPrepend.beforeScrollHeight;
      if (scrollHeightDelta !== 0) {
        container.scrollTop = pendingStagedPrepend.beforeScrollTop + scrollHeightDelta;
        restoredStagedPrepend = true;
      }
    } else if (pendingStagedPrepend) {
      stagedPrependScrollSnapshotRef.current = null;
    }

    if (restoredStagedPrepend) {
      refreshScrollState();
    }
  });

  useLayoutEffect(() => {
    void visibleWindowKey;

    refreshScrollState();
  }, [refreshScrollState, visibleWindowKey]);

  return {
    windowedRows,
    windowedTurns,
    windowStart,
    isNearBottom,
    isNearTop: isNearTop && turnStart === 0,
    preserveScrollBeforeStagedPrepend,
    scrollToBottom: () => {
      resetLatestTurnsAndPinBottom();
    },
    scrollToTop: () => {
      const container = messagesContainerRef.current;
      if (container) {
        container.style.overflowAnchor = "none";
      }

      revealAllHistory();
      if (!container) {
        refreshScrollState();
        return;
      }

      container.scrollTo({
        top: 0,
        behavior: "auto",
      });
      refreshScrollState();
    },
    scrollToBottomOnSend: () => {
      if (userScrolledRef.current) {
        resetLatestTurnsAndPinBottom();
        return;
      }

      forceScrollToBottom();
    },
  };
}

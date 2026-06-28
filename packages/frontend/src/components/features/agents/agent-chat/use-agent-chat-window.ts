import type { MutableRefObject, RefObject } from "react";
import { useCallback, useEffect, useLayoutEffect, useRef } from "react";
import type { AgentChatWindowRow, AgentChatWindowTurn } from "./agent-chat-thread-windowing";
import { useAgentChatHistoryWindow } from "./use-agent-chat-history-window";
import { useAgentChatScrollController } from "./use-agent-chat-scroll-controller";

type UseAgentChatWindowInput = {
  rows: AgentChatWindowRow[];
  turns?: AgentChatWindowTurn[];
  displayedSessionKey: string | null;
  shouldResetForTranscriptLoad: boolean;
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
  sessionKey: string | null;
  beforeScrollHeight: number;
  beforeScrollTop: number;
};

export function useAgentChatWindow({
  rows,
  turns,
  displayedSessionKey,
  shouldResetForTranscriptLoad,
  isSessionWorking = false,
  messagesContainerRef,
  messagesContentRef,
  syncBottomAfterComposerLayoutRef,
}: UseAgentChatWindowInput): UseAgentChatWindowResult {
  const composerLayoutSyncFrameRef = useRef<number | null>(null);
  const composerLayoutSyncSettleFrameRef = useRef<number | null>(null);
  const composerLayoutSyncTokenRef = useRef(0);
  const prevSessionKeyRef = useRef<string | null>(null);
  const prevShouldResetForTranscriptLoadRef = useRef(shouldResetForTranscriptLoad);
  const stagedPrependScrollSnapshotRef = useRef<StagedPrependScrollSnapshot | null>(null);
  const {
    isNearBottom,
    isNearTop,
    userScrolledRef,
    userScrollIntentVersionRef,
    forceScrollToBottom,
    refreshScrollState,
  } = useAgentChatScrollController({
    displayedSessionKey,
    messagesContainerRef,
    messagesContentRef,
    isSessionWorking,
  });
  const {
    windowStart,
    isLatestWindow,
    windowedRows,
    windowedTurns,
    resetToLatestTurns,
    revealOlderHistory,
  } = useAgentChatHistoryWindow({
    rows,
    shouldResetForTranscriptLoad,
    displayedSessionKey,
    messagesContainerRef,
    userScrolledRef,
    ...(turns ? { turns } : {}),
  });
  const pendingBottomResetRef = useRef(false);
  const visibleWindowKey = `${windowStart}:${windowedRows.length}`;
  const isFollowingTranscript = useCallback(() => {
    return !userScrolledRef.current;
  }, [userScrolledRef]);
  const preserveScrollBeforeStagedPrepend = useCallback((): void => {
    if (!userScrolledRef.current || stagedPrependScrollSnapshotRef.current !== null) {
      return;
    }

    const container = messagesContainerRef.current;
    if (!container) {
      return;
    }

    stagedPrependScrollSnapshotRef.current = {
      sessionKey: displayedSessionKey,
      beforeScrollHeight: container.scrollHeight,
      beforeScrollTop: container.scrollTop,
    };
  }, [displayedSessionKey, messagesContainerRef, userScrolledRef]);

  const resetLatestTurnsAndPinBottom = useCallback(() => {
    if (isLatestWindow) {
      forceScrollToBottom();
      return;
    }

    pendingBottomResetRef.current = true;
    resetToLatestTurns();
  }, [forceScrollToBottom, isLatestWindow, resetToLatestTurns]);

  useLayoutEffect(() => {
    if (prevSessionKeyRef.current === displayedSessionKey) {
      return;
    }

    prevSessionKeyRef.current = displayedSessionKey;
    stagedPrependScrollSnapshotRef.current = null;
    resetLatestTurnsAndPinBottom();
  }, [displayedSessionKey, resetLatestTurnsAndPinBottom]);

  useLayoutEffect(() => {
    const finishedTranscriptLoad =
      prevShouldResetForTranscriptLoadRef.current && !shouldResetForTranscriptLoad;
    prevShouldResetForTranscriptLoadRef.current = shouldResetForTranscriptLoad;
    if (!finishedTranscriptLoad) {
      return;
    }

    resetLatestTurnsAndPinBottom();
  }, [resetLatestTurnsAndPinBottom, shouldResetForTranscriptLoad]);

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

  useLayoutEffect(() => {
    const pendingStagedPrepend = stagedPrependScrollSnapshotRef.current;
    const container = messagesContainerRef.current;
    let restoredStagedPrepend = false;

    if (
      pendingStagedPrepend &&
      pendingStagedPrepend.sessionKey === displayedSessionKey &&
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
    isNearTop: isNearTop && windowStart === 0,
    preserveScrollBeforeStagedPrepend,
    scrollToBottom: () => {
      resetLatestTurnsAndPinBottom();
    },
    scrollToTop: () => {
      const container = messagesContainerRef.current;
      if (container) {
        container.style.overflowAnchor = "none";
      }

      revealOlderHistory({ preserveScroll: false });
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

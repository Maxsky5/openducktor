import type { MutableRefObject, RefObject } from "react";
import { useCallback, useEffect, useLayoutEffect, useRef } from "react";
import type { AgentChatTranscriptRow, AgentChatTurnAnchor } from "./agent-chat-transcript-model";
import { useAgentChatRowWindow } from "./use-agent-chat-row-window";
import { useAgentChatScrollController } from "./use-agent-chat-scroll-controller";

type UseAgentChatWindowInput = {
  rows: AgentChatTranscriptRow[];
  turnAnchors?: AgentChatTurnAnchor[];
  displayedSessionKey: string | null;
  shouldResetForTranscriptLoad: boolean;
  isSessionWorking?: boolean;
  messagesContainerRef: RefObject<HTMLDivElement | null>;
  messagesContentRef: RefObject<HTMLDivElement | null>;
  syncBottomAfterComposerLayoutRef?: MutableRefObject<(() => void) | null>;
};

type UseAgentChatWindowResult = {
  visibleRows: AgentChatTranscriptRow[];
  visibleTurnAnchors: AgentChatTurnAnchor[];
  windowStart: number;
  isNearBottom: boolean;
  isNearTop: boolean;
  scrollToBottom: () => void;
  scrollToTop: () => void;
  scrollToBottomOnSend: () => void;
};

export function useAgentChatWindow({
  rows,
  turnAnchors = [],
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
  const idleBottomPinFrameRef = useRef<number | null>(null);
  const idleBottomPinSettleFrameRef = useRef<number | null>(null);
  const idleBottomPinTokenRef = useRef(0);
  const prevSessionKeyRef = useRef<string | null>(null);
  const previousIsSessionWorkingRef = useRef(isSessionWorking);
  const prevShouldResetForTranscriptLoadRef = useRef(shouldResetForTranscriptLoad);
  const canFollowPhysicalBottomRef = useRef(true);
  const {
    isNearBottom,
    isNearTop,
    userScrolledRef,
    userScrollIntentVersionRef,
    stopFollowingTranscript,
    forceScrollToBottom,
    refreshScrollState,
  } = useAgentChatScrollController({
    displayedSessionKey,
    messagesContainerRef,
    messagesContentRef,
    isSessionWorking,
    canFollowPhysicalBottomRef,
  });
  const {
    windowStart,
    isLatestWindow,
    visibleRows,
    visibleTurnAnchors,
    selectFirstRowWindow,
    selectLatestRowWindow,
  } = useAgentChatRowWindow({
    rows,
    turnAnchors,
    shouldResetForTranscriptLoad,
    shouldFollowLatestWindow: !userScrolledRef.current,
    displayedSessionKey,
    messagesContainerRef,
  });
  canFollowPhysicalBottomRef.current = isLatestWindow;
  const pendingTopResetIntentVersionRef = useRef<number | null>(null);
  const pendingBottomResetRef = useRef(false);
  const visibleRowCount = visibleRows.length;
  const committedRowWindowVersion = `${windowStart}:${visibleRowCount}`;
  const resetLatestTurnsAndPinBottom = useCallback(() => {
    pendingTopResetIntentVersionRef.current = null;
    if (isLatestWindow) {
      forceScrollToBottom();
      return;
    }

    pendingBottomResetRef.current = true;
    selectLatestRowWindow();
  }, [forceScrollToBottom, isLatestWindow, selectLatestRowWindow]);

  const cancelScheduledIdleBottomPin = useCallback(() => {
    idleBottomPinTokenRef.current += 1;
    if (idleBottomPinFrameRef.current !== null) {
      globalThis.cancelAnimationFrame(idleBottomPinFrameRef.current);
      idleBottomPinFrameRef.current = null;
    }
    if (idleBottomPinSettleFrameRef.current !== null) {
      globalThis.cancelAnimationFrame(idleBottomPinSettleFrameRef.current);
      idleBottomPinSettleFrameRef.current = null;
    }
  }, []);

  const scheduleIdleBottomPinAfterLayout = useCallback(
    (scheduledUserScrollIntentVersion: number) => {
      cancelScheduledIdleBottomPin();

      const requestAnimationFrameFn = globalThis.requestAnimationFrame;
      if (typeof requestAnimationFrameFn !== "function") {
        if (userScrollIntentVersionRef.current === scheduledUserScrollIntentVersion) {
          forceScrollToBottom();
        }
        return;
      }

      const scheduledToken = idleBottomPinTokenRef.current + 1;
      idleBottomPinTokenRef.current = scheduledToken;
      idleBottomPinFrameRef.current = requestAnimationFrameFn(() => {
        idleBottomPinFrameRef.current = null;
        idleBottomPinSettleFrameRef.current = requestAnimationFrameFn(() => {
          idleBottomPinSettleFrameRef.current = null;
          if (idleBottomPinTokenRef.current !== scheduledToken) {
            return;
          }
          if (userScrollIntentVersionRef.current !== scheduledUserScrollIntentVersion) {
            return;
          }

          forceScrollToBottom();
        });
      });
    },
    [cancelScheduledIdleBottomPin, forceScrollToBottom, userScrollIntentVersionRef],
  );

  useLayoutEffect(() => {
    if (prevSessionKeyRef.current === displayedSessionKey) {
      return;
    }

    prevSessionKeyRef.current = displayedSessionKey;
    resetLatestTurnsAndPinBottom();
  }, [displayedSessionKey, resetLatestTurnsAndPinBottom]);

  useLayoutEffect(() => {
    const wasSessionWorking = previousIsSessionWorkingRef.current;
    previousIsSessionWorkingRef.current = isSessionWorking;
    if (!wasSessionWorking || isSessionWorking) {
      return;
    }

    if (userScrolledRef.current) {
      return;
    }

    const scheduledUserScrollIntentVersion = userScrollIntentVersionRef.current;
    resetLatestTurnsAndPinBottom();
    scheduleIdleBottomPinAfterLayout(scheduledUserScrollIntentVersion);
  }, [
    isSessionWorking,
    resetLatestTurnsAndPinBottom,
    scheduleIdleBottomPinAfterLayout,
    userScrollIntentVersionRef,
    userScrolledRef,
  ]);

  useEffect(() => cancelScheduledIdleBottomPin, [cancelScheduledIdleBottomPin]);

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
      if (userScrolledRef.current) {
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
    syncBottomAfterComposerLayoutRef,
    userScrollIntentVersionRef,
    userScrolledRef,
  ]);

  useLayoutEffect(() => {
    void committedRowWindowVersion;

    const pendingTopIntentVersion = pendingTopResetIntentVersionRef.current;
    if (pendingTopIntentVersion === null) {
      return;
    }
    if (windowStart !== 0) {
      return;
    }

    pendingTopResetIntentVersionRef.current = null;
    if (userScrollIntentVersionRef.current !== pendingTopIntentVersion) {
      return;
    }

    const container = messagesContainerRef.current;
    if (!container) {
      refreshScrollState();
      return;
    }

    container.style.overflowAnchor = "none";
    container.scrollTop = 0;
    refreshScrollState();
  }, [
    messagesContainerRef,
    refreshScrollState,
    userScrollIntentVersionRef,
    committedRowWindowVersion,
    windowStart,
  ]);

  useLayoutEffect(() => {
    void committedRowWindowVersion;

    if (!pendingBottomResetRef.current) {
      return;
    }

    pendingBottomResetRef.current = false;
    forceScrollToBottom();
  }, [committedRowWindowVersion, forceScrollToBottom]);

  useLayoutEffect(() => {
    void committedRowWindowVersion;

    refreshScrollState();
  }, [committedRowWindowVersion, refreshScrollState]);

  const scrollToTop = useCallback(() => {
    const container = messagesContainerRef.current;
    stopFollowingTranscript();
    if (container) {
      container.style.overflowAnchor = "none";
    }

    pendingBottomResetRef.current = false;

    if (windowStart === 0) {
      pendingTopResetIntentVersionRef.current = null;
      if (container) {
        container.scrollTop = 0;
      }
      refreshScrollState();
      return;
    }

    pendingTopResetIntentVersionRef.current = userScrollIntentVersionRef.current;
    selectFirstRowWindow();
    if (!container) {
      refreshScrollState();
      return;
    }

    container.scrollTop = 0;
    refreshScrollState();
  }, [
    messagesContainerRef,
    refreshScrollState,
    selectFirstRowWindow,
    stopFollowingTranscript,
    userScrollIntentVersionRef,
    windowStart,
  ]);

  const scrollToBottomOnSend = useCallback(() => {
    if (userScrolledRef.current || !isLatestWindow) {
      resetLatestTurnsAndPinBottom();
      return;
    }

    forceScrollToBottom();
  }, [forceScrollToBottom, isLatestWindow, resetLatestTurnsAndPinBottom, userScrolledRef]);

  return {
    visibleRows,
    visibleTurnAnchors,
    windowStart,
    isNearBottom: isNearBottom && isLatestWindow,
    isNearTop: isNearTop && windowStart === 0,
    scrollToBottom: resetLatestTurnsAndPinBottom,
    scrollToTop,
    scrollToBottomOnSend,
  };
}

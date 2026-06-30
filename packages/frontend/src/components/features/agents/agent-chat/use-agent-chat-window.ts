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
  const prevSessionKeyRef = useRef<string | null>(null);
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
  const pendingBottomResetRef = useRef(false);
  const visibleWindowKey = `${windowStart}:${visibleRows.length}`;
  const isFollowingTranscript = useCallback(() => {
    return !userScrolledRef.current;
  }, [userScrolledRef]);
  const resetLatestTurnsAndPinBottom = useCallback(() => {
    if (isLatestWindow) {
      forceScrollToBottom();
      return;
    }

    pendingBottomResetRef.current = true;
    selectLatestRowWindow();
  }, [forceScrollToBottom, isLatestWindow, selectLatestRowWindow]);

  useLayoutEffect(() => {
    if (prevSessionKeyRef.current === displayedSessionKey) {
      return;
    }

    prevSessionKeyRef.current = displayedSessionKey;
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
    void visibleWindowKey;

    refreshScrollState();
  }, [refreshScrollState, visibleWindowKey]);

  return {
    visibleRows,
    visibleTurnAnchors,
    windowStart,
    isNearBottom: isNearBottom && isLatestWindow,
    isNearTop: isNearTop && windowStart === 0,
    scrollToBottom: () => {
      resetLatestTurnsAndPinBottom();
    },
    scrollToTop: () => {
      const container = messagesContainerRef.current;
      stopFollowingTranscript();
      if (container) {
        container.style.overflowAnchor = "none";
      }

      selectFirstRowWindow();
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
      if (userScrolledRef.current || !isLatestWindow) {
        resetLatestTurnsAndPinBottom();
        return;
      }

      forceScrollToBottom();
    },
  };
}

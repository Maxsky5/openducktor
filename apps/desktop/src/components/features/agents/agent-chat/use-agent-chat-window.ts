import type { MutableRefObject, RefCallback, RefObject } from "react";
import { useEffect, useLayoutEffect, useRef } from "react";
import type { AgentChatWindowRow } from "./agent-chat-thread-windowing";
import { clampWindowRange, createBottomAnchoredWindow } from "./agent-chat-window-shared";
import { useAgentChatResizeSync } from "./use-agent-chat-resize-sync";
import { useAgentChatScrollController } from "./use-agent-chat-scroll-controller";
import { useAgentChatSentinelObservers } from "./use-agent-chat-sentinel-observers";
import { useAgentChatWindowRangeController } from "./use-agent-chat-window-range-controller";

type UseAgentChatWindowInput = {
  rows: AgentChatWindowRow[];
  activeSessionId: string | null;
  isSessionViewLoading: boolean;
  isSessionWorking?: boolean;
  messagesContainerRef: RefObject<HTMLDivElement | null>;
  messagesContentRef: RefObject<HTMLDivElement | null>;
  syncBottomAfterComposerLayoutRef?: MutableRefObject<(() => void) | null>;
};

type UseAgentChatWindowResult = {
  windowedRows: AgentChatWindowRow[];
  windowStart: number;
  windowEnd: number;
  isNearBottom: boolean;
  isNearTop: boolean;
  isAutoFollowingToBottom: boolean;
  topSentinelRef: RefCallback<HTMLDivElement>;
  bottomSentinelRef: RefCallback<HTMLDivElement>;
  scrollToBottom: () => void;
  scrollToTop: () => void;
  scrollToBottomOnSend: () => void;
};

export function useAgentChatWindow({
  rows,
  activeSessionId,
  isSessionViewLoading,
  isSessionWorking = false,
  messagesContainerRef,
  messagesContentRef,
  syncBottomAfterComposerLayoutRef,
}: UseAgentChatWindowInput): UseAgentChatWindowResult {
  const composerLayoutSyncFrameRef = useRef<number | null>(null);
  const composerLayoutSyncSettleFrameRef = useRef<number | null>(null);
  const composerLayoutSyncTokenRef = useRef(0);
  const rowCount = rows.length;
  const initialWindow = createBottomAnchoredWindow(rowCount);
  const {
    isNearBottom,
    isNearTop,
    isAutoFollowingToBottom,
    isPinnedToBottomRef,
    shouldAutoFollowLiveUpdatesRef,
    userScrollIntentVersionRef,
    suppressSentinelsRef,
    isUpdatingRef,
    hasPendingScrollRequest,
    captureScrollAnchor,
    captureViewportAnchor,
    restoreViewportAnchor,
    syncBottomIfPinned,
    scrollToBottomOnSend,
    requestWindowScroll,
    applyPendingScrollRequest,
    setBottomAnchoredState,
    setTopAnchoredState,
  } = useAgentChatScrollController({
    messagesContainerRef,
    initialWindow,
    isSessionWorking,
  });

  useLayoutEffect(() => {
    applyPendingScrollRequest();
  });

  useAgentChatResizeSync({
    messagesContainerRef,
    messagesContentRef,
    restoreViewportAnchor,
    syncBottomIfPinned,
  });

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
      cancelScheduledComposerLayoutSync();
      const requestAnimationFrameFn = globalThis.requestAnimationFrame;
      if (typeof requestAnimationFrameFn !== "function") {
        syncBottomIfPinned({ forcePinned: true });
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
          syncBottomIfPinned({ forcePinned: true });
        });
      });
    };

    return () => {
      cancelScheduledComposerLayoutSync();
      if (syncBottomAfterComposerLayoutRef.current) {
        syncBottomAfterComposerLayoutRef.current = null;
      }
    };
  }, [syncBottomAfterComposerLayoutRef, syncBottomIfPinned, userScrollIntentVersionRef]);

  const { windowRange, scrollToBottom, scrollToTop, shiftWindowUp, shiftWindowDown } =
    useAgentChatWindowRangeController({
      rows,
      rowCount,
      activeSessionId,
      isSessionViewLoading,
      isPinnedToBottomRef,
      shouldAutoFollowLiveUpdatesRef,
      suppressSentinelsRef,
      isUpdatingRef,
      hasPendingScrollRequest,
      captureScrollAnchor,
      captureViewportAnchor,
      requestWindowScroll,
      setBottomAnchoredState,
      setTopAnchoredState,
    });

  const { topSentinelRef, bottomSentinelRef } = useAgentChatSentinelObservers({
    messagesContainerRef,
    rowCount,
    windowStart: windowRange.start,
    windowEnd: windowRange.end,
    suppressSentinelsRef,
    shiftWindowUp,
    shiftWindowDown,
  });

  const effectiveIsNearTop = isNearTop && windowRange.start === 0;

  const effectiveWindow = clampWindowRange(windowRange, rowCount);
  const hasVisibleRows = effectiveWindow.end >= effectiveWindow.start;
  const windowedRows = hasVisibleRows
    ? rows.slice(effectiveWindow.start, effectiveWindow.end + 1)
    : [];

  return {
    windowedRows,
    windowStart: effectiveWindow.start,
    windowEnd: effectiveWindow.end,
    isNearBottom,
    isNearTop: effectiveIsNearTop,
    isAutoFollowingToBottom,
    topSentinelRef,
    bottomSentinelRef,
    scrollToBottom,
    scrollToTop,
    scrollToBottomOnSend,
  };
}

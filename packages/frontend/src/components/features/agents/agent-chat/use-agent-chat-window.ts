import type { RefObject } from "react";
import { useCallback, useLayoutEffect, useRef } from "react";
import type { AgentChatTranscriptRow, AgentChatTurnAnchor } from "./agent-chat-transcript-model";
import { useAgentChatRowWindow } from "./use-agent-chat-row-window";
import { useAgentChatScrollController } from "./use-agent-chat-scroll-controller";

type UseAgentChatWindowInput = {
  rows: AgentChatTranscriptRow[];
  turnAnchors?: AgentChatTurnAnchor[];
  displayedSessionKey: string | null;
  shouldResetForTranscriptLoad: boolean;
  messagesContainerRef: RefObject<HTMLDivElement | null>;
  messagesContentRef: RefObject<HTMLDivElement | null>;
};

type UseAgentChatWindowResult = {
  visibleRows: AgentChatTranscriptRow[];
  visibleTurnAnchors: AgentChatTurnAnchor[];
  windowStart: number;
  isNearBottom: boolean;
  isNearTop: boolean;
  scrollToBottom: () => void;
  scrollToTop: () => void;
};

export function useAgentChatWindow({
  rows,
  turnAnchors = [],
  displayedSessionKey,
  shouldResetForTranscriptLoad,
  messagesContainerRef,
  messagesContentRef,
}: UseAgentChatWindowInput): UseAgentChatWindowResult {
  const prevSessionKeyRef = useRef<string | null>(null);
  const prevShouldResetForTranscriptLoadRef = useRef(shouldResetForTranscriptLoad);
  // The window owns the pin state, because the row window reads it and the controller changes it.
  const pinnedRef = useRef(true);
  const isPinned = useCallback(() => pinnedRef.current, []);
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
    isFollowingLatestWindow: isPinned,
    displayedSessionKey,
    messagesContainerRef,
  });
  const { isNearBottom, isNearTop, pin, unpin, syncScrollPosition } = useAgentChatScrollController({
    messagesContainerRef,
    messagesContentRef,
    pinnedRef,
    canPin: isLatestWindow,
  });
  // The scroll position depends on whether the row window is the latest one, so that also counts.
  const committedRowWindowVersion = `${windowStart}:${visibleRows.length}:${isLatestWindow}`;

  // An older row window scrolls to the bottom after the latest row window commits.
  const scrollToBottom = useCallback(() => {
    pin();
    if (!isLatestWindow) {
      selectLatestRowWindow();
    }
  }, [isLatestWindow, pin, selectLatestRowWindow]);

  useLayoutEffect(() => {
    if (prevSessionKeyRef.current === displayedSessionKey) {
      return;
    }

    prevSessionKeyRef.current = displayedSessionKey;
    scrollToBottom();
  }, [displayedSessionKey, scrollToBottom]);

  useLayoutEffect(() => {
    const finishedTranscriptLoad =
      prevShouldResetForTranscriptLoadRef.current && !shouldResetForTranscriptLoad;
    prevShouldResetForTranscriptLoadRef.current = shouldResetForTranscriptLoad;
    if (finishedTranscriptLoad) {
      scrollToBottom();
    }
  }, [scrollToBottom, shouldResetForTranscriptLoad]);

  useLayoutEffect(() => {
    void committedRowWindowVersion;
    syncScrollPosition();
  }, [committedRowWindowVersion, syncScrollPosition]);

  // Scroll anchoring does not apply at scroll offset zero, so the first rows mount at the top.
  const scrollToTop = useCallback(() => {
    unpin();
    if (windowStart !== 0) {
      selectFirstRowWindow();
    }
    const container = messagesContainerRef.current;
    if (container) {
      container.scrollTop = 0;
    }
    syncScrollPosition();
  }, [messagesContainerRef, selectFirstRowWindow, syncScrollPosition, unpin, windowStart]);

  return {
    visibleRows,
    visibleTurnAnchors,
    windowStart,
    isNearBottom: isNearBottom && isLatestWindow,
    isNearTop: isNearTop && windowStart === 0,
    scrollToBottom,
    scrollToTop,
  };
}

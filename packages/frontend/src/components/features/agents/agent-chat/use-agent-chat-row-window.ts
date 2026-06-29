import type { RefObject } from "react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  type AgentChatRowWindow,
  buildAgentChatRowWindows,
  selectTurnAnchorsForWindow,
} from "./agent-chat-row-windows";
import type { AgentChatTranscriptRow, AgentChatTurnAnchor } from "./agent-chat-transcript-model";
import { CHAT_TURN_REVEAL_EDGE_THRESHOLD_PX } from "./agent-chat-window-shared";

type UseAgentChatRowWindowInput = {
  rows: AgentChatTranscriptRow[];
  turnAnchors: AgentChatTurnAnchor[];
  displayedSessionKey: string | null;
  shouldResetForTranscriptLoad: boolean;
  shouldFollowLatestWindow: boolean;
  messagesContainerRef: RefObject<HTMLDivElement | null>;
};

type UseAgentChatRowWindowResult = {
  windowStart: number;
  isFirstWindow: boolean;
  isLatestWindow: boolean;
  visibleRows: AgentChatTranscriptRow[];
  visibleTurnAnchors: AgentChatTurnAnchor[];
  selectFirstRowWindow: () => void;
  selectLatestRowWindow: () => void;
  selectPreviousRowWindow: () => void;
  selectNextRowWindow: () => void;
};

const latestWindowIndex = (windows: AgentChatRowWindow[]): number =>
  Math.max(0, windows.length - 1);

export function useAgentChatRowWindow({
  rows,
  turnAnchors,
  displayedSessionKey,
  shouldResetForTranscriptLoad,
  shouldFollowLatestWindow,
  messagesContainerRef,
}: UseAgentChatRowWindowInput): UseAgentChatRowWindowResult {
  const windows = useMemo(() => buildAgentChatRowWindows(rows.length), [rows.length]);
  const [selectedWindowIndex, setSelectedWindowIndex] = useState(() => latestWindowIndex(windows));
  const selectedWindowIndexRef = useRef(selectedWindowIndex);
  const previousSessionKeyRef = useRef<string | null>(displayedSessionKey);
  const pendingLatestResetRef = useRef(shouldResetForTranscriptLoad && rows.length === 0);
  const pendingScrollRestoreRef = useRef<{
    beforeScrollTop: number;
    rowHeight: number;
    rowOffset: number;
  } | null>(null);
  const previousRowsLengthRef = useRef(rows.length);
  const previousLatestWindowIndexRef = useRef(latestWindowIndex(windows));

  const setWindowIndex = useCallback(
    (nextIndex: number) => {
      const clampedIndex = Math.max(0, Math.min(nextIndex, latestWindowIndex(windows)));
      selectedWindowIndexRef.current = clampedIndex;
      setSelectedWindowIndex(clampedIndex);
    },
    [windows],
  );

  const selectWithScrollRestore = useCallback(
    (nextIndex: number) => {
      const container = messagesContainerRef.current;
      const currentWindow = windows[selectedWindowIndexRef.current];
      const nextWindow = windows[Math.max(0, Math.min(nextIndex, latestWindowIndex(windows)))];
      if (container) {
        const currentRowCount = currentWindow
          ? currentWindow.endRowExclusive - currentWindow.startRow
          : 0;
        const rowHeight = currentRowCount > 0 ? container.scrollHeight / currentRowCount : 0;
        pendingScrollRestoreRef.current = {
          beforeScrollTop: container.scrollTop,
          rowHeight,
          rowOffset: currentWindow && nextWindow ? currentWindow.startRow - nextWindow.startRow : 0,
        };
      }
      setWindowIndex(nextIndex);
    },
    [messagesContainerRef, setWindowIndex, windows],
  );

  const selectFirstRowWindow = useCallback(() => setWindowIndex(0), [setWindowIndex]);
  const selectLatestRowWindow = useCallback(() => {
    if (shouldResetForTranscriptLoad && rows.length === 0) {
      pendingLatestResetRef.current = true;
      return;
    }
    setWindowIndex(latestWindowIndex(windows));
  }, [rows.length, setWindowIndex, shouldResetForTranscriptLoad, windows]);
  const selectPreviousRowWindow = useCallback(() => {
    if (selectedWindowIndexRef.current <= 0) return;
    selectWithScrollRestore(selectedWindowIndexRef.current - 1);
  }, [selectWithScrollRestore]);
  const selectNextRowWindow = useCallback(() => {
    if (selectedWindowIndexRef.current >= latestWindowIndex(windows)) return;
    selectWithScrollRestore(selectedWindowIndexRef.current + 1);
  }, [selectWithScrollRestore, windows]);

  const effectiveIndex = Math.max(0, Math.min(selectedWindowIndex, latestWindowIndex(windows)));
  const window = windows[effectiveIndex] ??
    windows[0] ?? { index: 0, startRow: 0, endRowExclusive: 0 };
  const visibleRows = useMemo(
    () => rows.slice(window.startRow, window.endRowExclusive),
    [rows, window.endRowExclusive, window.startRow],
  );
  const visibleTurnAnchors = useMemo(
    () => selectTurnAnchorsForWindow(turnAnchors, window),
    [turnAnchors, window],
  );

  useLayoutEffect(() => {
    const didSessionChange = previousSessionKeyRef.current !== displayedSessionKey;
    if (didSessionChange) {
      previousSessionKeyRef.current = displayedSessionKey;
      pendingLatestResetRef.current = shouldResetForTranscriptLoad && rows.length === 0;
    }

    if ((didSessionChange || pendingLatestResetRef.current) && rows.length > 0) {
      pendingLatestResetRef.current = false;
      setWindowIndex(latestWindowIndex(windows));
      return;
    }

    const previousRowsLength = previousRowsLengthRef.current;
    const previousLatestIndex = previousLatestWindowIndexRef.current;
    previousRowsLengthRef.current = rows.length;
    previousLatestWindowIndexRef.current = latestWindowIndex(windows);

    if (
      rows.length !== previousRowsLength &&
      shouldFollowLatestWindow &&
      selectedWindowIndexRef.current === previousLatestIndex &&
      selectedWindowIndexRef.current !== latestWindowIndex(windows)
    ) {
      setWindowIndex(latestWindowIndex(windows));
      return;
    }

    if (selectedWindowIndexRef.current > latestWindowIndex(windows)) {
      setWindowIndex(latestWindowIndex(windows));
    }
  }, [
    displayedSessionKey,
    rows.length,
    setWindowIndex,
    shouldFollowLatestWindow,
    shouldResetForTranscriptLoad,
    windows,
  ]);

  useLayoutEffect(() => {
    const pendingRestore = pendingScrollRestoreRef.current;
    const container = messagesContainerRef.current;
    pendingScrollRestoreRef.current = null;
    if (!pendingRestore || !container) return;

    container.scrollTop = Math.max(
      0,
      pendingRestore.beforeScrollTop + pendingRestore.rowOffset * pendingRestore.rowHeight,
    );
  });

  useEffect(() => {
    const container = messagesContainerRef.current;
    if (!container) return;

    const handleScroll = () => {
      if (container.scrollTop < CHAT_TURN_REVEAL_EDGE_THRESHOLD_PX) {
        selectPreviousRowWindow();
        return;
      }
      const distanceFromBottom =
        container.scrollHeight - container.scrollTop - container.clientHeight;
      if (distanceFromBottom < CHAT_TURN_REVEAL_EDGE_THRESHOLD_PX) {
        selectNextRowWindow();
      }
    };

    container.addEventListener("scroll", handleScroll, { passive: true });
    return () => container.removeEventListener("scroll", handleScroll);
  }, [messagesContainerRef, selectNextRowWindow, selectPreviousRowWindow]);

  return {
    windowStart: window.startRow,
    isFirstWindow: effectiveIndex === 0,
    isLatestWindow: effectiveIndex === latestWindowIndex(windows),
    visibleRows,
    visibleTurnAnchors,
    selectFirstRowWindow,
    selectLatestRowWindow,
    selectPreviousRowWindow,
    selectNextRowWindow,
  };
}

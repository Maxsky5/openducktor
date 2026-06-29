import type { RefObject } from "react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  AGENT_CHAT_ROW_WINDOW_SIZE,
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

const latestWindowStart = (windows: AgentChatRowWindow[]): number =>
  windows[latestWindowIndex(windows)]?.startRow ?? 0;

const clampWindowStart = (startRow: number, windows: AgentChatRowWindow[]): number =>
  Math.max(0, Math.min(startRow, latestWindowStart(windows)));

const buildWindowFromStart = (
  startRow: number,
  rowCount: number,
): Pick<AgentChatRowWindow, "startRow" | "endRowExclusive"> => ({
  startRow,
  endRowExclusive: Math.min(rowCount, startRow + AGENT_CHAT_ROW_WINDOW_SIZE),
});

const previousWindowStart = (windows: AgentChatRowWindow[], currentStartRow: number): number => {
  for (let index = windows.length - 1; index >= 0; index -= 1) {
    const window = windows[index];
    if (window && window.startRow < currentStartRow) {
      return window.startRow;
    }
  }

  return 0;
};

const nextWindowStart = (windows: AgentChatRowWindow[], currentStartRow: number): number => {
  for (const window of windows) {
    if (window.startRow > currentStartRow) {
      return window.startRow;
    }
  }

  return latestWindowStart(windows);
};

export function useAgentChatRowWindow({
  rows,
  turnAnchors,
  displayedSessionKey,
  shouldResetForTranscriptLoad,
  shouldFollowLatestWindow,
  messagesContainerRef,
}: UseAgentChatRowWindowInput): UseAgentChatRowWindowResult {
  const windows = useMemo(() => buildAgentChatRowWindows(rows.length), [rows.length]);
  const [selectedWindowStart, setSelectedWindowStart] = useState(() => latestWindowStart(windows));
  const selectedWindowStartRef = useRef(selectedWindowStart);
  const previousSessionKeyRef = useRef<string | null>(displayedSessionKey);
  const pendingLatestResetRef = useRef(shouldResetForTranscriptLoad && rows.length === 0);
  const pendingScrollRestoreRef = useRef<{
    beforeScrollTop: number;
    rowHeight: number;
    rowOffset: number;
  } | null>(null);
  const previousRowsLengthRef = useRef(rows.length);
  const previousLatestWindowStartRef = useRef(latestWindowStart(windows));

  const setWindowStart = useCallback(
    (nextStart: number) => {
      const clampedStart = clampWindowStart(nextStart, windows);
      selectedWindowStartRef.current = clampedStart;
      setSelectedWindowStart(clampedStart);
    },
    [windows],
  );

  const selectWithScrollRestore = useCallback(
    (nextStart: number) => {
      const container = messagesContainerRef.current;
      const currentStart = clampWindowStart(selectedWindowStartRef.current, windows);
      const currentWindow = buildWindowFromStart(currentStart, rows.length);
      const clampedNextStart = clampWindowStart(nextStart, windows);
      const nextWindow = buildWindowFromStart(clampedNextStart, rows.length);
      if (container) {
        const currentRowCount = currentWindow.endRowExclusive - currentWindow.startRow;
        const rowHeight = currentRowCount > 0 ? container.scrollHeight / currentRowCount : 0;
        pendingScrollRestoreRef.current = {
          beforeScrollTop: container.scrollTop,
          rowHeight,
          rowOffset: currentWindow.startRow - nextWindow.startRow,
        };
      }
      setWindowStart(clampedNextStart);
    },
    [messagesContainerRef, rows.length, setWindowStart, windows],
  );

  const selectFirstRowWindow = useCallback(() => setWindowStart(0), [setWindowStart]);
  const selectLatestRowWindow = useCallback(() => {
    if (shouldResetForTranscriptLoad && rows.length === 0) {
      pendingLatestResetRef.current = true;
      return;
    }
    setWindowStart(latestWindowStart(windows));
  }, [rows.length, setWindowStart, shouldResetForTranscriptLoad, windows]);
  const selectPreviousRowWindow = useCallback(() => {
    const previousStart = previousWindowStart(windows, selectedWindowStartRef.current);
    if (previousStart === selectedWindowStartRef.current) return;
    selectWithScrollRestore(previousStart);
  }, [selectWithScrollRestore, windows]);
  const selectNextRowWindow = useCallback(() => {
    const nextStart = nextWindowStart(windows, selectedWindowStartRef.current);
    if (nextStart === selectedWindowStartRef.current) return;
    selectWithScrollRestore(nextStart);
  }, [selectWithScrollRestore, windows]);

  const effectiveWindowStart = clampWindowStart(selectedWindowStart, windows);
  const window = useMemo(
    () => buildWindowFromStart(effectiveWindowStart, rows.length),
    [effectiveWindowStart, rows.length],
  );
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
      setWindowStart(latestWindowStart(windows));
      return;
    }

    const previousRowsLength = previousRowsLengthRef.current;
    const previousLatestStart = previousLatestWindowStartRef.current;
    previousRowsLengthRef.current = rows.length;
    previousLatestWindowStartRef.current = latestWindowStart(windows);

    if (
      rows.length !== previousRowsLength &&
      shouldFollowLatestWindow &&
      selectedWindowStartRef.current === previousLatestStart &&
      selectedWindowStartRef.current !== latestWindowStart(windows)
    ) {
      setWindowStart(latestWindowStart(windows));
      return;
    }

    if (selectedWindowStartRef.current > latestWindowStart(windows)) {
      setWindowStart(latestWindowStart(windows));
    }
  }, [
    displayedSessionKey,
    rows.length,
    setWindowStart,
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
    isFirstWindow: window.startRow === 0,
    isLatestWindow: window.startRow === latestWindowStart(windows),
    visibleRows,
    visibleTurnAnchors,
    selectFirstRowWindow,
    selectLatestRowWindow,
    selectPreviousRowWindow,
    selectNextRowWindow,
  };
}

import type { RefObject } from "react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  AGENT_CHAT_ROW_WINDOW_EDGE_PRELOAD_COUNT,
  AGENT_CHAT_ROW_WINDOW_SIZE,
  selectTurnAnchorsForWindow,
} from "./agent-chat-row-windows";
import type { AgentChatTranscriptRow, AgentChatTurnAnchor } from "./agent-chat-transcript-model";
import { CHAT_TURN_REVEAL_EDGE_THRESHOLD_PX } from "./agent-chat-window-shared";

type UseAgentChatRowWindowInput = {
  rows: AgentChatTranscriptRow[];
  turnAnchors: AgentChatTurnAnchor[];
  displayedSessionKey: string | null;
  shouldResetForTranscriptLoad: boolean;
  isFollowingLatestWindow: () => boolean;
  messagesContainerRef: RefObject<HTMLDivElement | null>;
};

type UseAgentChatRowWindowResult = {
  windowStart: number;
  isLatestWindow: boolean;
  visibleRows: AgentChatTranscriptRow[];
  visibleTurnAnchors: AgentChatTurnAnchor[];
  selectFirstRowWindow: () => void;
  selectLatestRowWindow: () => void;
};

type RowRange = {
  startRow: number;
  endRowExclusive: number;
};

type SessionRowRange = {
  sessionKey: string | null;
  range: RowRange;
  /** Keys of the first and last rows in the range, so that the range can follow rows that move. */
  firstRowKey: string | null;
  lastRowKey: string | null;
};

// A mounted row, with its index among the mounted rows and its distance from the viewport top.
type RowAnchor = {
  rowKey: string;
  index: number;
  top: number;
};

type ExpandBeforeOptions = {
  trimBottomAfterPrepend?: boolean;
};

type ExpandAfterOptions = {
  trimTopAfterAppend?: boolean;
};

const MAX_MOUNTED_ROW_COUNT = AGENT_CHAT_ROW_WINDOW_SIZE * 3;

const latestWindowStart = (rowCount: number): number =>
  Math.max(0, rowCount - AGENT_CHAT_ROW_WINDOW_SIZE);

const clampStart = (startRow: number, rowCount: number): number =>
  Math.max(0, Math.min(startRow, rowCount));

const clampEnd = (endRowExclusive: number, rowCount: number): number =>
  Math.max(0, Math.min(endRowExclusive, rowCount));

const latestRange = (rowCount: number): RowRange => ({
  startRow: latestWindowStart(rowCount),
  endRowExclusive: rowCount,
});

const firstRange = (rowCount: number): RowRange => ({
  startRow: 0,
  endRowExclusive: Math.min(rowCount, AGENT_CHAT_ROW_WINDOW_SIZE),
});

const clampRange = (range: RowRange, rowCount: number): RowRange => {
  const startRow = clampStart(range.startRow, rowCount);
  const endRowExclusive = Math.max(startRow, clampEnd(range.endRowExclusive, rowCount));
  return { startRow, endRowExclusive };
};

const areRangesEqual = (left: RowRange, right: RowRange): boolean =>
  left.startRow === right.startRow && left.endRowExclusive === right.endRowExclusive;

const sessionRowRange = (
  sessionKey: string | null,
  range: RowRange,
  rows: AgentChatTranscriptRow[],
): SessionRowRange => ({
  sessionKey,
  range,
  firstRowKey: rows[range.startRow]?.key ?? null,
  lastRowKey: rows[range.endRowExclusive - 1]?.key ?? null,
});

const findRowIndex = (
  rows: AgentChatTranscriptRow[],
  rowKey: string | null,
  expectedIndex: number,
): number | null => {
  if (rowKey === null) return null;
  if (rows[expectedIndex]?.key === rowKey) return expectedIndex;
  const index = rows.findIndex((row) => row.key === rowKey);
  return index < 0 ? null : index;
};

/**
 * Rows can move before the layout effects set a new range, for example when the transcript inserts
 * a row inside the window or prepends history. The range follows its first and last rows, so no
 * mounted row leaves the window for one render and mounts again. A range whose edge row is gone
 * keeps its indexes.
 */
const followRangeRows = (
  { range, firstRowKey, lastRowKey }: SessionRowRange,
  rows: AgentChatTranscriptRow[],
): RowRange => {
  const startRow = findRowIndex(rows, firstRowKey, range.startRow);
  const lastRow = findRowIndex(rows, lastRowKey, range.endRowExclusive - 1);
  if (startRow === null || lastRow === null) return range;
  if (startRow === range.startRow && lastRow + 1 === range.endRowExclusive) return range;
  return { startRow, endRowExclusive: lastRow + 1 };
};

const rowCountForRange = (range: RowRange): number =>
  Math.max(0, range.endRowExclusive - range.startRow);

const trimRowCount = (range: RowRange): number =>
  Math.max(0, rowCountForRange(range) - MAX_MOUNTED_ROW_COUNT);

const isElementVisibleInContainer = (element: HTMLElement, container: HTMLDivElement): boolean => {
  const elementRect = element.getBoundingClientRect();
  const containerRect = container.getBoundingClientRect();
  return elementRect.bottom >= containerRect.top && elementRect.top <= containerRect.bottom;
};

const isMountedRowNearStart = (container: HTMLDivElement): boolean => {
  const rows = Array.from(container.querySelectorAll<HTMLElement>("[data-row-key]"));
  if (rows.length === 0) return false;

  const preloadRow = rows[Math.min(AGENT_CHAT_ROW_WINDOW_EDGE_PRELOAD_COUNT, rows.length - 1)];
  return preloadRow ? isElementVisibleInContainer(preloadRow, container) : false;
};

const isMountedRowNearEnd = (container: HTMLDivElement): boolean => {
  const rows = Array.from(container.querySelectorAll<HTMLElement>("[data-row-key]"));
  if (rows.length === 0) return false;

  const preloadRow = rows[Math.max(0, rows.length - 1 - AGENT_CHAT_ROW_WINDOW_EDGE_PRELOAD_COUNT)];
  return preloadRow ? isElementVisibleInContainer(preloadRow, container) : false;
};

const readRowAnchor = (container: HTMLDivElement, rowKey: string): RowAnchor | null => {
  const rows = Array.from(container.querySelectorAll<HTMLElement>("[data-row-key]"));
  const index = rows.findIndex((row) => row.dataset.rowKey === rowKey);
  const row = rows[index];
  if (!row) return null;

  const top = row.getBoundingClientRect().top - container.getBoundingClientRect().top;
  return { rowKey, index, top };
};

export function useAgentChatRowWindow({
  rows,
  turnAnchors,
  displayedSessionKey,
  shouldResetForTranscriptLoad,
  isFollowingLatestWindow,
  messagesContainerRef,
}: UseAgentChatRowWindowInput): UseAgentChatRowWindowResult {
  const [sessionRange, setSessionRange] = useState<SessionRowRange>(() =>
    sessionRowRange(displayedSessionKey, latestRange(rows.length), rows),
  );
  const didSessionChange = sessionRange.sessionKey !== displayedSessionKey;
  const range = didSessionChange ? latestRange(rows.length) : followRangeRows(sessionRange, rows);
  const rangeRef = useRef(range);
  const pendingLatestResetRef = useRef(shouldResetForTranscriptLoad && rows.length === 0);
  const previousRowsLengthRef = useRef(rows.length);
  // A row that stays mounted while rows mount or unmount above it, to keep it in place.
  const pendingRowAnchorRef = useRef<RowAnchor | null>(null);
  const shouldTrimBottomAfterPrependRef = useRef(false);
  const shouldTrimTopAfterAppendRef = useRef(false);
  const lastScrollTopRef = useRef(0);

  useLayoutEffect(() => {
    if (!didSessionChange) {
      return;
    }

    const nextRange = latestRange(rows.length);
    rangeRef.current = nextRange;
    pendingLatestResetRef.current = shouldResetForTranscriptLoad && rows.length === 0;
    previousRowsLengthRef.current = rows.length;
    setSessionRange(sessionRowRange(displayedSessionKey, nextRange, rows));
  }, [didSessionChange, displayedSessionKey, rows, shouldResetForTranscriptLoad]);

  const setRange = useCallback(
    (nextRange: RowRange) => {
      const clampedRange = clampRange(nextRange, rows.length);
      rangeRef.current = clampedRange;
      const next = sessionRowRange(displayedSessionKey, clampedRange, rows);
      setSessionRange((current) =>
        current.sessionKey === next.sessionKey &&
        areRangesEqual(current.range, next.range) &&
        current.firstRowKey === next.firstRowKey &&
        current.lastRowKey === next.lastRowKey
          ? current
          : next,
      );
    },
    [displayedSessionKey, rows],
  );

  const selectFirstRowWindow = useCallback(() => {
    setRange(firstRange(rows.length));
  }, [rows.length, setRange]);

  const selectLatestRowWindow = useCallback(() => {
    if (shouldResetForTranscriptLoad && rows.length === 0) {
      pendingLatestResetRef.current = true;
      return;
    }

    setRange(latestRange(rows.length));
  }, [rows.length, setRange, shouldResetForTranscriptLoad]);

  // Rows that mount or unmount above the viewport move every row below them.
  // This hook saves the position of a row that stays mounted, then scrolls by the distance it moved.
  const anchorRow = useCallback(
    (rowKey: string | undefined) => {
      const container = messagesContainerRef.current;
      pendingRowAnchorRef.current = container && rowKey ? readRowAnchor(container, rowKey) : null;
    },
    [messagesContainerRef],
  );

  const expandBefore = useCallback(
    (options?: ExpandBeforeOptions) => {
      const currentRange = rangeRef.current;
      if (currentRange.startRow === 0) return false;

      // A prepend that did not commit yet keeps its anchor, because the rows it adds are not mounted.
      if (!pendingRowAnchorRef.current) {
        anchorRow(rows[currentRange.startRow]?.key);
      }
      shouldTrimBottomAfterPrependRef.current = options?.trimBottomAfterPrepend !== false;
      setRange({
        startRow: Math.max(0, currentRange.startRow - AGENT_CHAT_ROW_WINDOW_SIZE),
        endRowExclusive: currentRange.endRowExclusive,
      });
      return true;
    },
    [anchorRow, rows, setRange],
  );

  const expandAfter = useCallback(
    (options?: ExpandAfterOptions) => {
      const currentRange = rangeRef.current;
      if (currentRange.endRowExclusive >= rows.length) return false;

      shouldTrimTopAfterAppendRef.current = options?.trimTopAfterAppend !== false;
      setRange({
        startRow: currentRange.startRow,
        endRowExclusive: Math.min(
          rows.length,
          currentRange.endRowExclusive + AGENT_CHAT_ROW_WINDOW_SIZE,
        ),
      });
      return true;
    },
    [rows.length, setRange],
  );

  // The layout can clamp the scroll position to a smaller scroll range, and browser scroll anchoring
  // can move it. The row position includes both, so the correction does not count them twice.
  useLayoutEffect(() => {
    const anchor = pendingRowAnchorRef.current;
    const container = messagesContainerRef.current;
    if (!anchor || !container) return;

    const current = readRowAnchor(container, anchor.rowKey);
    // A commit that does not change the rows above the anchor keeps its index, so the anchor waits.
    if (current?.index === anchor.index) return;

    pendingRowAnchorRef.current = null;
    if (!current) return;

    container.scrollTop += current.top - anchor.top;
    lastScrollTopRef.current = container.scrollTop;
  });

  useLayoutEffect(() => {
    if (!shouldTrimBottomAfterPrependRef.current || pendingRowAnchorRef.current) return;

    shouldTrimBottomAfterPrependRef.current = false;
    const currentRange = rangeRef.current;
    if (rowCountForRange(currentRange) <= MAX_MOUNTED_ROW_COUNT) {
      return;
    }

    const rowsToTrim = trimRowCount(currentRange);
    if (rowsToTrim <= 0) return;

    setRange({
      startRow: currentRange.startRow,
      endRowExclusive: currentRange.endRowExclusive - rowsToTrim,
    });
  });

  useLayoutEffect(() => {
    if (!shouldTrimTopAfterAppendRef.current) return;

    shouldTrimTopAfterAppendRef.current = false;
    const currentRange = rangeRef.current;
    if (rowCountForRange(currentRange) <= MAX_MOUNTED_ROW_COUNT) {
      return;
    }

    const rowsToTrim = trimRowCount(currentRange);
    if (rowsToTrim <= 0) return;

    const startRow = currentRange.startRow + rowsToTrim;
    anchorRow(rows[startRow]?.key);
    setRange({ startRow, endRowExclusive: currentRange.endRowExclusive });
  });

  const fillViewport = useCallback(() => {
    const container = messagesContainerRef.current;
    if (!container) return;
    const currentRange = rangeRef.current;
    const height = container.clientHeight;
    const scrollHeight = container.scrollHeight;
    if (height <= 0 || scrollHeight <= 0) return;
    if (scrollHeight - height > CHAT_TURN_REVEAL_EDGE_THRESHOLD_PX) return;

    if (rowCountForRange(currentRange) >= MAX_MOUNTED_ROW_COUNT) return;

    if (currentRange.startRow > 0) {
      expandBefore({ trimBottomAfterPrepend: false });
      return;
    }

    expandAfter({ trimTopAfterAppend: false });
  }, [expandAfter, expandBefore, messagesContainerRef]);
  useLayoutEffect(fillViewport, [fillViewport, range]);
  useLayoutEffect(() => {
    const container = messagesContainerRef.current;
    if (!container) return;
    // A pane resize can leave the row window too short even when the transcript stays the same.
    const observer = new ResizeObserver(fillViewport);
    observer.observe(container);
    return () => observer.disconnect();
  }, [fillViewport, messagesContainerRef]);

  useLayoutEffect(() => {
    const previousRowsLength = previousRowsLengthRef.current;
    const previousRange = rangeRef.current;
    previousRowsLengthRef.current = rows.length;

    if (didSessionChange) {
      return;
    }

    if (pendingLatestResetRef.current && rows.length > 0) {
      pendingLatestResetRef.current = false;
      setRange(latestRange(rows.length));
      return;
    }

    if (
      rows.length !== previousRowsLength &&
      isFollowingLatestWindow() &&
      previousRange.endRowExclusive === previousRowsLength
    ) {
      setRange(latestRange(rows.length));
      return;
    }

    if (rows.length > 0 && previousRange.startRow >= rows.length) {
      setRange(latestRange(rows.length));
      return;
    }

    if (range !== sessionRange.range) {
      // Keep the range that followed its moved rows, with the keys of its new edge rows.
      setRange(range);
    }
  }, [didSessionChange, isFollowingLatestWindow, range, rows, sessionRange.range, setRange]);

  useEffect(() => {
    const container = messagesContainerRef.current;
    if (!container) return;

    const handleScroll = () => {
      // A prepend commits after this event, so its anchor follows the user's scroll until then.
      const anchor = pendingRowAnchorRef.current;
      if (anchor) {
        pendingRowAnchorRef.current = readRowAnchor(container, anchor.rowKey);
      }

      const maxScrollTop = Math.max(0, container.scrollHeight - container.clientHeight);
      const previousScrollTop = lastScrollTopRef.current;
      lastScrollTopRef.current = container.scrollTop;
      const isScrollingUp = container.scrollTop < previousScrollTop;
      const isScrollingDown = container.scrollTop > previousScrollTop;
      const isNearTop = container.scrollTop <= CHAT_TURN_REVEAL_EDGE_THRESHOLD_PX;
      const isNearBottom = maxScrollTop - container.scrollTop <= CHAT_TURN_REVEAL_EDGE_THRESHOLD_PX;
      const shouldPreloadBefore = isNearTop || (isScrollingUp && isMountedRowNearStart(container));
      const shouldPreloadAfter =
        isNearBottom || (isScrollingDown && isMountedRowNearEnd(container));

      if (shouldPreloadBefore && expandBefore()) {
        return;
      }

      if (shouldPreloadAfter) {
        expandAfter();
      }
    };

    lastScrollTopRef.current = container.scrollTop;
    container.addEventListener("scroll", handleScroll, { passive: true });
    return () => container.removeEventListener("scroll", handleScroll);
  }, [expandAfter, expandBefore, messagesContainerRef]);

  const effectiveRange = clampRange(range, rows.length);
  const effectiveStartRow = effectiveRange.startRow;
  const effectiveEndRowExclusive = effectiveRange.endRowExclusive;
  const visibleRows = useMemo(
    () => rows.slice(effectiveStartRow, effectiveEndRowExclusive),
    [effectiveEndRowExclusive, effectiveStartRow, rows],
  );
  const visibleTurnAnchors = useMemo(
    () =>
      selectTurnAnchorsForWindow(turnAnchors, {
        startRow: effectiveStartRow,
        endRowExclusive: effectiveEndRowExclusive,
      }),
    [effectiveEndRowExclusive, effectiveStartRow, turnAnchors],
  );

  return {
    windowStart: effectiveStartRow,
    isLatestWindow: effectiveEndRowExclusive === rows.length,
    visibleRows,
    visibleTurnAnchors,
    selectFirstRowWindow,
    selectLatestRowWindow,
  };
}

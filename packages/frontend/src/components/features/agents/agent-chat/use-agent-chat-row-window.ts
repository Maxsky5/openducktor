import type { RefObject } from "react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  AGENT_CHAT_ROW_WINDOW_EDGE_PRELOAD_COUNT,
  AGENT_CHAT_ROW_WINDOW_SIZE,
  type AgentChatRowWindow,
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
};

type RowRange = {
  startRow: number;
  endRowExclusive: number;
};

type PrependScrollSnapshot = {
  scrollHeight: number;
  overflowAnchor: string;
};

type TrimTopScrollSnapshot = {
  scrollHeight: number;
  overflowAnchor: string;
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

const buildWindowFromRange = (range: RowRange): AgentChatRowWindow => ({
  index: 0,
  startRow: range.startRow,
  endRowExclusive: range.endRowExclusive,
});

const areRangesEqual = (left: RowRange, right: RowRange): boolean =>
  left.startRow === right.startRow && left.endRowExclusive === right.endRowExclusive;

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

export function useAgentChatRowWindow({
  rows,
  turnAnchors,
  displayedSessionKey,
  shouldResetForTranscriptLoad,
  shouldFollowLatestWindow,
  messagesContainerRef,
}: UseAgentChatRowWindowInput): UseAgentChatRowWindowResult {
  const [range, setRangeState] = useState<RowRange>(() => latestRange(rows.length));
  const rangeRef = useRef(range);
  const previousSessionKeyRef = useRef<string | null>(displayedSessionKey);
  const pendingLatestResetRef = useRef(shouldResetForTranscriptLoad && rows.length === 0);
  const previousRowsLengthRef = useRef(rows.length);
  const previousFirstVisibleRowKeyRef = useRef(rows[range.startRow]?.key ?? null);
  const prependScrollSnapshotRef = useRef<PrependScrollSnapshot | null>(null);
  const trimTopScrollSnapshotRef = useRef<TrimTopScrollSnapshot | null>(null);
  const shouldTrimBottomAfterPrependRef = useRef(false);
  const shouldTrimTopAfterAppendRef = useRef(false);
  const lastScrollTopRef = useRef(0);

  const setRange = useCallback(
    (nextRange: RowRange) => {
      const clampedRange = clampRange(nextRange, rows.length);
      rangeRef.current = clampedRange;
      previousFirstVisibleRowKeyRef.current = rows[clampedRange.startRow]?.key ?? null;
      setRangeState((currentRange) =>
        areRangesEqual(currentRange, clampedRange) ? currentRange : clampedRange,
      );
    },
    [rows],
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

  const expandBefore = useCallback(
    (options?: ExpandBeforeOptions) => {
      const currentRange = rangeRef.current;
      if (currentRange.startRow === 0) return false;

      const container = messagesContainerRef.current;
      prependScrollSnapshotRef.current = container
        ? {
            scrollHeight: container.scrollHeight,
            overflowAnchor: container.style.overflowAnchor,
          }
        : null;
      if (container) {
        container.style.overflowAnchor = "none";
      }

      shouldTrimBottomAfterPrependRef.current = options?.trimBottomAfterPrepend !== false;
      setRange({
        startRow: Math.max(0, currentRange.startRow - AGENT_CHAT_ROW_WINDOW_SIZE),
        endRowExclusive: currentRange.endRowExclusive,
      });
      return true;
    },
    [messagesContainerRef, setRange],
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

  useLayoutEffect(() => {
    const trimTopScrollSnapshot = trimTopScrollSnapshotRef.current;
    if (!trimTopScrollSnapshot) return;

    trimTopScrollSnapshotRef.current = null;
    const container = messagesContainerRef.current;
    if (!container) return;

    container.scrollTop += Math.min(0, container.scrollHeight - trimTopScrollSnapshot.scrollHeight);
    lastScrollTopRef.current = container.scrollTop;
    container.style.overflowAnchor = trimTopScrollSnapshot.overflowAnchor;
  });

  useLayoutEffect(() => {
    const prependScrollSnapshot = prependScrollSnapshotRef.current;
    if (!prependScrollSnapshot) return;

    prependScrollSnapshotRef.current = null;
    const container = messagesContainerRef.current;
    if (!container) return;

    container.scrollTop += Math.max(0, container.scrollHeight - prependScrollSnapshot.scrollHeight);
    lastScrollTopRef.current = container.scrollTop;
    container.style.overflowAnchor = prependScrollSnapshot.overflowAnchor;

    const shouldTrimBottom = shouldTrimBottomAfterPrependRef.current;
    shouldTrimBottomAfterPrependRef.current = false;
    if (!shouldTrimBottom) return;

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
    const container = messagesContainerRef.current;
    if (!container) return;

    const currentRange = rangeRef.current;
    if (rowCountForRange(currentRange) <= MAX_MOUNTED_ROW_COUNT) {
      return;
    }

    const rowsToTrim = trimRowCount(currentRange);
    if (rowsToTrim <= 0) return;

    trimTopScrollSnapshotRef.current = {
      scrollHeight: container.scrollHeight,
      overflowAnchor: container.style.overflowAnchor,
    };
    container.style.overflowAnchor = "none";
    setRange({
      startRow: currentRange.startRow + rowsToTrim,
      endRowExclusive: currentRange.endRowExclusive,
    });
  });

  useLayoutEffect(() => {
    const container = messagesContainerRef.current;
    if (!container) return;
    if (container.clientHeight <= 0 || container.scrollHeight <= 0) return;

    const maxScrollTop = Math.max(0, container.scrollHeight - container.clientHeight);
    if (maxScrollTop > CHAT_TURN_REVEAL_EDGE_THRESHOLD_PX) return;

    const currentRange = range;
    if (rowCountForRange(currentRange) >= MAX_MOUNTED_ROW_COUNT) return;

    if (currentRange.startRow > 0) {
      expandBefore({ trimBottomAfterPrepend: false });
      return;
    }

    expandAfter({ trimTopAfterAppend: false });
  }, [expandAfter, expandBefore, messagesContainerRef, range]);

  useLayoutEffect(() => {
    const didSessionChange = previousSessionKeyRef.current !== displayedSessionKey;
    const previousRowsLength = previousRowsLengthRef.current;
    const previousRange = rangeRef.current;
    const previousFirstVisibleRowKey = previousFirstVisibleRowKeyRef.current;
    previousRowsLengthRef.current = rows.length;

    if (didSessionChange) {
      previousSessionKeyRef.current = displayedSessionKey;
      pendingLatestResetRef.current = shouldResetForTranscriptLoad && rows.length === 0;
    }

    if ((didSessionChange || pendingLatestResetRef.current) && rows.length > 0) {
      pendingLatestResetRef.current = false;
      const nextRange = latestRange(rows.length);
      setRange(nextRange);
      previousFirstVisibleRowKeyRef.current = rows[nextRange.startRow]?.key ?? null;
      return;
    }

    if (rows.length !== previousRowsLength) {
      if (shouldFollowLatestWindow && previousRange.endRowExclusive === previousRowsLength) {
        const nextRange = latestRange(rows.length);
        setRange(nextRange);
        previousFirstVisibleRowKeyRef.current = rows[nextRange.startRow]?.key ?? null;
        return;
      }

      if (previousFirstVisibleRowKey) {
        const nextFirstVisibleIndex = rows.findIndex(
          (row) => row.key === previousFirstVisibleRowKey,
        );
        if (nextFirstVisibleIndex >= 0) {
          const previousWindowSize = previousRange.endRowExclusive - previousRange.startRow;
          const nextRange = {
            startRow: nextFirstVisibleIndex,
            endRowExclusive: Math.min(rows.length, nextFirstVisibleIndex + previousWindowSize),
          };
          setRange(nextRange);
          previousFirstVisibleRowKeyRef.current = rows[nextRange.startRow]?.key ?? null;
          return;
        }
      }
    }

    if (rows.length > 0 && previousRange.startRow >= rows.length) {
      const nextRange = latestRange(rows.length);
      setRange(nextRange);
      previousFirstVisibleRowKeyRef.current = rows[nextRange.startRow]?.key ?? null;
      return;
    }

    previousFirstVisibleRowKeyRef.current = rows[rangeRef.current.startRow]?.key ?? null;
  }, [
    displayedSessionKey,
    rows,
    rows.length,
    setRange,
    shouldFollowLatestWindow,
    shouldResetForTranscriptLoad,
  ]);

  useEffect(() => {
    const container = messagesContainerRef.current;
    if (!container) return;

    const handleScroll = () => {
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
  const window = useMemo(
    () =>
      buildWindowFromRange({
        startRow: effectiveStartRow,
        endRowExclusive: effectiveEndRowExclusive,
      }),
    [effectiveEndRowExclusive, effectiveStartRow],
  );
  const visibleRows = useMemo(
    () => rows.slice(effectiveStartRow, effectiveEndRowExclusive),
    [effectiveEndRowExclusive, effectiveStartRow, rows],
  );
  const visibleTurnAnchors = useMemo(
    () => selectTurnAnchorsForWindow(turnAnchors, window),
    [turnAnchors, window],
  );

  return {
    windowStart: window.startRow,
    isFirstWindow: window.startRow === 0,
    isLatestWindow: window.endRowExclusive === rows.length,
    visibleRows,
    visibleTurnAnchors,
    selectFirstRowWindow,
    selectLatestRowWindow,
  };
}

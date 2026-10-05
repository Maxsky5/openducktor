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
  messagesContentRef: RefObject<HTMLDivElement | null>;
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
  isFollowingLatestWindow,
  messagesContainerRef,
  messagesContentRef,
}: UseAgentChatRowWindowInput): UseAgentChatRowWindowResult {
  const [sessionRange, setSessionRange] = useState<SessionRowRange>(() => ({
    sessionKey: displayedSessionKey,
    range: latestRange(rows.length),
  }));
  const didSessionChange = sessionRange.sessionKey !== displayedSessionKey;
  const range = didSessionChange ? latestRange(rows.length) : sessionRange.range;
  const rangeRef = useRef(range);
  const pendingLatestResetRef = useRef(shouldResetForTranscriptLoad && rows.length === 0);
  const previousRowsLengthRef = useRef(rows.length);
  const previousFirstVisibleRowKeyRef = useRef(rows[range.startRow]?.key ?? null);
  // The scroll height before rows mount or unmount at the top, to keep the visible rows in place.
  const scrollHeightBeforePrependRef = useRef<number | null>(null);
  const scrollHeightBeforeTrimTopRef = useRef<number | null>(null);
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
    previousFirstVisibleRowKeyRef.current = rows[nextRange.startRow]?.key ?? null;
    setSessionRange({ sessionKey: displayedSessionKey, range: nextRange });
  }, [didSessionChange, displayedSessionKey, rows, shouldResetForTranscriptLoad]);

  const setRange = useCallback(
    (nextRange: RowRange) => {
      const clampedRange = clampRange(nextRange, rows.length);
      rangeRef.current = clampedRange;
      previousFirstVisibleRowKeyRef.current = rows[clampedRange.startRow]?.key ?? null;
      setSessionRange((current) =>
        current.sessionKey === displayedSessionKey && areRangesEqual(current.range, clampedRange)
          ? current
          : { sessionKey: displayedSessionKey, range: clampedRange },
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

  // This hook moves the scroll position itself when rows mount or unmount at the top.
  // It turns scroll anchoring off on the content, because the pin state owns it on the container.
  const suspendScrollAnchoring = useCallback(() => {
    const content = messagesContentRef.current;
    if (content) {
      content.style.overflowAnchor = "none";
    }
  }, [messagesContentRef]);

  const resumeScrollAnchoring = useCallback(() => {
    const content = messagesContentRef.current;
    if (content) {
      content.style.overflowAnchor = "";
    }
  }, [messagesContentRef]);

  const expandBefore = useCallback(
    (options?: ExpandBeforeOptions) => {
      const currentRange = rangeRef.current;
      if (currentRange.startRow === 0) return false;

      const container = messagesContainerRef.current;
      if (container) {
        scrollHeightBeforePrependRef.current = container.scrollHeight;
        suspendScrollAnchoring();
      }

      shouldTrimBottomAfterPrependRef.current = options?.trimBottomAfterPrepend !== false;
      setRange({
        startRow: Math.max(0, currentRange.startRow - AGENT_CHAT_ROW_WINDOW_SIZE),
        endRowExclusive: currentRange.endRowExclusive,
      });
      return true;
    },
    [messagesContainerRef, setRange, suspendScrollAnchoring],
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
    const scrollHeightBeforeTrimTop = scrollHeightBeforeTrimTopRef.current;
    if (scrollHeightBeforeTrimTop === null) return;

    scrollHeightBeforeTrimTopRef.current = null;
    const container = messagesContainerRef.current;
    if (!container) return;

    container.scrollTop += Math.min(0, container.scrollHeight - scrollHeightBeforeTrimTop);
    lastScrollTopRef.current = container.scrollTop;
    resumeScrollAnchoring();
  });

  useLayoutEffect(() => {
    const scrollHeightBeforePrepend = scrollHeightBeforePrependRef.current;
    if (scrollHeightBeforePrepend === null) return;

    scrollHeightBeforePrependRef.current = null;
    const container = messagesContainerRef.current;
    if (!container) return;

    container.scrollTop += Math.max(0, container.scrollHeight - scrollHeightBeforePrepend);
    lastScrollTopRef.current = container.scrollTop;
    resumeScrollAnchoring();

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

    scrollHeightBeforeTrimTopRef.current = container.scrollHeight;
    suspendScrollAnchoring();
    setRange({
      startRow: currentRange.startRow + rowsToTrim,
      endRowExclusive: currentRange.endRowExclusive,
    });
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
    const previousFirstVisibleRowKey = previousFirstVisibleRowKeyRef.current;
    previousRowsLengthRef.current = rows.length;

    if (didSessionChange) {
      return;
    }

    if (pendingLatestResetRef.current && rows.length > 0) {
      pendingLatestResetRef.current = false;
      setRange(latestRange(rows.length));
      return;
    }

    if (rows.length !== previousRowsLength) {
      if (isFollowingLatestWindow() && previousRange.endRowExclusive === previousRowsLength) {
        setRange(latestRange(rows.length));
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
          return;
        }
      }
    }

    if (rows.length > 0 && previousRange.startRow >= rows.length) {
      setRange(latestRange(rows.length));
      return;
    }

    previousFirstVisibleRowKeyRef.current = rows[rangeRef.current.startRow]?.key ?? null;
  }, [didSessionChange, isFollowingLatestWindow, rows, rows.length, setRange]);

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

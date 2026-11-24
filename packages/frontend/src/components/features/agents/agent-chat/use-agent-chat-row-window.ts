import type { RefObject } from "react";
import {
  useCallback,
  useEffect,
  useEffectEvent,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  AGENT_CHAT_ROW_WINDOW_EDGE_PRELOAD_COUNT,
  AGENT_CHAT_ROW_WINDOW_SIZE,
  selectTurnAnchorsForWindow,
} from "./agent-chat-row-windows";
import type {
  AgentChatTranscriptRow,
  AgentChatTurnAnchor,
} from "@openducktor/frontend-core/sessions/transcript/agent-chat-transcript-model";
import { CHAT_TURN_REVEAL_EDGE_THRESHOLD_PX, readMountedRows } from "./agent-chat-window-shared";

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
  anchorCurrentRowWindow: () => void;
  followLatestOnAppend: () => void;
  selectRowWindowAround: (rowIndex: number) => void;
  expandRowWindowEnd: () => void;
  rereadRowAnchor: () => void;
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

type LatestWindowMode = {
  kind: "latest";
  sessionKey: string | null;
  /** Grown by viewport fill when `AGENT_CHAT_ROW_WINDOW_SIZE` compact rows do not fill the pane. */
  rowLimit: number;
};

type AnchoredWindowMode = SessionRowRange & {
  kind: "anchored";
  rowCount: number;
  followOnAppend: boolean;
  latestRowLimit: number;
};

type WindowMode = LatestWindowMode | AnchoredWindowMode;

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

const latestWindowStart = (rowCount: number, rowLimit = AGENT_CHAT_ROW_WINDOW_SIZE): number =>
  Math.max(0, rowCount - rowLimit);

const clampStart = (startRow: number, rowCount: number): number =>
  Math.max(0, Math.min(startRow, rowCount));

const clampEnd = (endRowExclusive: number, rowCount: number): number =>
  Math.max(0, Math.min(endRowExclusive, rowCount));

const latestRange = (rowCount: number, rowLimit = AGENT_CHAT_ROW_WINDOW_SIZE): RowRange => ({
  startRow: latestWindowStart(rowCount, rowLimit),
  endRowExclusive: rowCount,
});

const readLatestRowLimit = (mode: WindowMode): number =>
  mode.kind === "latest" ? mode.rowLimit : mode.latestRowLimit;

const growRowLimit = (rowLimit: number): number =>
  Math.min(MAX_MOUNTED_ROW_COUNT, rowLimit + AGENT_CHAT_ROW_WINDOW_SIZE);

const firstRange = (rowCount: number): RowRange => ({
  startRow: 0,
  endRowExclusive: Math.min(rowCount, AGENT_CHAT_ROW_WINDOW_SIZE),
});

// A full row window with the row near its start, so rows above it can show at once.
const rangeAround = (rowIndex: number, rowCount: number): RowRange => {
  const startRow = Math.max(
    0,
    Math.min(
      rowIndex - AGENT_CHAT_ROW_WINDOW_EDGE_PRELOAD_COUNT,
      rowCount - AGENT_CHAT_ROW_WINDOW_SIZE,
    ),
  );
  return { startRow, endRowExclusive: startRow + AGENT_CHAT_ROW_WINDOW_SIZE };
};

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
  rowKey: string,
  expectedIndex: number,
): number | null => {
  if (rows[expectedIndex]?.key === rowKey) return expectedIndex;
  const index = rows.findIndex((row) => row.key === rowKey);
  return index < 0 ? null : index;
};

/**
 * Rows can move before the layout effects set a new range, for example when the transcript inserts
 * a row inside the window or prepends history. The range follows its first and last rows, so no
 * mounted row leaves the window for one render and mounts again. A range whose edge row is gone
 * keeps its indexes in a new object, so that the layout effect stores its new edge rows.
 */
const followRangeRows = (
  { range, firstRowKey, lastRowKey }: SessionRowRange,
  rows: AgentChatTranscriptRow[],
): RowRange => {
  if (firstRowKey === null || lastRowKey === null) return range;
  const startRow = findRowIndex(rows, firstRowKey, range.startRow);
  const lastRow = findRowIndex(rows, lastRowKey, range.endRowExclusive - 1);
  if (startRow === null || lastRow === null) return { ...range };
  if (startRow === range.startRow && lastRow + 1 === range.endRowExclusive) return range;
  return { startRow, endRowExclusive: lastRow + 1 };
};

const rowCountForRange = (range: RowRange): number =>
  Math.max(0, range.endRowExclusive - range.startRow);

const hasHiddenRowsForRange = (range: RowRange, rowCount: number): boolean =>
  range.startRow > 0 || range.endRowExclusive < rowCount;

const shouldFollowLatestAppend = (mode: AnchoredWindowMode, rowCount: number): boolean =>
  mode.followOnAppend && rowCount !== mode.rowCount && mode.range.endRowExclusive === mode.rowCount;

type ResolvedWindowMode = {
  mode: WindowMode;
  range: RowRange;
};

const resolveWindowMode = (
  mode: WindowMode,
  displayedSessionKey: string | null,
  rows: AgentChatTranscriptRow[],
): ResolvedWindowMode => {
  if (mode.sessionKey !== displayedSessionKey) {
    return {
      mode: {
        kind: "latest",
        sessionKey: displayedSessionKey,
        rowLimit: AGENT_CHAT_ROW_WINDOW_SIZE,
      },
      range: latestRange(rows.length),
    };
  }

  if (mode.kind === "latest") {
    return { mode, range: latestRange(rows.length, mode.rowLimit) };
  }

  if (shouldFollowLatestAppend(mode, rows.length)) {
    return {
      mode: {
        kind: "latest",
        sessionKey: displayedSessionKey,
        rowLimit: mode.latestRowLimit,
      },
      range: latestRange(rows.length, mode.latestRowLimit),
    };
  }

  let nextRange: RowRange;
  if (rows.length > 0 && mode.range.startRow >= rows.length) {
    nextRange = latestRange(rows.length, mode.latestRowLimit);
  } else {
    const followed = followRangeRows(mode, rows);
    // Keep every row mounted in a single-window transcript unless history was prepended above it.
    if (
      followed.startRow === 0 &&
      mode.range.endRowExclusive === mode.rowCount &&
      rows.length <= mode.latestRowLimit
    ) {
      nextRange = { startRow: 0, endRowExclusive: rows.length };
    } else {
      nextRange = followed;
    }
  }

  const clamped = clampRange(nextRange, rows.length);
  const next = sessionRowRange(displayedSessionKey, clamped, rows);
  const shouldSyncSingleWindowGrowth =
    clamped.startRow === 0 &&
    clamped.endRowExclusive === rows.length &&
    mode.rowCount !== rows.length;
  if (
    !areRangesEqual(mode.range, next.range) ||
    mode.firstRowKey !== next.firstRowKey ||
    mode.lastRowKey !== next.lastRowKey ||
    shouldSyncSingleWindowGrowth
  ) {
    return {
      mode: {
        kind: "anchored",
        ...next,
        rowCount: rows.length,
        followOnAppend: mode.followOnAppend,
        latestRowLimit: mode.latestRowLimit,
      },
      range: clamped,
    };
  }

  return { mode, range: clamped };
};

const trimRowCount = (range: RowRange): number =>
  Math.max(0, rowCountForRange(range) - MAX_MOUNTED_ROW_COUNT);

const isElementVisibleInContainer = (element: HTMLElement, container: HTMLDivElement): boolean => {
  const elementRect = element.getBoundingClientRect();
  const containerRect = container.getBoundingClientRect();
  return elementRect.bottom >= containerRect.top && elementRect.top <= containerRect.bottom;
};

const isMountedRowNearStart = (container: HTMLDivElement): boolean => {
  const rows = readMountedRows(container);
  if (rows.length === 0) return false;

  const preloadRow = rows[Math.min(AGENT_CHAT_ROW_WINDOW_EDGE_PRELOAD_COUNT, rows.length - 1)];
  return preloadRow ? isElementVisibleInContainer(preloadRow, container) : false;
};

const isMountedRowNearEnd = (container: HTMLDivElement): boolean => {
  const rows = readMountedRows(container);
  if (rows.length === 0) return false;

  const preloadRow = rows[Math.max(0, rows.length - 1 - AGENT_CHAT_ROW_WINDOW_EDGE_PRELOAD_COUNT)];
  return preloadRow ? isElementVisibleInContainer(preloadRow, container) : false;
};

const readRowAnchor = (container: HTMLDivElement, rowKey: string): RowAnchor | null => {
  const rows = readMountedRows(container);
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
  const [mode, setMode] = useState<WindowMode>(() => ({
    kind: "latest",
    sessionKey: displayedSessionKey,
    rowLimit: AGENT_CHAT_ROW_WINDOW_SIZE,
  }));
  const resolved = resolveWindowMode(mode, displayedSessionKey, rows);
  if (resolved.mode !== mode) {
    setMode(resolved.mode);
  }

  const effectiveStartRow = resolved.range.startRow;
  const effectiveEndRowExclusive = resolved.range.endRowExclusive;
  const effectiveRange = useMemo<RowRange>(
    () => ({ startRow: effectiveStartRow, endRowExclusive: effectiveEndRowExclusive }),
    [effectiveStartRow, effectiveEndRowExclusive],
  );
  const isFullTranscriptVisible =
    effectiveStartRow === 0 && effectiveEndRowExclusive === rows.length;
  const latestInputsRef = useRef({ rows, displayedSessionKey, shouldResetForTranscriptLoad });
  const modeRef = useRef(resolved.mode);
  const rangeRef = useRef(effectiveRange);
  // A row that stays mounted while rows mount or unmount above it, to keep it in place.
  const pendingRowAnchorRef = useRef<RowAnchor | null>(null);
  const shouldTrimBottomAfterPrependRef = useRef(false);
  const shouldTrimTopAfterAppendRef = useRef(false);
  const lastScrollTopRef = useRef(0);

  useLayoutEffect(() => {
    void displayedSessionKey;
    pendingRowAnchorRef.current = null;
    shouldTrimBottomAfterPrependRef.current = false;
    shouldTrimTopAfterAppendRef.current = false;
  }, [displayedSessionKey]);

  // Keep imperative handlers current after each committed window.
  useLayoutEffect(() => {
    latestInputsRef.current = { rows, displayedSessionKey, shouldResetForTranscriptLoad };
    modeRef.current = resolved.mode;
    rangeRef.current = effectiveRange;
  }, [displayedSessionKey, effectiveRange, resolved.mode, rows, shouldResetForTranscriptLoad]);

  const setRange = useCallback(
    (nextRange: RowRange) => {
      const { rows: currentRows, displayedSessionKey: currentSessionKey } = latestInputsRef.current;
      const nextClampedRange = clampRange(nextRange, currentRows.length);
      const next = sessionRowRange(currentSessionKey, nextClampedRange, currentRows);
      rangeRef.current = nextClampedRange;
      setMode((current) => {
        const nextFollowOnAppend =
          isFollowingLatestWindow() && next.range.endRowExclusive === currentRows.length;
        const nextLatestRowLimit =
          current.sessionKey === currentSessionKey
            ? readLatestRowLimit(current)
            : AGENT_CHAT_ROW_WINDOW_SIZE;
        if (
          current.kind === "anchored" &&
          current.sessionKey === next.sessionKey &&
          areRangesEqual(current.range, next.range) &&
          current.firstRowKey === next.firstRowKey &&
          current.lastRowKey === next.lastRowKey &&
          current.rowCount === currentRows.length &&
          current.followOnAppend === nextFollowOnAppend &&
          current.latestRowLimit === nextLatestRowLimit
        ) {
          return current;
        }
        return {
          kind: "anchored",
          ...next,
          rowCount: currentRows.length,
          followOnAppend: nextFollowOnAppend,
          latestRowLimit: nextLatestRowLimit,
        };
      });
    },
    [isFollowingLatestWindow],
  );

  const selectFirstRowWindow = useCallback(() => {
    setRange(firstRange(latestInputsRef.current.rows.length));
  }, [setRange]);

  const selectLatestRowWindow = useCallback(() => {
    const { rows: currentRows, displayedSessionKey: currentSessionKey } = latestInputsRef.current;
    const rowLimit =
      modeRef.current.sessionKey === currentSessionKey
        ? readLatestRowLimit(modeRef.current)
        : AGENT_CHAT_ROW_WINDOW_SIZE;
    rangeRef.current = latestRange(currentRows.length, rowLimit);
    setMode((current) => {
      const nextRowLimit =
        current.sessionKey === currentSessionKey
          ? readLatestRowLimit(current)
          : AGENT_CHAT_ROW_WINDOW_SIZE;
      return current.kind === "latest" &&
        current.sessionKey === currentSessionKey &&
        current.rowLimit === nextRowLimit
        ? current
        : { kind: "latest", sessionKey: currentSessionKey, rowLimit: nextRowLimit };
    });
  }, []);

  const anchorCurrentRowWindow = useCallback(() => {
    const { rows: currentRows, displayedSessionKey: currentSessionKey } = latestInputsRef.current;
    const currentRange = clampRange(rangeRef.current, currentRows.length);
    const next = sessionRowRange(currentSessionKey, currentRange, currentRows);
    setMode((current) => {
      const nextLatestRowLimit =
        current.sessionKey === currentSessionKey
          ? readLatestRowLimit(current)
          : AGENT_CHAT_ROW_WINDOW_SIZE;
      if (
        current.kind === "anchored" &&
        current.sessionKey === currentSessionKey &&
        !current.followOnAppend &&
        areRangesEqual(current.range, next.range) &&
        current.firstRowKey === next.firstRowKey &&
        current.lastRowKey === next.lastRowKey &&
        current.rowCount === currentRows.length &&
        current.latestRowLimit === nextLatestRowLimit
      ) {
        return current;
      }
      return {
        kind: "anchored",
        ...next,
        rowCount: currentRows.length,
        followOnAppend: false,
        latestRowLimit: nextLatestRowLimit,
      };
    });
  }, []);

  const followLatestOnAppend = useCallback(() => {
    const { rows: currentRows, displayedSessionKey: currentSessionKey } = latestInputsRef.current;
    setMode((current) => {
      if (current.kind !== "anchored" || current.sessionKey !== currentSessionKey) {
        return current;
      }
      if (current.range.endRowExclusive !== currentRows.length || current.followOnAppend) {
        return current;
      }
      return {
        ...current,
        rowCount: currentRows.length,
        followOnAppend: true,
      };
    });
  }, []);

  // A jump mounts a full row window with its target near the start. The pending anchor and trims
  // belong to the previous row window, so the jump drops them.
  const selectRowWindowAround = useCallback(
    (rowIndex: number) => {
      pendingRowAnchorRef.current = null;
      shouldTrimBottomAfterPrependRef.current = false;
      shouldTrimTopAfterAppendRef.current = false;
      setRange(rangeAround(rowIndex, latestInputsRef.current.rows.length));
    },
    [setRange],
  );

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
        anchorRow(latestInputsRef.current.rows[currentRange.startRow]?.key);
      }
      shouldTrimBottomAfterPrependRef.current = options?.trimBottomAfterPrepend !== false;
      setRange({
        startRow: Math.max(0, currentRange.startRow - AGENT_CHAT_ROW_WINDOW_SIZE),
        endRowExclusive: currentRange.endRowExclusive,
      });
      return true;
    },
    [anchorRow, setRange],
  );

  const expandAfter = useCallback(
    (options?: ExpandAfterOptions) => {
      const currentRange = rangeRef.current;
      const rowCount = latestInputsRef.current.rows.length;
      if (currentRange.endRowExclusive >= rowCount) return false;

      shouldTrimTopAfterAppendRef.current = options?.trimTopAfterAppend !== false;
      setRange({
        startRow: currentRange.startRow,
        endRowExclusive: Math.min(
          rowCount,
          currentRange.endRowExclusive + AGENT_CHAT_ROW_WINDOW_SIZE,
        ),
      });
      return true;
    },
    [setRange],
  );

  // Adds rows below without a trim, for a jump target that cannot reach the top yet.
  const expandRowWindowEnd = useCallback(() => {
    expandAfter({ trimTopAfterAppend: false });
  }, [expandAfter]);

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
    anchorRow(latestInputsRef.current.rows[startRow]?.key);
    setRange({ startRow, endRowExclusive: currentRange.endRowExclusive });
  });

  const growLatestRowWindow = useCallback(() => {
    const currentRange = rangeRef.current;
    if (currentRange.startRow === 0) return false;
    if (rowCountForRange(currentRange) >= MAX_MOUNTED_ROW_COUNT) return false;

    if (!pendingRowAnchorRef.current) {
      anchorRow(latestInputsRef.current.rows[currentRange.startRow]?.key);
    }
    setMode((current) => {
      if (current.kind !== "latest") return current;
      const nextRowLimit = growRowLimit(current.rowLimit);
      return nextRowLimit === current.rowLimit ? current : { ...current, rowLimit: nextRowLimit };
    });
    return true;
  }, [anchorRow]);

  const fillViewport = useEffectEvent(() => {
    const currentRange = rangeRef.current;
    if (!hasHiddenRowsForRange(currentRange, latestInputsRef.current.rows.length)) return;
    if (rowCountForRange(currentRange) >= MAX_MOUNTED_ROW_COUNT) return;

    const container = messagesContainerRef.current;
    if (!container) return;
    const height = container.clientHeight;
    const scrollHeight = container.scrollHeight;
    if (height <= 0 || scrollHeight <= 0) return;
    if (scrollHeight - height > CHAT_TURN_REVEAL_EDGE_THRESHOLD_PX) return;

    if (currentRange.startRow > 0) {
      if (modeRef.current.kind === "latest") {
        growLatestRowWindow();
        return;
      }
      expandBefore({ trimBottomAfterPrepend: false });
      return;
    }

    expandAfter({ trimTopAfterAppend: false });
  });
  // Before the latest window crosses its row limit and evicts its first row, expand the limit
  // whenever evicting that row would underfill the viewport and trigger a 1-frame collapse.
  const latestRowLimit = resolved.mode.kind === "latest" ? resolved.mode.rowLimit : null;
  useEffect(() => {
    if (latestRowLimit === null || latestRowLimit >= MAX_MOUNTED_ROW_COUNT) return;
    if (rows.length !== latestRowLimit) return;

    const container = messagesContainerRef.current;
    if (!container) return;
    const height = container.clientHeight;
    const scrollHeight = container.scrollHeight;
    if (height <= 0 || scrollHeight <= 0) return;
    const firstRowHeight = readMountedRows(container)[0]?.getBoundingClientRect().height ?? 0;
    if (scrollHeight - firstRowHeight - height > CHAT_TURN_REVEAL_EDGE_THRESHOLD_PX) return;

    setMode((current) => {
      if (current.kind !== "latest" || current.sessionKey !== displayedSessionKey) return current;
      const nextRowLimit = growRowLimit(current.rowLimit);
      return nextRowLimit === current.rowLimit ? current : { ...current, rowLimit: nextRowLimit };
    });
  }, [displayedSessionKey, latestRowLimit, messagesContainerRef, rows.length]);
  // The fill reads layout, so it waits for the next frame. A switch then paints the rows it
  // already has, and a streamed row does not lay out the transcript before each paint.
  const fillFrameRef = useRef<number | null>(null);
  const scheduleFillViewport = useEffectEvent(() => {
    if (fillFrameRef.current !== null) return;
    if (!hasHiddenRowsForRange(rangeRef.current, latestInputsRef.current.rows.length)) return;
    if (rowCountForRange(rangeRef.current) >= MAX_MOUNTED_ROW_COUNT) return;
    fillFrameRef.current = requestAnimationFrame(() => {
      fillFrameRef.current = null;
      fillViewport();
    });
  });
  useEffect(() => {
    return () => {
      if (fillFrameRef.current !== null) {
        cancelAnimationFrame(fillFrameRef.current);
        fillFrameRef.current = null;
      }
    };
  }, []);
  // Row content can shrink without a range change, so fill again when hidden rows remain.
  useEffect(() => {
    if (!isFullTranscriptVisible) {
      scheduleFillViewport();
    }
  }, [effectiveEndRowExclusive, effectiveStartRow, isFullTranscriptVisible, rows]);
  useLayoutEffect(() => {
    const container = messagesContainerRef.current;
    if (!container) return;
    // The observer lives once per container, so a row update does not re-observe it. A pane
    // resize can leave the row window too short even when the transcript stays the same.
    const observer = new ResizeObserver(scheduleFillViewport);
    observer.observe(container);
    return () => observer.disconnect();
  }, [messagesContainerRef]);

  // A prepend commits after a scroll, so its anchor follows the scroll until then.
  const rereadRowAnchor = useCallback(() => {
    const container = messagesContainerRef.current;
    const anchor = pendingRowAnchorRef.current;
    if (container && anchor) {
      pendingRowAnchorRef.current = readRowAnchor(container, anchor.rowKey);
    }
  }, [messagesContainerRef]);

  const handleScroll = useEffectEvent((container: HTMLDivElement): void => {
    rereadRowAnchor();

    const previousScrollTop = lastScrollTopRef.current;
    lastScrollTopRef.current = container.scrollTop;
    const rowCount = latestInputsRef.current.rows.length;
    if (!hasHiddenRowsForRange(rangeRef.current, rowCount)) return;
    if (isFollowingLatestWindow() && rangeRef.current.endRowExclusive === rowCount) return;

    const maxScrollTop = Math.max(0, container.scrollHeight - container.clientHeight);
    const isScrollingUp = container.scrollTop < previousScrollTop;
    const isScrollingDown = container.scrollTop > previousScrollTop;
    const isNearTop = container.scrollTop <= CHAT_TURN_REVEAL_EDGE_THRESHOLD_PX;
    const isNearBottom = maxScrollTop - container.scrollTop <= CHAT_TURN_REVEAL_EDGE_THRESHOLD_PX;
    const shouldPreloadBefore = isNearTop || (isScrollingUp && isMountedRowNearStart(container));
    const shouldPreloadAfter = isNearBottom || (isScrollingDown && isMountedRowNearEnd(container));

    if (shouldPreloadBefore && expandBefore()) {
      return;
    }

    if (shouldPreloadAfter) {
      expandAfter();
    }
  });

  // The listener lives once per container. A streamed row then does not read the scroll position,
  // which would lay out the page before its paint.
  useEffect(() => {
    const container = messagesContainerRef.current;
    if (!container) return;

    const onScroll = (): void => handleScroll(container);
    lastScrollTopRef.current = container.scrollTop;
    container.addEventListener("scroll", onScroll, { passive: true });
    return () => container.removeEventListener("scroll", onScroll);
  }, [messagesContainerRef]);

  const visibleRows = useMemo(
    () =>
      isFullTranscriptVisible ? rows : rows.slice(effectiveStartRow, effectiveEndRowExclusive),
    [effectiveEndRowExclusive, effectiveStartRow, isFullTranscriptVisible, rows],
  );
  const visibleTurnAnchors = useMemo(
    () =>
      isFullTranscriptVisible
        ? turnAnchors
        : selectTurnAnchorsForWindow(turnAnchors, {
            startRow: effectiveStartRow,
            endRowExclusive: effectiveEndRowExclusive,
          }),
    [effectiveEndRowExclusive, effectiveStartRow, isFullTranscriptVisible, turnAnchors],
  );

  return {
    windowStart: effectiveStartRow,
    isLatestWindow: effectiveEndRowExclusive === rows.length,
    visibleRows,
    visibleTurnAnchors,
    selectFirstRowWindow,
    selectLatestRowWindow,
    anchorCurrentRowWindow,
    followLatestOnAppend,
    selectRowWindowAround,
    expandRowWindowEnd,
    rereadRowAnchor,
  };
}

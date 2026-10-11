import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { type DynamicRowHeight, useListRef } from "react-window";
import { arraysEqual } from "@/lib/arrays-equal";
import { FILE_LIST_ROW_HEIGHT } from "./constants";
import { type FileListRow, findAnchorRow, type RowAnchor } from "./file-list-rows";
import type { FileListViewMode } from "./file-list-view-preference";

const ROW_KEY_ATTRIBUTE = "data-row-key";

/**
 * Owns the row heights and the scroll position of the virtual file list.
 * When the rows change, it keeps the top visible row in place. A new `scrollResetKey` scrolls to the top.
 *
 * Each rendered row root must spread `rowKeyAttributes(row.key)`, so the hook can find the row and its size.
 * Each row must also report its height with `onMeasureRow` in a layout effect, and again for a new
 * `measurementKey`, so the heights are known before paint.
 */
export function useFileListScrollAnchor({
  rows,
  measurementKey,
  viewMode,
  scrollResetKey,
}: {
  rows: readonly FileListRow[];
  /** A new owner, such as another task or diff scope, drops the known heights. */
  measurementKey: string;
  /** Row headers have another height in each view, so a view switch changes the known heights. */
  viewMode: FileListViewMode;
  scrollResetKey: string;
}) {
  const listRef = useListRef(null);
  const visibleRowRef = useRef<VisibleRowAnchor | null>(null);
  const pendingAnchorRef = useRef<PendingAnchor | null>(null);
  const { rowHeight, setRowHeightByKey } = useRowHeights(rows, measurementKey, viewMode);
  const previousRowsRef = useRef(rows);
  const previousViewModeRef = useRef(viewMode);
  const scrollResetKeyRef = useRef(scrollResetKey);

  const captureVisibleOffset = useCallback(() => {
    const list = listRef.current?.element;
    const anchor = visibleRowRef.current;
    if (!list || !anchor) return;
    const row = getRenderedRow(list, anchor.key);
    if (!row) return;
    anchor.offset = Math.max(0, list.getBoundingClientRect().top - row.getBoundingClientRect().top);
  }, [listRef]);

  // This runs again from the layout effect and from `onRowsRendered` until the anchor row is in place.
  // react-window's `scrollToRow` cannot keep the offset inside the row, so the hook scrolls itself.
  const restorePendingAnchor = useCallback(() => {
    const list = listRef.current?.element;
    const anchor = pendingAnchorRef.current;
    // react-window gives the list element one render after the list mounts.
    if (!anchor || !list) return;

    const { index, isAnchorRow } = findAnchorRow(rows, anchor);
    const rowKey = rows[index]?.key;
    const row = rowKey === undefined ? undefined : getRenderedRow(list, rowKey);
    if (!row) {
      let rowStart = 0;
      for (let rowIndex = 0; rowIndex < index; rowIndex++) {
        rowStart += rowHeight.getRowHeight(rowIndex) ?? rowHeight.getAverageRowHeight();
      }
      if (!scrollTowardRow(list, anchor, rowStart)) {
        pendingAnchorRef.current = null;
      }
      return;
    }

    const listTop = list.getBoundingClientRect().top;
    const rowRect = row.getBoundingClientRect();
    if (rowRect.height === 0) return;
    const knownHeight = rowHeight.getRowHeight(index) ?? rowHeight.getAverageRowHeight();
    if (Math.abs(knownHeight - rowRect.height) > 1) {
      rowHeight.setRowHeight(index, rowRect.height);
      return;
    }

    const rowStart = list.scrollTop + rowRect.top - listTop;
    const offset = isAnchorRow ? Math.min(anchor.offset, Math.max(0, rowRect.height - 1)) : 0;
    list.scrollTop = rowStart + offset;
    pendingAnchorRef.current = null;
  }, [listRef, rowHeight, rows]);

  useLayoutEffect(() => {
    const previousRows = previousRowsRef.current;
    previousRowsRef.current = rows;
    const isNewViewMode = previousViewModeRef.current !== viewMode;
    previousViewModeRef.current = viewMode;
    const isNewScrollResetKey = scrollResetKeyRef.current !== scrollResetKey;
    scrollResetKeyRef.current = scrollResetKey;
    // A new `scrollResetKey` starts at the top. The list unmounts while no row shows,
    // and it also starts at the top when it mounts again, so no old anchor may stay.
    if (isNewScrollResetKey || rows.length === 0) {
      visibleRowRef.current = null;
      pendingAnchorRef.current = null;
      const list = listRef.current?.element;
      if (list) list.scrollTop = 0;
      return;
    }
    // A view switch changes the row heights even when the rows stay the same.
    if (
      isNewViewMode ||
      !arraysEqual(previousRows, rows, (previous, row) => previous.key === row.key)
    ) {
      pendingAnchorRef.current = visibleRowRef.current && {
        ...visibleRowRef.current,
        estimatedScrollTop: null,
      };
    }
    restorePendingAnchor();
  }, [listRef, restorePendingAnchor, rows, scrollResetKey, viewMode]);

  const onRowsRendered = useCallback(
    ({ startIndex }: { startIndex: number }) => {
      restorePendingAnchor();
      // Keep the anchor that is still moving into view.
      if (pendingAnchorRef.current) return;
      const key = rows[startIndex]?.key;
      if (key) {
        visibleRowRef.current = { key, index: startIndex, offset: 0, rows };
        captureVisibleOffset();
      }
    },
    [captureVisibleOffset, restorePendingAnchor, rows],
  );

  return {
    listRef,
    rowHeight,
    onMeasureRow: setRowHeightByKey,
    onRowsRendered,
    onScroll: captureVisibleOffset,
  };
}

/** The attributes that a rendered row root must carry. */
export function rowKeyAttributes(rowKey: string) {
  return { [ROW_KEY_ATTRIBUTE]: rowKey };
}

type VisibleRowAnchor = RowAnchor & { offset: number };

type PendingAnchor = VisibleRowAnchor & {
  /** The scroll position of the last estimate, set while the anchor row is not rendered. */
  estimatedScrollTop: number | null;
};

/**
 * Scrolls toward an anchor row that is not rendered. Returns false when the anchor must be dropped.
 * react-window 2.3.3 sizes the list as the row count times the mean height of the rows that it has placed,
 * so the browser can cut a far scroll short. Each later render estimates again from the new heights.
 */
function scrollTowardRow(list: HTMLElement, anchor: PendingAnchor, rowStart: number): boolean {
  if (
    anchor.estimatedScrollTop !== null &&
    Math.abs(list.scrollTop - anchor.estimatedScrollTop) > 1
  ) {
    // The user scrolled away before the row rendered.
    return false;
  }
  list.scrollTop = rowStart;
  anchor.estimatedScrollTop = list.scrollTop;
  return true;
}

function getRenderedRow(list: HTMLElement, rowKey: string): Element | undefined {
  for (const child of list.children) {
    if (child.getAttribute(ROW_KEY_ATTRIBUTE) === rowKey) {
      return child;
    }
  }
  return undefined;
}

type KnownHeight = { height: number; viewMode: FileListViewMode };

type KnownHeights = {
  heightByKey: ReadonlyMap<string, KnownHeight>;
  /** The smallest known height in each view. It is usually the height of a closed row. */
  smallestHeightByView: ReadonlyMap<FileListViewMode, number>;
};

type OwnedHeights = KnownHeights & { measurementKey: string };

const NO_KNOWN_HEIGHTS: KnownHeights = { heightByKey: new Map(), smallestHeightByView: new Map() };

/**
 * Gives react-window the measured row heights by row key. A row keeps its height when rows move,
 * and when a closed directory or a search hides it for a time, or a view switch changes its header.
 */
function useRowHeights(
  rows: readonly FileListRow[],
  measurementKey: string,
  viewMode: FileListViewMode,
) {
  const [ownedHeights, setOwnedHeights] = useState<OwnedHeights>(() => ({
    measurementKey,
    ...NO_KNOWN_HEIGHTS,
  }));
  const { heightByKey, smallestHeightByView } =
    ownedHeights.measurementKey === measurementKey ? ownedHeights : NO_KNOWN_HEIGHTS;
  const estimatedHeight = estimatedRowHeight(viewMode, smallestHeightByView);

  const setRowHeightByKey = useCallback(
    (rowKey: string, height: number): void => {
      setOwnedHeights((current) => {
        const known = current.measurementKey === measurementKey ? current : NO_KNOWN_HEIGHTS;
        const previous = known.heightByKey.get(rowKey);
        if (previous?.height === height && previous.viewMode === viewMode) {
          return current;
        }
        const heightByKey = new Map(known.heightByKey);
        heightByKey.set(rowKey, { height, viewMode });
        const smallestHeightByView = new Map(known.smallestHeightByView);
        smallestHeightByView.set(
          viewMode,
          Math.min(known.smallestHeightByView.get(viewMode) ?? height, height),
        );
        return { measurementKey, heightByKey, smallestHeightByView };
      });
    },
    [measurementKey, viewMode],
  );

  // The observer outlives renders, so it reads the newest setter.
  const latestSetRowHeightRef = useRef(setRowHeightByKey);
  useLayoutEffect(() => {
    latestSetRowHeightRef.current = setRowHeightByKey;
  }, [setRowHeightByKey]);
  const [resizeObserver] = useState(
    () =>
      new ResizeObserver((entries) => {
        for (const { target, borderBoxSize } of entries) {
          const rowKey = target.getAttribute(ROW_KEY_ATTRIBUTE);
          if (!rowKey) {
            throw new Error(`A file list row has no ${ROW_KEY_ATTRIBUTE} attribute.`);
          }
          const height = borderBoxSize[0]?.blockSize;
          if (height) {
            latestSetRowHeightRef.current(rowKey, height);
          }
        }
      }),
  );
  useEffect(() => () => resizeObserver.disconnect(), [resizeObserver]);

  const rowHeight = useMemo<DynamicRowHeight>(
    () => ({
      // react-window uses this for rows that have no known height.
      getAverageRowHeight: () => estimatedHeight,
      getRowHeight: (index) => {
        const row = rows[index];
        const known = row ? heightByKey.get(row.key) : undefined;
        return known === undefined ? undefined : heightInView(known, viewMode);
      },
      setRowHeight: (index, height) => {
        const row = rows[index];
        if (row) {
          setRowHeightByKey(row.key, height);
        }
      },
      observeRowElements: (elements) => {
        for (const element of elements) {
          resizeObserver.observe(element);
        }
        return () => {
          for (const element of elements) {
            resizeObserver.unobserve(element);
          }
        };
      },
    }),
    [estimatedHeight, heightByKey, resizeObserver, rows, setRowHeightByKey, viewMode],
  );

  return { rowHeight, setRowHeightByKey };
}

/**
 * Only the row header changes height in another view. Its height comes from `FILE_LIST_ROW_HEIGHT`,
 * because a measured row can include an expanded diff body.
 */
function heightInView(known: KnownHeight, viewMode: FileListViewMode): number {
  return known.height - FILE_LIST_ROW_HEIGHT[known.viewMode] + FILE_LIST_ROW_HEIGHT[viewMode];
}

/** A row that is not measured yet gets the height of a closed row, because most rows are closed. */
function estimatedRowHeight(
  viewMode: FileListViewMode,
  smallestHeightByView: KnownHeights["smallestHeightByView"],
): number {
  const measuredHeight = smallestHeightByView.get(viewMode);
  if (measuredHeight !== undefined) {
    return measuredHeight;
  }
  // Until a row of the view is measured, use a row of the other view, so a view switch keeps the row positions.
  const otherViewMode = viewMode === "tree" ? "list" : "tree";
  const otherHeight = smallestHeightByView.get(otherViewMode);
  return otherHeight === undefined
    ? FILE_LIST_ROW_HEIGHT[viewMode]
    : heightInView({ height: otherHeight, viewMode: otherViewMode }, viewMode);
}

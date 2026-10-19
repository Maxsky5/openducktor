import type { RefObject } from "react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef } from "react";
import type { AgentChatTranscriptRow } from "./agent-chat-transcript-model";
import { CHAT_SCROLL_EDGE_THRESHOLD_PX, readMountedRows } from "./agent-chat-window-shared";

// A jump puts the top of its target row this far below the top of the viewport.
export const JUMP_TOP_MARGIN_PX = 8;
export const JUMP_HIGHLIGHT_ATTRIBUTE = "data-jump-highlight";
const JUMP_HIGHLIGHT_MS = 2000;

/** Global row indexes of the mounted rows at the viewport edges and at the active line. */
export type AgentChatTranscriptViewportRows = {
  activeRow: number;
  firstVisibleRow: number;
  lastVisibleRow: number;
};

export type AgentChatTranscriptNavigation = {
  jumpToRow: (rowKey: string) => void;
  readViewportRows: () => AgentChatTranscriptViewportRows | null;
  subscribeViewportRows: (listener: () => void) => () => void;
  /** Scrolls the transcript for wheel input over a control outside it, with the pin rules. */
  scrollByWheel: (event: WheelEvent) => void;
};

type UseAgentChatTranscriptNavigationInput = {
  rows: AgentChatTranscriptRow[];
  windowStart: number;
  windowEnd: number;
  displayedSessionKey: string | null;
  messagesContainerRef: RefObject<HTMLDivElement | null>;
  messagesContentRef: RefObject<HTMLDivElement | null>;
  selectRowWindowAround: (rowIndex: number) => void;
  expandRowWindowEnd: () => void;
  rereadRowAnchor: () => void;
  pin: () => void;
  unpin: () => void;
};

type LandedJump = { rowKey: string; scrollTop: number };

type JumpHighlight = { element: HTMLElement; timer: ReturnType<typeof setTimeout> };

/**
 * Jumps to transcript rows and reports which rows are on screen. A jump reuses the row window, so
 * it reaches rows that are not mounted, and the pin rules, so auto-follow acts as for a user scroll.
 *
 * Call this hook after the window's own layout effects, so a landing reads the committed row window
 * and the scroll position that those effects set.
 */
export function useAgentChatTranscriptNavigation({
  rows,
  windowStart,
  windowEnd,
  displayedSessionKey,
  messagesContainerRef,
  messagesContentRef,
  selectRowWindowAround,
  expandRowWindowEnd,
  rereadRowAnchor,
  pin,
  unpin,
}: UseAgentChatTranscriptNavigationInput): Omit<AgentChatTranscriptNavigation, "scrollByWheel"> {
  // The navigation functions keep their identity across row updates, so they read the committed
  // rows and row window through a ref.
  const committedRef = useRef({
    rows,
    windowStart,
    windowEnd,
    selectRowWindowAround,
    expandRowWindowEnd,
  });
  const pendingJumpRef = useRef<string | null>(null);
  const landedJumpRef = useRef<LandedJump | null>(null);
  const highlightRef = useRef<JumpHighlight | null>(null);
  const viewportListenersRef = useRef(new Set<() => void>());

  const notifyViewportRows = useCallback(() => {
    for (const listener of viewportListenersRef.current) {
      listener();
    }
  }, []);

  // Layout effects of child components run earlier and can read the previous window start. Rows
  // that mount above keep their place on screen but change their indexes, so readers read again.
  useLayoutEffect(() => {
    const previousWindowStart = committedRef.current.windowStart;
    committedRef.current = {
      rows,
      windowStart,
      windowEnd,
      selectRowWindowAround,
      expandRowWindowEnd,
    };
    if (previousWindowStart !== windowStart) {
      notifyViewportRows();
    }
  });

  // A jump belongs to its session, so a session change drops it.
  useLayoutEffect(() => {
    void displayedSessionKey;
    pendingJumpRef.current = null;
    landedJumpRef.current = null;
  }, [displayedSessionKey]);

  // A highlight changes only the DOM of the mounted row, so the rows do not render again.
  const highlightRow = useCallback((element: HTMLElement) => {
    const previous = highlightRef.current;
    if (previous) {
      clearTimeout(previous.timer);
      previous.element.removeAttribute(JUMP_HIGHLIGHT_ATTRIBUTE);
      // The layout read restarts the animation when the same row gets the highlight again.
      element.getBoundingClientRect();
    }
    element.setAttribute(JUMP_HIGHLIGHT_ATTRIBUTE, "");
    const timer = setTimeout(() => {
      element.removeAttribute(JUMP_HIGHLIGHT_ATTRIBUTE);
      highlightRef.current = null;
    }, JUMP_HIGHLIGHT_MS);
    highlightRef.current = { element, timer };
  }, []);

  useEffect(
    () => () => {
      const highlight = highlightRef.current;
      if (highlight) {
        clearTimeout(highlight.timer);
        highlight.element.removeAttribute(JUMP_HIGHLIGHT_ATTRIBUTE);
      }
    },
    [],
  );

  /**
   * Puts the pending jump target at the top of the viewport, before the browser paints. A target
   * that is not mounted yet waits for its row window. A target whose section is too short extends
   * the row window, and at the transcript end the jump goes to the bottom and pins.
   */
  const landJump = useCallback(() => {
    const rowKey = pendingJumpRef.current;
    const container = messagesContainerRef.current;
    if (rowKey === null || !container) {
      return;
    }

    const committed = committedRef.current;
    const rowIndex = committed.rows.findIndex((row) => row.key === rowKey);
    if (rowIndex < 0) {
      pendingJumpRef.current = null;
      return;
    }
    if (!isRowMounted(committed, rowIndex)) {
      return;
    }
    const element = readMountedRows(container).find((row) => row.dataset.rowKey === rowKey);
    if (!element) {
      pendingJumpRef.current = null;
      return;
    }

    const rowTop = element.getBoundingClientRect().top - container.getBoundingClientRect().top;
    const targetScrollTop = container.scrollTop + rowTop - JUMP_TOP_MARGIN_PX;
    const maxScrollTop = container.scrollHeight - container.clientHeight;
    // The committed window decides, because the requested range can be ahead of the commit.
    const isLatestWindow = committed.windowEnd >= committed.rows.length;
    if (targetScrollTop > maxScrollTop && !isLatestWindow) {
      committed.expandRowWindowEnd();
      return;
    }
    pendingJumpRef.current = null;
    // A landing at the bottom edge pins, like a user scroll to the bottom. A later scroll event
    // would pin there anyway and move the target after the first paint.
    if (isLatestWindow && maxScrollTop - targetScrollTop < CHAT_SCROLL_EDGE_THRESHOLD_PX) {
      pin();
    } else {
      container.scrollTop = targetScrollTop;
    }
    rereadRowAnchor();
    landedJumpRef.current = { rowKey, scrollTop: container.scrollTop };
    highlightRow(element);
    notifyViewportRows();
  }, [rereadRowAnchor, highlightRow, messagesContainerRef, notifyViewportRows, pin]);

  useLayoutEffect(() => {
    landJump();
  });

  const jumpToRow = useCallback(
    (rowKey: string) => {
      pendingJumpRef.current = null;
      landedJumpRef.current = null;
      const committed = committedRef.current;
      const rowIndex = committed.rows.findIndex((row) => row.key === rowKey);
      if (rowIndex < 0) {
        return;
      }

      unpin();
      pendingJumpRef.current = rowKey;
      if (!isRowMounted(committed, rowIndex)) {
        committed.selectRowWindowAround(rowIndex);
        return;
      }
      landJump();
    },
    [landJump, unpin],
  );

  // A landed target stays active until the scroll position changes, also when it lands at the
  // bottom, where the active line shows another row.
  const readViewportRows = useCallback((): AgentChatTranscriptViewportRows | null => {
    const container = messagesContainerRef.current;
    if (!container) {
      return null;
    }

    const landed = landedJumpRef.current;
    const landedRowKey = landed?.scrollTop === container.scrollTop ? landed.rowKey : null;
    const viewport = container.getBoundingClientRect();
    const activeLine = viewport.top + JUMP_TOP_MARGIN_PX + 1;
    // Mounted rows render in row window order, so their position plus the window start is their index.
    const mountedRows = readMountedRows(container);
    let firstVisible = -1;
    let lastVisible = -1;
    let activeLineRow = -1;
    let landedRow = -1;
    for (let index = 0; index < mountedRows.length; index += 1) {
      const row = mountedRows[index];
      if (!row) {
        continue;
      }
      const rect = row.getBoundingClientRect();
      if (rect.top >= viewport.bottom) {
        break;
      }
      if (rect.top <= activeLine) {
        activeLineRow = index;
      }
      if (row.dataset.rowKey === landedRowKey) {
        landedRow = index;
      }
      if (rect.bottom > viewport.top) {
        if (firstVisible < 0) {
          firstVisible = index;
        }
        lastVisible = index;
      }
    }
    if (firstVisible < 0) {
      return null;
    }

    const start = committedRef.current.windowStart;
    const activeRow = landedRow >= 0 ? landedRow : Math.max(activeLineRow, firstVisible);
    return {
      activeRow: start + activeRow,
      firstVisibleRow: start + firstVisible,
      lastVisibleRow: start + lastVisible,
    };
  }, [messagesContainerRef]);

  const subscribeViewportRows = useCallback((listener: () => void) => {
    const listeners = viewportListenersRef.current;
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }, []);

  useEffect(() => {
    const container = messagesContainerRef.current;
    const content = messagesContentRef.current;
    if (!container || !content) {
      return;
    }

    container.addEventListener("scroll", notifyViewportRows, { passive: true });
    const resizeObserver = new ResizeObserver(notifyViewportRows);
    resizeObserver.observe(container);
    resizeObserver.observe(content);
    return () => {
      container.removeEventListener("scroll", notifyViewportRows);
      resizeObserver.disconnect();
    };
  }, [messagesContainerRef, messagesContentRef, notifyViewportRows]);

  return useMemo(
    () => ({ jumpToRow, readViewportRows, subscribeViewportRows }),
    [jumpToRow, readViewportRows, subscribeViewportRows],
  );
}

function isRowMounted(
  range: { windowStart: number; windowEnd: number },
  rowIndex: number,
): boolean {
  return rowIndex >= range.windowStart && rowIndex < range.windowEnd;
}

import type { RefObject } from "react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  type AgentChatWindowRow,
  type AgentChatWindowTurn,
  buildAgentChatWindowTurns,
  CHAT_ROW_WINDOW_BATCH,
  CHAT_ROW_WINDOW_INIT,
  CHAT_TURN_WINDOW_BATCH,
  getAgentChatInitialTurnStart,
} from "./agent-chat-thread-windowing";
import { CHAT_TURN_REVEAL_EDGE_THRESHOLD_PX } from "./agent-chat-window-shared";

type UseAgentChatHistoryWindowInput = {
  rows: AgentChatWindowRow[];
  turns?: AgentChatWindowTurn[];
  displayedSessionKey: string | null;
  shouldResetForTranscriptLoad: boolean;
  messagesContainerRef: RefObject<HTMLDivElement | null>;
  userScrolledRef: RefObject<boolean>;
  userScrollIntentVersionRef: RefObject<number>;
};

type RevealOlderHistoryOptions = {
  preserveScroll?: boolean;
  suppressTopContinuation?: boolean;
};

type UseAgentChatHistoryWindowResult = {
  latestTurnStart: number;
  turnStart: number;
  windowStart: number;
  isLatestWindow: boolean;
  windowedRows: AgentChatWindowRow[];
  windowedTurns: AgentChatWindowTurn[];
  resetToLatestTurns: () => void;
  revealOlderHistory: (options?: RevealOlderHistoryOptions) => void;
};

export const resolveAgentChatEffectiveTurnStart = ({
  displayedSessionKey,
  previousSessionKey,
  turnStart,
  latestTurnStart,
  rowsLength,
  pendingLatestReset,
}: {
  displayedSessionKey: string | null;
  previousSessionKey: string | null;
  turnStart: number;
  latestTurnStart: number;
  rowsLength: number;
  pendingLatestReset: boolean;
}): number => {
  const clampedTurnStart =
    rowsLength === 0 ? turnStart : Math.max(0, Math.min(turnStart, latestTurnStart));

  if (pendingLatestReset && rowsLength > 0) {
    return latestTurnStart;
  }

  if (previousSessionKey !== displayedSessionKey) {
    return latestTurnStart;
  }

  return clampedTurnStart;
};

const findFirstVisibleTurnIndex = (
  turns: AgentChatWindowTurn[],
  startIndex: number,
  windowStart: number,
): number => {
  let low = Math.max(0, Math.min(startIndex, turns.length));
  let high = turns.length;

  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    const turn = turns[mid];
    if (turn && turn.end < windowStart) {
      low = mid + 1;
      continue;
    }

    high = mid;
  }

  return low;
};

export function useAgentChatHistoryWindow({
  rows,
  turns: providedTurns,
  displayedSessionKey,
  shouldResetForTranscriptLoad,
  messagesContainerRef,
  userScrolledRef,
  userScrollIntentVersionRef,
}: UseAgentChatHistoryWindowInput): UseAgentChatHistoryWindowResult {
  const turns = useMemo(
    () => providedTurns ?? buildAgentChatWindowTurns(rows),
    [providedTurns, rows],
  );
  const getLatestTurnStart = useCallback(
    () => getAgentChatInitialTurnStart(turns.length),
    [turns.length],
  );
  const [turnStart, setTurnStart] = useState(() => getLatestTurnStart());
  const [rowWindowLimit, setRowWindowLimit] = useState(CHAT_ROW_WINDOW_INIT);
  const turnStartRef = useRef(turnStart);
  const rowWindowLimitRef = useRef(rowWindowLimit);
  const windowStartRef = useRef(0);
  const fillFrameRef = useRef<number | null>(null);
  const continuationFrameRef = useRef<number | null>(null);
  const suppressedTopContinuationVersionRef = useRef<number | null>(null);
  const pendingLatestResetRef = useRef(shouldResetForTranscriptLoad && rows.length === 0);
  const previousSessionKeyRef = useRef<string | null>(displayedSessionKey);
  const pendingScrollRestoreRef = useRef<{
    beforeScrollHeight: number;
    beforeScrollTop: number;
  } | null>(null);
  const latestTurnStart = getLatestTurnStart();
  const shouldUsePendingLatestTurnStart = pendingLatestResetRef.current && rows.length > 0;
  const didSessionChange = previousSessionKeyRef.current !== displayedSessionKey;
  const shouldFlagPendingLatestReset = shouldResetForTranscriptLoad && rows.length === 0;
  const shouldClampToLatestTurnStart = rows.length > 0 && turnStartRef.current > latestTurnStart;
  const shouldResetRowWindowLimit =
    didSessionChange || shouldUsePendingLatestTurnStart || shouldClampToLatestTurnStart;
  const effectiveTurnStart = resolveAgentChatEffectiveTurnStart({
    displayedSessionKey,
    previousSessionKey: previousSessionKeyRef.current,
    turnStart,
    latestTurnStart,
    rowsLength: rows.length,
    pendingLatestReset: shouldUsePendingLatestTurnStart,
  });
  const effectiveRowWindowLimit = shouldResetRowWindowLimit ? CHAT_ROW_WINDOW_INIT : rowWindowLimit;
  const turnWindowStart = turns[effectiveTurnStart]?.start ?? 0;
  const rowWindowStart = Math.max(0, rows.length - effectiveRowWindowLimit);
  const windowStart = Math.max(turnWindowStart, rowWindowStart);
  const latestTurnWindowStart = turns[latestTurnStart]?.start ?? 0;
  const latestRowWindowStart = Math.max(0, rows.length - CHAT_ROW_WINDOW_INIT);
  const latestWindowStart = Math.max(latestTurnWindowStart, latestRowWindowStart);
  const firstVisibleTurnIndex = findFirstVisibleTurnIndex(turns, effectiveTurnStart, windowStart);
  const windowedRows = useMemo(() => rows.slice(windowStart), [rows, windowStart]);
  const windowedTurns = useMemo(
    () =>
      turns.slice(firstVisibleTurnIndex).map((turn) => ({
        key: turn.key,
        start: Math.max(turn.start, windowStart) - windowStart,
        end: turn.end - windowStart,
      })),
    [firstVisibleTurnIndex, turns, windowStart],
  );

  const setTurnStartState = useCallback(
    (nextTurnStart: number) => {
      const latestTurnStart = getLatestTurnStart();
      const clampedTurnStart = Math.max(0, Math.min(nextTurnStart, latestTurnStart));
      turnStartRef.current = clampedTurnStart;
      setTurnStart(clampedTurnStart);
    },
    [getLatestTurnStart],
  );

  const setRowWindowLimitState = useCallback(
    (nextRowWindowLimit: number) => {
      const clampedRowWindowLimit = Math.max(
        CHAT_ROW_WINDOW_INIT,
        Math.min(nextRowWindowLimit, Math.max(rows.length, CHAT_ROW_WINDOW_INIT)),
      );
      rowWindowLimitRef.current = clampedRowWindowLimit;
      setRowWindowLimit(clampedRowWindowLimit);
    },
    [rows.length],
  );

  const preserveScroll = useCallback(
    (fn: () => void) => {
      const container = messagesContainerRef.current;
      if (!container) {
        fn();
        return;
      }

      pendingScrollRestoreRef.current = {
        beforeScrollHeight: container.scrollHeight,
        beforeScrollTop: container.scrollTop,
      };
      fn();
    },
    [messagesContainerRef],
  );

  const isTopContinuationSuppressed = useCallback(() => {
    const suppressedVersion = suppressedTopContinuationVersionRef.current;
    if (suppressedVersion === null) {
      return false;
    }

    if (suppressedVersion === userScrollIntentVersionRef.current) {
      return true;
    }

    suppressedTopContinuationVersionRef.current = null;
    return false;
  }, [userScrollIntentVersionRef]);

  const revealOlderHistory = useCallback(
    (options?: RevealOlderHistoryOptions) => {
      if (pendingScrollRestoreRef.current !== null) {
        return;
      }

      if (windowStartRef.current <= 0) {
        return;
      }

      const currentTurnStart = turnStartRef.current;
      const reveal = () => {
        setRowWindowLimitState(rowWindowLimitRef.current + CHAT_ROW_WINDOW_BATCH);

        if (currentTurnStart > 0) {
          setTurnStartState(currentTurnStart - CHAT_TURN_WINDOW_BATCH);
        }
      };

      if (options?.preserveScroll === false) {
        if (options.suppressTopContinuation) {
          suppressedTopContinuationVersionRef.current = userScrollIntentVersionRef.current;
        }
        reveal();
        return;
      }

      preserveScroll(reveal);
    },
    [preserveScroll, setRowWindowLimitState, setTurnStartState, userScrollIntentVersionRef],
  );

  const scheduleFill = useCallback(() => {
    if (fillFrameRef.current !== null) {
      return;
    }

    fillFrameRef.current = globalThis.requestAnimationFrame(() => {
      fillFrameRef.current = null;

      const container = messagesContainerRef.current;
      if (!container) {
        return;
      }

      if (userScrolledRef.current) {
        return;
      }

      if (container.scrollHeight > container.clientHeight + 1) {
        return;
      }

      if (windowStartRef.current <= 0) {
        return;
      }

      revealOlderHistory();
    });
  }, [messagesContainerRef, revealOlderHistory, userScrolledRef]);

  const scheduleContinuation = useCallback(() => {
    if (continuationFrameRef.current !== null) {
      return;
    }

    continuationFrameRef.current = globalThis.requestAnimationFrame(() => {
      continuationFrameRef.current = null;

      const container = messagesContainerRef.current;
      if (!container) {
        return;
      }

      if (!userScrolledRef.current) {
        return;
      }

      if (pendingScrollRestoreRef.current !== null) {
        return;
      }

      if (windowStartRef.current <= 0) {
        return;
      }

      if (container.scrollTop >= CHAT_TURN_REVEAL_EDGE_THRESHOLD_PX) {
        return;
      }

      if (isTopContinuationSuppressed()) {
        return;
      }

      revealOlderHistory();
    });
  }, [isTopContinuationSuppressed, messagesContainerRef, revealOlderHistory, userScrolledRef]);

  const cancelScheduledFrames = useCallback(() => {
    if (fillFrameRef.current !== null) {
      globalThis.cancelAnimationFrame(fillFrameRef.current);
      fillFrameRef.current = null;
    }
    if (continuationFrameRef.current !== null) {
      globalThis.cancelAnimationFrame(continuationFrameRef.current);
      continuationFrameRef.current = null;
    }
  }, []);

  // Intentionally runs after every commit so pending scroll restoration and
  // session-switch latest-window rebasing happen on the very next DOM update.
  useLayoutEffect(() => {
    if (didSessionChange) {
      previousSessionKeyRef.current = displayedSessionKey;
      pendingLatestResetRef.current = shouldFlagPendingLatestReset;
      suppressedTopContinuationVersionRef.current = null;
    } else if (shouldFlagPendingLatestReset) {
      pendingLatestResetRef.current = true;
    } else if (shouldUsePendingLatestTurnStart) {
      pendingLatestResetRef.current = false;
    }

    if (
      (didSessionChange || shouldUsePendingLatestTurnStart || shouldClampToLatestTurnStart) &&
      turnStart !== latestTurnStart
    ) {
      setTurnStartState(latestTurnStart);
    }

    if (shouldResetRowWindowLimit && rowWindowLimit !== CHAT_ROW_WINDOW_INIT) {
      setRowWindowLimitState(CHAT_ROW_WINDOW_INIT);
    }

    turnStartRef.current = effectiveTurnStart;
    rowWindowLimitRef.current = effectiveRowWindowLimit;
    windowStartRef.current = windowStart;

    const pendingRestore = pendingScrollRestoreRef.current;
    const container = messagesContainerRef.current;
    if (!pendingRestore) {
      if (
        container &&
        userScrolledRef.current &&
        windowStartRef.current > 0 &&
        container.scrollTop < CHAT_TURN_REVEAL_EDGE_THRESHOLD_PX &&
        !isTopContinuationSuppressed()
      ) {
        scheduleContinuation();
      }
      return;
    }

    pendingScrollRestoreRef.current = null;
    if (!container) {
      return;
    }

    const delta = container.scrollHeight - pendingRestore.beforeScrollHeight;
    if (delta) {
      container.scrollTop = pendingRestore.beforeScrollTop + delta;
    }

    if (
      userScrolledRef.current &&
      windowStartRef.current > 0 &&
      container.scrollTop < CHAT_TURN_REVEAL_EDGE_THRESHOLD_PX &&
      !isTopContinuationSuppressed()
    ) {
      scheduleContinuation();
    }
  });

  useEffect(() => {
    const container = messagesContainerRef.current;
    if (!container) {
      return;
    }

    const handleScroll = () => {
      if (!userScrolledRef.current) {
        return;
      }

      if (windowStartRef.current <= 0) {
        return;
      }

      if (container.scrollTop >= CHAT_TURN_REVEAL_EDGE_THRESHOLD_PX) {
        return;
      }

      if (isTopContinuationSuppressed()) {
        return;
      }

      revealOlderHistory();
    };

    container.addEventListener("scroll", handleScroll, { passive: true });
    return () => {
      container.removeEventListener("scroll", handleScroll);
    };
  }, [isTopContinuationSuppressed, messagesContainerRef, revealOlderHistory, userScrolledRef]);

  // Intentionally runs after every commit so an underfilled viewport can keep
  // backfilling until the rendered transcript is tall enough to scroll.
  useEffect(() => {
    if (shouldResetForTranscriptLoad) {
      return;
    }

    scheduleFill();
  });

  useEffect(() => cancelScheduledFrames, [cancelScheduledFrames]);

  return {
    latestTurnStart,
    turnStart: effectiveTurnStart,
    windowStart,
    isLatestWindow: effectiveTurnStart === latestTurnStart && windowStart === latestWindowStart,
    windowedRows,
    windowedTurns,
    resetToLatestTurns: () => {
      if (shouldResetForTranscriptLoad && rows.length === 0) {
        pendingLatestResetRef.current = true;
        return;
      }

      setRowWindowLimitState(CHAT_ROW_WINDOW_INIT);
      suppressedTopContinuationVersionRef.current = null;
      setTurnStartState(latestTurnStart);
    },
    revealOlderHistory,
  };
}

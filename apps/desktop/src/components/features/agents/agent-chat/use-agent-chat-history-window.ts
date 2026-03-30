import type { RefObject } from "react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  type AgentChatWindowRow,
  buildAgentChatWindowTurns,
  CHAT_TURN_WINDOW_BATCH,
  getAgentChatInitialTurnStart,
} from "./agent-chat-thread-windowing";
import { CHAT_TURN_REVEAL_EDGE_THRESHOLD_PX } from "./agent-chat-window-shared";

type UseAgentChatHistoryWindowInput = {
  rows: AgentChatWindowRow[];
  isSessionViewLoading: boolean;
  messagesContainerRef: RefObject<HTMLDivElement | null>;
  userScrolledRef: RefObject<boolean>;
};

type UseAgentChatHistoryWindowResult = {
  latestTurnStart: number;
  turnStart: number;
  windowStart: number;
  windowedRows: AgentChatWindowRow[];
  resetToLatestTurns: () => void;
  revealAllHistory: () => void;
};

export function useAgentChatHistoryWindow({
  rows,
  isSessionViewLoading,
  messagesContainerRef,
  userScrolledRef,
}: UseAgentChatHistoryWindowInput): UseAgentChatHistoryWindowResult {
  const turns = useMemo(() => buildAgentChatWindowTurns(rows), [rows]);
  const getLatestTurnStart = useCallback(
    () => getAgentChatInitialTurnStart(turns.length),
    [turns.length],
  );
  const [turnStart, setTurnStart] = useState(() => getLatestTurnStart());
  const turnStartRef = useRef(turnStart);
  const fillFrameRef = useRef<number | null>(null);
  const continuationFrameRef = useRef<number | null>(null);
  const pendingLatestResetRef = useRef(isSessionViewLoading && rows.length === 0);
  const pendingScrollRestoreRef = useRef<{
    beforeScrollHeight: number;
    beforeScrollTop: number;
  } | null>(null);
  const latestTurnStart = getLatestTurnStart();
  const clampedTurnStart =
    rows.length === 0 ? turnStart : Math.max(0, Math.min(turnStart, latestTurnStart));
  const shouldUsePendingLatestTurnStart = pendingLatestResetRef.current && rows.length > 0;
  const effectiveTurnStart = shouldUsePendingLatestTurnStart ? latestTurnStart : clampedTurnStart;

  const setTurnStartState = useCallback(
    (nextTurnStart: number) => {
      const latestTurnStart = getLatestTurnStart();
      const clampedTurnStart = Math.max(0, Math.min(nextTurnStart, latestTurnStart));
      turnStartRef.current = clampedTurnStart;
      setTurnStart(clampedTurnStart);
    },
    [getLatestTurnStart],
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

  const revealOlderTurns = useCallback(() => {
    if (pendingScrollRestoreRef.current !== null) {
      return;
    }

    const currentTurnStart = turnStartRef.current;
    if (currentTurnStart <= 0) {
      return;
    }

    preserveScroll(() => {
      setTurnStartState(currentTurnStart - CHAT_TURN_WINDOW_BATCH);
    });
  }, [preserveScroll, setTurnStartState]);

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

      if (turnStartRef.current <= 0) {
        return;
      }

      revealOlderTurns();
    });
  }, [messagesContainerRef, revealOlderTurns, userScrolledRef]);

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

      if (turnStartRef.current <= 0) {
        return;
      }

      if (container.scrollTop >= CHAT_TURN_REVEAL_EDGE_THRESHOLD_PX) {
        return;
      }

      revealOlderTurns();
    });
  }, [messagesContainerRef, revealOlderTurns, userScrolledRef]);

  // Intentionally runs after every commit so pending scroll restoration and
  // deferred-session latest-turn rebasing happen on the very next DOM update.
  useLayoutEffect(() => {
    if (shouldUsePendingLatestTurnStart) {
      pendingLatestResetRef.current = false;
      if (turnStart !== latestTurnStart) {
        setTurnStartState(latestTurnStart);
      }
    }

    turnStartRef.current = effectiveTurnStart;

    const pendingRestore = pendingScrollRestoreRef.current;
    const container = messagesContainerRef.current;
    if (!pendingRestore) {
      if (
        container &&
        userScrolledRef.current &&
        turnStartRef.current > 0 &&
        container.scrollTop < CHAT_TURN_REVEAL_EDGE_THRESHOLD_PX
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
      turnStartRef.current > 0 &&
      container.scrollTop < CHAT_TURN_REVEAL_EDGE_THRESHOLD_PX
    ) {
      scheduleContinuation();
    }
  });

  useEffect(() => {
    if (isSessionViewLoading && rows.length === 0) {
      pendingLatestResetRef.current = true;
    }
  }, [isSessionViewLoading, rows.length]);

  useEffect(() => {
    if (rows.length === 0) {
      return;
    }

    if (turnStartRef.current > latestTurnStart) {
      setTurnStartState(latestTurnStart);
    }
  }, [latestTurnStart, rows.length, setTurnStartState]);

  useEffect(() => {
    const container = messagesContainerRef.current;
    if (!container) {
      return;
    }

    const handleScroll = () => {
      if (!userScrolledRef.current) {
        return;
      }

      if (turnStartRef.current <= 0) {
        return;
      }

      if (container.scrollTop >= CHAT_TURN_REVEAL_EDGE_THRESHOLD_PX) {
        return;
      }

      revealOlderTurns();
    };

    container.addEventListener("scroll", handleScroll, { passive: true });
    return () => {
      container.removeEventListener("scroll", handleScroll);
    };
  }, [messagesContainerRef, revealOlderTurns, userScrolledRef]);

  // Intentionally runs after every commit so an underfilled viewport can keep
  // backfilling until the rendered transcript is tall enough to scroll.
  useEffect(() => {
    if (isSessionViewLoading) {
      return;
    }

    scheduleFill();
  });

  useEffect(() => {
    return () => {
      if (fillFrameRef.current !== null) {
        globalThis.cancelAnimationFrame(fillFrameRef.current);
      }
      if (continuationFrameRef.current !== null) {
        globalThis.cancelAnimationFrame(continuationFrameRef.current);
      }
    };
  }, []);

  const windowStart = turns[effectiveTurnStart]?.start ?? 0;
  const windowedRows = rows.slice(windowStart);

  return {
    latestTurnStart,
    turnStart: effectiveTurnStart,
    windowStart,
    windowedRows,
    resetToLatestTurns: () => {
      if (isSessionViewLoading && rows.length === 0) {
        pendingLatestResetRef.current = true;
        return;
      }

      setTurnStartState(latestTurnStart);
    },
    revealAllHistory: () => setTurnStartState(0),
  };
}

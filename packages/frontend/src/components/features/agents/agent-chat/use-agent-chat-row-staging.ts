import { useEffect, useMemo, useRef, useState } from "react";
import type { AgentChatWindowRow, AgentChatWindowTurn } from "./agent-chat-thread-windowing";

const ROW_STAGE_INIT = 8;
const ROW_STAGE_BATCH = 8;

const shouldStageRows = ({
  activeSessionId,
  completedSessionIds,
  disabled,
  forceStage,
  rowCount,
}: {
  activeSessionId: string;
  completedSessionIds: Set<string>;
  disabled: boolean;
  forceStage?: boolean;
  rowCount: number;
}): boolean => {
  return (
    !disabled &&
    rowCount > ROW_STAGE_INIT &&
    (forceStage === true || !completedSessionIds.has(activeSessionId))
  );
};

type UseAgentChatRowStagingArgs = {
  activeSessionId: string | null;
  rows: AgentChatWindowRow[];
  turns: AgentChatWindowTurn[];
  disabled?: boolean;
  onBeforePrepend?: () => void;
};

type UseAgentChatRowStagingResult = {
  rows: AgentChatWindowRow[];
  turns: AgentChatWindowTurn[];
};

export function useAgentChatRowStaging({
  activeSessionId,
  rows,
  turns,
  disabled = false,
  onBeforePrepend,
}: UseAgentChatRowStagingArgs): UseAgentChatRowStagingResult {
  const [rowCount, setRowCount] = useState(() =>
    activeSessionId !== null && !disabled && rows.length > ROW_STAGE_INIT
      ? ROW_STAGE_INIT
      : rows.length,
  );
  const rowCountRef = useRef(rowCount);
  const frameRef = useRef<number | null>(null);
  const activeSessionRef = useRef<string | null>(null);
  const completedSessionIdsRef = useRef<Set<string>>(new Set());
  const previousSessionIdRef = useRef<string | null>(activeSessionId);
  const previousSessionId = previousSessionIdRef.current;
  const switchedSessions =
    previousSessionId !== null && activeSessionId !== null && previousSessionId !== activeSessionId;

  useEffect(() => {
    const updateRowCount = (nextRowCount: number): void => {
      rowCountRef.current = nextRowCount;
      setRowCount((current) => (current === nextRowCount ? current : nextRowCount));
    };

    if (frameRef.current !== null) {
      globalThis.cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
    }

    previousSessionIdRef.current = activeSessionId;

    if (switchedSessions && activeSessionId !== null) {
      completedSessionIdsRef.current.delete(activeSessionId);
    }

    if (activeSessionId === null) {
      activeSessionRef.current = null;
      updateRowCount(rows.length);
      return;
    }

    const shouldStage = shouldStageRows({
      activeSessionId,
      completedSessionIds: completedSessionIdsRef.current,
      disabled,
      forceStage: switchedSessions,
      rowCount: rows.length,
    });

    if (!shouldStage) {
      activeSessionRef.current = null;
      updateRowCount(rows.length);
      return;
    }

    const sessionId = activeSessionId;
    const isContinuingActiveSession = activeSessionRef.current === activeSessionId;
    activeSessionRef.current = sessionId;
    let nextRowCount = Math.min(
      rows.length,
      isContinuingActiveSession ? rowCountRef.current : ROW_STAGE_INIT,
    );
    updateRowCount(nextRowCount);

    if (nextRowCount >= rows.length) {
      activeSessionRef.current = null;
      completedSessionIdsRef.current.add(sessionId);
      return;
    }

    const step = () => {
      if (activeSessionRef.current !== sessionId) {
        frameRef.current = null;
        return;
      }

      nextRowCount = Math.min(rows.length, nextRowCount + ROW_STAGE_BATCH);
      onBeforePrepend?.();
      updateRowCount(nextRowCount);

      if (nextRowCount >= rows.length) {
        frameRef.current = null;
        activeSessionRef.current = null;
        completedSessionIdsRef.current.add(sessionId);
        return;
      }

      frameRef.current = globalThis.requestAnimationFrame(step);
    };

    frameRef.current = globalThis.requestAnimationFrame(step);
    return () => {
      if (frameRef.current !== null) {
        globalThis.cancelAnimationFrame(frameRef.current);
        frameRef.current = null;
      }
    };
  }, [activeSessionId, disabled, onBeforePrepend, rows.length, switchedSessions]);

  return useMemo(() => {
    if (
      activeSessionId === null ||
      !shouldStageRows({
        activeSessionId,
        completedSessionIds: completedSessionIdsRef.current,
        disabled,
        forceStage: switchedSessions,
        rowCount: rows.length,
      })
    ) {
      return { rows, turns };
    }

    const effectiveRowCount =
      switchedSessions && activeSessionRef.current !== activeSessionId
        ? Math.min(rows.length, ROW_STAGE_INIT)
        : rowCount;

    if (effectiveRowCount >= rows.length) {
      return { rows, turns };
    }

    const rowStart = Math.max(0, rows.length - effectiveRowCount);
    return {
      rows: rows.slice(rowStart),
      turns: turns
        .filter((turn) => turn.end >= rowStart)
        .map((turn) => ({
          key: turn.key,
          start: Math.max(turn.start, rowStart) - rowStart,
          end: turn.end - rowStart,
        })),
    };
  }, [activeSessionId, disabled, rowCount, rows, switchedSessions, turns]);
}

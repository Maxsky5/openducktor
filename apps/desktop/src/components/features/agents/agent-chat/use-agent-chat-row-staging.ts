import { useEffect, useMemo, useRef, useState } from "react";
import type { AgentChatWindowRow, AgentChatWindowTurn } from "./agent-chat-thread-windowing";

const ROW_STAGE_INIT = 24;
const ROW_STAGE_BATCH = 32;

type UseAgentChatRowStagingArgs = {
  activeSessionId: string | null;
  rows: AgentChatWindowRow[];
  turns: AgentChatWindowTurn[];
  disabled?: boolean;
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
}: UseAgentChatRowStagingArgs): UseAgentChatRowStagingResult {
  const [rowCount, setRowCount] = useState(rows.length);
  const rowCountRef = useRef(rowCount);
  const frameRef = useRef<number | null>(null);
  const activeSessionRef = useRef<string | null>(null);
  const completedSessionIdsRef = useRef<Set<string>>(new Set());
  const previousSessionIdRef = useRef<string | null>(activeSessionId);

  useEffect(() => {
    const updateRowCount = (nextRowCount: number): void => {
      rowCountRef.current = nextRowCount;
      setRowCount((current) => (current === nextRowCount ? current : nextRowCount));
    };

    if (frameRef.current !== null) {
      globalThis.cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
    }

    const previousSessionId = previousSessionIdRef.current;
    const switchedSessions =
      previousSessionId !== null &&
      activeSessionId !== null &&
      previousSessionId !== activeSessionId;
    previousSessionIdRef.current = activeSessionId;

    if (switchedSessions && activeSessionId !== null) {
      completedSessionIdsRef.current.delete(activeSessionId);
    }

    const shouldStage =
      !disabled &&
      activeSessionId !== null &&
      rows.length > ROW_STAGE_INIT &&
      !completedSessionIdsRef.current.has(activeSessionId);

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
  }, [activeSessionId, disabled, rows.length]);

  return useMemo(() => {
    const shouldStage =
      !disabled &&
      activeSessionId !== null &&
      rows.length > ROW_STAGE_INIT &&
      !completedSessionIdsRef.current.has(activeSessionId);
    if (!shouldStage) {
      return { rows, turns };
    }

    if (rowCount >= rows.length) {
      return { rows, turns };
    }

    const rowStart = Math.max(0, rows.length - rowCount);
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
  }, [activeSessionId, disabled, rowCount, rows, turns]);
}

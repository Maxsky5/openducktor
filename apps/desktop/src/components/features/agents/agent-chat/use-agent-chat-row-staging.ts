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
  const frameRef = useRef<number | null>(null);
  const activeSessionRef = useRef<string | null>(null);
  const completedSessionIdsRef = useRef<Set<string>>(new Set());
  const previousSessionIdRef = useRef<string | null>(activeSessionId);

  useEffect(() => {
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
      setRowCount((current) => (current === rows.length ? current : rows.length));
      return;
    }

    if (activeSessionRef.current === activeSessionId) {
      return;
    }

    const sessionId = activeSessionId;
    activeSessionRef.current = sessionId;
    let nextRowCount = Math.min(rows.length, ROW_STAGE_INIT);
    setRowCount((current) => (current === nextRowCount ? current : nextRowCount));

    const step = () => {
      if (activeSessionRef.current !== sessionId) {
        frameRef.current = null;
        return;
      }

      nextRowCount = Math.min(rows.length, nextRowCount + ROW_STAGE_BATCH);
      setRowCount((current) => (current === nextRowCount ? current : nextRowCount));

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
  }, [rowCount, rows, turns]);
}

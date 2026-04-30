import { useEffect, useMemo, useRef, useState } from "react";
import type { AgentChatWindowRow, AgentChatWindowTurn } from "./agent-chat-thread-windowing";

const ROW_STAGE_INIT = 8;
const ROW_STAGE_BATCH = 8;

const shouldStageRows = ({
  activeExternalSessionId,
  completedSessionIds,
  disabled,
  forceStage,
  rowCount,
}: {
  activeExternalSessionId: string;
  completedSessionIds: Set<string>;
  disabled: boolean;
  forceStage?: boolean;
  rowCount: number;
}): boolean => {
  return (
    !disabled &&
    rowCount > ROW_STAGE_INIT &&
    (forceStage === true || !completedSessionIds.has(activeExternalSessionId))
  );
};

type UseAgentChatRowStagingArgs = {
  activeExternalSessionId: string | null;
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
  activeExternalSessionId,
  rows,
  turns,
  disabled = false,
  onBeforePrepend,
}: UseAgentChatRowStagingArgs): UseAgentChatRowStagingResult {
  const [rowCount, setRowCount] = useState(() =>
    activeExternalSessionId !== null && !disabled && rows.length > ROW_STAGE_INIT
      ? ROW_STAGE_INIT
      : rows.length,
  );
  const rowCountRef = useRef(rowCount);
  const frameRef = useRef<number | null>(null);
  const activeSessionRef = useRef<string | null>(null);
  const completedSessionIdsRef = useRef<Set<string>>(new Set());
  const previousSessionIdRef = useRef<string | null>(activeExternalSessionId);
  const previousSessionId = previousSessionIdRef.current;
  const renderSwitchedSessions =
    previousSessionId !== null &&
    activeExternalSessionId !== null &&
    previousSessionId !== activeExternalSessionId;

  useEffect(() => {
    const updateRowCount = (nextRowCount: number): void => {
      rowCountRef.current = nextRowCount;
      setRowCount((current) => (current === nextRowCount ? current : nextRowCount));
    };

    if (frameRef.current !== null) {
      globalThis.cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
    }

    const effectPreviousSessionId = previousSessionIdRef.current;
    const effectSwitchedSessions =
      effectPreviousSessionId !== null &&
      activeExternalSessionId !== null &&
      effectPreviousSessionId !== activeExternalSessionId;
    previousSessionIdRef.current = activeExternalSessionId;

    if (effectSwitchedSessions && activeExternalSessionId !== null) {
      completedSessionIdsRef.current.delete(activeExternalSessionId);
    }

    if (activeExternalSessionId === null) {
      activeSessionRef.current = null;
      updateRowCount(rows.length);
      return;
    }

    const shouldStage = shouldStageRows({
      activeExternalSessionId,
      completedSessionIds: completedSessionIdsRef.current,
      disabled,
      forceStage: effectSwitchedSessions,
      rowCount: rows.length,
    });

    if (!shouldStage) {
      activeSessionRef.current = null;
      updateRowCount(rows.length);
      return;
    }

    const externalSessionId = activeExternalSessionId;
    const isContinuingActiveSession = activeSessionRef.current === activeExternalSessionId;
    activeSessionRef.current = externalSessionId;
    let nextRowCount = Math.min(
      rows.length,
      isContinuingActiveSession ? rowCountRef.current : ROW_STAGE_INIT,
    );
    updateRowCount(nextRowCount);

    if (nextRowCount >= rows.length) {
      activeSessionRef.current = null;
      completedSessionIdsRef.current.add(externalSessionId);
      return;
    }

    const step = () => {
      if (activeSessionRef.current !== externalSessionId) {
        frameRef.current = null;
        return;
      }

      nextRowCount = Math.min(rows.length, nextRowCount + ROW_STAGE_BATCH);
      onBeforePrepend?.();
      updateRowCount(nextRowCount);

      if (nextRowCount >= rows.length) {
        frameRef.current = null;
        activeSessionRef.current = null;
        completedSessionIdsRef.current.add(externalSessionId);
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
  }, [activeExternalSessionId, disabled, onBeforePrepend, rows.length]);

  return useMemo(() => {
    if (
      activeExternalSessionId === null ||
      !shouldStageRows({
        activeExternalSessionId,
        completedSessionIds: completedSessionIdsRef.current,
        disabled,
        forceStage: renderSwitchedSessions,
        rowCount: rows.length,
      })
    ) {
      return { rows, turns };
    }

    const effectiveRowCount =
      renderSwitchedSessions && activeSessionRef.current !== activeExternalSessionId
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
  }, [activeExternalSessionId, disabled, rowCount, rows, renderSwitchedSessions, turns]);
}

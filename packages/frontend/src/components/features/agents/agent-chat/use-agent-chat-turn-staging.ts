import { useEffect, useMemo, useRef, useState } from "react";
import type { AgentChatWindowTurn } from "./agent-chat-thread-windowing";

const STAGE_INIT = 1;
const STAGE_BATCH = 1;

const shouldStageTurns = ({
  activeExternalSessionId,
  completedSessionIds,
  disabled,
  forceStage,
  turnCount,
  windowStart,
}: {
  activeExternalSessionId: string;
  completedSessionIds: Set<string>;
  disabled: boolean;
  forceStage?: boolean;
  turnCount: number;
  windowStart: number;
}): boolean => {
  return (
    !disabled &&
    windowStart > 0 &&
    turnCount > STAGE_INIT &&
    (forceStage === true || !completedSessionIds.has(activeExternalSessionId))
  );
};

type UseAgentChatTurnStagingArgs = {
  activeExternalSessionId: string | null;
  windowStart: number;
  turns: AgentChatWindowTurn[];
  disabled?: boolean;
  onBeforePrepend?: () => void;
};

export function useAgentChatTurnStaging({
  activeExternalSessionId,
  windowStart,
  turns,
  disabled = false,
  onBeforePrepend,
}: UseAgentChatTurnStagingArgs): AgentChatWindowTurn[] {
  const [count, setCount] = useState(() =>
    activeExternalSessionId !== null && !disabled && windowStart > 0 && turns.length > STAGE_INIT
      ? STAGE_INIT
      : turns.length,
  );
  const countRef = useRef(count);
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
    const updateCount = (nextCount: number): void => {
      countRef.current = nextCount;
      setCount((current) => (current === nextCount ? current : nextCount));
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
      updateCount(turns.length);
      return;
    }

    const shouldStage = shouldStageTurns({
      activeExternalSessionId,
      completedSessionIds: completedSessionIdsRef.current,
      disabled,
      forceStage: effectSwitchedSessions,
      turnCount: turns.length,
      windowStart,
    });

    if (!shouldStage) {
      activeSessionRef.current = null;
      updateCount(turns.length);
      return;
    }

    const externalSessionId = activeExternalSessionId;
    const isContinuingActiveSession = activeSessionRef.current === activeExternalSessionId;
    activeSessionRef.current = externalSessionId;
    let nextCount = Math.min(
      turns.length,
      isContinuingActiveSession ? countRef.current : STAGE_INIT,
    );
    updateCount(nextCount);

    if (nextCount >= turns.length) {
      activeSessionRef.current = null;
      completedSessionIdsRef.current.add(externalSessionId);
      return;
    }

    const step = () => {
      if (activeSessionRef.current !== externalSessionId) {
        frameRef.current = null;
        return;
      }

      nextCount = Math.min(turns.length, nextCount + STAGE_BATCH);
      onBeforePrepend?.();
      updateCount(nextCount);

      if (nextCount >= turns.length) {
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
  }, [activeExternalSessionId, disabled, onBeforePrepend, turns.length, windowStart]);

  return useMemo(() => {
    if (
      activeExternalSessionId === null ||
      !shouldStageTurns({
        activeExternalSessionId,
        completedSessionIds: completedSessionIdsRef.current,
        disabled,
        forceStage: renderSwitchedSessions,
        turnCount: turns.length,
        windowStart,
      })
    ) {
      return turns;
    }

    const effectiveCount =
      renderSwitchedSessions && activeSessionRef.current !== activeExternalSessionId
        ? Math.min(turns.length, STAGE_INIT)
        : count;

    if (effectiveCount >= turns.length) {
      return turns;
    }

    return turns.slice(Math.max(0, turns.length - effectiveCount));
  }, [activeExternalSessionId, count, disabled, renderSwitchedSessions, turns, windowStart]);
}

import { useEffect, useMemo, useRef, useState } from "react";
import type { AgentChatWindowTurn } from "./agent-chat-thread-windowing";

const STAGE_INIT = 1;
const STAGE_BATCH = 1;

const shouldStageTurns = ({
  activeSessionId,
  completedSessionIds,
  disabled,
  forceStage,
  turnCount,
  windowStart,
}: {
  activeSessionId: string;
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
    (forceStage === true || !completedSessionIds.has(activeSessionId))
  );
};

type UseAgentChatTurnStagingArgs = {
  activeSessionId: string | null;
  windowStart: number;
  turns: AgentChatWindowTurn[];
  disabled?: boolean;
  onBeforePrepend?: () => void;
};

export function useAgentChatTurnStaging({
  activeSessionId,
  windowStart,
  turns,
  disabled = false,
  onBeforePrepend,
}: UseAgentChatTurnStagingArgs): AgentChatWindowTurn[] {
  const [count, setCount] = useState(() =>
    activeSessionId !== null && !disabled && windowStart > 0 && turns.length > STAGE_INIT
      ? STAGE_INIT
      : turns.length,
  );
  const countRef = useRef(count);
  const frameRef = useRef<number | null>(null);
  const activeSessionRef = useRef<string | null>(null);
  const completedSessionIdsRef = useRef<Set<string>>(new Set());
  const previousSessionIdRef = useRef<string | null>(activeSessionId);
  const previousSessionId = previousSessionIdRef.current;
  const switchedSessions =
    previousSessionId !== null && activeSessionId !== null && previousSessionId !== activeSessionId;

  useEffect(() => {
    const updateCount = (nextCount: number): void => {
      countRef.current = nextCount;
      setCount((current) => (current === nextCount ? current : nextCount));
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
      updateCount(turns.length);
      return;
    }

    const shouldStage = shouldStageTurns({
      activeSessionId,
      completedSessionIds: completedSessionIdsRef.current,
      disabled,
      forceStage: switchedSessions,
      turnCount: turns.length,
      windowStart,
    });

    if (!shouldStage) {
      activeSessionRef.current = null;
      updateCount(turns.length);
      return;
    }

    const sessionId = activeSessionId;
    const isContinuingActiveSession = activeSessionRef.current === activeSessionId;
    activeSessionRef.current = sessionId;
    let nextCount = Math.min(
      turns.length,
      isContinuingActiveSession ? countRef.current : STAGE_INIT,
    );
    updateCount(nextCount);

    if (nextCount >= turns.length) {
      activeSessionRef.current = null;
      completedSessionIdsRef.current.add(sessionId);
      return;
    }

    const step = () => {
      if (activeSessionRef.current !== sessionId) {
        frameRef.current = null;
        return;
      }

      nextCount = Math.min(turns.length, nextCount + STAGE_BATCH);
      onBeforePrepend?.();
      updateCount(nextCount);

      if (nextCount >= turns.length) {
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
  }, [activeSessionId, disabled, onBeforePrepend, switchedSessions, turns.length, windowStart]);

  return useMemo(() => {
    if (
      activeSessionId === null ||
      !shouldStageTurns({
        activeSessionId,
        completedSessionIds: completedSessionIdsRef.current,
        disabled,
        forceStage: switchedSessions,
        turnCount: turns.length,
        windowStart,
      })
    ) {
      return turns;
    }

    const effectiveCount =
      switchedSessions && activeSessionRef.current !== activeSessionId
        ? Math.min(turns.length, STAGE_INIT)
        : count;

    if (effectiveCount >= turns.length) {
      return turns;
    }

    return turns.slice(Math.max(0, turns.length - effectiveCount));
  }, [activeSessionId, count, disabled, switchedSessions, turns, windowStart]);
}

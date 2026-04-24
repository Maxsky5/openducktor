import { useEffect, useMemo, useRef, useState } from "react";
import type { AgentChatWindowTurn } from "./agent-chat-thread-windowing";

const STAGE_INIT = 1;
const STAGE_BATCH = 3;

const shouldStageTurns = ({
  activeSessionId,
  completedSessionIds,
  disabled,
  turnCount,
  windowStart,
}: {
  activeSessionId: string;
  completedSessionIds: Set<string>;
  disabled: boolean;
  turnCount: number;
  windowStart: number;
}): boolean => {
  return (
    !disabled &&
    windowStart > 0 &&
    turnCount > STAGE_INIT &&
    !completedSessionIds.has(activeSessionId)
  );
};

type UseAgentChatTurnStagingArgs = {
  activeSessionId: string | null;
  windowStart: number;
  turns: AgentChatWindowTurn[];
  disabled?: boolean;
};

export function useAgentChatTurnStaging({
  activeSessionId,
  windowStart,
  turns,
  disabled = false,
}: UseAgentChatTurnStagingArgs): AgentChatWindowTurn[] {
  const [count, setCount] = useState(turns.length);
  const countRef = useRef(count);
  const frameRef = useRef<number | null>(null);
  const activeSessionRef = useRef<string | null>(null);
  const completedSessionIdsRef = useRef<Set<string>>(new Set());
  const previousSessionIdRef = useRef<string | null>(activeSessionId);

  useEffect(() => {
    const updateCount = (nextCount: number): void => {
      countRef.current = nextCount;
      setCount((current) => (current === nextCount ? current : nextCount));
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

    if (activeSessionId === null) {
      activeSessionRef.current = null;
      updateCount(turns.length);
      return;
    }

    const shouldStage = shouldStageTurns({
      activeSessionId,
      completedSessionIds: completedSessionIdsRef.current,
      disabled,
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
  }, [activeSessionId, disabled, turns.length, windowStart]);

  return useMemo(() => {
    if (
      activeSessionId === null ||
      !shouldStageTurns({
        activeSessionId,
        completedSessionIds: completedSessionIdsRef.current,
        disabled,
        turnCount: turns.length,
        windowStart,
      })
    ) {
      return turns;
    }

    if (count >= turns.length) {
      return turns;
    }

    return turns.slice(Math.max(0, turns.length - count));
  }, [activeSessionId, count, disabled, turns, windowStart]);
}

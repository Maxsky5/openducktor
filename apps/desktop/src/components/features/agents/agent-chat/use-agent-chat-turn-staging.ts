import { useEffect, useMemo, useRef, useState } from "react";
import type { AgentChatWindowTurn } from "./agent-chat-thread-windowing";

const STAGE_INIT = 1;
const STAGE_BATCH = 3;

type UseAgentChatTurnStagingArgs = {
  activeSessionId: string | null;
  windowStart: number;
  turns: AgentChatWindowTurn[];
};

export function useAgentChatTurnStaging({
  activeSessionId,
  windowStart,
  turns,
}: UseAgentChatTurnStagingArgs): AgentChatWindowTurn[] {
  const [count, setCount] = useState(turns.length);
  const frameRef = useRef<number | null>(null);
  const activeSessionRef = useRef<string | null>(null);
  const completedSessionRef = useRef<string | null>(null);

  useEffect(() => {
    if (frameRef.current !== null) {
      globalThis.cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
    }

    const shouldStage =
      activeSessionId !== null &&
      windowStart > 0 &&
      turns.length > STAGE_INIT &&
      completedSessionRef.current !== activeSessionId;

    if (!shouldStage) {
      activeSessionRef.current = null;
      setCount((current) => (current === turns.length ? current : turns.length));
      return;
    }

    if (activeSessionRef.current === activeSessionId) {
      return;
    }

    const sessionId = activeSessionId;
    activeSessionRef.current = sessionId;
    let nextCount = Math.min(turns.length, STAGE_INIT);
    setCount((current) => (current === nextCount ? current : nextCount));

    const step = () => {
      if (activeSessionRef.current !== sessionId) {
        frameRef.current = null;
        return;
      }

      nextCount = Math.min(turns.length, nextCount + STAGE_BATCH);
      setCount((current) => (current === nextCount ? current : nextCount));

      if (nextCount >= turns.length) {
        frameRef.current = null;
        activeSessionRef.current = null;
        completedSessionRef.current = sessionId;
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
  }, [activeSessionId, turns.length, windowStart]);

  return useMemo(() => {
    if (count >= turns.length) {
      return turns;
    }

    return turns.slice(Math.max(0, turns.length - count));
  }, [count, turns]);
}

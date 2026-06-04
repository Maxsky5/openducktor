import { useCallback, useEffect, useReducer, useRef } from "react";
import type { AgentSessionState } from "@/types/agent-orchestrator";

type UseAgentStudioThreadContextArgs = {
  activeSession: AgentSessionState | null;
  isTaskHydrating: boolean;
  isSessionHistoryHydrating: boolean;
  contextSwitchVersion: number;
};

type AgentStudioThreadContext = {
  threadSession: AgentSessionState | null;
  activeExternalSessionId: string | null;
  isContextSwitching: boolean;
};

export const useAgentStudioThreadContext = ({
  activeSession,
  isTaskHydrating,
  isSessionHistoryHydrating: _isSessionHistoryHydrating,
  contextSwitchVersion,
}: UseAgentStudioThreadContextArgs): AgentStudioThreadContext => {
  const [isContextSwitchIntentActive, setIsContextSwitchIntentActive] = useReducer(
    (_current: boolean, next: boolean) => next,
    false,
  );
  const contextSwitchVersionRef = useRef(contextSwitchVersion);
  const clearIntentRafRef = useRef<number | null>(null);
  const activeExternalSessionId = activeSession?.externalSessionId ?? null;

  useEffect(() => {
    if (contextSwitchVersionRef.current === contextSwitchVersion) {
      return;
    }

    contextSwitchVersionRef.current = contextSwitchVersion;
    setIsContextSwitchIntentActive(true);
  }, [contextSwitchVersion]);

  useEffect(() => {
    if (!isContextSwitchIntentActive) {
      if (clearIntentRafRef.current !== null && typeof window !== "undefined") {
        window.cancelAnimationFrame(clearIntentRafRef.current);
        clearIntentRafRef.current = null;
      }
      return;
    }

    if (isTaskHydrating) {
      return;
    }

    if (typeof window === "undefined") {
      setIsContextSwitchIntentActive(false);
      return;
    }

    if (clearIntentRafRef.current !== null) {
      window.cancelAnimationFrame(clearIntentRafRef.current);
      clearIntentRafRef.current = null;
    }

    const rafId = window.requestAnimationFrame(() => {
      clearIntentRafRef.current = null;
      setIsContextSwitchIntentActive(false);
    });
    clearIntentRafRef.current = rafId;

    return () => {
      const clearIntentRafId = clearIntentRafRef.current;
      if (clearIntentRafId !== null) {
        window.cancelAnimationFrame(clearIntentRafId);
        clearIntentRafRef.current = null;
      }
    };
  }, [isContextSwitchIntentActive, isTaskHydrating]);

  const clearContextSwitchIntentFrame = useCallback(() => {
    if (clearIntentRafRef.current !== null && typeof window !== "undefined") {
      window.cancelAnimationFrame(clearIntentRafRef.current);
      clearIntentRafRef.current = null;
    }
  }, []);

  useEffect(() => clearContextSwitchIntentFrame, [clearContextSwitchIntentFrame]);

  return {
    threadSession: activeSession,
    activeExternalSessionId,
    isContextSwitching:
      isTaskHydrating || (isContextSwitchIntentActive && activeExternalSessionId === null),
  };
};

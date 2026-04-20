import { useEffect, useRef, useState } from "react";
import type { AgentSessionState } from "@/types/agent-orchestrator";

type UseAgentChatThreadContextArgs = {
  activeSession: AgentSessionState | null;
  isTaskHydrating: boolean;
  contextSwitchVersion: number;
};

type AgentChatThreadContext = {
  threadSession: AgentSessionState | null;
  activeSessionId: string | null;
  isContextSwitching: boolean;
};

export const useAgentChatThreadContext = ({
  activeSession,
  isTaskHydrating,
  contextSwitchVersion,
}: UseAgentChatThreadContextArgs): AgentChatThreadContext => {
  const [isContextSwitchIntentActive, setIsContextSwitchIntentActive] = useState(false);
  const contextSwitchVersionRef = useRef(contextSwitchVersion);
  const clearIntentRafRef = useRef<number | null>(null);
  const activeSessionId = activeSession?.sessionId ?? null;

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
      if (clearIntentRafRef.current !== null) {
        window.cancelAnimationFrame(clearIntentRafRef.current);
        clearIntentRafRef.current = null;
      }
    };
  }, [isContextSwitchIntentActive, isTaskHydrating]);

  useEffect(() => {
    return () => {
      if (clearIntentRafRef.current !== null && typeof window !== "undefined") {
        window.cancelAnimationFrame(clearIntentRafRef.current);
      }
    };
  }, []);

  return {
    threadSession: activeSession,
    activeSessionId,
    isContextSwitching:
      isTaskHydrating || (isContextSwitchIntentActive && activeSessionId === null),
  };
};

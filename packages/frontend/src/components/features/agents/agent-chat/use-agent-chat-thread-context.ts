import { useEffect, useRef, useState } from "react";
import type { AgentSessionState } from "@/types/agent-orchestrator";

type UseAgentChatThreadContextArgs = {
  activeSession: AgentSessionState | null;
  isTaskHydrating: boolean;
  isSessionHistoryHydrated: boolean;
  contextSwitchVersion: number;
};

type AgentChatThreadContext = {
  threadSession: AgentSessionState | null;
  activeExternalSessionId: string | null;
  isContextSwitching: boolean;
};

export const useAgentChatThreadContext = ({
  activeSession,
  isTaskHydrating,
  isSessionHistoryHydrated,
  contextSwitchVersion,
}: UseAgentChatThreadContextArgs): AgentChatThreadContext => {
  const [isContextSwitchIntentActive, setIsContextSwitchIntentActive] = useState(false);
  const contextSwitchVersionRef = useRef(contextSwitchVersion);
  const clearIntentRafRef = useRef<number | null>(null);
  const activeExternalSessionId = activeSession?.externalSessionId ?? null;
  const hasPendingContextSwitchVersion = contextSwitchVersionRef.current !== contextSwitchVersion;
  const canRenderActiveSession = activeSession !== null && isSessionHistoryHydrated;
  const shouldClearThread =
    isTaskHydrating ||
    (!canRenderActiveSession && (hasPendingContextSwitchVersion || isContextSwitchIntentActive));

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
    threadSession: shouldClearThread ? null : activeSession,
    activeExternalSessionId: shouldClearThread ? null : activeExternalSessionId,
    isContextSwitching: shouldClearThread,
  };
};

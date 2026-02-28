import { useEffect, useRef, useState } from "react";
import type { AgentSessionState } from "@/types/agent-orchestrator";

type UseAgentStudioThreadContextArgs = {
  activeSession: AgentSessionState | null;
  isTaskHydrating: boolean;
  contextSwitchVersion: number;
};

type AgentStudioThreadContext = {
  threadSession: AgentSessionState | null;
  activeSessionId: string | null;
  isContextSwitching: boolean;
  scrollTrigger: string;
};

export const useAgentStudioThreadContext = ({
  activeSession,
  isTaskHydrating,
  contextSwitchVersion,
}: UseAgentStudioThreadContextArgs): AgentStudioThreadContext => {
  const [threadSession, setThreadSession] = useState<AgentSessionState | null>(activeSession);
  const [isContextSwitchIntentActive, setIsContextSwitchIntentActive] = useState(false);
  const contextSwitchVersionRef = useRef(contextSwitchVersion);
  const hasObservedContextSwitchRef = useRef(false);
  const contextSwitchIntentRafRef = useRef<number | null>(null);

  useEffect(() => {
    if (contextSwitchVersionRef.current === contextSwitchVersion) {
      return;
    }

    contextSwitchVersionRef.current = contextSwitchVersion;
    hasObservedContextSwitchRef.current = false;
    setIsContextSwitchIntentActive(true);

    if (contextSwitchIntentRafRef.current !== null && typeof window !== "undefined") {
      window.cancelAnimationFrame(contextSwitchIntentRafRef.current);
      contextSwitchIntentRafRef.current = null;
    }

    if (typeof window === "undefined") {
      setIsContextSwitchIntentActive(false);
      return;
    }

    const rafId = window.requestAnimationFrame(() => {
      const nestedRafId = window.requestAnimationFrame(() => {
        contextSwitchIntentRafRef.current = null;
        if (!hasObservedContextSwitchRef.current) {
          setIsContextSwitchIntentActive(false);
        }
      });
      contextSwitchIntentRafRef.current = nestedRafId;
    });
    contextSwitchIntentRafRef.current = rafId;
  }, [contextSwitchVersion]);

  useEffect(() => {
    const nextSessionId = activeSession?.sessionId ?? null;
    const currentThreadSessionId = threadSession?.sessionId ?? null;
    if (nextSessionId === currentThreadSessionId) {
      if (activeSession !== threadSession) {
        setThreadSession(activeSession);
      }
      return;
    }

    if (typeof window === "undefined") {
      setThreadSession(activeSession);
      return;
    }

    const rafId = window.requestAnimationFrame(() => {
      setThreadSession(activeSession);
    });

    return () => {
      window.cancelAnimationFrame(rafId);
    };
  }, [activeSession, threadSession]);

  useEffect(() => {
    return () => {
      if (contextSwitchIntentRafRef.current !== null && typeof window !== "undefined") {
        window.cancelAnimationFrame(contextSwitchIntentRafRef.current);
      }
    };
  }, []);

  const activeSessionId = activeSession?.sessionId ?? null;
  const threadSessionId = threadSession?.sessionId ?? null;
  const isThreadContextSwitching = activeSessionId !== threadSessionId;

  useEffect(() => {
    if (!isContextSwitchIntentActive) {
      return;
    }

    if (isTaskHydrating || isThreadContextSwitching) {
      hasObservedContextSwitchRef.current = true;
      return;
    }

    if (!hasObservedContextSwitchRef.current) {
      return;
    }

    hasObservedContextSwitchRef.current = false;
    setIsContextSwitchIntentActive(false);
  }, [isContextSwitchIntentActive, isTaskHydrating, isThreadContextSwitching]);

  const isContextSwitching =
    isTaskHydrating || isThreadContextSwitching || isContextSwitchIntentActive;

  const activeMessageCount = threadSession?.messages.length ?? 0;
  const activeDraftScrollBucket = Math.floor((threadSession?.draftAssistantText.length ?? 0) / 48);
  const activeSessionStatus = threadSession?.status ?? "stopped";
  const scrollTrigger = `${threadSession?.sessionId ?? "none"}:${activeSessionStatus}:${activeMessageCount}:${threadSession?.pendingQuestions.length ?? 0}:${threadSession?.pendingPermissions.length ?? 0}:${activeDraftScrollBucket}`;

  return {
    threadSession,
    activeSessionId,
    isContextSwitching,
    scrollTrigger,
  };
};

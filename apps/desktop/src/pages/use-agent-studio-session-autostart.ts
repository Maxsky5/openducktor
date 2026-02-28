import type { AgentRole, AgentScenario } from "@openducktor/core";
import { type MutableRefObject, useEffect } from "react";
import { buildAutoStartKey } from "./use-agent-studio-session-action-helpers";

type UseAgentStudioSessionAutostartArgs = {
  activeRepo: string | null;
  taskId: string;
  role: AgentRole;
  scenario: AgentScenario;
  autostart: boolean;
  sessionStartPreference: "fresh" | "continue" | null;
  activeSessionPresent: boolean;
  agentStudioReady: boolean;
  isActiveTaskHydrated: boolean;
  autoStartExecutedRef: MutableRefObject<Set<string>>;
  startScenarioKickoff: () => Promise<void>;
};

export function useAgentStudioSessionAutostart({
  activeRepo,
  taskId,
  role,
  scenario,
  autostart,
  sessionStartPreference,
  activeSessionPresent,
  agentStudioReady,
  isActiveTaskHydrated,
  autoStartExecutedRef,
  startScenarioKickoff,
}: UseAgentStudioSessionAutostartArgs): {
  isAutoStartPending: boolean;
} {
  const autoStartKey = buildAutoStartKey({
    activeRepo,
    taskId,
    role,
    scenario,
  });

  const isFreshStartRequested = sessionStartPreference === "fresh";
  const hasAutoStartExecuted = autoStartKey
    ? autoStartExecutedRef.current.has(autoStartKey)
    : false;
  const isAutoStartPending = Boolean(
    autostart &&
      autoStartKey &&
      (isFreshStartRequested || !activeSessionPresent) &&
      agentStudioReady &&
      !hasAutoStartExecuted,
  );

  useEffect(() => {
    if (
      !autostart ||
      !activeRepo ||
      !taskId ||
      (!isFreshStartRequested && activeSessionPresent) ||
      !agentStudioReady ||
      !isActiveTaskHydrated
    ) {
      return;
    }
    if (!autoStartKey || autoStartExecutedRef.current.has(autoStartKey)) {
      return;
    }

    autoStartExecutedRef.current.add(autoStartKey);
    void startScenarioKickoff();
  }, [
    activeRepo,
    activeSessionPresent,
    agentStudioReady,
    autostart,
    autoStartExecutedRef,
    autoStartKey,
    isActiveTaskHydrated,
    isFreshStartRequested,
    startScenarioKickoff,
    taskId,
  ]);

  return {
    isAutoStartPending,
  };
}

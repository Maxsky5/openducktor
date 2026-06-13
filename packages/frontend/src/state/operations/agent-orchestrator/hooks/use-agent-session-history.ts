import { useCallback } from "react";
import type { AgentSessionState } from "@/types/agent-orchestrator";
import {
  deriveAgentSessionViewLifecycle,
  type SessionRepoReadinessState,
  shouldEnsureAgentSessionReadyForView,
} from "../lifecycle/session-view-lifecycle";

type LoadSelectedSessionHistory = (input: { session: AgentSessionState }) => Promise<void>;

export const useAgentSessionHistory = ({
  loadSelectedSessionHistory,
  sessionsRef,
}: {
  loadSelectedSessionHistory: LoadSelectedSessionHistory;
  sessionsRef: { current: Record<string, AgentSessionState> };
}) => {
  const loadSelectedSessionHistoryForView = useCallback(
    async ({
      externalSessionId,
      repoReadinessState,
    }: {
      externalSessionId: string;
      repoReadinessState: SessionRepoReadinessState;
    }): Promise<void> => {
      const session = sessionsRef.current[externalSessionId] ?? null;
      const lifecycle = deriveAgentSessionViewLifecycle({ session, repoReadinessState });

      if (!session || !shouldEnsureAgentSessionReadyForView(lifecycle)) {
        return;
      }

      await loadSelectedSessionHistory({ session });
    },
    [loadSelectedSessionHistory, sessionsRef],
  );

  return {
    loadSelectedSessionHistoryForView,
  };
};

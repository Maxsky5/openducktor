import { useCallback } from "react";
import type { AgentSessionState } from "@/types/agent-orchestrator";
import {
  deriveAgentSessionViewLifecycle,
  type SessionRepoReadinessState,
} from "../lifecycle/session-view-lifecycle";
import { requiresLoadedAgentSessionHistory } from "../support/history-load-state";

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

      if (!session || !lifecycle.shouldEnsureReadyForView) {
        return;
      }

      if (requiresLoadedAgentSessionHistory(session)) {
        await loadSelectedSessionHistory({ session });
      }
    },
    [loadSelectedSessionHistory, sessionsRef],
  );

  return {
    loadSelectedSessionHistoryForView,
  };
};

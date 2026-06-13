import type { AgentSessionRecord } from "@openducktor/contracts";
import { useCallback } from "react";
import type {
  AgentSessionState,
  EnsureSessionReadyForViewResult,
} from "@/types/agent-orchestrator";
import {
  deriveAgentSessionViewLifecycle,
  type SessionRepoReadinessState,
} from "../lifecycle/session-view-lifecycle";
import { requiresLoadedAgentSessionHistory } from "../support/history-load-state";

type LoadAgentSessionHistory = (input: {
  taskId: string;
  externalSessionId: string;
  persistedRecords?: AgentSessionRecord[];
}) => Promise<void>;

export const useAgentSessionHistory = ({
  loadAgentSessionHistory,
  sessionsRef,
}: {
  loadAgentSessionHistory: LoadAgentSessionHistory;
  sessionsRef: { current: Record<string, AgentSessionState> };
}) => {
  const loadRequestedTaskSessionHistory = useCallback(
    async ({
      taskId,
      externalSessionId,
      persistedRecords,
    }: {
      taskId: string;
      externalSessionId: string;
      persistedRecords?: AgentSessionRecord[];
    }): Promise<void> => {
      await loadAgentSessionHistory({
        taskId,
        externalSessionId,
        ...(persistedRecords ? { persistedRecords } : {}),
      });
    },
    [loadAgentSessionHistory],
  );

  const ensureSessionReadyForView = useCallback(
    async ({
      taskId,
      externalSessionId,
      repoReadinessState,
    }: {
      taskId: string;
      externalSessionId: string;
      repoReadinessState: SessionRepoReadinessState;
    }): Promise<EnsureSessionReadyForViewResult> => {
      const session = sessionsRef.current[externalSessionId] ?? null;
      const lifecycle = deriveAgentSessionViewLifecycle({ session, repoReadinessState });

      if (!session || !lifecycle.shouldEnsureReadyForView) {
        return lifecycle.phase === "ready" ? "ready" : "not_needed";
      }

      if (requiresLoadedAgentSessionHistory(session)) {
        try {
          await loadAgentSessionHistory({
            taskId,
            externalSessionId,
          });
        } catch {
          return "failed";
        }
      }
      return "ready";
    },
    [loadAgentSessionHistory, sessionsRef],
  );

  return {
    loadRequestedTaskSessionHistory,
    ensureSessionReadyForView,
  };
};

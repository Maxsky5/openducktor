import type { AgentSessionRecord } from "@openducktor/contracts";
import { useCallback } from "react";
import type { AgentSessionState } from "@/types/agent-orchestrator";
import { runOrchestratorSideEffect } from "../support/async-side-effects";
import { toPersistedSessionRecord } from "../support/persistence";
import { isTranscriptAgentSession } from "../support/session-purpose";

type UseAgentSessionMutationsArgs = {
  workspaceRepoPath: string | null;
  sessionsRef: { current: Record<string, AgentSessionState> };
  commitSessions: (
    updater:
      | Record<string, AgentSessionState>
      | ((current: Record<string, AgentSessionState>) => Record<string, AgentSessionState>),
  ) => void;
  persistSessionRecord: (taskId: string, record: AgentSessionRecord) => Promise<void>;
};

export type UpdateAgentSession = (
  externalSessionId: string,
  updater: (current: AgentSessionState) => AgentSessionState,
  options?: { persist?: boolean },
) => void;

export const useAgentSessionMutations = ({
  workspaceRepoPath,
  sessionsRef,
  commitSessions,
  persistSessionRecord,
}: UseAgentSessionMutationsArgs): { updateSession: UpdateAgentSession } => {
  const updateSession = useCallback<UpdateAgentSession>(
    (externalSessionId, updater, options): void => {
      const currentSessions = sessionsRef.current;
      const current = currentSessions[externalSessionId];
      if (!current) {
        return;
      }
      const shouldPersist = options?.persist === true && !isTranscriptAgentSession(current);
      const nextSession = updater(current);
      if (nextSession === current) {
        return;
      }

      let hasChanges = false;
      for (const key of Object.keys(nextSession) as Array<keyof AgentSessionState>) {
        if (nextSession[key] !== current[key]) {
          hasChanges = true;
          break;
        }
      }

      if (!hasChanges) {
        return;
      }

      const nextSessions = {
        ...currentSessions,
        [externalSessionId]: nextSession,
      };
      commitSessions(nextSessions);

      if (shouldPersist) {
        runOrchestratorSideEffect(
          "operations-persist-session-snapshot",
          persistSessionRecord(nextSession.taskId, toPersistedSessionRecord(nextSession)),
          {
            tags: {
              repoPath: workspaceRepoPath,
              externalSessionId,
              taskId: nextSession.taskId,
              role: nextSession.role,
            },
          },
        );
      }
    },
    [workspaceRepoPath, commitSessions, persistSessionRecord, sessionsRef],
  );

  return { updateSession };
};

import type { AgentSessionRecord } from "@openducktor/contracts";
import { useCallback } from "react";
import {
  type AgentSessionCollection,
  type AgentSessionCollectionUpdater,
  getAgentSession,
  replaceAgentSession,
} from "@/state/agent-session-collection";
import type { AgentSessionIdentity, AgentSessionState } from "@/types/agent-orchestrator";
import { runOrchestratorSideEffect } from "../support/async-side-effects";
import { toPersistedSessionRecord } from "../support/persistence";
import { isWorkflowAgentSession } from "../support/workflow-session";

type UseAgentSessionMutationsArgs = {
  workspaceRepoPath: string | null;
  sessionsRef: { current: AgentSessionCollection };
  commitSessions: (updater: AgentSessionCollectionUpdater) => void;
  persistSessionRecord: (taskId: string, record: AgentSessionRecord) => Promise<void>;
};

export type UpdateAgentSession = (
  identity: AgentSessionIdentity,
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
    (identity, updater, options): void => {
      const currentSessions = sessionsRef.current;
      const current = getAgentSession(currentSessions, identity);
      if (!current) {
        return;
      }
      const nextSession = updater(current);
      if (nextSession === current) {
        return;
      }
      const shouldPersist = options?.persist === true;

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

      if (shouldPersist && !isWorkflowAgentSession(nextSession)) {
        throw new Error(`Session '${identity.externalSessionId}' is not a workflow session.`);
      }

      commitSessions(replaceAgentSession(currentSessions, nextSession));

      if (shouldPersist) {
        runOrchestratorSideEffect(
          "operations-persist-session-snapshot",
          persistSessionRecord(nextSession.taskId, toPersistedSessionRecord(nextSession)),
          {
            tags: {
              repoPath: workspaceRepoPath,
              externalSessionId: nextSession.externalSessionId,
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

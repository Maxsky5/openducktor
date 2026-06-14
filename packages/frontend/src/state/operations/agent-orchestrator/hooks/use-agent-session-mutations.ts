import type { AgentSessionRecord } from "@openducktor/contracts";
import { useCallback } from "react";
import {
  type AgentSessionCollection,
  type AgentSessionCollectionUpdater,
  getAgentSessionByExternalSessionId,
  replaceAgentSession,
} from "@/state/agent-session-collection";
import type { AgentSessionState } from "@/types/agent-orchestrator";
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
      const current = getAgentSessionByExternalSessionId(currentSessions, externalSessionId);
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
        throw new Error(`Session '${externalSessionId}' is not a workflow session.`);
      }

      commitSessions(replaceAgentSession(currentSessions, nextSession));

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

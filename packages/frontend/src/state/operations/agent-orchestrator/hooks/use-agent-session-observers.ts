import type { RepoPromptOverrides, RuntimeKind } from "@openducktor/contracts";
import {
  type AgentEnginePort,
  type AgentRole,
  buildReadOnlyPermissionRejectionMessage,
} from "@openducktor/core";
import type { QueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import { findRuntimeDefinition, runtimeSupportsCapability } from "@/lib/agent-runtime";
import type { AgentSessionsStore } from "@/state/agent-sessions-store";
import { updateSessionTodosQueryData } from "@/state/queries/agent-session-todos";
import type { AgentSessionIdentity } from "@/types/agent-orchestrator";
import type { UpdateSession } from "../events/session-event-types";
import { listenToAgentSessionEvents } from "../events/session-events";
import { cleanupLocalAgentSessions } from "../support/local-session-cleanup";
import type { SessionObservers } from "../support/session-observers";
import type { ObserveAgentSession } from "../support/session-runtime-ref";
import type { SessionTurnState } from "../support/session-turn-state";

type UseAgentSessionObserversArgs = {
  agentEngine: AgentEnginePort;
  workspaceId: string | null;
  loadRepoPromptOverrides: (workspaceId: string) => Promise<RepoPromptOverrides>;
  sessionObserversRef: { current: SessionObservers };
  sessionTurnState: SessionTurnState;
  readSession: AgentSessionsStore["getSessionSnapshot"];
  updateSession: UpdateSession;
  queryClient: QueryClient;
  refreshTaskData: (
    repoPath: string,
    taskIdOrIds?: string | string[],
    options?: { forceFreshTaskList?: boolean },
  ) => Promise<void>;
};

export const useAgentSessionObservers = ({
  agentEngine,
  workspaceId,
  loadRepoPromptOverrides,
  sessionObserversRef,
  sessionTurnState,
  readSession,
  updateSession,
  queryClient,
  refreshTaskData,
}: UseAgentSessionObserversArgs) => {
  const buildReadOnlyApprovalRejectionMessage = useCallback(
    async (role: AgentRole): Promise<string> => {
      if (!workspaceId) {
        throw new Error("Active workspace is required to build approval rejection text.");
      }
      const promptOverrides = await loadRepoPromptOverrides(workspaceId);
      return buildReadOnlyPermissionRejectionMessage({
        role,
        overrides: promptOverrides,
      });
    },
    [loadRepoPromptOverrides, workspaceId],
  );

  const cleanupSessions = useCallback(
    (sessions: readonly AgentSessionIdentity[]): void => {
      cleanupLocalAgentSessions({
        sessions,
        sessionObservers: sessionObserversRef.current,
        clearSessionTurnState: sessionTurnState.clearSession,
      });
    },
    [sessionObserversRef, sessionTurnState],
  );

  const observeAgentSession = useCallback<ObserveAgentSession>(
    async (target): Promise<boolean> => {
      const findRuntimeDefinitionForKind = (runtimeKind: RuntimeKind) =>
        findRuntimeDefinition(agentEngine.listRuntimeDefinitions(), runtimeKind);

      return sessionObserversRef.current.ensureObserver(target, () =>
        listenToAgentSessionEvents({
          adapter: agentEngine,
          sessionRef: target,
          turnMetadata: sessionTurnState.metadata,
          readSession,
          updateSession,
          updateSessionTodos: (updater) =>
            updateSessionTodosQueryData(queryClient, target, updater),
          isSessionObserved: (candidateSession) =>
            sessionObserversRef.current.has(candidateSession),
          recordTurnActivityTimestamp: sessionTurnState.timing.recordTurnActivityTimestamp,
          recordTurnUserMessageTimestamp: sessionTurnState.timing.recordTurnUserMessageTimestamp,
          resolveTurnDurationMs: sessionTurnState.timing.resolveTurnDurationMs,
          clearTurnDuration: sessionTurnState.timing.clearTurnDuration,
          buildReadOnlyApprovalRejectionMessage,
          refreshTaskData,
          canAutoRejectReadOnlyApproval: (runtimeKind) => {
            const runtimeDefinition = findRuntimeDefinitionForKind(runtimeKind);
            return runtimeDefinition
              ? runtimeSupportsCapability(runtimeDefinition, "approvals.readOnlyAutoRejectSafe")
              : false;
          },
          resolveWorkflowToolAliasesByCanonical: (runtimeKind) =>
            findRuntimeDefinitionForKind(runtimeKind)?.workflowToolAliasesByCanonical,
        }),
      );
    },
    [
      agentEngine,
      buildReadOnlyApprovalRejectionMessage,
      refreshTaskData,
      readSession,
      queryClient,
      sessionObserversRef,
      sessionTurnState,
      updateSession,
    ],
  );

  return {
    observeAgentSession,
    cleanupLocalSessions: cleanupSessions,
  };
};

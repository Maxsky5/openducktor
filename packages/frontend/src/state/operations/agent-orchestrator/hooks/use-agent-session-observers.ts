import type { RepoPromptOverrides } from "@openducktor/contracts";
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

  const clearSessionObservationState = useCallback(
    (sessions: readonly AgentSessionIdentity[]): void => {
      for (const session of sessions) {
        sessionObserversRef.current.remove(session);
        sessionTurnState.clearSession(session);
      }
    },
    [sessionObserversRef, sessionTurnState],
  );

  const observeAgentSession = useCallback<ObserveAgentSession>(
    async (target): Promise<void> => {
      await sessionObserversRef.current.ensureObserver(target, () => {
        const runtimeDefinition = findRuntimeDefinition(
          agentEngine.listRuntimeDefinitions(),
          target.runtimeKind,
        );

        return listenToAgentSessionEvents({
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
          readOnlyApprovalAutoRejectSafe: runtimeDefinition
            ? runtimeSupportsCapability(runtimeDefinition, "approvals.readOnlyAutoRejectSafe")
            : false,
          workflowToolAliasesByCanonical: runtimeDefinition?.workflowToolAliasesByCanonical,
        });
      });
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
    clearSessionObservationState,
  };
};

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
import { updateSessionTodosQueryData } from "@/state/queries/agent-session-runtime";
import type { AgentSessionIdentity, AgentSessionState } from "@/types/agent-orchestrator";
import type { UpdateSession } from "../events/session-event-types";
import { listenToAgentSessionEvents } from "../events/session-events";
import {
  removeLocalAgentSessions,
  selectSessionsForTaskRemoval,
} from "../support/local-session-removal";
import type { SessionObservers } from "../support/session-observers";
import type { ObserveAgentSession } from "../support/session-runtime-ref";
import type { SessionTransientState } from "../support/session-transient-state";

type UseAgentSessionObserversArgs = {
  agentEngine: AgentEnginePort;
  workspaceId: string | null;
  loadRepoPromptOverrides: (workspaceId: string) => Promise<RepoPromptOverrides>;
  sessionObserversRef: { current: SessionObservers };
  sessionTransientState: SessionTransientState;
  readSessions: AgentSessionsStore["getSessionsSnapshot"];
  readSession: AgentSessionsStore["getSessionSnapshot"];
  setSessionCollection: AgentSessionsStore["setSessionCollection"];
  updateSession: UpdateSession;
  queryClient: QueryClient;
  recordTurnActivityTimestamp: (sessionKey: string, timestamp: string | number) => void;
  recordTurnUserMessageTimestamp: (
    sessionKey: string,
    timestamp: string | number,
  ) => number | undefined;
  resolveTurnDurationMs: (
    sessionKey: string,
    externalSessionId: string,
    timestamp: string,
    messages?: AgentSessionState["messages"],
  ) => number | undefined;
  clearTurnDuration: (sessionKey: string, completedTimestamp?: string) => void;
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
  sessionTransientState,
  readSessions,
  readSession,
  setSessionCollection,
  updateSession,
  queryClient,
  recordTurnActivityTimestamp,
  recordTurnUserMessageTimestamp,
  resolveTurnDurationMs,
  clearTurnDuration,
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

  const removeSessions = useCallback(
    (sessions: readonly AgentSessionIdentity[]): void => {
      removeLocalAgentSessions({
        sessions,
        commitSessionCollection: setSessionCollection,
        sessionObservers: sessionObserversRef.current,
        sessionTransientState,
      });
    },
    [setSessionCollection, sessionObserversRef, sessionTransientState],
  );

  const removeAgentSession = useCallback(
    async (session: AgentSessionIdentity): Promise<void> => {
      removeSessions([session]);
    },
    [removeSessions],
  );

  const removeAgentSessions = useCallback(
    async ({ taskId, roles }: { taskId: string; roles?: AgentRole[] }): Promise<void> => {
      const matchingSessions = selectSessionsForTaskRemoval(readSessions(), {
        taskId,
        roles,
      });
      removeSessions(matchingSessions);
    },
    [readSessions, removeSessions],
  );

  const observeAgentSession = useCallback<ObserveAgentSession>(
    async (target): Promise<void> => {
      const findRuntimeDefinitionForKind = (runtimeKind: RuntimeKind) =>
        findRuntimeDefinition(agentEngine.listRuntimeDefinitions(), runtimeKind);

      await sessionObserversRef.current.ensureObserver(target, () =>
        listenToAgentSessionEvents({
          adapter: agentEngine,
          sessionRef: target,
          draftBuffers: sessionTransientState.draftBuffers,
          turnMetadata: sessionTransientState.turnMetadata,
          readSession,
          updateSession,
          updateSessionTodos: (updater) =>
            updateSessionTodosQueryData(queryClient, target, updater),
          hasSessionObserver: (candidateSession) =>
            sessionObserversRef.current.has(candidateSession),
          recordTurnActivityTimestamp,
          recordTurnUserMessageTimestamp,
          resolveTurnDurationMs,
          clearTurnDuration,
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
      clearTurnDuration,
      refreshTaskData,
      recordTurnActivityTimestamp,
      recordTurnUserMessageTimestamp,
      readSession,
      resolveTurnDurationMs,
      queryClient,
      sessionObserversRef,
      sessionTransientState,
      updateSession,
    ],
  );

  return { observeAgentSession, removeAgentSession, removeAgentSessions };
};

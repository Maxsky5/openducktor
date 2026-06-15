import type { RepoPromptOverrides, RuntimeKind } from "@openducktor/contracts";
import {
  type AgentEnginePort,
  type AgentRole,
  buildReadOnlyPermissionRejectionMessage,
} from "@openducktor/core";
import type { QueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import { findRuntimeDefinition } from "@/lib/agent-runtime";
import { removeAgentSessions as removeAgentSessionsFromCollection } from "@/state/agent-session-collection";
import type { AgentSessionsStore } from "@/state/agent-sessions-store";
import { updateSessionTodosQueryData } from "@/state/queries/agent-session-runtime";
import type { AgentSessionIdentity, AgentSessionState } from "@/types/agent-orchestrator";
import type { UpdateSession } from "../events/session-event-types";
import { listenToAgentSessionEvents } from "../events/session-events";
import type { SessionObservers } from "../support/session-observers";
import type { ObserveAgentSession } from "../support/session-runtime-ref";
import {
  clearSessionsTransientState,
  type SessionTransientState,
} from "../support/session-transient-state";

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

const selectSessionsForTaskRemoval = (
  sessions: readonly AgentSessionState[],
  { taskId, roles }: { taskId: string; roles: AgentRole[] | undefined },
): AgentSessionIdentity[] => {
  const matchingRoles = roles ? new Set(roles) : null;
  return sessions.filter(
    (session) =>
      session.taskId === taskId &&
      (matchingRoles === null || (session.role !== null && matchingRoles.has(session.role))),
  );
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
      if (sessions.length === 0) {
        return;
      }

      setSessionCollection((currentSessions) =>
        removeAgentSessionsFromCollection(currentSessions, sessions),
      );
      sessionObserversRef.current.removeMany(sessions);
      clearSessionsTransientState(sessionTransientState, sessions);
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
      if (sessionObserversRef.current.has(target)) {
        return;
      }

      const unsubscribe = await listenToAgentSessionEvents({
        adapter: agentEngine,
        sessionRef: target,
        draftBuffers: sessionTransientState.draftBuffers,
        turnMetadata: sessionTransientState.turnMetadata,
        readSession,
        updateSession,
        updateSessionTodos: (updater) => updateSessionTodosQueryData(queryClient, target, updater),
        hasSessionObserver: (candidateSession) => sessionObserversRef.current.has(candidateSession),
        recordTurnActivityTimestamp,
        recordTurnUserMessageTimestamp,
        resolveTurnDurationMs,
        clearTurnDuration,
        buildReadOnlyApprovalRejectionMessage,
        refreshTaskData,
        resolveRuntimeDefinition: (runtimeKind: RuntimeKind) =>
          findRuntimeDefinition(agentEngine.listRuntimeDefinitions(), runtimeKind),
      });

      if (sessionObserversRef.current.has(target)) {
        unsubscribe();
        return;
      }
      sessionObserversRef.current.add(target, unsubscribe);
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

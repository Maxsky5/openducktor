import type { TaskCard } from "@openducktor/contracts";
import type { AgentRole } from "@openducktor/core";
import { useQueryClient } from "@tanstack/react-query";
import { type Dispatch, type SetStateAction, useCallback } from "react";
import { toast } from "sonner";
import {
  executeSessionStartFromDecision,
  type ResolvedSessionStartDecision,
  type SessionLaunchActionId,
  type SessionStartFlowRequest,
  type SessionStartWorkflowResult,
} from "@/features/session-start";
import { errorMessage } from "@/lib/errors";
import { AGENT_ROLE_LABELS } from "@/types";
import type { AgentSessionState } from "@/types/agent-orchestrator";
import type { ActiveWorkspace, AgentStateContextValue } from "@/types/state-slices";
import { buildRoleEnabledMapForTask, type SessionCreateOption } from "../agents-page-session-tabs";
import {
  buildAgentStudioAsyncActivityContextKey,
  buildAgentStudioSelectionQueryUpdate,
  buildCreateSessionStartKey,
  decrementActivityCountRecord,
  incrementActivityCountRecord,
  type QueryUpdate,
} from "../use-agent-studio-session-action-helpers";

type UseAgentStudioFreshSessionCreationArgs = {
  activeWorkspace: ActiveWorkspace | null;
  taskId: string;
  activeSession: AgentSessionState | null;
  selectedTask: TaskCard | null;
  agentStudioReady: boolean;
  isActiveTaskReady: boolean;
  isSessionWorking: boolean;
  startAgentSession: AgentStateContextValue["startAgentSession"];
  settleStartedAgentSession: AgentStateContextValue["settleStartedAgentSession"];
  sendAgentMessage: AgentStateContextValue["sendAgentMessage"];
  updateQuery: (updates: QueryUpdate) => void;
  setStartingActivityCountByContext: Dispatch<SetStateAction<Record<string, number>>>;
  startingSessionByTask: Map<string, Promise<SessionStartWorkflowResult | undefined>>;
  onPostStartActionError?: (action: "kickoff", error: Error) => void;
  executeRequestedSessionStart: <T>(
    request: SessionStartFlowRequest,
    executeWithDecision: (decision: ResolvedSessionStartDecision) => Promise<T | undefined>,
  ) => Promise<T | undefined>;
};

export function useAgentStudioFreshSessionCreation({
  activeWorkspace,
  taskId,
  activeSession,
  selectedTask,
  agentStudioReady,
  isActiveTaskReady,
  isSessionWorking,
  startAgentSession,
  settleStartedAgentSession,
  sendAgentMessage,
  updateQuery,
  setStartingActivityCountByContext,
  startingSessionByTask,
  onPostStartActionError,
  executeRequestedSessionStart,
}: UseAgentStudioFreshSessionCreationArgs): {
  handleCreateSession: (option: SessionCreateOption) => void;
} {
  const queryClient = useQueryClient();
  const applyFreshSessionSelectionQuery = useCallback(
    (session: SessionStartWorkflowResult, nextRole: AgentRole): void => {
      updateQuery(
        buildAgentStudioSelectionQueryUpdate({
          taskId,
          session,
          role: nextRole,
        }),
      );
    },
    [taskId, updateQuery],
  );

  const runFreshSessionCreation = useCallback(
    async (params: {
      nextRole: AgentRole;
      nextLaunchActionId: SessionLaunchActionId;
    }): Promise<SessionStartWorkflowResult | undefined> => {
      const startContextKey = buildAgentStudioAsyncActivityContextKey({
        activeWorkspace,
        taskId,
        role: params.nextRole,
        externalSessionId: null,
      });
      const executeStartedSession = async (
        decision: ResolvedSessionStartDecision,
      ): Promise<SessionStartWorkflowResult | undefined> => {
        setStartingActivityCountByContext((current) =>
          incrementActivityCountRecord(current, startContextKey),
        );
        try {
          try {
            const workflow = await executeSessionStartFromDecision({
              activeWorkspace,
              queryClient,
              request: {
                taskId,
                role: params.nextRole,
                launchActionId: params.nextLaunchActionId,
                postStartAction: "kickoff",
              },
              decision,
              task: selectedTask,
              startAgentSession,
              settleStartedAgentSession,
              sendAgentMessage,
              postStartExecution: "detached",
              onPostStartActionError: (_action, error) => {
                if (onPostStartActionError) {
                  onPostStartActionError("kickoff", error);
                  return;
                }

                toast.error("Session started, but the kickoff prompt failed to send.", {
                  description: error.message,
                });
              },
            });
            if (!workflow) {
              return undefined;
            }

            applyFreshSessionSelectionQuery(workflow, params.nextRole);
            return workflow;
          } catch (error) {
            const roleLabel = AGENT_ROLE_LABELS[params.nextRole] ?? params.nextRole.toUpperCase();
            toast.error(`Failed to start ${roleLabel} session`, {
              description: errorMessage(error),
            });
            return undefined;
          }
        } finally {
          setStartingActivityCountByContext((current) =>
            decrementActivityCountRecord(current, startContextKey),
          );
        }
      };

      return executeRequestedSessionStart(
        {
          taskId,
          role: params.nextRole,
          launchActionId: params.nextLaunchActionId,
          postStartAction: "kickoff",
        },
        executeStartedSession,
      );
    },
    [
      activeWorkspace,
      applyFreshSessionSelectionQuery,
      onPostStartActionError,
      executeRequestedSessionStart,
      queryClient,
      selectedTask,
      sendAgentMessage,
      settleStartedAgentSession,
      setStartingActivityCountByContext,
      startAgentSession,
      taskId,
    ],
  );

  const handleCreateSession = useCallback(
    (option: SessionCreateOption): void => {
      const { role: nextRole, launchActionId: nextLaunchActionId } = option;
      if (!taskId || !agentStudioReady || !isActiveTaskReady) {
        return;
      }
      if (activeSession && isSessionWorking) {
        return;
      }

      const roleEnabledByTask = buildRoleEnabledMapForTask(selectedTask);
      if (!roleEnabledByTask[nextRole]) {
        return;
      }

      const startKey = buildCreateSessionStartKey({
        taskId,
        role: nextRole,
        launchActionId: nextLaunchActionId,
      });
      if (startingSessionByTask.has(startKey)) {
        return;
      }

      const startPromise = runFreshSessionCreation({
        nextRole,
        nextLaunchActionId,
      });

      startingSessionByTask.set(startKey, startPromise);
      void startPromise.finally(() => {
        if (startingSessionByTask.get(startKey) === startPromise) {
          startingSessionByTask.delete(startKey);
        }
      });
    },
    [
      activeSession,
      agentStudioReady,
      isActiveTaskReady,
      isSessionWorking,
      runFreshSessionCreation,
      selectedTask,
      startingSessionByTask,
      taskId,
    ],
  );

  return {
    handleCreateSession,
  };
}

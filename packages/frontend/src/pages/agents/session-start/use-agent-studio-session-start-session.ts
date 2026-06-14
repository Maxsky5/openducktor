import type { GitTargetBranch } from "@openducktor/contracts";
import type { AgentRole } from "@openducktor/core";
import { useQueryClient } from "@tanstack/react-query";
import { type Dispatch, type SetStateAction, useCallback } from "react";
import type {
  ResolvedSessionStartDecision,
  SessionLaunchActionId,
  SessionStartFlowRequest,
  SessionStartPostAction,
  SessionStartWorkflowResult,
} from "@/features/session-start";
import { executeSessionStartFromDecision } from "@/features/session-start";
import type { AgentSessionState } from "@/types/agent-orchestrator";
import type { ActiveWorkspace, AgentStateContextValue } from "@/types/state-slices";
import {
  applyAgentStudioSelectionQuery,
  buildAgentStudioAsyncActivityContextKey,
  buildCreateSessionStartKey,
  canStartSessionForRole,
  decrementActivityCountRecord,
  incrementActivityCountRecord,
  type QueryUpdate,
} from "../use-agent-studio-session-action-helpers";

type UseAgentStudioSessionStartSessionArgs = {
  activeWorkspace: ActiveWorkspace | null;
  taskId: string;
  role: AgentRole;
  launchActionId: SessionLaunchActionId;
  activeSession: AgentSessionState | null;
  selectedTask: Parameters<typeof canStartSessionForRole>[0];
  agentStudioReady: boolean;
  isActiveTaskReady: boolean;
  startAgentSession: AgentStateContextValue["startAgentSession"];
  settleStartedAgentSession: AgentStateContextValue["settleStartedAgentSession"];
  sendAgentMessage: AgentStateContextValue["sendAgentMessage"];
  setTaskTargetBranch?: (taskId: string, targetBranch: GitTargetBranch) => Promise<void>;
  setStartingActivityCountByContext: Dispatch<SetStateAction<Record<string, number>>>;
  startingSessionByTask: Map<string, Promise<SessionStartWorkflowResult | undefined>>;
  updateQuery: (updates: QueryUpdate) => void;
  onPostStartActionError?: (action: SessionStartPostAction, error: Error) => void;
  executeRequestedSessionStart: <T>(
    request: SessionStartFlowRequest,
    executeWithDecision: (decision: ResolvedSessionStartDecision) => Promise<T | undefined>,
  ) => Promise<T | undefined>;
};

export function useAgentStudioSessionStartSession({
  activeWorkspace,
  taskId,
  role,
  launchActionId,
  selectedTask,
  agentStudioReady,
  isActiveTaskReady,
  startAgentSession,
  settleStartedAgentSession,
  sendAgentMessage,
  setTaskTargetBranch,
  setStartingActivityCountByContext,
  startingSessionByTask,
  updateQuery,
  onPostStartActionError,
  executeRequestedSessionStart,
}: UseAgentStudioSessionStartSessionArgs): {
  startSession: () => Promise<SessionStartWorkflowResult | undefined>;
  runSessionStart: (params: {
    postStartAction: SessionStartPostAction;
  }) => Promise<SessionStartWorkflowResult | undefined>;
} {
  const queryClient = useQueryClient();
  const startRequestedSession = useCallback(
    async (params: {
      postStartAction: SessionStartPostAction;
    }): Promise<SessionStartWorkflowResult | undefined> => {
      const startContextKey = buildAgentStudioAsyncActivityContextKey({
        activeWorkspace,
        taskId,
        role,
        externalSessionId: null,
      });
      const executeStartedSession = async (
        decision: ResolvedSessionStartDecision,
      ): Promise<SessionStartWorkflowResult | undefined> => {
        setStartingActivityCountByContext((current) =>
          incrementActivityCountRecord(current, startContextKey),
        );
        try {
          const workflow = await executeSessionStartFromDecision({
            activeWorkspace,
            queryClient,
            request: {
              taskId,
              role,
              launchActionId,
              postStartAction: params.postStartAction,
            },
            decision,
            task: selectedTask,
            ...(setTaskTargetBranch ? { persistTaskTargetBranch: setTaskTargetBranch } : {}),
            startAgentSession,
            settleStartedAgentSession,
            sendAgentMessage,
            onPostStartActionError,
          });

          applyAgentStudioSelectionQuery(updateQuery, {
            taskId,
            session: workflow,
            role,
          });
          return workflow;
        } finally {
          setStartingActivityCountByContext((current) =>
            decrementActivityCountRecord(current, startContextKey),
          );
        }
      };

      return executeRequestedSessionStart(
        {
          taskId,
          role,
          launchActionId,
          postStartAction: params.postStartAction,
          initialTargetBranch: selectedTask?.targetBranch ?? null,
          initialTargetBranchError: selectedTask?.targetBranchError ?? null,
        },
        executeStartedSession,
      );
    },
    [
      activeWorkspace,
      role,
      launchActionId,
      queryClient,
      setStartingActivityCountByContext,
      sendAgentMessage,
      settleStartedAgentSession,
      startAgentSession,
      selectedTask,
      updateQuery,
      onPostStartActionError,
      setTaskTargetBranch,
      taskId,
      executeRequestedSessionStart,
    ],
  );

  const runSessionStart = useCallback(
    async (params: {
      postStartAction: SessionStartPostAction;
    }): Promise<SessionStartWorkflowResult | undefined> => {
      if (!taskId || !agentStudioReady || !isActiveTaskReady) {
        return undefined;
      }
      if (!canStartSessionForRole(selectedTask, role)) {
        return undefined;
      }

      const startKey = buildCreateSessionStartKey({
        taskId,
        role,
        launchActionId,
      });
      const inFlightSessionStart = startingSessionByTask.get(startKey);
      if (inFlightSessionStart) {
        return inFlightSessionStart;
      }

      const startPromise = startRequestedSession(params);

      startingSessionByTask.set(startKey, startPromise);
      void startPromise
        .finally(() => {
          const currentStartPromise = startingSessionByTask.get(startKey);
          if (currentStartPromise === undefined) {
            return;
          }
          if (currentStartPromise === startPromise) {
            startingSessionByTask.delete(startKey);
          }
        })
        .catch(() => {});

      return startPromise;
    },
    [
      agentStudioReady,
      isActiveTaskReady,
      role,
      selectedTask,
      launchActionId,
      startRequestedSession,
      startingSessionByTask,
      taskId,
    ],
  );

  const startSession = useCallback(async (): Promise<SessionStartWorkflowResult | undefined> => {
    return runSessionStart({
      postStartAction: "none",
    });
  }, [runSessionStart]);

  return {
    startSession,
    runSessionStart,
  };
}

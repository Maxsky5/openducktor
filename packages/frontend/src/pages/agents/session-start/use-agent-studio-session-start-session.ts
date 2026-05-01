import type { GitTargetBranch } from "@openducktor/contracts";
import type { AgentRole } from "@openducktor/core";
import { useQueryClient } from "@tanstack/react-query";
import { type Dispatch, type MutableRefObject, type SetStateAction, useCallback } from "react";
import type {
  ResolvedSessionStartDecision,
  SessionLaunchActionId,
  SessionStartFlowRequest,
  SessionStartPostAction,
  SessionStartRequestReason,
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
  isActiveTaskHydrated: boolean;
  startAgentSession: AgentStateContextValue["startAgentSession"];
  sendAgentMessage: AgentStateContextValue["sendAgentMessage"];
  setTaskTargetBranch?: (taskId: string, targetBranch: GitTargetBranch) => Promise<void>;
  setStartingActivityCountByContext: Dispatch<SetStateAction<Record<string, number>>>;
  startingSessionByTaskRef: MutableRefObject<Map<string, Promise<string | undefined>>>;
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
  isActiveTaskHydrated,
  startAgentSession,
  sendAgentMessage,
  setTaskTargetBranch,
  setStartingActivityCountByContext,
  startingSessionByTaskRef,
  updateQuery,
  onPostStartActionError,
  executeRequestedSessionStart,
}: UseAgentStudioSessionStartSessionArgs): {
  startSession: (reason: SessionStartRequestReason) => Promise<string | undefined>;
  runSessionStart: (params: {
    reason: SessionStartRequestReason;
    postStartAction: SessionStartPostAction;
  }) => Promise<SessionStartWorkflowResult | undefined>;
} {
  const queryClient = useQueryClient();
  const startRequestedSession = useCallback(
    async (params: {
      reason: SessionStartRequestReason;
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
            sendAgentMessage,
            onPostStartActionError,
          });

          applyAgentStudioSelectionQuery(updateQuery, {
            taskId,
            externalSessionId: workflow.externalSessionId,
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
      reason: SessionStartRequestReason;
      postStartAction: SessionStartPostAction;
    }): Promise<SessionStartWorkflowResult | undefined> => {
      if (!taskId || !agentStudioReady || !isActiveTaskHydrated) {
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
      const inFlightSessionStart = startingSessionByTaskRef.current.get(startKey);
      if (inFlightSessionStart) {
        return inFlightSessionStart.then((externalSessionId) =>
          externalSessionId === undefined
            ? undefined
            : {
                externalSessionId,
                postStartActionError: null,
              },
        );
      }

      const startPromise = startRequestedSession(params);
      const externalSessionIdPromise = startPromise.then((workflow) => workflow?.externalSessionId);

      startingSessionByTaskRef.current.set(startKey, externalSessionIdPromise);
      void startPromise
        .finally(() => {
          const currentStartPromise = startingSessionByTaskRef.current.get(startKey);
          if (currentStartPromise === undefined) {
            return;
          }
          if (currentStartPromise === externalSessionIdPromise) {
            startingSessionByTaskRef.current.delete(startKey);
          }
        })
        .catch(() => {});

      return startPromise;
    },
    [
      agentStudioReady,
      isActiveTaskHydrated,
      role,
      selectedTask,
      launchActionId,
      startRequestedSession,
      startingSessionByTaskRef,
      taskId,
    ],
  );

  const startSession = useCallback(
    async (reason: SessionStartRequestReason): Promise<string | undefined> => {
      const workflow = await runSessionStart({
        reason,
        postStartAction: "none",
      });
      return workflow?.externalSessionId;
    },
    [runSessionStart],
  );

  return {
    startSession,
    runSessionStart,
  };
}

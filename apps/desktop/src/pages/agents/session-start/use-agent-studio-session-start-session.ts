import type { AgentRole, AgentScenario } from "@openducktor/core";
import { useQueryClient } from "@tanstack/react-query";
import { type Dispatch, type MutableRefObject, type SetStateAction, useCallback } from "react";
import type {
  NewSessionStartDecision,
  NewSessionStartRequest,
  SessionStartRequestReason,
  SessionStartPostAction,
  SessionStartWorkflowResult,
} from "@/features/session-start";
import { startSessionWorkflow } from "@/features/session-start";
import type { AgentSessionState } from "@/types/agent-orchestrator";
import type { AgentStateContextValue } from "@/types/state-slices";
import {
  applyAgentStudioSelectionQuery,
  buildAgentStudioAsyncActivityContextKey,
  buildCreateSessionStartKey,
  canStartSessionForRole,
  decrementActivityCountRecord,
  incrementActivityCountRecord,
  type QueryUpdate,
} from "../use-agent-studio-session-action-helpers";

type ResolvedSessionStartDecision = Exclude<NewSessionStartDecision, null>;

type UseAgentStudioSessionStartSessionArgs = {
  activeRepo: string | null;
  taskId: string;
  role: AgentRole;
  scenario: AgentScenario;
  activeSession: AgentSessionState | null;
  selectedTask: Parameters<typeof canStartSessionForRole>[0];
  agentStudioReady: boolean;
  isActiveTaskHydrated: boolean;
  markStartingBeforeDecision?: boolean;
  startAgentSession: AgentStateContextValue["startAgentSession"];
  sendAgentMessage: AgentStateContextValue["sendAgentMessage"];
  setStartingActivityCountByContext: Dispatch<SetStateAction<Record<string, number>>>;
  startingSessionByTaskRef: MutableRefObject<Map<string, Promise<string | undefined>>>;
  updateQuery: (updates: QueryUpdate) => void;
  onPostStartActionError?: (action: SessionStartPostAction, error: Error) => void;
  executeRequestedSessionStart: <T>(
    request: Omit<NewSessionStartRequest, "selectedModel">,
    executeWithDecision: (decision: ResolvedSessionStartDecision) => Promise<T | undefined>,
  ) => Promise<T | undefined>;
};

export function useAgentStudioSessionStartSession({
  activeRepo,
  taskId,
  role,
  scenario,
  selectedTask,
  agentStudioReady,
  isActiveTaskHydrated,
  markStartingBeforeDecision = false,
  startAgentSession,
  sendAgentMessage,
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
        activeRepo,
        taskId,
        role,
        sessionId: null,
      });
      const executeStartedSession = async (
        decision: ResolvedSessionStartDecision,
      ): Promise<SessionStartWorkflowResult | undefined> => {
        setStartingActivityCountByContext((current) =>
          incrementActivityCountRecord(current, startContextKey),
        );
        try {
          const workflow = await startSessionWorkflow({
            activeRepo,
            queryClient,
            intent: {
              taskId,
              role,
              scenario,
              startMode: decision.startMode,
              ...(decision.startMode === "reuse" || decision.startMode === "fork"
                ? { sourceSessionId: decision.sourceSessionId }
                : {}),
              postStartAction: params.postStartAction,
            },
            selection: decision.startMode === "reuse" ? null : decision.selectedModel,
            task: selectedTask,
            startAgentSession,
            sendAgentMessage,
            postStartExecution: params.postStartAction === "none" ? "await" : "detached",
            onDetachedPostStartError:
              params.postStartAction === "none" || !onPostStartActionError
                ? undefined
                : (error) => onPostStartActionError(params.postStartAction, error),
          });

          applyAgentStudioSelectionQuery(updateQuery, {
            taskId,
            sessionId: workflow.sessionId,
            role,
          });
          return workflow;
        } finally {
          setStartingActivityCountByContext((current) =>
            decrementActivityCountRecord(current, startContextKey),
          );
        }
      };

      if (!markStartingBeforeDecision) {
        return executeRequestedSessionStart(
          {
            taskId,
            role,
            scenario,
            reason: params.reason,
          },
          executeStartedSession,
        );
      }

      setStartingActivityCountByContext((current) =>
        incrementActivityCountRecord(current, startContextKey),
      );
      try {
        return await executeRequestedSessionStart(
          {
            taskId,
            role,
            scenario,
            reason: params.reason,
          },
          async (decision) => {
            const workflow = await startSessionWorkflow({
              activeRepo,
              queryClient,
              intent: {
                taskId,
                role,
                scenario,
                startMode: decision.startMode,
                ...(decision.startMode === "reuse" || decision.startMode === "fork"
                  ? { sourceSessionId: decision.sourceSessionId }
                  : {}),
                postStartAction: params.postStartAction,
              },
              selection: decision.startMode === "reuse" ? null : decision.selectedModel,
              task: selectedTask,
              startAgentSession,
              sendAgentMessage,
              postStartExecution: params.postStartAction === "none" ? "await" : "detached",
              onDetachedPostStartError:
                params.postStartAction === "none" || !onPostStartActionError
                  ? undefined
                  : (error) => onPostStartActionError(params.postStartAction, error),
            });

            applyAgentStudioSelectionQuery(updateQuery, {
              taskId,
              sessionId: workflow.sessionId,
              role,
            });
            return workflow;
          },
        );
      } finally {
        setStartingActivityCountByContext((current) =>
          decrementActivityCountRecord(current, startContextKey),
        );
      }
    },
    [
      activeRepo,
      role,
      scenario,
      markStartingBeforeDecision,
      queryClient,
      setStartingActivityCountByContext,
      sendAgentMessage,
      startAgentSession,
      selectedTask,
      updateQuery,
      onPostStartActionError,
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
        scenario,
      });
      const inFlightSessionStart = startingSessionByTaskRef.current.get(startKey);
      if (inFlightSessionStart) {
        return inFlightSessionStart.then((sessionId) =>
          sessionId === undefined
            ? undefined
            : {
                sessionId,
                beforeStartActionError: null,
                postStartActionError: null,
              },
        );
      }

      const startPromise = startRequestedSession(params);
      const sessionIdPromise = startPromise.then((workflow) => workflow?.sessionId);

      startingSessionByTaskRef.current.set(startKey, sessionIdPromise);
      void startPromise
        .finally(() => {
          const currentStartPromise = startingSessionByTaskRef.current.get(startKey);
          if (currentStartPromise === undefined) {
            return;
          }
          if (currentStartPromise === sessionIdPromise) {
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
      scenario,
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
      return workflow?.sessionId;
    },
    [runSessionStart],
  );

  return {
    startSession,
    runSessionStart,
  };
}

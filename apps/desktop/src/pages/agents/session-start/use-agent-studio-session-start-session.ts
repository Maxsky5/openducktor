import type { AgentRole, AgentScenario } from "@openducktor/core";
import { type Dispatch, type MutableRefObject, type SetStateAction, useCallback } from "react";
import type {
  NewSessionStartDecision,
  NewSessionStartRequest,
  SessionStartRequestReason,
} from "@/features/session-start";
import {
  resolveBuildWorkingDirectoryOverride,
  resolveQaBuilderSessionContext,
} from "@/lib/build-worktree-overrides";
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

type UseAgentStudioSessionStartSessionArgs = {
  activeRepo: string | null;
  taskId: string;
  role: AgentRole;
  scenario: AgentScenario;
  activeSession: AgentSessionState | null;
  selectedTask: Parameters<typeof canStartSessionForRole>[0];
  agentStudioReady: boolean;
  isActiveTaskHydrated: boolean;
  startAgentSession: AgentStateContextValue["startAgentSession"];
  updateAgentSessionModel: AgentStateContextValue["updateAgentSessionModel"];
  setStartingActivityCountByContext: Dispatch<SetStateAction<Record<string, number>>>;
  startingSessionByTaskRef: MutableRefObject<Map<string, Promise<string | undefined>>>;
  updateQuery: (updates: QueryUpdate) => void;
  resolveRequestedDecision: (
    request: Omit<NewSessionStartRequest, "selectedModel">,
  ) => Promise<NewSessionStartDecision | undefined>;
};

export function useAgentStudioSessionStartSession({
  activeRepo,
  taskId,
  role,
  scenario,
  selectedTask,
  agentStudioReady,
  isActiveTaskHydrated,
  startAgentSession,
  updateAgentSessionModel,
  setStartingActivityCountByContext,
  startingSessionByTaskRef,
  updateQuery,
  resolveRequestedDecision,
}: UseAgentStudioSessionStartSessionArgs): {
  startSession: (reason: SessionStartRequestReason) => Promise<string | undefined>;
} {
  const startRequestedSession = useCallback(
    async (params: { reason: SessionStartRequestReason }): Promise<string | undefined> => {
      const startContextKey = buildAgentStudioAsyncActivityContextKey({
        activeRepo,
        taskId,
        role,
        sessionId: null,
      });
      setStartingActivityCountByContext((current) =>
        incrementActivityCountRecord(current, startContextKey),
      );
      try {
        const decision = await resolveRequestedDecision({
          taskId,
          role,
          scenario,
          reason: params.reason,
        });
        if (decision == null) {
          return undefined;
        }
        const selectedModel = decision.selectedModel;
        if (decision.startMode === "reuse" && decision.sourceSessionId) {
          applyAgentStudioSelectionQuery(updateQuery, {
            taskId,
            sessionId: decision.sourceSessionId,
            role,
          });
          return decision.sourceSessionId;
        }

        let workingDirectoryOverride: string | null = null;
        try {
          workingDirectoryOverride = await resolveBuildWorkingDirectoryOverride({
            activeRepo,
            taskId,
            role,
            scenario,
          });
        } catch (error) {
          const description = error instanceof Error ? error.message : "Unknown error";
          throw new Error(
            `Failed to resolve working directory override for ${role} ${scenario} on ${taskId}: ${description}`,
          );
        }
        let builderContext: { workingDirectory: string } | null = null;
        if (role === "qa") {
          try {
            builderContext = await resolveQaBuilderSessionContext({
              activeRepo,
              taskId,
            });
          } catch (error) {
            const description = error instanceof Error ? error.message : "Unknown error";
            throw new Error(
              `Failed to resolve QA builder context for ${role} ${scenario} on ${taskId}: ${description}`,
            );
          }
        }
        const sessionId = await startAgentSession({
          taskId,
          role,
          scenario,
          selectedModel,
          sendKickoff: false,
          startMode: decision.startMode,
          ...(decision.sourceSessionId ? { sourceSessionId: decision.sourceSessionId } : {}),
          requireModelReady: true,
          ...(workingDirectoryOverride ? { workingDirectoryOverride } : {}),
          ...(builderContext ? { builderContext } : {}),
        });

        if (selectedModel && decision.startMode !== "reuse") {
          updateAgentSessionModel(sessionId, selectedModel);
        }

        applyAgentStudioSelectionQuery(updateQuery, {
          taskId,
          sessionId,
          role,
        });
        return sessionId;
      } finally {
        setStartingActivityCountByContext((current) =>
          decrementActivityCountRecord(current, startContextKey),
        );
      }
    },
    [
      activeRepo,
      resolveRequestedDecision,
      role,
      scenario,
      setStartingActivityCountByContext,
      startAgentSession,
      updateQuery,
      taskId,
      updateAgentSessionModel,
    ],
  );

  const startSession = useCallback(
    async (reason: SessionStartRequestReason): Promise<string | undefined> => {
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
        return inFlightSessionStart;
      }

      const startPromise = startRequestedSession({ reason });

      startingSessionByTaskRef.current.set(startKey, startPromise);
      void startPromise
        .finally(() => {
          if (startingSessionByTaskRef.current.get(startKey) === startPromise) {
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

  return {
    startSession,
  };
}

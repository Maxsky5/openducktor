import type { AgentModelSelection, AgentRole, AgentScenario } from "@openducktor/core";
import { type Dispatch, type MutableRefObject, type SetStateAction, useCallback } from "react";
import type { NewSessionStartRequest, SessionStartRequestReason } from "@/features/session-start";
import { resolveBuildWorkingDirectoryOverride } from "@/lib/build-worktree-overrides";
import type { AgentSessionState } from "@/types/agent-orchestrator";
import type { AgentStateContextValue } from "@/types/state-slices";
import {
  applyAgentStudioSelectionQuery,
  canStartSessionForRole,
  type QueryUpdate,
  resolveReusableSessionForStart,
} from "./use-agent-studio-session-action-helpers";

type UseAgentStudioSessionStartSessionArgs = {
  activeRepo: string | null;
  taskId: string;
  role: AgentRole;
  scenario: AgentScenario;
  activeSession: AgentSessionState | null;
  sessionsForTask: AgentSessionState[];
  selectedTask: Parameters<typeof canStartSessionForRole>[0];
  agentStudioReady: boolean;
  isActiveTaskHydrated: boolean;
  startAgentSession: AgentStateContextValue["startAgentSession"];
  updateAgentSessionModel: AgentStateContextValue["updateAgentSessionModel"];
  setIsStarting: Dispatch<SetStateAction<boolean>>;
  startingSessionByTaskRef: MutableRefObject<Map<string, Promise<string | undefined>>>;
  updateQuery: (updates: QueryUpdate) => void;
  resolveRequestedSelection: (
    request: Omit<NewSessionStartRequest, "selectedModel">,
  ) => Promise<AgentModelSelection | null | undefined>;
};

export function useAgentStudioSessionStartSession({
  activeRepo,
  taskId,
  role,
  scenario,
  activeSession,
  sessionsForTask,
  selectedTask,
  agentStudioReady,
  isActiveTaskHydrated,
  startAgentSession,
  updateAgentSessionModel,
  setIsStarting,
  startingSessionByTaskRef,
  updateQuery,
  resolveRequestedSelection,
}: UseAgentStudioSessionStartSessionArgs): {
  startSession: (reason: SessionStartRequestReason) => Promise<string | undefined>;
} {
  const startRequestedSession = useCallback(
    async (params: {
      reason: SessionStartRequestReason;
      startMode: "fresh" | "reuse_latest";
    }): Promise<string | undefined> => {
      setIsStarting(true);
      try {
        const selectedModel = await resolveRequestedSelection({
          taskId,
          role,
          scenario,
          startMode: params.startMode,
          reason: params.reason,
        });
        if (selectedModel === undefined) {
          return undefined;
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
        const sessionId = await startAgentSession({
          taskId,
          role,
          scenario,
          selectedModel,
          sendKickoff: false,
          startMode: params.startMode,
          requireModelReady: true,
          ...(workingDirectoryOverride ? { workingDirectoryOverride } : {}),
        });

        if (selectedModel) {
          updateAgentSessionModel(sessionId, selectedModel);
        }

        applyAgentStudioSelectionQuery(updateQuery, {
          taskId,
          sessionId,
          role,
        });
        return sessionId;
      } finally {
        setIsStarting(false);
      }
    },
    [
      resolveRequestedSelection,
      role,
      scenario,
      activeRepo,
      setIsStarting,
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

      const reusableSession = resolveReusableSessionForStart({
        activeSession,
        sessionsForTask,
        role,
      });
      if (reusableSession) {
        applyAgentStudioSelectionQuery(updateQuery, {
          taskId: reusableSession.session.taskId,
          sessionId: reusableSession.session.sessionId,
          role: reusableSession.session.role,
        });
        return reusableSession.session.sessionId;
      }

      const inFlightSessionStart = startingSessionByTaskRef.current.get(taskId);
      if (inFlightSessionStart) {
        return inFlightSessionStart;
      }

      const startPromise = startRequestedSession({
        reason,
        startMode: "reuse_latest",
      });

      startingSessionByTaskRef.current.set(taskId, startPromise);
      void startPromise.finally(() => {
        if (startingSessionByTaskRef.current.get(taskId) === startPromise) {
          startingSessionByTaskRef.current.delete(taskId);
        }
      });

      return startPromise;
    },
    [
      activeSession,
      agentStudioReady,
      isActiveTaskHydrated,
      role,
      selectedTask,
      sessionsForTask,
      startRequestedSession,
      startingSessionByTaskRef,
      taskId,
      updateQuery,
    ],
  );

  return {
    startSession,
  };
}

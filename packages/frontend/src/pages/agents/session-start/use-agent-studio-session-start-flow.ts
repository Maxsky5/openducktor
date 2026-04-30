import type { GitBranch, GitTargetBranch, TaskCard } from "@openducktor/contracts";
import type { AgentModelSelection, AgentRole, AgentScenario } from "@openducktor/core";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import type { SessionStartModalModel } from "@/components/features/agents";
import type { HumanReviewFeedbackModalModel } from "@/features/human-review-feedback/human-review-feedback-types";
import type {
  ResolvedSessionStartDecision,
  SessionStartFlowRequest,
  SessionStartLaunchRequest,
  SessionStartRequestReason,
} from "@/features/session-start";
import {
  buildSessionStartModalRequest,
  executeSessionStartFromDecision,
  useSessionStartModalRunner,
} from "@/features/session-start";
import type { AgentSessionSummary } from "@/state/agent-sessions-store";
import { isWorkflowAgentSession } from "@/state/operations/agent-orchestrator/support/session-purpose";
import type { AgentSessionState } from "@/types/agent-orchestrator";
import type {
  ActiveWorkspace,
  AgentStateContextValue,
  RepoSettingsInput,
} from "@/types/state-slices";
import type { SessionCreateOption } from "../agents-page-session-tabs";
import { useAgentStudioFreshSessionCreation } from "../use-agent-studio-fresh-session-creation";
import { useAgentStudioHumanReviewFeedbackFlow } from "../use-agent-studio-human-review-feedback-flow";
import {
  applyAgentStudioSelectionQuery,
  buildAgentStudioAsyncActivityContextKey,
  canStartSessionForRole,
  type QueryUpdate,
} from "../use-agent-studio-session-action-helpers";
import { useAgentStudioSessionStartSession } from "./use-agent-studio-session-start-session";

type UseAgentStudioSessionStartFlowArgs = {
  activeWorkspace: ActiveWorkspace | null;
  branches?: GitBranch[];
  taskId: string;
  role: AgentRole;
  scenario: AgentScenario;
  activeSession: AgentSessionState | null;
  sessionsForTask: AgentSessionSummary[];
  selectedTask: TaskCard | null;
  agentStudioReady: boolean;
  isActiveTaskHydrated: boolean;
  isSessionWorking: boolean;
  selectionForNewSession: AgentModelSelection | null;
  repoSettings: RepoSettingsInput | null;
  startAgentSession: AgentStateContextValue["startAgentSession"];
  sendAgentMessage: AgentStateContextValue["sendAgentMessage"];
  setTaskTargetBranch?: (taskId: string, targetBranch: GitTargetBranch) => Promise<void>;
  updateQuery: (updates: QueryUpdate) => void;
  onContextSwitchIntent?: () => void;
};

type AgentStudioSessionStartRequest = SessionStartLaunchRequest;

export function useAgentStudioSessionStartFlow({
  activeWorkspace,
  branches = [],
  taskId,
  role,
  scenario,
  activeSession,
  sessionsForTask,
  selectedTask,
  agentStudioReady,
  isActiveTaskHydrated,
  isSessionWorking,
  selectionForNewSession,
  repoSettings,
  startAgentSession,
  sendAgentMessage,
  setTaskTargetBranch,
  updateQuery,
  onContextSwitchIntent,
}: UseAgentStudioSessionStartFlowArgs): {
  isStarting: boolean;
  sessionStartModal: SessionStartModalModel | null;
  humanReviewFeedbackModal: HumanReviewFeedbackModalModel | null;
  startSessionRequest: (request: AgentStudioSessionStartRequest) => Promise<string | undefined>;
  startSession: (reason: SessionStartRequestReason) => Promise<string | undefined>;
  startScenarioKickoff: () => Promise<void>;
  handleCreateSession: (option: SessionCreateOption) => void;
} {
  const queryClient = useQueryClient();
  const workspaceRepoPath = activeWorkspace?.repoPath ?? null;
  const [startingActivityCountByContext, setStartingActivityCountByContext] = useState<
    Record<string, number>
  >({});
  const isStarting =
    (startingActivityCountByContext[
      buildAgentStudioAsyncActivityContextKey({
        activeWorkspace,
        taskId,
        role,
        externalSessionId: activeSession?.externalSessionId ?? null,
      })
    ] ?? 0) > 0;

  const previousRepoForSessionRefs = useRef<string | null>(workspaceRepoPath);
  const startingSessionByTaskRef = useRef(new Map<string, Promise<string | undefined>>());
  const { sessionStartModal, runSessionStartRequest: runInternalSessionStartRequest } =
    useSessionStartModalRunner({
      activeWorkspace,
      branches,
      repoSettings,
    });

  useEffect(() => {
    if (previousRepoForSessionRefs.current === workspaceRepoPath) {
      return;
    }

    previousRepoForSessionRefs.current = workspaceRepoPath;
    startingSessionByTaskRef.current.clear();
  }, [workspaceRepoPath]);

  const executeRequestedSessionStart = useCallback(
    async <T>(
      request: SessionStartFlowRequest,
      executeWithDecision: (decision: ResolvedSessionStartDecision) => Promise<T | undefined>,
    ): Promise<T | undefined> => {
      return runInternalSessionStartRequest(
        buildSessionStartModalRequest({
          source: "agent_studio",
          request,
          selectedModel:
            request.role === role && request.taskId === taskId
              ? (selectionForNewSession ?? null)
              : null,
          taskSessions: sessionsForTask,
          activeSession: isWorkflowAgentSession(activeSession) ? activeSession : null,
          selectedTask: request.taskId === taskId ? selectedTask : null,
        }),
        async ({ decision }) => executeWithDecision(decision),
      );
    },
    [
      activeSession,
      role,
      runInternalSessionStartRequest,
      selectionForNewSession,
      selectedTask,
      sessionsForTask,
      taskId,
    ],
  );

  const { startSession, runSessionStart } = useAgentStudioSessionStartSession({
    activeWorkspace,
    taskId,
    role,
    scenario,
    activeSession,
    selectedTask,
    agentStudioReady,
    isActiveTaskHydrated,
    startAgentSession,
    sendAgentMessage,
    ...(setTaskTargetBranch ? { setTaskTargetBranch } : {}),
    setStartingActivityCountByContext,
    startingSessionByTaskRef,
    updateQuery,
    onPostStartActionError: (action, error) => {
      const message =
        action === "kickoff"
          ? "Session started, but the kickoff prompt failed to send."
          : "Session started, but feedback message failed.";
      toast.error(message, {
        description: error.message,
      });
    },
    executeRequestedSessionStart,
  });

  const startSessionRequest = useCallback(
    async (request: AgentStudioSessionStartRequest): Promise<string | undefined> => {
      return executeRequestedSessionStart(request, async (decision) => {
        const workflow = await executeSessionStartFromDecision({
          activeWorkspace,
          queryClient,
          request,
          decision,
          task: request.taskId === taskId ? selectedTask : null,
          ...(setTaskTargetBranch ? { persistTaskTargetBranch: setTaskTargetBranch } : {}),
          startAgentSession,
          sendAgentMessage,
          onPostStartActionError: (action, error) => {
            const message =
              action === "kickoff"
                ? "Session started, but the kickoff prompt failed to send."
                : "Session started, but feedback message failed.";
            toast.error(message, {
              description: error.message,
            });
          },
        });

        applyAgentStudioSelectionQuery(updateQuery, {
          taskId: request.taskId,
          externalSessionId: workflow.externalSessionId,
          role: request.role,
        });
        return workflow.externalSessionId;
      });
    },
    [
      activeWorkspace,
      executeRequestedSessionStart,
      queryClient,
      selectedTask,
      sendAgentMessage,
      setTaskTargetBranch,
      startAgentSession,
      taskId,
      updateQuery,
    ],
  );

  const { humanReviewFeedbackModal, shouldInterceptCreateSession, openHumanReviewFeedback } =
    useAgentStudioHumanReviewFeedbackFlow({
      taskId,
      sessionsForTask,
      selectedTask,
      startSessionRequest,
    });

  const startScenarioKickoff = useCallback(async (): Promise<void> => {
    if (!taskId || !agentStudioReady) {
      return;
    }
    if (!isActiveTaskHydrated) {
      return;
    }
    if (!canStartSessionForRole(selectedTask, role)) {
      return;
    }
    if (role === "build" && scenario === "build_after_human_request_changes") {
      openHumanReviewFeedback();
      return;
    }

    const workflow = await runSessionStart({
      reason: "scenario_kickoff",
      postStartAction: "kickoff",
    });
    if (!workflow) {
      return;
    }
  }, [
    agentStudioReady,
    isActiveTaskHydrated,
    openHumanReviewFeedback,
    role,
    runSessionStart,
    scenario,
    selectedTask,
    taskId,
  ]);

  const { handleCreateSession } = useAgentStudioFreshSessionCreation({
    activeWorkspace,
    taskId,
    role,
    activeSession,
    selectedTask,
    agentStudioReady,
    isActiveTaskHydrated,
    isSessionWorking,
    startAgentSession,
    sendAgentMessage,
    updateQuery,
    ...(onContextSwitchIntent ? { onContextSwitchIntent } : {}),
    setStartingActivityCountByContext,
    startingSessionByTaskRef,
    executeRequestedSessionStart,
  });

  const handleCreateSessionWithHumanFeedback = useCallback(
    (option: SessionCreateOption): void => {
      if (shouldInterceptCreateSession(option)) {
        if (!taskId || !agentStudioReady || !isActiveTaskHydrated) {
          return;
        }
        if (!canStartSessionForRole(selectedTask, option.role)) {
          return;
        }
        openHumanReviewFeedback();
        return;
      }
      handleCreateSession(option);
    },
    [
      agentStudioReady,
      handleCreateSession,
      isActiveTaskHydrated,
      openHumanReviewFeedback,
      selectedTask,
      shouldInterceptCreateSession,
      taskId,
    ],
  );

  return {
    isStarting,
    sessionStartModal,
    humanReviewFeedbackModal,
    startSessionRequest,
    startSession,
    startScenarioKickoff,
    handleCreateSession: handleCreateSessionWithHumanFeedback,
  };
}

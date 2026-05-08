import type { GitBranch, GitTargetBranch, TaskCard } from "@openducktor/contracts";
import type { AgentModelSelection, AgentRole } from "@openducktor/core";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import type { SessionStartModalModel } from "@/components/features/agents";
import type { HumanReviewFeedbackModalModel } from "@/features/human-review-feedback/human-review-feedback-types";
import type {
  ResolvedSessionStartDecision,
  SessionLaunchActionId,
  SessionStartFlowRequest,
  SessionStartLaunchRequest,
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
import type { AgentStudioQuickActionOption } from "../agent-studio-quick-actions";
import type { SessionCreateOption } from "../agents-page-session-tabs";
import { useAgentStudioFreshSessionCreation } from "../use-agent-studio-fresh-session-creation";
import { useAgentStudioHumanReviewFeedbackFlow } from "../use-agent-studio-human-review-feedback-flow";
import {
  applyAgentStudioSelectionQuery,
  buildAgentStudioAsyncActivityContextKey,
  buildCreateSessionStartKey,
  canStartSessionForRole,
  type QueryUpdate,
} from "../use-agent-studio-session-action-helpers";
import { useAgentStudioSessionStartSession } from "./use-agent-studio-session-start-session";

type UseAgentStudioSessionStartFlowArgs = {
  activeWorkspace: ActiveWorkspace | null;
  branches?: GitBranch[];
  taskId: string;
  role: AgentRole;
  launchActionId: SessionLaunchActionId;
  activeSession: AgentSessionState | null;
  sessionsForTask: AgentSessionSummary[];
  selectedTask: TaskCard | null;
  agentStudioReady: boolean;
  isActiveTaskHydrated: boolean;
  isSessionWorking: boolean;
  selectionForNewSession: AgentModelSelection | null;
  repoSettings: RepoSettingsInput | null;
  startAgentSession: AgentStateContextValue["startAgentSession"];
  settleStartedAgentSession: AgentStateContextValue["settleStartedAgentSession"];
  sendAgentMessage: AgentStateContextValue["sendAgentMessage"];
  humanRequestChangesTask: (taskId: string, note?: string) => Promise<void>;
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
  launchActionId,
  activeSession,
  sessionsForTask,
  selectedTask,
  agentStudioReady,
  isActiveTaskHydrated,
  isSessionWorking,
  selectionForNewSession,
  repoSettings,
  startAgentSession,
  settleStartedAgentSession,
  sendAgentMessage,
  humanRequestChangesTask,
  setTaskTargetBranch,
  updateQuery,
  onContextSwitchIntent,
}: UseAgentStudioSessionStartFlowArgs): {
  isStarting: boolean;
  sessionStartModal: SessionStartModalModel | null;
  humanReviewFeedbackModal: HumanReviewFeedbackModalModel | null;
  startSessionRequest: (request: AgentStudioSessionStartRequest) => Promise<string | undefined>;
  startSession: () => Promise<string | undefined>;
  startLaunchKickoff: () => Promise<void>;
  handleCreateSession: (option: SessionCreateOption) => void;
  handleQuickAction: (option: AgentStudioQuickActionOption) => void;
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
    launchActionId,
    activeSession,
    selectedTask,
    agentStudioReady,
    isActiveTaskHydrated,
    startAgentSession,
    settleStartedAgentSession,
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
          settleStartedAgentSession,
          sendAgentMessage,
          humanRequestChangesTask,
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
      settleStartedAgentSession,
      setTaskTargetBranch,
      startAgentSession,
      humanRequestChangesTask,
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

  const startLaunchKickoff = useCallback(async (): Promise<void> => {
    if (!taskId || !agentStudioReady) {
      return;
    }
    if (!isActiveTaskHydrated) {
      return;
    }
    if (!canStartSessionForRole(selectedTask, role)) {
      return;
    }
    if (role === "build" && launchActionId === "build_after_human_request_changes") {
      openHumanReviewFeedback();
      return;
    }

    const workflow = await runSessionStart({
      postStartAction: "kickoff",
    });
    if (!workflow) {
      return;
    }
  }, [
    agentStudioReady,
    isActiveTaskHydrated,
    openHumanReviewFeedback,
    launchActionId,
    role,
    runSessionStart,
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
    settleStartedAgentSession,
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

  const handleQuickAction = useCallback(
    (option: AgentStudioQuickActionOption): void => {
      if (option.disabled || !taskId || !agentStudioReady || !isActiveTaskHydrated) {
        return;
      }
      if (isSessionWorking) {
        return;
      }
      if (option.requiresHumanFeedback) {
        openHumanReviewFeedback();
        return;
      }

      const startKey = buildCreateSessionStartKey({
        taskId,
        role: option.role,
        launchActionId: option.launchActionId,
      });
      if (startingSessionByTaskRef.current.has(startKey)) {
        return;
      }

      const startPromise = startSessionRequest({
        taskId,
        role: option.role,
        launchActionId: option.launchActionId,
        postStartAction: option.postStartAction,
        ...(option.initialStartMode ? { initialStartMode: option.initialStartMode } : {}),
        ...(option.existingSessionOptions
          ? { existingSessionOptions: option.existingSessionOptions }
          : {}),
        ...(option.initialSourceExternalSessionId !== undefined
          ? { initialSourceExternalSessionId: option.initialSourceExternalSessionId }
          : {}),
      });
      startingSessionByTaskRef.current.set(startKey, startPromise);
      void startPromise
        .finally(() => {
          if (startingSessionByTaskRef.current.get(startKey) === startPromise) {
            startingSessionByTaskRef.current.delete(startKey);
          }
        })
        .catch(() => {});
    },
    [
      agentStudioReady,
      isActiveTaskHydrated,
      isSessionWorking,
      openHumanReviewFeedback,
      startSessionRequest,
      taskId,
    ],
  );

  return {
    isStarting,
    sessionStartModal,
    humanReviewFeedbackModal,
    startSessionRequest,
    startSession,
    startLaunchKickoff,
    handleCreateSession: handleCreateSessionWithHumanFeedback,
    handleQuickAction,
  };
}

import type { GitBranch, GitTargetBranch, TaskCard } from "@openducktor/contracts";
import type { AgentModelSelection, AgentRole } from "@openducktor/core";
import { useCallback } from "react";
import { toast } from "sonner";
import type { SessionStartModalModel } from "@/components/features/agents";
import type { HumanReviewFeedbackModalModel } from "@/features/human-review-feedback/human-review-feedback-types";
import type {
  ResolvedSessionStartDecision,
  RunSessionStartWorkflow,
  SessionLaunchActionId,
  SessionStartFlowRequest,
  SessionStartLaunchRequest,
  SessionStartPostAction,
  SessionStartWorkflowResult,
} from "@/features/session-start";
import {
  buildSessionStartModalRequest,
  sessionStartPostActionErrorTitle,
  useSessionStartModalRunner,
} from "@/features/session-start";
import type { AgentSessionSummary } from "@/state/agent-sessions-store";
import { isWorkflowAgentSession } from "@/state/operations/agent-orchestrator/support/workflow-session";
import type { AgentSessionState } from "@/types/agent-orchestrator";
import type { RepoSettingsInput } from "@/types/state-slices";
import type { AgentStudioQuickActionOption } from "../agent-studio-quick-actions";
import type { SessionCreateOption } from "../agents-page-session-tabs";
import {
  buildAgentStudioSelectionQueryUpdate,
  type AgentStudioQueryUpdate as QueryUpdate,
} from "../query-sync/agent-studio-navigation";
import {
  buildAgentStudioSessionActivityKey,
  useAgentStudioAsyncActivityTracker,
} from "../use-agent-studio-async-activity";
import { useAgentStudioHumanReviewFeedbackFlow } from "../use-agent-studio-human-review-feedback-flow";
import {
  buildAgentStudioSessionStartKey,
  useAgentStudioSessionStartGate,
} from "./use-agent-studio-session-start-gate";

type CanStartRole = (role: AgentRole) => boolean;

type UseAgentStudioSessionStartFlowArgs = {
  branches?: GitBranch[];
  taskId: string;
  role: AgentRole;
  launchActionId: SessionLaunchActionId;
  loadedSession: AgentSessionState | null;
  sessionsForTask: AgentSessionSummary[];
  selectedTask: TaskCard | null;
  canStartRole: CanStartRole;
  isSessionWorking: boolean;
  selectionForNewSession: AgentModelSelection | null;
  repoSettings: RepoSettingsInput | null;
  workspaceId: string | null;
  workspaceRepoPath: string | null;
  runSessionStartWorkflow: RunSessionStartWorkflow;
  humanRequestChangesTask: (taskId: string, note?: string) => Promise<void>;
  setTaskTargetBranch?: (taskId: string, targetBranch: GitTargetBranch) => Promise<void>;
  updateQuery: (updates: QueryUpdate) => void;
};

type AgentStudioSessionStartRequest = SessionStartLaunchRequest;

const showPostStartActionError = (action: SessionStartPostAction, error: Error): void => {
  toast.error(sessionStartPostActionErrorTitle(action), {
    description: error.message,
  });
};

export function useAgentStudioSessionStartFlow({
  branches = [],
  taskId,
  role,
  launchActionId,
  loadedSession,
  sessionsForTask,
  selectedTask,
  canStartRole,
  isSessionWorking,
  selectionForNewSession,
  repoSettings,
  workspaceId,
  workspaceRepoPath,
  runSessionStartWorkflow,
  humanRequestChangesTask,
  setTaskTargetBranch,
  updateQuery,
}: UseAgentStudioSessionStartFlowArgs): {
  isStarting: boolean;
  sessionStartModal: SessionStartModalModel | null;
  humanReviewFeedbackModal: HumanReviewFeedbackModalModel | null;
  startSessionRequest: (
    request: AgentStudioSessionStartRequest,
  ) => Promise<SessionStartWorkflowResult | undefined>;
  startSession: () => Promise<SessionStartWorkflowResult | undefined>;
  startLaunchKickoff: () => Promise<void>;
  handleCreateSession: (option: SessionCreateOption) => void;
  handleQuickAction: (option: AgentStudioQuickActionOption) => void;
} {
  const sessionStartGate = useAgentStudioSessionStartGate(workspaceId);
  const { begin: beginStartingActivity, isActive: isStartingActivityActive } =
    useAgentStudioAsyncActivityTracker();
  const isStarting = isStartingActivityActive(
    buildAgentStudioSessionActivityKey({
      workspaceId,
      taskId,
      role,
      session: loadedSession,
    }),
  );

  const { sessionStartModal, runSessionStartRequest: runInternalSessionStartRequest } =
    useSessionStartModalRunner({
      branches,
      repoSettings,
      workspaceRepoPath,
    });

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
          preferredSourceSession: isWorkflowAgentSession(loadedSession) ? loadedSession : null,
          selectedTask: request.taskId === taskId ? selectedTask : null,
        }),
        async ({ decision }) => executeWithDecision(decision),
      );
    },
    [
      loadedSession,
      role,
      runInternalSessionStartRequest,
      selectionForNewSession,
      selectedTask,
      sessionsForTask,
      taskId,
    ],
  );

  const runSessionStartRequest = useCallback(
    async (request: SessionStartFlowRequest): Promise<SessionStartWorkflowResult | undefined> => {
      const executeWithDecision = async (
        decision: ResolvedSessionStartDecision,
      ): Promise<SessionStartWorkflowResult | undefined> => {
        const execute = async (): Promise<SessionStartWorkflowResult> => {
          const workflow = await runSessionStartWorkflow({
            request,
            decision,
            task: request.taskId === taskId ? selectedTask : null,
            ...(setTaskTargetBranch ? { persistTaskTargetBranch: setTaskTargetBranch } : {}),
            humanRequestChangesTask,
          });
          if (workflow.postStartActionError) {
            showPostStartActionError(request.postStartAction, workflow.postStartActionError);
          }

          updateQuery(
            buildAgentStudioSelectionQueryUpdate({
              taskId: request.taskId,
              session: workflow,
              role: request.role,
            }),
          );
          return workflow;
        };

        const activity = beginStartingActivity(
          buildAgentStudioSessionActivityKey({
            workspaceId,
            taskId: request.taskId,
            role: request.role,
            session: null,
          }),
        );
        try {
          return await execute();
        } finally {
          activity.finish();
        }
      };

      return executeRequestedSessionStart(request, executeWithDecision);
    },
    [
      beginStartingActivity,
      executeRequestedSessionStart,
      humanRequestChangesTask,
      runSessionStartWorkflow,
      selectedTask,
      setTaskTargetBranch,
      taskId,
      updateQuery,
      workspaceId,
    ],
  );

  const runSessionStart = useCallback(
    async (params: {
      postStartAction: SessionStartPostAction;
    }): Promise<SessionStartWorkflowResult | undefined> => {
      if (!canStartRole(role)) {
        return undefined;
      }

      const startKey = buildAgentStudioSessionStartKey({
        taskId,
        role,
        launchActionId,
      });
      return sessionStartGate.run(startKey, () =>
        runSessionStartRequest({
          taskId,
          role,
          launchActionId,
          postStartAction: params.postStartAction,
          initialTargetBranch: selectedTask?.targetBranch ?? null,
          initialTargetBranchError: selectedTask?.targetBranchError ?? null,
        }),
      );
    },
    [
      canStartRole,
      launchActionId,
      role,
      runSessionStartRequest,
      selectedTask?.targetBranch,
      selectedTask?.targetBranchError,
      sessionStartGate,
      taskId,
    ],
  );

  const startSession = useCallback(async (): Promise<SessionStartWorkflowResult | undefined> => {
    return runSessionStart({
      postStartAction: "none",
    });
  }, [runSessionStart]);

  const startSessionRequest = useCallback(
    async (
      request: AgentStudioSessionStartRequest,
    ): Promise<SessionStartWorkflowResult | undefined> => {
      return runSessionStartRequest(request);
    },
    [runSessionStartRequest],
  );

  const { humanReviewFeedbackModal, shouldInterceptCreateSession, openHumanReviewFeedback } =
    useAgentStudioHumanReviewFeedbackFlow({
      taskId,
      sessionsForTask,
      selectedTask,
      startSessionRequest,
    });

  const startLaunchKickoff = useCallback(async (): Promise<void> => {
    if (!canStartRole(role)) {
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
  }, [canStartRole, openHumanReviewFeedback, launchActionId, role, runSessionStart]);

  const handleCreateSession = useCallback(
    (option: SessionCreateOption): void => {
      const { role: nextRole, launchActionId: nextLaunchActionId } = option;
      if (loadedSession && isSessionWorking) {
        return;
      }

      if (!canStartRole(nextRole)) {
        return;
      }

      const startKey = buildAgentStudioSessionStartKey({
        taskId,
        role: nextRole,
        launchActionId: nextLaunchActionId,
      });
      void sessionStartGate.run(startKey, () =>
        runSessionStartRequest({
          taskId,
          role: nextRole,
          launchActionId: nextLaunchActionId,
          postStartAction: "kickoff",
        }),
      );
    },
    [
      loadedSession,
      canStartRole,
      isSessionWorking,
      runSessionStartRequest,
      sessionStartGate,
      taskId,
    ],
  );

  const handleCreateSessionWithHumanFeedback = useCallback(
    (option: SessionCreateOption): void => {
      if (shouldInterceptCreateSession(option)) {
        if (!canStartRole(option.role)) {
          return;
        }
        openHumanReviewFeedback();
        return;
      }
      handleCreateSession(option);
    },
    [canStartRole, handleCreateSession, openHumanReviewFeedback, shouldInterceptCreateSession],
  );

  const handleQuickAction = useCallback(
    (option: AgentStudioQuickActionOption): void => {
      if (option.disabled) {
        return;
      }
      if (isSessionWorking) {
        return;
      }
      if (!canStartRole(option.role)) {
        return;
      }
      if (option.requiresHumanFeedback) {
        openHumanReviewFeedback();
        return;
      }

      const startKey = buildAgentStudioSessionStartKey({
        taskId,
        role: option.role,
        launchActionId: option.launchActionId,
      });
      void sessionStartGate.run(startKey, () =>
        startSessionRequest({
          taskId,
          role: option.role,
          launchActionId: option.launchActionId,
          postStartAction: option.postStartAction,
          ...(option.initialStartMode ? { initialStartMode: option.initialStartMode } : {}),
          ...(option.existingSessionOptions
            ? { existingSessionOptions: option.existingSessionOptions }
            : {}),
          ...(option.initialSourceSession !== undefined
            ? { initialSourceSession: option.initialSourceSession }
            : {}),
        }),
      );
    },
    [
      canStartRole,
      isSessionWorking,
      openHumanReviewFeedback,
      sessionStartGate,
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

import {
  getSessionLaunchAction,
  type BuiltinLaunchActionId as SessionLaunchActionId,
  type BuiltinRoleId as AgentRole,
  type BuiltinTaskCard as TaskCard,
  builtinRoleId,
} from "@openducktor/workflows";
import type { SessionCreateOption } from "../agents-page-session-tabs";
import { showSessionStartMessageRecovery } from "@/features/session-start/session-start-message-recovery";
import { useSessionStartContext } from "@openducktor/frontend-core/sessions/start/use-session-start-context";
import { useQueryClient } from "@tanstack/react-query";
import { createSessionStartKickoffResolver } from "@openducktor/frontend-core/sessions/start/session-start-kickoff";
import type { GitBranch } from "@openducktor/contracts";
import type { AgentModelSelection } from "@openducktor/core";
import { useCallback } from "react";
import { toast } from "sonner";
import type { SessionStartModalModel } from "@openducktor/frontend-core/sessions/start/session-start-modal-model";
import type { HumanReviewFeedbackModalModel } from "@openducktor/frontend-core/tasks/workflow/human-review-feedback-types";
import type {
  ResolvedSessionStartDecision,
  RunSessionStartWorkflow,
  SessionStartFlowRequest,
  SessionStartLaunchRequest,
} from "@openducktor/frontend-core/sessions/start/session-start-orchestration";
import type {
  SessionStartPostAction,
  SessionStartWorkflowResult,
} from "@openducktor/frontend-core/sessions/start/session-start-workflow";
import {
  buildSessionStartModalRequest,
  isSessionStartFailureFeedbackHandled,
} from "@openducktor/frontend-core/sessions/start/session-start-orchestration";
import { sessionStartPostActionErrorTitle } from "@openducktor/frontend-core/sessions/start/session-start-post-action-errors";
import { useSessionStartModalRunner } from "@openducktor/frontend-core/sessions/start/use-session-start-modal-runner";
import { useWorkspaceSessionStartGate } from "@openducktor/frontend-core/sessions/start/use-workspace-session-start-gate";
import type { AgentSessionSummary } from "@openducktor/frontend-core/sessions/agent-sessions-store";
import { isWorkflowAgentSession } from "@openducktor/frontend-core/sessions/agent-orchestrator/support/workflow-session";
import type {
  AgentSessionIdentity,
  AgentSessionState,
} from "@openducktor/frontend-core/types/agent-orchestrator";
import type { RepoSettingsInput } from "@/types/state-slices";
import type { AgentStudioQuickActionOption } from "@openducktor/frontend-core/sessions/start/agent-studio-quick-actions";
import {
  buildAgentStudioSelectionQueryUpdate,
  type AgentStudioQueryUpdate as QueryUpdate,
} from "../query-sync/agent-studio-navigation";
import { useAsyncActivityTracker } from "@openducktor/frontend-core/lib/use-async-activity-tracker";
import { buildAgentStudioSessionActivityKey } from "../agent-studio-session-activity-key";
import { useAgentStudioHumanReviewFeedbackFlow } from "../use-agent-studio-human-review-feedback-flow";

type CanStartRole = (role: AgentRole) => boolean;

type UseAgentStudioSessionStartFlowArgs = {
  branches?: GitBranch[];
  favoriteState: SessionStartModalModel["favoriteState"];
  taskId: string;
  role: AgentRole;
  launchActionId: SessionLaunchActionId;
  selectedSessionIdentity: AgentSessionIdentity | null;
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
  scheduleQueryUpdate: (updates: QueryUpdate) => void;
};

type AgentStudioSessionStartRequest = SessionStartLaunchRequest;
type AgentStudioSessionStartGateResult = SessionStartWorkflowResult | undefined;

const buildSessionStartKey = (params: {
  workspaceId: string | null;
  taskId: string;
  role: AgentRole;
  launchActionId: SessionLaunchActionId;
}): string => {
  return JSON.stringify([params.workspaceId, params.taskId, params.role, params.launchActionId]);
};

export function useAgentStudioSessionStartFlow({
  branches = [],
  favoriteState,
  taskId,
  role,
  launchActionId,
  selectedSessionIdentity,
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
  scheduleQueryUpdate,
}: UseAgentStudioSessionStartFlowArgs) {
  const queryClient = useQueryClient();
  const contextKey = `${workspaceId}:${taskId}:${role}`;
  const isCurrentContext = useSessionStartContext(contextKey);
  const sessionStartGate =
    useWorkspaceSessionStartGate<AgentStudioSessionStartGateResult>(workspaceId);

  const { begin: beginStartingActivity, isActive: isStartingActivityActive } =
    useAsyncActivityTracker();
  const isStarting = isStartingActivityActive(
    buildAgentStudioSessionActivityKey({
      workspaceId,
      taskId,
      role,
      session: null,
    }),
  );

  const { sessionStartModal, runSessionStartRequest: runInternalSessionStartRequest } =
    useSessionStartModalRunner({
      scopeKey: contextKey,
      branches,
      favoriteState,
      repoSettings,
      workspaceRepoPath,
    });

  const executeRequestedSessionStart = useCallback(
    async <T>(
      request: SessionStartFlowRequest,
      executeWithDecision: (decision: ResolvedSessionStartDecision) => Promise<T | undefined>,
    ): Promise<T | undefined> => {
      const isSameTaskAndRole = request.taskId === taskId && request.role === role;
      return runInternalSessionStartRequest(
        buildSessionStartModalRequest({
          source: "agent_studio",
          resolveKickoffPrompt: createSessionStartKickoffResolver({
            queryClient,
            workspaceId,
            task: request.taskId === taskId ? selectedTask : null,
            request,
          }),
          request,
          requestedRuntimeKind: isSameTaskAndRole
            ? (selectionForNewSession?.runtimeKind ?? selectedSessionIdentity?.runtimeKind ?? null)
            : null,
          selectedModel: isSameTaskAndRole ? (selectionForNewSession ?? null) : null,
          taskSessions: sessionsForTask,
          preferredSourceSession: isWorkflowAgentSession(loadedSession)
            ? {
                ...loadedSession,
                taskId: loadedSession.sessionAssociation.taskId,
                role: builtinRoleId(loadedSession.sessionAssociation.role),
              }
            : null,
          selectedTask: request.taskId === taskId ? selectedTask : null,
        }),
        async ({ decision }) => executeWithDecision(decision),
      );
    },
    [
      queryClient,
      workspaceId,
      loadedSession,
      role,
      runInternalSessionStartRequest,
      selectionForNewSession,
      selectedSessionIdentity?.runtimeKind,
      selectedTask,
      sessionsForTask,
      taskId,
    ],
  );

  const runWorkflow = useCallback(
    async (input: Parameters<RunSessionStartWorkflow>[0]): Promise<SessionStartWorkflowResult> => {
      const activity = beginStartingActivity(
        buildAgentStudioSessionActivityKey({ workspaceId, ...input.request, session: null }),
      );
      try {
        return await runSessionStartWorkflow(input);
      } finally {
        activity.finish();
      }
    },
    [beginStartingActivity, runSessionStartWorkflow, workspaceId],
  );

  const runSessionStartRequest = useCallback(
    async (request: SessionStartFlowRequest): Promise<SessionStartWorkflowResult | undefined> => {
      const executeWithDecision = async (
        decision: ResolvedSessionStartDecision,
      ): Promise<SessionStartWorkflowResult | undefined> => {
        const workflowInput: Parameters<typeof runSessionStartWorkflow>[0] = {
          request,
          decision,
          task: request.taskId === taskId ? selectedTask : null,
          onPostStartMessageFailure: showSessionStartMessageRecovery,
        };

        const workflow = await runWorkflow(workflowInput);
        if (
          workflow.postStartActionError &&
          !workflow.retryPostStartMessage &&
          !isSessionStartFailureFeedbackHandled(workflow.postStartActionError)
        ) {
          toast.error(sessionStartPostActionErrorTitle(request.postStartAction), {
            description: workflow.postStartActionError.message,
          });
        }

        if (isCurrentContext())
          scheduleQueryUpdate(
            buildAgentStudioSelectionQueryUpdate({
              taskId: request.taskId,
              sessionExternalId: workflow.externalSessionId,
              role: request.role,
            }),
          );
        return workflow;
      };

      return executeRequestedSessionStart(request, executeWithDecision);
    },
    [
      isCurrentContext,
      executeRequestedSessionStart,
      runWorkflow,
      selectedTask,
      scheduleQueryUpdate,
      taskId,
    ],
  );

  const runGatedSessionStartRequest = useCallback(
    (request: AgentStudioSessionStartRequest): Promise<SessionStartWorkflowResult | undefined> => {
      const startKeyParams: Parameters<typeof buildSessionStartKey>[0] = {
        workspaceId,
        taskId: request.taskId,
        role: request.role,
        launchActionId: request.launchActionId,
      };

      const startKey = buildSessionStartKey(startKeyParams);
      return sessionStartGate.run(startKey, () => runSessionStartRequest(request));
    },
    [runSessionStartRequest, sessionStartGate, workspaceId],
  );

  const startPreparedSession = useCallback(
    async (input: Parameters<RunSessionStartWorkflow>[0]) => {
      // A joined modal launch does not contain this typed draft.
      let launched: ReturnType<RunSessionStartWorkflow> | undefined;
      await sessionStartGate.run(
        buildSessionStartKey({ workspaceId, ...input.request }),
        () => (launched = runWorkflow(input)),
      );
      return launched;
    },
    [runWorkflow, sessionStartGate, workspaceId],
  );

  const runSessionStart = useCallback(
    async (params: {
      postStartAction: SessionStartPostAction;
    }): Promise<SessionStartWorkflowResult | undefined> => {
      if (!canStartRole(role)) {
        return undefined;
      }

      const request: AgentStudioSessionStartRequest = {
        taskId,
        role,
        launchActionId,
        postStartAction: params.postStartAction,
        initialTargetBranch: selectedTask?.targetBranch ?? null,
        initialTargetBranchError: selectedTask?.targetBranchError ?? null,
      };

      return runGatedSessionStartRequest(request);
    },
    [
      canStartRole,
      launchActionId,
      role,
      runGatedSessionStartRequest,
      selectedTask?.targetBranch,
      selectedTask?.targetBranchError,
      taskId,
    ],
  );

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
    if (getSessionLaunchAction(launchActionId).context === "human_feedback") {
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
      if (selectedSessionIdentity && isSessionWorking) {
        return;
      }

      if (!canStartRole(nextRole)) {
        return;
      }

      void runGatedSessionStartRequest({
        taskId,
        role: nextRole,
        launchActionId: nextLaunchActionId,
        postStartAction: "kickoff",
      });
    },
    [canStartRole, isSessionWorking, runGatedSessionStartRequest, selectedSessionIdentity, taskId],
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

      const request: AgentStudioSessionStartRequest = {
        taskId,
        role: option.role,
        launchActionId: option.launchActionId,
        postStartAction: option.postStartAction,
      };

      if (option.initialStartMode) {
        request.initialStartMode = option.initialStartMode;
      }

      if (option.existingSessionOptions) {
        request.existingSessionOptions = option.existingSessionOptions;
      }

      if (option.initialSourceSession !== undefined) {
        request.initialSourceSession = option.initialSourceSession;
      }

      void runGatedSessionStartRequest(request);
    },
    [canStartRole, isSessionWorking, openHumanReviewFeedback, runGatedSessionStartRequest, taskId],
  );

  return {
    isStarting,
    sessionStartModal,
    humanReviewFeedbackModal,
    startSessionRequest,
    startPreparedSession,
    startLaunchKickoff,
    handleCreateSession: handleCreateSessionWithHumanFeedback,
    handleQuickAction,
  } satisfies {
    isStarting: boolean;
    sessionStartModal: SessionStartModalModel | null;
    humanReviewFeedbackModal: HumanReviewFeedbackModalModel | null;
    startSessionRequest: (
      request: AgentStudioSessionStartRequest,
    ) => Promise<SessionStartWorkflowResult | undefined>;
    startPreparedSession: (
      input: Parameters<RunSessionStartWorkflow>[0],
    ) => Promise<SessionStartWorkflowResult | undefined>;
    startLaunchKickoff: () => Promise<void>;
    handleCreateSession: (option: SessionCreateOption) => void;
    handleQuickAction: (option: AgentStudioQuickActionOption) => void;
  };
}

import { useSessionStartContext } from "@/features/session-start/use-session-start-context";
import { useRuntimeAvailabilityContext } from "@/state/app-state-contexts";
import { getSessionLaunchAction } from "@/features/session-start/session-start-launch-options";
import { supportsTaskTargetBranchSelection } from "@/features/session-start/constants";
import { toAgentSessionIdentity } from "@/lib/agent-session-identity";
import { effectiveTaskTargetBranch, taskTargetBranchValidationError } from "@/lib/target-branch";
import { requireDirectSessionSelection } from "./direct-session-selection";
import { useQueryClient } from "@tanstack/react-query";
import { createSessionStartKickoffResolver } from "@/features/session-start/session-start-kickoff";
import type { GitBranch, TaskCard } from "@openducktor/contracts";
import type {
  AgentModelCatalog,
  AgentModelSelection,
  AgentRole,
  AgentUserMessagePart,
} from "@openducktor/core";
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
  isSessionStartFailureFeedbackHandled,
  sessionStartPostActionErrorTitle,
  useSessionStartModalRunner,
  useWorkspaceSessionStartGate,
} from "@/features/session-start";
import type { AgentSessionSummary } from "@/state/agent-sessions-store";
import { isWorkflowAgentSession } from "@/state/operations/agent-orchestrator/support/workflow-session";
import type { AgentSessionIdentity, AgentSessionState } from "@/types/agent-orchestrator";
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
  newSessionCatalog?: AgentModelCatalog | null;
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
  newSessionCatalog,
  repoSettings,
  workspaceId,
  workspaceRepoPath,
  runSessionStartWorkflow,
  scheduleQueryUpdate,
}: UseAgentStudioSessionStartFlowArgs) {
  const queryClient = useQueryClient();
  const { availableRuntimeDefinitions } = useRuntimeAvailabilityContext();
  const contextKey = `${workspaceId}:${taskId}:${role}`;
  const isCurrentContext = useSessionStartContext(contextKey);
  const isCurrentComposerContext = useSessionStartContext(
    buildAgentStudioSessionActivityKey({
      workspaceId,
      taskId,
      role,
      session: selectedSessionIdentity,
    }),
  );
  const sessionStartGate =
    useWorkspaceSessionStartGate<AgentStudioSessionStartGateResult>(workspaceId);

  const { begin: beginStartingActivity, isActive: isStartingActivityActive } =
    useAgentStudioAsyncActivityTracker();
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
                role: loadedSession.sessionAssociation.role,
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

  const runSessionStartRequest = useCallback(
    async (request: SessionStartFlowRequest): Promise<SessionStartWorkflowResult | undefined> => {
      const executeWithDecision = async (
        decision: ResolvedSessionStartDecision,
      ): Promise<SessionStartWorkflowResult | undefined> => {
        const execute = async (): Promise<SessionStartWorkflowResult> => {
          const workflowInput: Parameters<typeof runSessionStartWorkflow>[0] = {
            request,
            decision,
            task: request.taskId === taskId ? selectedTask : null,
          };

          const workflow = await runSessionStartWorkflow(workflowInput);
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
                session: toAgentSessionIdentity(workflow),
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
      isCurrentContext,
      beginStartingActivity,
      executeRequestedSessionStart,
      runSessionStartWorkflow,
      selectedTask,
      scheduleQueryUpdate,
      taskId,
      workspaceId,
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

  const startSessionForMessage = useCallback(
    async (parts: AgentUserMessagePart[]): Promise<SessionStartWorkflowResult | undefined> => {
      if (!canStartRole(role))
        throw new Error("This task cannot start the selected workflow role.");
      const action = getSessionLaunchAction(launchActionId);
      if (action.role !== role || !action.allowedStartModes.includes("fresh")) {
        throw new Error("This workflow action requires an explicit session launch.");
      }
      const selectedModel = requireDirectSessionSelection({
        selection: selectionForNewSession,
        catalog: newSessionCatalog ?? null,
        runtimeDefinitions: availableRuntimeDefinitions,
        role,
        taskId,
        launchActionId,
      });
      const decision: ResolvedSessionStartDecision = { startMode: "fresh", selectedModel };
      if (supportsTaskTargetBranchSelection(role, launchActionId)) {
        if (!repoSettings)
          throw new Error("Repository settings are unavailable. Reload before starting a session.");
        const branchError = taskTargetBranchValidationError(selectedTask?.targetBranchError);
        if (branchError) throw new Error(branchError);
        decision.targetBranch = effectiveTaskTargetBranch(
          selectedTask?.targetBranch,
          repoSettings.defaultTargetBranch,
        );
      }
      const activity = beginStartingActivity(
        buildAgentStudioSessionActivityKey({ workspaceId, taskId, role, session: null }),
      );
      try {
        const input: Parameters<typeof runSessionStartWorkflow>[0] = {
          request: {
            taskId,
            role,
            launchActionId,
            postStartAction: "send_message",
            parts,
          },
          decision,
          task: selectedTask,
        };
        const result = await runSessionStartWorkflow(input);
        if (isCurrentComposerContext())
          scheduleQueryUpdate(
            buildAgentStudioSelectionQueryUpdate({
              taskId,
              role,
              session: toAgentSessionIdentity(result),
            }),
          );
        return result;
      } finally {
        activity.finish();
      }
    },
    [
      canStartRole,
      role,
      launchActionId,
      selectionForNewSession,
      newSessionCatalog,
      availableRuntimeDefinitions,
      taskId,
      repoSettings,
      selectedTask,
      beginStartingActivity,
      workspaceId,
      runSessionStartWorkflow,
      isCurrentComposerContext,
      scheduleQueryUpdate,
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
    startSessionForMessage,
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
    startSessionForMessage: (
      parts: AgentUserMessagePart[],
    ) => Promise<SessionStartWorkflowResult | undefined>;
    startLaunchKickoff: () => Promise<void>;
    handleCreateSession: (option: SessionCreateOption) => void;
    handleQuickAction: (option: AgentStudioQuickActionOption) => void;
  };
}

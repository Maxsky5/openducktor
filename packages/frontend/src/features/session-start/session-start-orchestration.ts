import type { GitTargetBranch, RuntimeKind, TaskCard } from "@openducktor/contracts";
import type { AgentModelSelection, AgentSessionStartMode } from "@openducktor/core";
import type { QueryClient } from "@tanstack/react-query";
import { agentSessionIdentityKey, toAgentSessionIdentity } from "@/lib/agent-session-identity";
import type { AgentSessionSummary } from "@/state/agent-sessions-store";
import type { AgentSessionIdentity } from "@/types/agent-orchestrator";
import type { StartAgentSession } from "@/types/agent-session-start";
import { getSessionLaunchAction } from "./session-start-launch-options";
import type { SessionStartModalSource } from "./session-start-modal-types";
import { buildReusableSessionOptions } from "./session-start-reuse-options";
import type { NewSessionStartDecision, NewSessionStartRequest } from "./session-start-types";
import {
  type SendAgentMessage,
  type SessionStartBeforeAction,
  type SessionStartPostAction,
  type SessionStartWorkflowResult,
  startSessionWorkflow,
} from "./session-start-workflow";
import type { SessionStartModalOpenRequest } from "./use-session-start-modal-coordinator";

export type SessionStartFlowRequest = Omit<NewSessionStartRequest, "selectedModel"> & {
  initialStartMode?: AgentSessionStartMode;
  postStartAction: SessionStartPostAction;
  holdForPostStartMessage?: boolean;
  queueIfBusy?: boolean;
  message?: string;
  beforeStartAction?: SessionStartBeforeAction;
};

export type SessionStartLaunchRequest = SessionStartFlowRequest;

export type ResolvedSessionStartDecision = Exclude<NewSessionStartDecision, null>;

type SessionStartModalRunRequest = SessionStartModalOpenRequest & {
  selectedModel?: AgentModelSelection | null;
};

type SessionStartContextSession = {
  externalSessionId: string;
  runtimeKind: AgentSessionSummary["runtimeKind"];
  workingDirectory: string;
  taskId: string;
  role: AgentSessionSummary["role"];
};

type BuildSessionStartModalRequestArgs = {
  source: SessionStartModalSource;
  request: SessionStartFlowRequest;
  requestedRuntimeKind?: RuntimeKind | null;
  selectedModel: AgentModelSelection | null;
  taskSessions: AgentSessionSummary[];
  preferredSourceSession?: SessionStartContextSession | null | undefined;
  selectedTask?: Pick<TaskCard, "targetBranch" | "targetBranchError"> | null;
};

type ExecuteSessionStartFromDecisionArgs = {
  queryClient: QueryClient;
  request: SessionStartFlowRequest;
  decision: ResolvedSessionStartDecision;
  task: TaskCard | null;
  workspaceId: string | null;
  persistTaskTargetBranch?: (taskId: string, targetBranch: GitTargetBranch) => Promise<void>;
  startAgentSession: StartAgentSession;
  sendAgentMessage?: SendAgentMessage;
  postStartErrorAttentionId?: string;
  humanRequestChangesTask?: (taskId: string, note?: string) => Promise<void>;
};

export type RunSessionStartWorkflowInput = Omit<
  ExecuteSessionStartFromDecisionArgs,
  | "queryClient"
  | "workspaceId"
  | "startAgentSession"
  | "sendAgentMessage"
  | "postStartErrorAttentionId"
>;

export type RunSessionStartWorkflow = (
  input: RunSessionStartWorkflowInput,
) => Promise<SessionStartWorkflowResult>;

export type SessionStartNotificationInput = {
  launchAttemptId: string;
  workspaceId: string | null;
  taskId: string;
  taskTitle?: string;
  role: SessionStartFlowRequest["role"];
  session?: AgentSessionIdentity;
};

export type SessionStartNotificationPublisher = {
  publishSessionStarted(
    input: SessionStartNotificationInput & { session: AgentSessionIdentity },
  ): void;
  publishSessionError(input: SessionStartNotificationInput): Promise<boolean>;
  reportFailure(cause: unknown, input: SessionStartNotificationInput): void;
};

export class SessionStartWorkflowError extends Error {
  constructor(
    readonly originalCause: Error,
    readonly feedbackHandled: boolean,
  ) {
    super(originalCause.message);
    this.name = "SessionStartWorkflowError";
  }
}

export const isSessionStartFailureFeedbackHandled = (cause: unknown): boolean =>
  cause instanceof SessionStartWorkflowError && cause.feedbackHandled;

type CreateSessionStartWorkflowRunnerArgs = Pick<
  ExecuteSessionStartFromDecisionArgs,
  "queryClient" | "workspaceId" | "startAgentSession" | "sendAgentMessage"
> & {
  notifications?: SessionStartNotificationPublisher;
  createLaunchAttemptId?: () => string;
};

const launchActionSupportsReusableSessions = (
  launchActionId: SessionStartFlowRequest["launchActionId"],
): boolean => {
  return getSessionLaunchAction(launchActionId).allowedStartModes.some(
    (mode) => mode === "reuse" || mode === "fork",
  );
};

const resolveExistingSessionOptions = (
  request: SessionStartFlowRequest,
  taskSessions: AgentSessionSummary[],
) => {
  if (request.existingSessionOptions) {
    return request.existingSessionOptions;
  }

  if (!launchActionSupportsReusableSessions(request.launchActionId)) {
    return [];
  }

  return buildReusableSessionOptions({
    sessions: taskSessions.filter((session) => session.taskId === request.taskId),
    role: request.role,
  });
};

const resolveInitialSourceSession = ({
  request,
  existingSessionOptions,
  preferredSourceSession,
}: {
  request: SessionStartFlowRequest;
  existingSessionOptions: ReturnType<typeof resolveExistingSessionOptions>;
  preferredSourceSession?: SessionStartContextSession | null | undefined;
}): AgentSessionIdentity | null => {
  if (request.initialSourceSession !== undefined) {
    return request.initialSourceSession;
  }

  if (
    preferredSourceSession &&
    preferredSourceSession.taskId === request.taskId &&
    preferredSourceSession.role === request.role &&
    existingSessionOptions.some(
      (option) => option.value === agentSessionIdentityKey(preferredSourceSession),
    )
  ) {
    return toAgentSessionIdentity(preferredSourceSession);
  }

  return existingSessionOptions[0]?.sourceSession ?? null;
};

export const buildSessionStartModalRequest = ({
  source,
  request,
  requestedRuntimeKind,
  selectedModel,
  taskSessions,
  preferredSourceSession,
  selectedTask,
}: BuildSessionStartModalRequestArgs): SessionStartModalRunRequest => {
  const existingSessionOptions = resolveExistingSessionOptions(request, taskSessions);
  const initialSourceSession = resolveInitialSourceSession({
    request,
    existingSessionOptions,
    preferredSourceSession,
  });
  const initialTargetBranch = request.initialTargetBranch ?? selectedTask?.targetBranch ?? null;
  const initialTargetBranchError =
    request.initialTargetBranchError ?? selectedTask?.targetBranchError ?? null;
  const modalRequest: SessionStartModalRunRequest = {
    source,
    taskId: request.taskId,
    role: request.role,
    launchActionId: request.launchActionId,
    postStartAction: request.postStartAction,
    selectedModel,
    initialTargetBranch,
  };

  if (requestedRuntimeKind) {
    modalRequest.requestedRuntimeKind = requestedRuntimeKind;
  }

  if (initialTargetBranchError) {
    modalRequest.initialTargetBranchError = initialTargetBranchError;
  }

  if (request.targetWorkingDirectory !== undefined) {
    modalRequest.targetWorkingDirectory = request.targetWorkingDirectory;
  }

  if (request.initialStartMode) {
    modalRequest.initialStartMode = request.initialStartMode;
  }

  if (existingSessionOptions.length > 0) {
    modalRequest.existingSessionOptions = existingSessionOptions;
  }

  if (initialSourceSession !== undefined) {
    modalRequest.initialSourceSession = initialSourceSession;
  }

  return modalRequest;
};

export const executeSessionStartFromDecision = async ({
  queryClient,
  request,
  decision,
  task,
  workspaceId,
  persistTaskTargetBranch,
  startAgentSession,
  sendAgentMessage,
  postStartErrorAttentionId,
  humanRequestChangesTask,
}: ExecuteSessionStartFromDecisionArgs): Promise<SessionStartWorkflowResult> => {
  const intent: Parameters<typeof startSessionWorkflow>[0]["intent"] = {
    taskId: request.taskId,
    role: request.role,
    launchActionId: request.launchActionId,
    startMode: decision.startMode,
    postStartAction: request.postStartAction,
  };

  if (decision.targetBranch) {
    intent.targetBranch = decision.targetBranch;
  }

  if (request.targetWorkingDirectory !== undefined) {
    intent.targetWorkingDirectory = request.targetWorkingDirectory;
  }

  if (request.holdForPostStartMessage) {
    intent.holdForPostStartMessage = true;
  }

  if (decision.startMode === "fresh" && request.queueIfBusy) {
    intent.queueIfBusy = true;
  }

  if (request.message) {
    intent.message = request.message;
  }

  if (request.beforeStartAction) {
    intent.beforeStartAction = request.beforeStartAction;
  }

  if (decision.startMode === "reuse" || decision.startMode === "fork") {
    intent.sourceSession = decision.sourceSession;
  }

  const workflowInput: Parameters<typeof startSessionWorkflow>[0] = {
    queryClient,
    intent,
    selection: decision.startMode === "reuse" ? null : decision.selectedModel,
    task,
    workspaceId,
    startAgentSession,
  };

  if (persistTaskTargetBranch) {
    workflowInput.persistTaskTargetBranch = persistTaskTargetBranch;
  }

  if (sendAgentMessage) {
    workflowInput.sendAgentMessage = sendAgentMessage;
  }

  if (postStartErrorAttentionId) {
    workflowInput.postStartErrorAttentionId = postStartErrorAttentionId;
  }

  if (humanRequestChangesTask) {
    workflowInput.humanRequestChangesTask = humanRequestChangesTask;
  }

  return startSessionWorkflow(workflowInput);
};

export const createSessionStartWorkflowRunner = ({
  queryClient,
  workspaceId,
  startAgentSession,
  sendAgentMessage,
  notifications,
  createLaunchAttemptId = () => crypto.randomUUID(),
}: CreateSessionStartWorkflowRunnerArgs): RunSessionStartWorkflow => {
  return async (input) => {
    const launchAttemptId = createLaunchAttemptId();
    const notificationInput: SessionStartNotificationInput = {
      launchAttemptId,
      workspaceId,
      taskId: input.request.taskId,
      role: input.request.role,
    };
    if (input.task?.title) notificationInput.taskTitle = input.task.title;
    const reportNotificationFailure = (cause: unknown): void => {
      try {
        notifications?.reportFailure(cause, notificationInput);
      } catch {
        console.error("Session start notification failure reporting failed.", {
          launchAttemptId,
          taskId: input.request.taskId,
          workspaceId,
        });
      }
    };
    const args: ExecuteSessionStartFromDecisionArgs = {
      ...input,
      queryClient,
      workspaceId,
      startAgentSession,
      postStartErrorAttentionId: launchAttemptId,
    };

    if (sendAgentMessage) {
      args.sendAgentMessage = sendAgentMessage;
    }

    let result: SessionStartWorkflowResult;
    try {
      result = await executeSessionStartFromDecision(args);
    } catch (cause) {
      let feedbackHandled = false;
      try {
        if (notifications) {
          feedbackHandled = await notifications.publishSessionError(notificationInput);
        }
      } catch (notificationCause) {
        reportNotificationFailure(notificationCause);
      }
      const startError = cause instanceof Error ? cause : new Error(String(cause));
      throw new SessionStartWorkflowError(startError, feedbackHandled);
    }

    const { postStartActionError, ...session } = result;
    const notificationWithSession = { ...notificationInput, session };
    try {
      if (postStartActionError) {
        await notifications?.publishSessionError(notificationWithSession);
      } else if (input.decision.startMode === "fresh" || input.decision.startMode === "fork") {
        notifications?.publishSessionStarted(notificationWithSession);
      }
    } catch (cause) {
      reportNotificationFailure(cause);
    }
    return result;
  };
};

import type { RuntimeKind, TaskCard } from "@openducktor/contracts";
import type { AgentModelSelection } from "@openducktor/core";
import { presentWorkflowLaunchOutcome } from "./session-start-message-recovery";
import { agentSessionIdentityKey, toAgentSessionIdentity } from "@/lib/agent-session-identity";
import type { AgentSessionSummary } from "@/state/agent-sessions-store";
import type { AgentSessionIdentity } from "@/types/agent-orchestrator";
import { host } from "@/state/operations/shared/host";
import { getSessionLaunchAction } from "./session-start-launch-options";
import type { SessionStartModalSource } from "./session-start-modal-types";
import { buildReusableSessionOptions } from "./session-start-reuse-options";
import type { ResolvedSessionStartDecision, SessionStartFlowRequest } from "./session-start-types";
export type { ResolvedSessionStartDecision, SessionStartFlowRequest } from "./session-start-types";
import {
  type WorkflowLaunchClient,
  type SessionStartWorkflowResult,
  startSessionWorkflow,
  WorkflowLaunchFailure,
} from "./session-start-workflow";
import type { SessionStartModalOpenRequest } from "./use-session-start-modal-coordinator";

export type SessionStartLaunchRequest = SessionStartFlowRequest;

type SessionStartContextSession = {
  externalSessionId: string;
  runtimeKind: AgentSessionSummary["runtimeKind"];
  workingDirectory: string;
  taskId: string;
  role: AgentSessionSummary["role"];
};

type BuildSessionStartModalRequestArgs = {
  source: SessionStartModalSource;
  resolveKickoffPrompt?: SessionStartModalOpenRequest["resolveKickoffPrompt"];
  request: SessionStartFlowRequest;
  requestedRuntimeKind?: RuntimeKind | null;
  selectedModel: AgentModelSelection | null;
  taskSessions: AgentSessionSummary[];
  preferredSourceSession?: SessionStartContextSession | null | undefined;
  selectedTask?: Pick<TaskCard, "targetBranch" | "targetBranchError"> | null;
};

type StartFromDecisionArgs = {
  request: SessionStartFlowRequest;
  decision: ResolvedSessionStartDecision;
  workspaceId: string | null;
  repoPath: string | null;
  launchAttemptId: string;
  client?: WorkflowLaunchClient;
  readSessionSnapshot?: Parameters<typeof startSessionWorkflow>[0]["readSessionSnapshot"];
};

export type RunSessionStartWorkflowInput = Pick<StartFromDecisionArgs, "request" | "decision"> & {
  isCurrent?: () => boolean;
  task: TaskCard | null;
  onPostStartMessageFailure?: (result: SessionStartWorkflowResult) => void;
};

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
  errorAttentionId?: string;
  inAppFeedbackHandled?: boolean;
};

export type SessionStartNotificationPublisher = {
  publishSessionStarted(
    input: SessionStartNotificationInput & { session: AgentSessionIdentity },
  ): void;
  publishSessionError(
    input: SessionStartNotificationInput,
    localErrorMessage?: string,
  ): Promise<boolean>;
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
  StartFromDecisionArgs,
  "workspaceId" | "repoPath" | "client" | "readSessionSnapshot"
> & {
  notifications?: SessionStartNotificationPublisher;
  createLaunchAttemptId?: () => string;
};

export const createSessionStartWorkflowRunner = ({
  workspaceId,
  repoPath,
  client,
  readSessionSnapshot,
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
    const args: StartFromDecisionArgs = {
      request: input.request,
      decision: input.decision,
      workspaceId,
      repoPath,
      launchAttemptId,
    };

    if (client) args.client = client;
    if (readSessionSnapshot) args.readSessionSnapshot = readSessionSnapshot;
    const presentFailure = (error: Error): boolean => {
      if (!(error instanceof WorkflowLaunchFailure)) return false;
      try {
        return presentWorkflowLaunchOutcome(error.outcome, client ?? host);
      } catch (cause) {
        reportNotificationFailure(cause);
        return false;
      }
    };
    const publishFailure = async (
      error: Error,
      notification: SessionStartNotificationInput,
    ): Promise<boolean> => {
      let handled = presentFailure(error);
      if (handled) notification.inAppFeedbackHandled = true;
      try {
        const delivered = await notifications?.publishSessionError(notification, error.message);
        handled ||= delivered === true;
      } catch (cause) {
        reportNotificationFailure(cause);
      }
      return handled;
    };
    let result: SessionStartWorkflowResult;
    try {
      if (input.isCurrent && !input.isCurrent())
        throw new Error("The session start context changed. Start again in the current workspace.");
      result = await startFromDecision(args);
    } catch (cause) {
      const startError = cause instanceof Error ? cause : new Error(String(cause));
      const feedbackHandled = await publishFailure(startError, notificationInput);
      throw new SessionStartWorkflowError(startError, feedbackHandled);
    }

    const { postStartActionError } = result;
    const session = toAgentSessionIdentity(result);
    const notificationWithSession = { ...notificationInput, session };
    if (postStartActionError) {
      if (result.retryPostStartMessage && input.onPostStartMessageFailure) {
        try {
          input.onPostStartMessageFailure(result);
        } catch (cause) {
          reportNotificationFailure(cause);
        }
      }
      const feedbackHandled = await publishFailure(postStartActionError, notificationWithSession);
      return {
        ...result,
        postStartActionError: new SessionStartWorkflowError(postStartActionError, feedbackHandled),
      };
    }
    try {
      if (input.decision.startMode === "fresh" || input.decision.startMode === "fork") {
        notifications?.publishSessionStarted(notificationWithSession);
      }
    } catch (cause) {
      reportNotificationFailure(cause);
    }
    return result;
  };
};

export const buildSessionStartModalRequest = ({
  source,
  resolveKickoffPrompt,
  request,
  requestedRuntimeKind,
  selectedModel,
  taskSessions,
  preferredSourceSession,
  selectedTask,
}: BuildSessionStartModalRequestArgs): SessionStartModalOpenRequest => {
  const existingSessionOptions = resolveExistingSessionOptions(request, taskSessions);
  const initialSourceSession = resolveInitialSourceSession({
    request,
    existingSessionOptions,
    preferredSourceSession,
  });
  const initialTargetBranch = request.initialTargetBranch ?? selectedTask?.targetBranch ?? null;
  const initialTargetBranchError =
    request.initialTargetBranchError ?? selectedTask?.targetBranchError ?? null;
  const modalRequest: SessionStartModalOpenRequest = {
    source,
    taskId: request.taskId,
    role: request.role,
    launchActionId: request.launchActionId,
    postStartAction: request.postStartAction,
    selectedModel,
    initialTargetBranch,
  };

  if (resolveKickoffPrompt) modalRequest.resolveKickoffPrompt = resolveKickoffPrompt;

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

const startFromDecision = async ({
  request,
  decision,
  workspaceId,
  repoPath,
  launchAttemptId,
  client = host,
  readSessionSnapshot,
}: StartFromDecisionArgs): Promise<SessionStartWorkflowResult> => {
  if (!workspaceId || !repoPath)
    throw new Error("Session start requires an explicit workspace and repository.");
  const input: Parameters<typeof startSessionWorkflow>[0] = {
    request,
    decision,
    workspaceId,
    repoPath,
    launchAttemptId,
    client,
  };
  if (readSessionSnapshot) input.readSessionSnapshot = readSessionSnapshot;
  return startSessionWorkflow(input);
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

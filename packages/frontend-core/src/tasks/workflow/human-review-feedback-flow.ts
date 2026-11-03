import type { WorkspaceRef } from "@openducktor/contracts";
import type { ContinueTaskWorkflow } from "./task-workflow-continuation";
import type { QueryClient } from "@tanstack/react-query";
import { connectionHost } from "../../connection/client-connection";
import { getProductionTaskViewSync } from "../../queries/task-view-sync";
import { resolveTaskCards } from "../../queries/workflows";
import type { ClientFeedback } from "../../platform/client-feedback";
import type {
  ResolvedTaskCard,
  WorkflowLaunchActionId as SessionLaunchActionId,
} from "@openducktor/workflows";
import type { SessionStartExistingSessionOption } from "../../sessions/start/session-start-types";
import { buildReusableSessionOptions } from "../../sessions/start/session-start-reuse-options";
import type { AgentSessionSummary } from "../../sessions/agent-sessions-store";
import type { AgentSessionIdentity } from "../../types/agent-orchestrator";
import type {
  HumanReviewFeedbackLaunch,
  HumanReviewFeedbackState,
} from "./human-review-feedback-types";

export const HUMAN_REVIEW_FEEDBACK_REQUIRED_MESSAGE = "Feedback message is required.";

export type HumanReviewFeedbackStartRequest = {
  taskId: string;
  role: string;
  launchActionId: SessionLaunchActionId;
  initialStartMode?: "fresh" | "reuse" | "fork";
  existingSessionOptions: SessionStartExistingSessionOption[];
  initialSourceSession?: AgentSessionIdentity;
  postStartAction: "kickoff" | "send_message";
  humanFeedback: string;
};

type PrepareHumanReviewFeedbackInput = {
  createState: () => HumanReviewFeedbackState;
};

export type SubmitHumanReviewFeedbackResult =
  | { outcome: "started" | "updated" }
  | { outcome: "cancelled" };

type SubmitHumanReviewFeedbackInput = {
  feedback: ClientFeedback;
  state: HumanReviewFeedbackState;
  continueTaskWorkflow?: ContinueTaskWorkflow;
  requestChangesTask: (taskId: string, note: string) => Promise<ResolvedTaskCard>;
  builderSessions: AgentSessionSummary[];
  startRequestChangesSession: (
    request: HumanReviewFeedbackStartRequest,
  ) => Promise<AgentSessionIdentity | undefined>;
};

const buildRequestChangesSessionRequest = (
  state: HumanReviewFeedbackState,
  launch: HumanReviewFeedbackLaunch,
  builderSessions: AgentSessionSummary[],
  feedback: string,
): HumanReviewFeedbackStartRequest => {
  const existingSessionOptions = buildReusableSessionOptions({
    sessions: builderSessions,
    role: launch.role,
    roleLabel: launch.roleLabel,
  });
  const latestSourceSession = existingSessionOptions[0]?.sourceSession;

  const request: HumanReviewFeedbackStartRequest = {
    taskId: state.taskId,
    role: launch.role,
    launchActionId: launch.launchActionId,
    existingSessionOptions,
    postStartAction: launch.postStartAction,
    humanFeedback: feedback,
  };
  if (existingSessionOptions.length === 0) {
    request.initialStartMode = "fresh";
  }
  if (latestSourceSession) {
    request.initialSourceSession = latestSourceSession;
  }
  return request;
};

export const prepareHumanReviewFeedback = ({
  createState,
}: PrepareHumanReviewFeedbackInput): HumanReviewFeedbackState => {
  return createState();
};

export const submitHumanReviewFeedback = async ({
  feedback,
  state,
  requestChangesTask,
  continueTaskWorkflow,
  builderSessions,
  startRequestChangesSession,
}: SubmitHumanReviewFeedbackInput): Promise<SubmitHumanReviewFeedbackResult> => {
  const trimmedMessage = state.message.trim();
  if (trimmedMessage.length === 0) {
    feedback.show("error", HUMAN_REVIEW_FEEDBACK_REQUIRED_MESSAGE);
    return { outcome: "cancelled" };
  }

  if (!state.launch) {
    if (state.continuation && !continueTaskWorkflow)
      throw new Error("This client cannot continue Request Changes. Update the client.");
    let committedTask: ResolvedTaskCard;
    try {
      committedTask = await requestChangesTask(state.taskId, trimmedMessage);
    } catch (cause) {
      if (!(cause instanceof RequestChangesCommittedError)) throw cause;
      feedback.show("error", "Task updated, but its view could not load", {
        description: cause.message,
      });
      return { outcome: "updated" };
    }
    await continueTaskWorkflow?.(state.taskId, state.continuation, {
      humanFeedback: trimmedMessage,
      committedTask,
    });
    return { outcome: "updated" };
  }
  const startResult = await startRequestChangesSession(
    buildRequestChangesSessionRequest(state, state.launch, builderSessions, trimmedMessage),
  );
  if (!startResult) {
    return { outcome: "cancelled" };
  }

  return { outcome: "started" };
};

class RequestChangesCommittedError extends Error {}

/** Use the existing review command and refresh the connection-owned task views after commit. */
export const requestHumanReviewChanges = async (
  queryClient: QueryClient,
  scope: WorkspaceRef | null,
  taskId: string,
  note: string,
): Promise<ResolvedTaskCard> => {
  if (!scope) throw new Error("Select the task workspace before requesting changes.");
  const result = await connectionHost(queryClient).humanRequestChanges(scope, taskId, note);
  try {
    const [committed] = await resolveTaskCards(queryClient, scope, [result]);
    if (!committed) throw new Error("Host returned no committed task. Reload the workspace.");
    await getProductionTaskViewSync(queryClient).refreshManually(scope);
    return committed;
  } catch (cause) {
    throw new RequestChangesCommittedError(
      `The changes were requested, but the task view could not load. Reload the task. Do not repeat the action. ${cause instanceof Error ? cause.message : String(cause)}`,
      { cause },
    );
  }
};

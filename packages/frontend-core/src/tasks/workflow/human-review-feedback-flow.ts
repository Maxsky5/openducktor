import type { TaskCard, WorkspaceRef } from "@openducktor/contracts";
import type { QueryClient } from "@tanstack/react-query";
import { connectionHost } from "../../connection/client-connection";
import type { ClientFeedback } from "../../platform/client-feedback";
import type { WorkflowLaunchActionId as SessionLaunchActionId } from "@openducktor/workflows";
import type {
  SessionStartBeforeAction,
  SessionStartExistingSessionOption,
} from "../../sessions/start/session-start-types";
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
  /** The host commits the event after it checks the launch, and before the session starts. */
  beforeStartAction?: SessionStartBeforeAction;
};

export type SubmitHumanReviewFeedbackResult =
  | { outcome: "started" | "updated" }
  | { outcome: "cancelled" };

type SubmitHumanReviewFeedbackInput = {
  feedback: ClientFeedback;
  state: HumanReviewFeedbackState;
  /** Commits the event without a launch. */
  applyFeedbackEvent: (taskId: string, eventId: string) => Promise<TaskCard>;
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
  if (state.eventId !== null) {
    request.beforeStartAction = { eventId: state.eventId };
  }
  if (existingSessionOptions.length === 0) {
    request.initialStartMode = "fresh";
  }
  if (latestSourceSession) {
    request.initialSourceSession = latestSourceSession;
  }
  return request;
};

export const submitHumanReviewFeedback = async ({
  feedback,
  state,
  applyFeedbackEvent,
  builderSessions,
  startRequestChangesSession,
}: SubmitHumanReviewFeedbackInput): Promise<SubmitHumanReviewFeedbackResult> => {
  const trimmedMessage = state.message.trim();
  if (trimmedMessage.length === 0) {
    feedback.show("error", HUMAN_REVIEW_FEEDBACK_REQUIRED_MESSAGE);
    return { outcome: "cancelled" };
  }

  if (!state.launch) {
    if (state.eventId === null) throw new Error("The feedback form has no event and no launch.");
    await applyFeedbackEvent(state.taskId, state.eventId);
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

/** Applies the event alone. The task stream updates every task view after the commit. */
export const applyHumanFeedbackEvent = async (
  queryClient: QueryClient,
  scope: WorkspaceRef | null,
  taskId: string,
  eventId: string,
): Promise<TaskCard> => {
  if (!scope) throw new Error("Select the task workspace before requesting changes.");
  return connectionHost(queryClient).taskApplyEvent(scope, taskId, eventId);
};

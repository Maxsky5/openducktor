import { toast } from "sonner";
import type { SessionStartExistingSessionOption } from "@/features/session-start";
import { buildReusableSessionOptions } from "@/features/session-start";
import type { AgentSessionSummary } from "@/state/agent-sessions-store";
import type { HumanReviewFeedbackState } from "./human-review-feedback-types";

export const HUMAN_REVIEW_FEEDBACK_REQUIRED_MESSAGE = "Feedback message is required.";

export type HumanReviewFeedbackStartRequest = {
  taskId: string;
  role: "build";
  scenario: HumanReviewFeedbackState["scenario"];
  initialStartMode?: "fresh" | "reuse" | "fork";
  existingSessionOptions: SessionStartExistingSessionOption[];
  initialSourceSessionId?: string;
  postStartAction: "kickoff";
  message: string;
  beforeStartAction: {
    action: "human_request_changes";
    note: string;
  };
};

type PrepareHumanReviewFeedbackInput = {
  createState: () => HumanReviewFeedbackState;
};

export type SubmitHumanReviewFeedbackResult = { outcome: "started" } | { outcome: "cancelled" };

type SubmitHumanReviewFeedbackInput = {
  state: HumanReviewFeedbackState;
  builderSessions: AgentSessionSummary[];
  startRequestChangesSession: (
    request: HumanReviewFeedbackStartRequest,
  ) => Promise<string | undefined>;
};

const buildRequestChangesSessionRequest = (
  state: HumanReviewFeedbackState,
  builderSessions: AgentSessionSummary[],
  feedback: string,
): HumanReviewFeedbackStartRequest => {
  const existingSessionOptions = buildReusableSessionOptions({
    sessions: builderSessions,
    role: "build",
  });
  const latestBuilderSessionId = builderSessions[0]?.sessionId;

  return {
    taskId: state.taskId,
    role: "build",
    scenario: state.scenario,
    ...(existingSessionOptions.length === 0 ? { initialStartMode: "fresh" as const } : {}),
    existingSessionOptions,
    ...(latestBuilderSessionId ? { initialSourceSessionId: latestBuilderSessionId } : {}),
    postStartAction: "kickoff",
    message: feedback,
    beforeStartAction: {
      action: "human_request_changes",
      note: feedback,
    },
  };
};

export const prepareHumanReviewFeedback = ({
  createState,
}: PrepareHumanReviewFeedbackInput): HumanReviewFeedbackState => {
  return createState();
};

export const submitHumanReviewFeedback = async ({
  state,
  builderSessions,
  startRequestChangesSession,
}: SubmitHumanReviewFeedbackInput): Promise<SubmitHumanReviewFeedbackResult> => {
  const trimmedMessage = state.message.trim();
  if (trimmedMessage.length === 0) {
    toast.error(HUMAN_REVIEW_FEEDBACK_REQUIRED_MESSAGE);
    return { outcome: "cancelled" };
  }

  const sessionId = await startRequestChangesSession(
    buildRequestChangesSessionRequest(state, builderSessions, trimmedMessage),
  );
  if (!sessionId) {
    return { outcome: "cancelled" };
  }

  return { outcome: "started" };
};

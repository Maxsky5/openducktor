import { toast } from "sonner";
import type {
  SessionLaunchActionId,
  SessionStartExistingSessionOption,
} from "@/features/session-start";
import { buildReusableSessionOptions } from "@/features/session-start";
import type { AgentSessionSummary } from "@/state/agent-sessions-store";
import type { HumanReviewFeedbackState } from "./human-review-feedback-types";

export const HUMAN_REVIEW_FEEDBACK_REQUIRED_MESSAGE = "Feedback message is required.";

export type HumanReviewFeedbackStartRequest = {
  taskId: string;
  role: "build";
  launchActionId: SessionLaunchActionId;
  initialStartMode?: "fresh" | "reuse" | "fork";
  existingSessionOptions: SessionStartExistingSessionOption[];
  initialSourceExternalSessionId?: string;
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
  const latestBuilderSessionId = builderSessions[0]?.externalSessionId;

  return {
    taskId: state.taskId,
    role: "build",
    launchActionId: "build_after_human_request_changes",
    ...(existingSessionOptions.length === 0 ? { initialStartMode: "fresh" as const } : {}),
    existingSessionOptions,
    ...(latestBuilderSessionId ? { initialSourceExternalSessionId: latestBuilderSessionId } : {}),
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

  const externalSessionId = await startRequestChangesSession(
    buildRequestChangesSessionRequest(state, builderSessions, trimmedMessage),
  );
  if (!externalSessionId) {
    return { outcome: "cancelled" };
  }

  return { outcome: "started" };
};

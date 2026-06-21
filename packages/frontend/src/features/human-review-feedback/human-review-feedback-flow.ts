import { toast } from "sonner";
import type {
  SessionLaunchActionId,
  SessionStartExistingSessionOption,
} from "@/features/session-start";
import { buildReusableSessionOptions } from "@/features/session-start";
import { toAgentSessionIdentity } from "@/lib/agent-session-identity";
import type { AgentSessionSummary } from "@/state/agent-sessions-store";
import type { AgentSessionIdentity } from "@/types/agent-orchestrator";
import type { HumanReviewFeedbackState } from "./human-review-feedback-types";

export const HUMAN_REVIEW_FEEDBACK_REQUIRED_MESSAGE = "Feedback message is required.";

export type HumanReviewFeedbackStartRequest = {
  taskId: string;
  role: "build";
  launchActionId: SessionLaunchActionId;
  initialStartMode?: "fresh" | "reuse" | "fork";
  existingSessionOptions: SessionStartExistingSessionOption[];
  initialSourceSession?: AgentSessionIdentity;
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
  ) => Promise<unknown | undefined>;
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
  const latestBuilderSession = builderSessions[0];

  return {
    taskId: state.taskId,
    role: "build",
    launchActionId: "build_after_human_request_changes",
    ...(existingSessionOptions.length === 0 ? { initialStartMode: "fresh" as const } : {}),
    existingSessionOptions,
    ...(latestBuilderSession
      ? { initialSourceSession: toAgentSessionIdentity(latestBuilderSession) }
      : {}),
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

  const startResult = await startRequestChangesSession(
    buildRequestChangesSessionRequest(state, builderSessions, trimmedMessage),
  );
  if (!startResult) {
    return { outcome: "cancelled" };
  }

  return { outcome: "started" };
};

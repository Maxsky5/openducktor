import { toast } from "sonner";
import { buildReusableSessionOptions } from "@/features/session-start";
import type { AgentSessionSummary } from "@/state/agent-sessions-store";
import { NEW_BUILDER_SESSION_TARGET } from "./human-review-feedback-state";
import type {
  HumanReviewFeedbackState,
  PendingHumanReviewHydration,
} from "./human-review-feedback-types";

export const HUMAN_REVIEW_FEEDBACK_REQUIRED_MESSAGE = "Feedback message is required.";
export const HUMAN_REVIEW_FEEDBACK_STALE_SESSION_MESSAGE =
  "The selected builder session is no longer available for this task.";
export const HUMAN_REVIEW_FEEDBACK_REQUEST_FAILURE_MESSAGE = "Requesting changes failed.";
export const HUMAN_REVIEW_FEEDBACK_HYDRATION_FAILURE_MESSAGE =
  "Changes requested, but refreshing Builder sessions failed.";
export const HUMAN_REVIEW_FEEDBACK_SEND_FAILURE_MESSAGE =
  "Changes requested, but feedback message failed.";
export const HUMAN_REVIEW_FEEDBACK_BOOTSTRAP_FAILURE_MESSAGE =
  "Failed to load Builder sessions for this task.";

export type HumanReviewFeedbackNewSessionRequest = {
  taskId: string;
  role: "build";
  scenario: HumanReviewFeedbackState["scenario"];
  initialStartMode: "fresh";
  existingSessionOptions: ReturnType<typeof buildReusableSessionOptions>;
  sourceSessionId?: string;
  postStartAction: "send_message";
  message: string;
  beforeStartAction: {
    action: "human_request_changes";
    note: string;
  };
};

type PrepareHumanReviewFeedbackInput = {
  taskId: string;
  baselineSessions: AgentSessionSummary[];
  bootstrapTaskSessions: (taskId: string) => Promise<void>;
  getBuilderSessions: () => AgentSessionSummary[];
  createState: (builderSessions: AgentSessionSummary[]) => HumanReviewFeedbackState;
};

type PrepareHumanReviewFeedbackResult =
  | { kind: "ready"; state: HumanReviewFeedbackState }
  | { kind: "pending_hydration"; pendingHydration: PendingHumanReviewHydration }
  | { kind: "failed" };

type SubmitHumanReviewFeedbackInput = {
  state: HumanReviewFeedbackState;
  humanRequestChangesTask: (taskId: string, note?: string) => Promise<void>;
  dismissFeedbackModal: () => void;
  startNewSession: (request: HumanReviewFeedbackNewSessionRequest) => Promise<void>;
  openExistingSession: (session: AgentSessionSummary) => void;
  hydrateExistingSession: (session: AgentSessionSummary) => Promise<void>;
  sendExistingSessionMessage: (session: AgentSessionSummary, message: string) => Promise<void>;
};

const buildNewSessionRequest = (
  state: HumanReviewFeedbackState,
  message: string,
): HumanReviewFeedbackNewSessionRequest => {
  const request: HumanReviewFeedbackNewSessionRequest = {
    taskId: state.taskId,
    role: "build",
    scenario: state.scenario,
    initialStartMode: "fresh",
    existingSessionOptions: buildReusableSessionOptions({
      sessions: state.builderSessions,
      role: "build",
    }),
    postStartAction: "send_message",
    message,
    beforeStartAction: {
      action: "human_request_changes",
      note: message,
    },
  };

  const latestBuilderSessionId = state.builderSessions[0]?.sessionId;
  if (latestBuilderSessionId) {
    request.sourceSessionId = latestBuilderSessionId;
  }

  return request;
};

export const prepareHumanReviewFeedback = async ({
  taskId,
  baselineSessions,
  bootstrapTaskSessions,
  getBuilderSessions,
  createState,
}: PrepareHumanReviewFeedbackInput): Promise<PrepareHumanReviewFeedbackResult> => {
  try {
    await bootstrapTaskSessions(taskId);
  } catch {
    toast.error(HUMAN_REVIEW_FEEDBACK_BOOTSTRAP_FAILURE_MESSAGE);
    return { kind: "failed" };
  }

  const builderSessions = getBuilderSessions();
  if (builderSessions.length > 0) {
    return {
      kind: "ready",
      state: createState(builderSessions),
    };
  }

  return {
    kind: "pending_hydration",
    pendingHydration: { taskId, baselineSessions },
  };
};

export const submitHumanReviewFeedback = async ({
  state,
  humanRequestChangesTask,
  dismissFeedbackModal,
  startNewSession,
  openExistingSession,
  hydrateExistingSession,
  sendExistingSessionMessage,
}: SubmitHumanReviewFeedbackInput): Promise<void> => {
  const trimmedMessage = state.message.trim();
  if (trimmedMessage.length === 0) {
    toast.error(HUMAN_REVIEW_FEEDBACK_REQUIRED_MESSAGE);
    return;
  }

  if (state.selectedTarget === NEW_BUILDER_SESSION_TARGET) {
    await startNewSession(buildNewSessionRequest(state, trimmedMessage));
    return;
  }

  const existingBuilderSession = state.builderSessions.find(
    (session) => session.sessionId === state.selectedTarget,
  );
  if (!existingBuilderSession) {
    toast.error(HUMAN_REVIEW_FEEDBACK_STALE_SESSION_MESSAGE);
    return;
  }

  try {
    await humanRequestChangesTask(state.taskId, trimmedMessage);
  } catch {
    toast.error(HUMAN_REVIEW_FEEDBACK_REQUEST_FAILURE_MESSAGE);
    return;
  }

  dismissFeedbackModal();
  openExistingSession(existingBuilderSession);

  try {
    await hydrateExistingSession(existingBuilderSession);
  } catch {
    toast.error(HUMAN_REVIEW_FEEDBACK_HYDRATION_FAILURE_MESSAGE);
  }

  try {
    await sendExistingSessionMessage(existingBuilderSession, trimmedMessage);
  } catch {
    toast.error(HUMAN_REVIEW_FEEDBACK_SEND_FAILURE_MESSAGE);
  }
};

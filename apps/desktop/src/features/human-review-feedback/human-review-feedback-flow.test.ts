import { afterEach, describe, expect, mock, test } from "bun:test";
import { toast } from "sonner";
import type { SessionStartExistingSessionOption } from "@/features/session-start";
import type { AgentSessionSummary } from "@/state/agent-sessions-store";
import { createAgentSessionFixture } from "@/test-utils/shared-test-fixtures";
import type { AgentSessionState } from "@/types/agent-orchestrator";
import {
  HUMAN_REVIEW_FEEDBACK_BOOTSTRAP_FAILURE_MESSAGE,
  HUMAN_REVIEW_FEEDBACK_HYDRATION_FAILURE_MESSAGE,
  HUMAN_REVIEW_FEEDBACK_REQUEST_FAILURE_MESSAGE,
  HUMAN_REVIEW_FEEDBACK_REQUIRED_MESSAGE,
  HUMAN_REVIEW_FEEDBACK_SEND_FAILURE_MESSAGE,
  HUMAN_REVIEW_FEEDBACK_STALE_SESSION_MESSAGE,
  prepareHumanReviewFeedback,
  submitHumanReviewFeedback,
} from "./human-review-feedback-flow";
import { NEW_BUILDER_SESSION_TARGET } from "./human-review-feedback-state";
import type { HumanReviewFeedbackState } from "./human-review-feedback-types";

const originalToastError = toast.error;

const createBuilderSession = (overrides: Partial<AgentSessionState> = {}) =>
  createAgentSessionFixture(
    { role: "build", taskId: "TASK-1", scenario: "build_implementation_start" },
    overrides,
  );

const createState = (
  overrides: Partial<HumanReviewFeedbackState> = {},
): HumanReviewFeedbackState => ({
  taskId: "TASK-1",
  scenario: "build_after_human_request_changes",
  message: "Apply the requested changes.",
  builderSessions: [
    createBuilderSession({ sessionId: "builder-session-2", startedAt: "2026-03-20T12:00:00.000Z" }),
    createBuilderSession({ sessionId: "builder-session-1", startedAt: "2026-03-19T12:00:00.000Z" }),
  ],
  selectedTarget: "builder-session-2",
  ...overrides,
});

afterEach(() => {
  toast.error = originalToastError;
});

describe("human-review-feedback-flow", () => {
  test("prepareHumanReviewFeedback returns ready state after bootstrapping builder sessions", async () => {
    const bootstrapTaskSessions = mock(async () => {});
    const builderSessions = [createBuilderSession({ sessionId: "builder-session-2" })];
    const state = createState({ builderSessions, selectedTarget: "builder-session-2" });

    const result = await prepareHumanReviewFeedback({
      taskId: "TASK-1",
      baselineSessions: [],
      bootstrapTaskSessions,
      getBuilderSessions: () => builderSessions,
      createState: () => state,
    });

    expect(bootstrapTaskSessions).toHaveBeenCalledWith("TASK-1");
    expect(result).toEqual({ kind: "ready", state, pendingHydration: null });
  });

  test("prepareHumanReviewFeedback returns ready state with new-session default when no builder sessions exist", async () => {
    const bootstrapTaskSessions = mock(async () => {});
    const state = createState({
      builderSessions: [],
      selectedTarget: NEW_BUILDER_SESSION_TARGET,
    });
    const baselineSessions: AgentSessionSummary[] = [];

    const result = await prepareHumanReviewFeedback({
      taskId: "TASK-1",
      baselineSessions,
      bootstrapTaskSessions,
      getBuilderSessions: () => [],
      createState: () => state,
    });

    expect(result).toEqual({
      kind: "ready",
      state,
      pendingHydration: {
        taskId: "TASK-1",
        baselineSessions,
      },
    });
  });

  test("prepareHumanReviewFeedback reports bootstrap failures with the canonical toast", async () => {
    const toastError = mock(() => "toast-id");
    toast.error = toastError;
    const bootstrapTaskSessions = mock(async () => {
      throw new Error("bootstrap failed");
    });

    const result = await prepareHumanReviewFeedback({
      taskId: "TASK-1",
      baselineSessions: [],
      bootstrapTaskSessions,
      getBuilderSessions: () => [],
      createState: () => createState(),
    });

    expect(result).toEqual({ kind: "failed" });
    expect(toastError).toHaveBeenCalledWith(HUMAN_REVIEW_FEEDBACK_BOOTSTRAP_FAILURE_MESSAGE);
  });

  test("submitHumanReviewFeedback rejects blank messages before starting any session", async () => {
    const toastError = mock(() => "toast-id");
    toast.error = toastError;
    const humanRequestChangesTask = mock(async () => {});
    const dismissFeedbackModal = mock(() => {});
    const startNewSession = mock(async () => {});
    const openExistingSession = mock(() => {});
    const hydrateExistingSession = mock(async () => {});
    const sendExistingSessionMessage = mock(async () => {});

    await submitHumanReviewFeedback({
      state: createState({ message: "   " }),
      humanRequestChangesTask,
      dismissFeedbackModal,
      startNewSession,
      openExistingSession,
      hydrateExistingSession,
      sendExistingSessionMessage,
    });

    expect(toastError).toHaveBeenCalledWith(HUMAN_REVIEW_FEEDBACK_REQUIRED_MESSAGE);
    expect(humanRequestChangesTask).not.toHaveBeenCalled();
    expect(startNewSession).not.toHaveBeenCalled();
    expect(openExistingSession).not.toHaveBeenCalled();
  });

  test("submitHumanReviewFeedback normalizes the new-session request payload", async () => {
    const humanRequestChangesTask = mock(async () => {});
    const receivedExistingSessionOptionValues: string[] = [];
    const startNewSession = mock(async (request) => {
      receivedExistingSessionOptionValues.splice(
        0,
        receivedExistingSessionOptionValues.length,
        ...request.existingSessionOptions.map(
          (option: SessionStartExistingSessionOption) => option.value,
        ),
      );
    });

    await submitHumanReviewFeedback({
      state: createState({
        message: "  Use a fresh builder session for these changes.  ",
        selectedTarget: NEW_BUILDER_SESSION_TARGET,
      }),
      humanRequestChangesTask,
      dismissFeedbackModal: mock(() => {}),
      startNewSession,
      openExistingSession: mock(() => {}),
      hydrateExistingSession: mock(async () => {}),
      sendExistingSessionMessage: mock(async () => {}),
    });

    expect(humanRequestChangesTask).not.toHaveBeenCalled();
    expect(startNewSession).toHaveBeenCalledWith(
      expect.objectContaining({
        taskId: "TASK-1",
        role: "build",
        scenario: "build_after_human_request_changes",
        initialStartMode: "fresh",
        sourceSessionId: "builder-session-2",
        postStartAction: "send_message",
        message: "Use a fresh builder session for these changes.",
        beforeStartAction: {
          action: "human_request_changes",
          note: "Use a fresh builder session for these changes.",
        },
      }),
    );
    expect(receivedExistingSessionOptionValues).toEqual(["builder-session-2", "builder-session-1"]);
  });

  test("submitHumanReviewFeedback completes the existing-session request flow with partial failure toasts", async () => {
    const toastError = mock(() => "toast-id");
    toast.error = toastError;
    const state = createState({
      message: "  Apply the requested changes.  ",
      selectedTarget: "builder-session-1",
    });
    const humanRequestChangesTask = mock(async () => {});
    const dismissFeedbackModal = mock(() => {});
    const openExistingSession = mock(() => {});
    const hydrateExistingSession = mock(async () => {
      throw new Error("refresh failed");
    });
    const sendExistingSessionMessage = mock(async () => {
      throw new Error("send failed");
    });

    await submitHumanReviewFeedback({
      state,
      humanRequestChangesTask,
      dismissFeedbackModal,
      startNewSession: mock(async () => {}),
      openExistingSession,
      hydrateExistingSession,
      sendExistingSessionMessage,
    });

    const existingBuilderSession = state.builderSessions[1];
    expect(humanRequestChangesTask).toHaveBeenCalledWith("TASK-1", "Apply the requested changes.");
    expect(dismissFeedbackModal).toHaveBeenCalledTimes(1);
    expect(openExistingSession).toHaveBeenCalledWith(existingBuilderSession);
    expect(hydrateExistingSession).toHaveBeenCalledWith(existingBuilderSession);
    expect(sendExistingSessionMessage).toHaveBeenCalledWith(
      existingBuilderSession,
      "Apply the requested changes.",
    );
    expect(toastError).toHaveBeenCalledWith(HUMAN_REVIEW_FEEDBACK_HYDRATION_FAILURE_MESSAGE);
    expect(toastError).toHaveBeenCalledWith(HUMAN_REVIEW_FEEDBACK_SEND_FAILURE_MESSAGE);
  });

  test("submitHumanReviewFeedback stops when the selected builder session is stale", async () => {
    const toastError = mock(() => "toast-id");
    toast.error = toastError;
    const humanRequestChangesTask = mock(async () => {});

    await submitHumanReviewFeedback({
      state: createState({ selectedTarget: "missing-session" }),
      humanRequestChangesTask,
      dismissFeedbackModal: mock(() => {}),
      startNewSession: mock(async () => {}),
      openExistingSession: mock(() => {}),
      hydrateExistingSession: mock(async () => {}),
      sendExistingSessionMessage: mock(async () => {}),
    });

    expect(toastError).toHaveBeenCalledWith(HUMAN_REVIEW_FEEDBACK_STALE_SESSION_MESSAGE);
    expect(humanRequestChangesTask).not.toHaveBeenCalled();
  });

  test("submitHumanReviewFeedback shows the canonical request failure toast", async () => {
    const toastError = mock(() => "toast-id");
    toast.error = toastError;
    const humanRequestChangesTask = mock(async () => {
      throw new Error("request failed");
    });

    await submitHumanReviewFeedback({
      state: createState(),
      humanRequestChangesTask,
      dismissFeedbackModal: mock(() => {}),
      startNewSession: mock(async () => {}),
      openExistingSession: mock(() => {}),
      hydrateExistingSession: mock(async () => {}),
      sendExistingSessionMessage: mock(async () => {}),
    });

    expect(toastError).toHaveBeenCalledWith(HUMAN_REVIEW_FEEDBACK_REQUEST_FAILURE_MESSAGE);
  });
});

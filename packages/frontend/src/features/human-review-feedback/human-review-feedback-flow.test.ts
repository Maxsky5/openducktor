import { afterEach, describe, expect, mock, spyOn, test } from "bun:test";
import { toast } from "sonner";
import { createAgentSessionFixture } from "@/test-utils/shared-test-fixtures";
import type { AgentSessionState } from "@/types/agent-orchestrator";
import {
  HUMAN_REVIEW_FEEDBACK_REQUIRED_MESSAGE,
  prepareHumanReviewFeedback,
  submitHumanReviewFeedback,
} from "./human-review-feedback-flow";
import type { HumanReviewFeedbackState } from "./human-review-feedback-types";

const createBuilderSession = (overrides: Partial<AgentSessionState> = {}) =>
  createAgentSessionFixture({
    role: "build",
    taskId: "TASK-1",
    ...overrides,
  });

const createState = (
  overrides: Partial<HumanReviewFeedbackState> = {},
): HumanReviewFeedbackState => ({
  taskId: "TASK-1",
  message: "Apply the requested changes.",
  ...overrides,
});

let toastErrorSpy: ReturnType<typeof spyOn<typeof toast, "error">> | null = null;

afterEach(() => {
  toastErrorSpy?.mockRestore();
  toastErrorSpy = null;
  mock.clearAllMocks();
});

describe("human-review-feedback-flow", () => {
  test("prepareHumanReviewFeedback returns the created feedback state", () => {
    const state = createState();

    const result = prepareHumanReviewFeedback({
      createState: () => state,
    });

    expect(result).toBe(state);
  });

  test("submitHumanReviewFeedback rejects blank messages before starting the shared workflow", async () => {
    toastErrorSpy = spyOn(toast, "error").mockImplementation(() => "toast-id");
    const startRequestChangesSession = mock(async () => "session-new");

    const result = await submitHumanReviewFeedback({
      state: createState({ message: "   " }),
      builderSessions: [createBuilderSession({ externalSessionId: "builder-session-1" })],
      startRequestChangesSession,
    });

    expect(result).toEqual({ outcome: "cancelled" });
    expect(toastErrorSpy).toHaveBeenCalledWith(HUMAN_REVIEW_FEEDBACK_REQUIRED_MESSAGE);
    expect(startRequestChangesSession).not.toHaveBeenCalled();
  });

  test("submitHumanReviewFeedback builds a kickoff-based shared start-session request", async () => {
    const startRequestChangesSession = mock(async () => "session-new");
    const builderSessions = [
      createBuilderSession({
        externalSessionId: "builder-session-2",
        startedAt: "2026-03-20T12:00:00.000Z",
      }),
      createBuilderSession({
        externalSessionId: "builder-session-1",
        startedAt: "2026-03-19T12:00:00.000Z",
      }),
    ];

    const result = await submitHumanReviewFeedback({
      state: createState({ message: "  Use the standard request-changes workflow.  " }),
      builderSessions,
      startRequestChangesSession,
    });

    expect(result).toEqual({ outcome: "started" });
    expect(startRequestChangesSession).toHaveBeenCalledWith(
      expect.objectContaining({
        taskId: "TASK-1",
        role: "build",
        launchActionId: "build_after_human_request_changes",
        initialSourceExternalSessionId: "builder-session-2",
        postStartAction: "kickoff",
        message: "Use the standard request-changes workflow.",
        beforeStartAction: {
          action: "human_request_changes",
          note: "Use the standard request-changes workflow.",
        },
      }),
    );
    expect(startRequestChangesSession).toHaveBeenCalledWith(
      expect.objectContaining({
        existingSessionOptions: [
          expect.objectContaining({ value: "builder-session-2" }),
          expect.objectContaining({ value: "builder-session-1" }),
        ],
      }),
    );
  });

  test("submitHumanReviewFeedback defaults the shared start-session flow to fresh when no builder sessions exist", async () => {
    const startRequestChangesSession = mock(async () => "session-new");

    await submitHumanReviewFeedback({
      state: createState({ message: "Start this in a new builder session." }),
      builderSessions: [],
      startRequestChangesSession,
    });

    expect(startRequestChangesSession).toHaveBeenCalledWith(
      expect.objectContaining({
        initialStartMode: "fresh",
        existingSessionOptions: [],
      }),
    );
  });

  test("submitHumanReviewFeedback keeps the first modal editable when the shared workflow is cancelled", async () => {
    const startRequestChangesSession = mock(async () => undefined);

    const result = await submitHumanReviewFeedback({
      state: createState({ message: "Keep editing if I cancel the second step." }),
      builderSessions: [createBuilderSession({ externalSessionId: "builder-session-1" })],
      startRequestChangesSession,
    });

    expect(result).toEqual({ outcome: "cancelled" });
    expect(startRequestChangesSession).toHaveBeenCalledTimes(1);
  });

  test("submitHumanReviewFeedback preserves the human-request-changes launch action in the handoff request", async () => {
    const startRequestChangesSession = mock(async () => "session-new");

    await submitHumanReviewFeedback({
      state: createState({
        message: "Address the requested changes in the shared flow.",
      }),
      builderSessions: [createBuilderSession({ externalSessionId: "builder-session-1" })],
      startRequestChangesSession,
    });

    expect(startRequestChangesSession).toHaveBeenCalledWith(
      expect.objectContaining({
        launchActionId: "build_after_human_request_changes",
        message: "Address the requested changes in the shared flow.",
      }),
    );
  });
});

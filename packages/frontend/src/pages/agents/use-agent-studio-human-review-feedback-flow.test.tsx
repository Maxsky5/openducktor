import { describe, expect, mock, test } from "bun:test";
import type { TaskCard } from "@openducktor/contracts";
import { withMockedToast } from "@/test-utils/mock-toast";
import {
  createAgentSessionFixture,
  createHookHarness as createSharedHookHarness,
  createTaskCardFixture,
  enableReactActEnvironment,
} from "./agent-studio-test-utils";
import { useAgentStudioHumanReviewFeedbackFlow } from "./use-agent-studio-human-review-feedback-flow";

enableReactActEnvironment();

type HookArgs = Parameters<typeof useAgentStudioHumanReviewFeedbackFlow>[0];

const createTask = (overrides: Partial<TaskCard> = {}): TaskCard =>
  createTaskCardFixture({
    id: "task-1",
    title: "Task 1",
    status: "human_review",
    ...overrides,
  });

const createSession = (overrides: Partial<ReturnType<typeof createAgentSessionFixture>> = {}) =>
  createAgentSessionFixture({
    externalSessionId: "ext-session-build-1",
    taskId: "task-1",
    role: "build",
    status: "idle",
    startedAt: "2026-02-22T12:00:00.000Z",
    ...overrides,
  });

const createHookHarness = (initialProps: HookArgs) =>
  createSharedHookHarness(useAgentStudioHumanReviewFeedbackFlow, initialProps);

const createBaseArgs = (overrides: Partial<HookArgs> = {}): HookArgs => ({
  taskId: "task-1",
  sessionsForTask: [],
  selectedTask: createTask(),
  startSessionRequest: async () => undefined,
  ...overrides,
});

const waitForFeedbackModal = async (
  harness: ReturnType<typeof createHookHarness>,
): Promise<NonNullable<ReturnType<typeof harness.getLatest>["humanReviewFeedbackModal"]>> => {
  await harness.waitFor((state) => state.humanReviewFeedbackModal !== null);
  const modal = harness.getLatest().humanReviewFeedbackModal;
  expect(modal).not.toBeNull();
  if (!modal) {
    throw new Error("Expected human review feedback modal to be open.");
  }
  return modal;
};

const openFeedbackModal = async (harness: ReturnType<typeof createHookHarness>) => {
  await harness.mount();
  await harness.run((state) => {
    state.openHumanReviewFeedback();
  });
  return waitForFeedbackModal(harness);
};

const updateFeedbackMessage = async (
  harness: ReturnType<typeof createHookHarness>,
  message: string,
) => {
  await harness.run((state) => {
    state.humanReviewFeedbackModal?.onMessageChange(message);
  });
};

const confirmFeedbackModal = async (harness: ReturnType<typeof createHookHarness>) => {
  await harness.run(async (state) => {
    await state.humanReviewFeedbackModal?.onConfirm();
  });
};

describe("useAgentStudioHumanReviewFeedbackFlow", () => {
  test("intercepts only build-after-human-request-changes session creation", async () => {
    const harness = createHookHarness(createBaseArgs());

    await harness.mount();

    expect(
      harness.getLatest().shouldInterceptCreateSession({
        id: "build:build_after_human_request_changes:fresh",
        launchActionId: "build_after_human_request_changes",
        role: "build",
        label: "Builder",
        description: "Create builder session",
        disabled: false,
      }),
    ).toBe(true);
    expect(
      harness.getLatest().shouldInterceptCreateSession({
        id: "build:build_implementation_start:fresh",
        launchActionId: "build_implementation_start",
        role: "build",
        label: "Builder",
        description: "Create builder session",
        disabled: false,
      }),
    ).toBe(false);
    expect(
      harness.getLatest().shouldInterceptCreateSession({
        id: "qa:qa_review:fresh",
        launchActionId: "qa_review",
        role: "qa",
        label: "QA",
        description: "Create QA session",
        disabled: false,
      }),
    ).toBe(false);

    await harness.unmount();
  });

  test("opens the feedback modal with an empty draft", async () => {
    const harness = createHookHarness(
      createBaseArgs({
        sessionsForTask: [createSession({ externalSessionId: "session-build-latest" })],
      }),
    );

    const modal = await openFeedbackModal(harness);

    expect(modal.open).toBe(true);
    expect(modal.taskId).toBe("task-1");
    expect(modal.message).toBe("");

    await harness.unmount();
  });

  test("rejects blank feedback without starting the shared workflow", async () => {
    await withMockedToast(async ({ toastErrorMock }) => {
      const startSessionRequest = mock(async () => undefined);
      const harness = createHookHarness(
        createBaseArgs({
          startSessionRequest,
          sessionsForTask: [createSession({ externalSessionId: "session-build-existing" })],
        }),
      );

      await openFeedbackModal(harness);
      await updateFeedbackMessage(harness, "   ");
      await confirmFeedbackModal(harness);

      expect(toastErrorMock).toHaveBeenCalledWith("Feedback message is required.");
      expect(startSessionRequest).toHaveBeenCalledTimes(0);
      expect(harness.getLatest().humanReviewFeedbackModal?.open).toBe(true);

      await harness.unmount();
    });
  });

  test("hands off to the shared start-session workflow with reuse options when builder sessions exist", async () => {
    const startSessionRequests: Array<{
      taskId: string;
      role: "build";
      existingSessionOptions: Array<{ value: string }>;
      initialSourceExternalSessionId?: string | null;
      initialStartMode?: "fresh" | "reuse" | "fork";
      postStartAction: "kickoff";
      message?: string;
      beforeStartAction?: {
        action: "human_request_changes";
        note: string;
      };
    }> = [];
    const startSessionRequest = mock(async (request) => {
      startSessionRequests.push(request);
      return "session-build-new";
    });
    const harness = createHookHarness(
      createBaseArgs({
        startSessionRequest,
        sessionsForTask: [
          createSession({
            externalSessionId: "session-build-existing",
            startedAt: "2026-02-22T13:00:00.000Z",
          }),
          createSession({
            externalSessionId: "session-build-older",
            startedAt: "2026-02-22T11:00:00.000Z",
          }),
        ],
      }),
    );

    await openFeedbackModal(harness);
    await updateFeedbackMessage(harness, "  Ship the requested fixes.  ");
    await confirmFeedbackModal(harness);

    expect(startSessionRequests).toHaveLength(1);
    expect(startSessionRequests[0]).toMatchObject({
      taskId: "task-1",
      role: "build",
      launchActionId: "build_after_human_request_changes",
      initialSourceExternalSessionId: "session-build-existing",
      postStartAction: "kickoff",
      message: "Ship the requested fixes.",
      beforeStartAction: {
        action: "human_request_changes",
        note: "Ship the requested fixes.",
      },
    });
    expect(startSessionRequests[0]?.existingSessionOptions.map((option) => option.value)).toEqual([
      "session-build-existing",
      "session-build-older",
    ]);
    expect(harness.getLatest().humanReviewFeedbackModal).toBeNull();

    await harness.unmount();
  });

  test("keeps the feedback modal open when the shared start-session flow is canceled", async () => {
    const startSessionRequest = mock(async () => undefined);
    const harness = createHookHarness(
      createBaseArgs({
        startSessionRequest,
        sessionsForTask: [createSession({ externalSessionId: "session-build-existing" })],
      }),
    );

    await openFeedbackModal(harness);
    await updateFeedbackMessage(harness, "  Ship the requested fixes.  ");
    await confirmFeedbackModal(harness);

    expect(startSessionRequest).toHaveBeenCalledTimes(1);
    expect(harness.getLatest().humanReviewFeedbackModal?.open).toBe(true);
    expect(harness.getLatest().humanReviewFeedbackModal?.message).toBe(
      "  Ship the requested fixes.  ",
    );

    await harness.unmount();
  });

  test("surfaces start-session preparation failures and keeps the feedback modal open", async () => {
    await withMockedToast(async ({ toastErrorMock }) => {
      const startSessionRequest = mock(async () => {
        throw new Error("start failed");
      });
      const harness = createHookHarness(
        createBaseArgs({
          startSessionRequest,
          sessionsForTask: [createSession({ externalSessionId: "session-build-existing" })],
        }),
      );

      await openFeedbackModal(harness);
      await updateFeedbackMessage(harness, "  Ship the requested fixes.  ");
      await confirmFeedbackModal(harness);
      await harness.waitFor(() => toastErrorMock.mock.calls.length > 0);

      expect(startSessionRequest).toHaveBeenCalledTimes(1);
      expect(toastErrorMock).toHaveBeenCalledWith("Failed to prepare the Builder session.", {
        description: "start failed",
      });
      expect(harness.getLatest().humanReviewFeedbackModal?.open).toBe(true);

      await harness.unmount();
    });
  });
});

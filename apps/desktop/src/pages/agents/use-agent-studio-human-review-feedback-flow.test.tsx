import { describe, expect, mock, test } from "bun:test";
import type { TaskCard } from "@openducktor/contracts";
import { NEW_BUILDER_SESSION_TARGET } from "@/features/human-review-feedback/human-review-feedback-state";
import type { NewSessionStartRequest } from "@/features/session-start";
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

const createModelSelection = () => ({
  runtimeKind: "opencode" as const,
  providerId: "openai",
  modelId: "gpt-5",
  variant: "default",
  profileId: "builder",
});

const createTask = (overrides: Partial<TaskCard> = {}): TaskCard =>
  createTaskCardFixture({
    id: "task-1",
    title: "Task 1",
    status: "human_review",
    ...overrides,
  });

const createSession = (overrides: Partial<ReturnType<typeof createAgentSessionFixture>> = {}) =>
  createAgentSessionFixture({
    sessionId: "session-build-1",
    externalSessionId: "ext-session-build-1",
    taskId: "task-1",
    role: "build",
    scenario: "build_implementation_start",
    status: "idle",
    startedAt: "2026-02-22T12:00:00.000Z",
    ...overrides,
  });

const createHookHarness = (initialProps: HookArgs) =>
  createSharedHookHarness(useAgentStudioHumanReviewFeedbackFlow, initialProps);

const createBaseArgs = (overrides: Partial<HookArgs> = {}): HookArgs => ({
  activeRepo: "/repo",
  taskId: "task-1",
  role: "spec",
  activeSession: null,
  sessionsForTask: [],
  selectedTask: createTask(),
  startAgentSession: async () => "session-new",
  sendAgentMessage: async () => {},
  bootstrapTaskSessions: async () => {},
  hydrateRequestedTaskSessionHistory: async () => {},
  humanRequestChangesTask: async () => {},
  updateQuery: () => {},
  executeRequestedSessionStart: async () => undefined,
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

const updateFeedbackModal = async (
  harness: ReturnType<typeof createHookHarness>,
  {
    target,
    message,
  }: {
    target?: string;
    message?: string;
  },
) => {
  await harness.run((state) => {
    if (target !== undefined) {
      state.humanReviewFeedbackModal?.onTargetChange(target);
    }
    if (message !== undefined) {
      state.humanReviewFeedbackModal?.onMessageChange(message);
    }
  });
};

const confirmFeedbackModal = async (harness: ReturnType<typeof createHookHarness>) => {
  await harness.run(async (state) => {
    await state.humanReviewFeedbackModal?.onConfirm();
  });
};

const expectBuilderSelectionUpdate = (
  updateCalls: Array<Record<string, string | undefined>>,
  sessionId: string,
) => {
  expect(updateCalls).toEqual([
    {
      task: "task-1",
      session: sessionId,
      agent: "build",
      scenario: undefined,
      autostart: undefined,
      start: undefined,
    },
  ]);
};

describe("useAgentStudioHumanReviewFeedbackFlow", () => {
  test("intercepts only build-after-human-request-changes session creation", async () => {
    const harness = createHookHarness(createBaseArgs());

    await harness.mount();

    expect(
      harness.getLatest().shouldInterceptCreateSession({
        id: "build:build_after_human_request_changes:fresh",
        role: "build",
        scenario: "build_after_human_request_changes",
        label: "Builder",
        description: "Create builder session",
        disabled: false,
      }),
    ).toBe(true);
    expect(
      harness.getLatest().shouldInterceptCreateSession({
        id: "build:build_implementation_start:fresh",
        role: "build",
        scenario: "build_implementation_start",
        label: "Builder",
        description: "Create builder session",
        disabled: false,
      }),
    ).toBe(false);
    expect(
      harness.getLatest().shouldInterceptCreateSession({
        id: "qa:qa_review:fresh",
        role: "qa",
        scenario: "qa_review",
        label: "QA",
        description: "Create QA session",
        disabled: false,
      }),
    ).toBe(false);

    await harness.unmount();
  });

  test("opens the feedback modal immediately when builder sessions already exist", async () => {
    const bootstrapTaskSessions = mock(async () => {});
    const latestBuilderSession = createSession({
      sessionId: "session-build-latest",
      startedAt: "2026-02-22T13:00:00.000Z",
    });
    const olderBuilderSession = createSession({
      sessionId: "session-build-older",
      startedAt: "2026-02-22T11:00:00.000Z",
    });
    const harness = createHookHarness(
      createBaseArgs({
        bootstrapTaskSessions,
        sessionsForTask: [olderBuilderSession, latestBuilderSession],
      }),
    );

    const modal = await openFeedbackModal(harness);

    expect(bootstrapTaskSessions).toHaveBeenCalledWith("task-1");
    expect(modal.selectedTarget).toBe("session-build-latest");
    expect(modal.targetOptions.map((option) => option.value)).toEqual([
      NEW_BUILDER_SESSION_TARGET,
      "session-build-latest",
      "session-build-older",
    ]);

    await harness.unmount();
  });

  test("opens the feedback modal immediately and adopts delayed builder-session hydration", async () => {
    const bootstrapTaskSessions = mock(async () => {});
    const harness = createHookHarness(
      createBaseArgs({
        bootstrapTaskSessions,
        sessionsForTask: [],
      }),
    );

    const initialModal = await openFeedbackModal(harness);
    expect(initialModal.selectedTarget).toBe(NEW_BUILDER_SESSION_TARGET);
    expect(initialModal.targetOptions.map((option) => option.value)).toEqual([
      NEW_BUILDER_SESSION_TARGET,
    ]);

    await harness.update(
      createBaseArgs({
        bootstrapTaskSessions,
        sessionsForTask: [createSession({ sessionId: "session-build-hydrated" })],
      }),
    );

    const modal = await waitForFeedbackModal(harness);
    expect(modal.selectedTarget).toBe("session-build-hydrated");

    await harness.unmount();
  });

  test("clears pending hydration and toasts when builder session bootstrap fails", async () => {
    await withMockedToast(async ({ toastErrorMock }) => {
      const bootstrapTaskSessions = mock(async () => {
        throw new Error("bootstrap failed");
      });
      const harness = createHookHarness(
        createBaseArgs({
          bootstrapTaskSessions,
        }),
      );

      await harness.mount();
      await harness.run((state) => {
        state.openHumanReviewFeedback();
      });

      expect(toastErrorMock).toHaveBeenCalledWith("Failed to load Builder sessions for this task.");
      expect(harness.getLatest().humanReviewFeedbackModal).toBeNull();

      await harness.update(
        createBaseArgs({
          bootstrapTaskSessions,
          sessionsForTask: [createSession({ sessionId: "session-build-late" })],
        }),
      );

      expect(harness.getLatest().humanReviewFeedbackModal).toBeNull();

      await harness.unmount();
    });
  });

  test("rejects blank feedback without starting or reusing a builder session", async () => {
    await withMockedToast(async ({ toastErrorMock }) => {
      const humanRequestChangesTask = mock(async () => {});
      const executeRequestedSessionStart = mock(async () => undefined);
      const harness = createHookHarness(
        createBaseArgs({
          humanRequestChangesTask,
          executeRequestedSessionStart,
          sessionsForTask: [createSession({ sessionId: "session-build-existing" })],
        }),
      );

      await openFeedbackModal(harness);
      await updateFeedbackModal(harness, { message: "   " });
      await confirmFeedbackModal(harness);

      expect(toastErrorMock).toHaveBeenCalledWith("Feedback message is required.");
      expect(humanRequestChangesTask).toHaveBeenCalledTimes(0);
      expect(executeRequestedSessionStart).toHaveBeenCalledTimes(0);
      expect(harness.getLatest().humanReviewFeedbackModal?.open).toBe(true);

      await harness.unmount();
    });
  });

  test("reuses an existing builder session and surfaces partial follow-up failures", async () => {
    await withMockedToast(async ({ toastErrorMock }) => {
      const humanRequestChangesTask = mock(async () => {});
      const hydrateRequestedTaskSessionHistory = mock(async () => {
        throw new Error("hydrate failed");
      });
      const sendAgentMessage = mock(async () => {
        throw new Error("send failed");
      });
      const onContextSwitchIntent = mock(() => {});
      const updateCalls: Array<Record<string, string | undefined>> = [];
      const harness = createHookHarness(
        createBaseArgs({
          activeSession: createSession({
            sessionId: "session-spec-active",
            externalSessionId: "ext-session-spec-active",
            role: "spec",
            scenario: "spec_initial",
          }),
          humanRequestChangesTask,
          hydrateRequestedTaskSessionHistory,
          sendAgentMessage,
          onContextSwitchIntent,
          sessionsForTask: [
            createSession({
              sessionId: "session-build-latest",
              startedAt: "2026-02-22T13:00:00.000Z",
            }),
            createSession({
              sessionId: "session-build-older",
              startedAt: "2026-02-22T11:00:00.000Z",
            }),
          ],
          updateQuery: (updates) => {
            updateCalls.push(updates);
          },
        }),
      );

      await openFeedbackModal(harness);
      await updateFeedbackModal(harness, {
        target: "session-build-older",
        message: "  Apply the requested human changes.  ",
      });
      await confirmFeedbackModal(harness);

      expect(humanRequestChangesTask).toHaveBeenCalledWith(
        "task-1",
        "Apply the requested human changes.",
      );
      expect(hydrateRequestedTaskSessionHistory).toHaveBeenCalledWith({
        taskId: "task-1",
        sessionId: "session-build-older",
      });
      expect(sendAgentMessage).toHaveBeenCalledWith("session-build-older", [
        { kind: "text", text: "Apply the requested human changes." },
      ]);
      expect(onContextSwitchIntent).toHaveBeenCalledTimes(1);
      expectBuilderSelectionUpdate(updateCalls, "session-build-older");
      expect(toastErrorMock).toHaveBeenCalledWith(
        "Changes requested, but refreshing Builder sessions failed.",
      );
      expect(toastErrorMock).toHaveBeenCalledWith(
        "Changes requested, but feedback message failed.",
      );
      expect(harness.getLatest().humanReviewFeedbackModal).toBeNull();

      await harness.unmount();
    });
  });

  test("starts a new builder session through the requested-session workflow", async () => {
    const humanRequestChangesTask = mock(async () => {});
    const startAgentSession = mock(async () => "session-build-new");
    const sendAgentMessage = mock(async () => {});
    const hydrateRequestedTaskSessionHistory = mock(async () => {});
    const requestedStarts: Array<Omit<NewSessionStartRequest, "selectedModel">> = [];
    const updateCalls: Array<Record<string, string | undefined>> = [];
    const executeRequestedSessionStart: HookArgs["executeRequestedSessionStart"] = async (
      request,
      executeWithDecision,
    ) => {
      requestedStarts.push(request);
      return executeWithDecision({
        startMode: "fresh",
        selectedModel: createModelSelection(),
      });
    };
    const harness = createHookHarness(
      createBaseArgs({
        humanRequestChangesTask,
        startAgentSession,
        sendAgentMessage,
        hydrateRequestedTaskSessionHistory,
        executeRequestedSessionStart,
        sessionsForTask: [createSession({ sessionId: "session-build-existing" })],
        updateQuery: (updates) => {
          updateCalls.push(updates);
        },
      }),
    );

    await openFeedbackModal(harness);
    await updateFeedbackModal(harness, {
      target: NEW_BUILDER_SESSION_TARGET,
      message: "  Ship the requested fixes.  ",
    });
    await confirmFeedbackModal(harness);
    await harness.waitFor(() => sendAgentMessage.mock.calls.length > 0);

    expect(requestedStarts).toEqual([
      {
        taskId: "task-1",
        role: "build",
        scenario: "build_after_human_request_changes",
        reason: "create_session",
        existingSessionOptions: expect.any(Array),
        initialSourceSessionId: "session-build-existing",
      },
    ]);
    expect(humanRequestChangesTask).toHaveBeenCalledWith("task-1", "Ship the requested fixes.");
    expect(startAgentSession).toHaveBeenCalledWith({
      taskId: "task-1",
      role: "build",
      scenario: "build_after_human_request_changes",
      selectedModel: createModelSelection(),
      startMode: "fresh",
    });
    expect(sendAgentMessage).toHaveBeenCalledWith("session-build-new", [
      { kind: "text", text: "Ship the requested fixes." },
    ]);
    expect(hydrateRequestedTaskSessionHistory).toHaveBeenCalledWith({
      taskId: "task-1",
      sessionId: "session-build-new",
    });
    expectBuilderSelectionUpdate(updateCalls, "session-build-new");
    expect(harness.getLatest().humanReviewFeedbackModal).toBeNull();

    await harness.unmount();
  });

  test("surfaces detached follow-up message failures after starting a new builder session", async () => {
    await withMockedToast(async ({ toastErrorMock }) => {
      const humanRequestChangesTask = mock(async () => {});
      const startAgentSession = mock(async () => "session-build-new");
      const sendAgentMessage = mock(async () => {
        throw new Error("detached send failed");
      });
      const hydrateRequestedTaskSessionHistory = mock(async () => {});
      const updateCalls: Array<Record<string, string | undefined>> = [];
      const executeRequestedSessionStart: HookArgs["executeRequestedSessionStart"] = async (
        _request,
        executeWithDecision,
      ) => {
        return executeWithDecision({
          startMode: "fresh",
          selectedModel: createModelSelection(),
        });
      };
      const harness = createHookHarness(
        createBaseArgs({
          humanRequestChangesTask,
          startAgentSession,
          sendAgentMessage,
          hydrateRequestedTaskSessionHistory,
          executeRequestedSessionStart,
          sessionsForTask: [createSession({ sessionId: "session-build-existing" })],
          updateQuery: (updates) => {
            updateCalls.push(updates);
          },
        }),
      );

      await openFeedbackModal(harness);
      await updateFeedbackModal(harness, {
        target: NEW_BUILDER_SESSION_TARGET,
        message: "  Ship the requested fixes.  ",
      });
      await confirmFeedbackModal(harness);
      await harness.waitFor(() => toastErrorMock.mock.calls.length > 0);

      expect(humanRequestChangesTask).toHaveBeenCalledWith("task-1", "Ship the requested fixes.");
      expect(startAgentSession).toHaveBeenCalledWith({
        taskId: "task-1",
        role: "build",
        scenario: "build_after_human_request_changes",
        selectedModel: createModelSelection(),
        startMode: "fresh",
      });
      expect(sendAgentMessage).toHaveBeenCalledWith("session-build-new", [
        { kind: "text", text: "Ship the requested fixes." },
      ]);
      expect(hydrateRequestedTaskSessionHistory).toHaveBeenCalledWith({
        taskId: "task-1",
        sessionId: "session-build-new",
      });
      expectBuilderSelectionUpdate(updateCalls, "session-build-new");
      expect(toastErrorMock).toHaveBeenCalledWith(
        "Changes requested, but feedback message failed.",
        { description: "detached send failed" },
      );
      expect(harness.getLatest().humanReviewFeedbackModal).toBeNull();

      await harness.unmount();
    });
  });

  test("rejects a stale selected builder target before requesting changes", async () => {
    await withMockedToast(async ({ toastErrorMock }) => {
      const humanRequestChangesTask = mock(async () => {});
      const harness = createHookHarness(
        createBaseArgs({
          humanRequestChangesTask,
          sessionsForTask: [createSession({ sessionId: "session-build-existing" })],
        }),
      );

      await openFeedbackModal(harness);
      await updateFeedbackModal(harness, {
        target: "session-build-missing",
        message: "Apply the latest review feedback.",
      });
      await confirmFeedbackModal(harness);

      expect(toastErrorMock).toHaveBeenCalledWith(
        "The selected builder session is no longer available for this task.",
      );
      expect(humanRequestChangesTask).toHaveBeenCalledTimes(0);
      expect(harness.getLatest().humanReviewFeedbackModal?.open).toBe(true);

      await harness.unmount();
    });
  });
});

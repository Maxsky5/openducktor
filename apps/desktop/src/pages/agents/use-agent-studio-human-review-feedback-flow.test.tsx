import { afterAll, beforeAll, beforeEach, describe, expect, mock, test } from "bun:test";
import type { TaskCard } from "@openducktor/contracts";
import { NEW_BUILDER_SESSION_TARGET } from "@/features/human-review-feedback/human-review-feedback-state";
import type { NewSessionStartRequest } from "@/features/session-start";
import { restoreMockedModules } from "@/test-utils/mock-module-cleanup";
import {
  createAgentSessionFixture,
  createHookHarness as createSharedHookHarness,
  createTaskCardFixture,
  enableReactActEnvironment,
} from "./agent-studio-test-utils";

enableReactActEnvironment();

const toastErrorMock = mock(() => {});

type UseHumanReviewHook =
  typeof import("./use-agent-studio-human-review-feedback-flow")["useAgentStudioHumanReviewFeedbackFlow"];

let useAgentStudioHumanReviewFeedbackFlow: UseHumanReviewHook;

type HookArgs = Parameters<UseHumanReviewHook>[0];

const MODEL_SELECTION = {
  runtimeKind: "opencode" as const,
  providerId: "openai",
  modelId: "gpt-5",
  variant: "default",
  profileId: "builder",
};

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

beforeAll(async () => {
  mock.module("sonner", () => ({
    toast: {
      error: toastErrorMock,
    },
  }));
  ({ useAgentStudioHumanReviewFeedbackFlow } = await import(
    "./use-agent-studio-human-review-feedback-flow"
  ));
});

afterAll(async () => {
  await restoreMockedModules([["sonner", () => import("sonner")]]);
});

beforeEach(() => {
  toastErrorMock.mockClear();
});

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

    await harness.mount();
    await harness.run((state) => {
      state.openHumanReviewFeedback();
    });

    const modal = await waitForFeedbackModal(harness);

    expect(bootstrapTaskSessions).toHaveBeenCalledWith("task-1");
    expect(modal.selectedTarget).toBe("session-build-latest");
    expect(modal.targetOptions.map((option) => option.value)).toEqual([
      NEW_BUILDER_SESSION_TARGET,
      "session-build-latest",
      "session-build-older",
    ]);

    await harness.unmount();
  });

  test("opens the feedback modal after delayed builder-session hydration", async () => {
    const bootstrapTaskSessions = mock(async () => {});
    const harness = createHookHarness(
      createBaseArgs({
        bootstrapTaskSessions,
        sessionsForTask: [],
      }),
    );

    await harness.mount();
    await harness.run((state) => {
      state.openHumanReviewFeedback();
    });

    expect(harness.getLatest().humanReviewFeedbackModal).toBeNull();

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

  test("rejects blank feedback without starting or reusing a builder session", async () => {
    const humanRequestChangesTask = mock(async () => {});
    const executeRequestedSessionStart = mock(async () => undefined);
    const harness = createHookHarness(
      createBaseArgs({
        humanRequestChangesTask,
        executeRequestedSessionStart,
        sessionsForTask: [createSession({ sessionId: "session-build-existing" })],
      }),
    );

    await harness.mount();
    await harness.run((state) => {
      state.openHumanReviewFeedback();
    });
    await waitForFeedbackModal(harness);

    await harness.run((state) => {
      state.humanReviewFeedbackModal?.onMessageChange("   ");
    });
    await harness.run(async (state) => {
      await state.humanReviewFeedbackModal?.onConfirm();
    });

    expect(toastErrorMock).toHaveBeenCalledWith("Feedback message is required.");
    expect(humanRequestChangesTask).toHaveBeenCalledTimes(0);
    expect(executeRequestedSessionStart).toHaveBeenCalledTimes(0);
    expect(harness.getLatest().humanReviewFeedbackModal?.open).toBe(true);

    await harness.unmount();
  });

  test("reuses an existing builder session and surfaces partial follow-up failures", async () => {
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

    await harness.mount();
    await harness.run((state) => {
      state.openHumanReviewFeedback();
    });
    await waitForFeedbackModal(harness);

    await harness.run((state) => {
      state.humanReviewFeedbackModal?.onTargetChange("session-build-older");
      state.humanReviewFeedbackModal?.onMessageChange("  Apply the requested human changes.  ");
    });
    await harness.run(async (state) => {
      await state.humanReviewFeedbackModal?.onConfirm();
    });

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
    expect(updateCalls).toEqual([
      {
        task: "task-1",
        session: "session-build-older",
        agent: "build",
        scenario: undefined,
        autostart: undefined,
        start: undefined,
      },
    ]);
    expect(toastErrorMock).toHaveBeenCalledWith(
      "Changes requested, but refreshing Builder sessions failed.",
    );
    expect(toastErrorMock).toHaveBeenCalledWith("Changes requested, but feedback message failed.");
    expect(harness.getLatest().humanReviewFeedbackModal).toBeNull();

    await harness.unmount();
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
        selectedModel: MODEL_SELECTION,
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

    await harness.mount();
    await harness.run((state) => {
      state.openHumanReviewFeedback();
    });
    await waitForFeedbackModal(harness);

    await harness.run((state) => {
      state.humanReviewFeedbackModal?.onTargetChange(NEW_BUILDER_SESSION_TARGET);
      state.humanReviewFeedbackModal?.onMessageChange("  Ship the requested fixes.  ");
    });
    await harness.run(async (state) => {
      await state.humanReviewFeedbackModal?.onConfirm();
    });
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
      selectedModel: MODEL_SELECTION,
      startMode: "fresh",
    });
    expect(sendAgentMessage).toHaveBeenCalledWith("session-build-new", [
      { kind: "text", text: "Ship the requested fixes." },
    ]);
    expect(hydrateRequestedTaskSessionHistory).toHaveBeenCalledWith({
      taskId: "task-1",
      sessionId: "session-build-new",
    });
    expect(updateCalls).toEqual([
      {
        task: "task-1",
        session: "session-build-new",
        agent: "build",
        scenario: undefined,
        autostart: undefined,
        start: undefined,
      },
    ]);
    expect(harness.getLatest().humanReviewFeedbackModal).toBeNull();

    await harness.unmount();
  });

  test("rejects a stale selected builder target before requesting changes", async () => {
    const humanRequestChangesTask = mock(async () => {});
    const harness = createHookHarness(
      createBaseArgs({
        humanRequestChangesTask,
        sessionsForTask: [createSession({ sessionId: "session-build-existing" })],
      }),
    );

    await harness.mount();
    await harness.run((state) => {
      state.openHumanReviewFeedback();
    });
    await waitForFeedbackModal(harness);

    await harness.run((state) => {
      state.humanReviewFeedbackModal?.onTargetChange("session-build-missing");
      state.humanReviewFeedbackModal?.onMessageChange("Apply the latest review feedback.");
    });
    await harness.run(async (state) => {
      await state.humanReviewFeedbackModal?.onConfirm();
    });

    expect(toastErrorMock).toHaveBeenCalledWith(
      "The selected builder session is no longer available for this task.",
    );
    expect(humanRequestChangesTask).toHaveBeenCalledTimes(0);
    expect(harness.getLatest().humanReviewFeedbackModal?.open).toBe(true);

    await harness.unmount();
  });
});

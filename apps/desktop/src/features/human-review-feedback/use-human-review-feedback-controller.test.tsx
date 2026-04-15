import { describe, expect, mock, test } from "bun:test";
import {
  createAgentSessionFixture,
  enableReactActEnvironment,
} from "@/pages/agents/agent-studio-test-utils";
import { createHookHarness } from "@/test-utils/react-hook-harness";
import type { AgentSessionState } from "@/types/agent-orchestrator";
import type { PrepareHumanReviewFeedbackResult } from "./human-review-feedback-flow";
import { NEW_BUILDER_SESSION_TARGET } from "./human-review-feedback-state";
import type { HumanReviewFeedbackState } from "./human-review-feedback-types";
import { useHumanReviewFeedbackController } from "./use-human-review-feedback-controller";

enableReactActEnvironment();

type HookProps = {
  sessions: AgentSessionState[];
  openFeedback: (taskId: string) => Promise<PrepareHumanReviewFeedbackResult>;
  createState: (taskId: string) => HumanReviewFeedbackState;
};

const createBuilderSession = (overrides: Partial<AgentSessionState> = {}): AgentSessionState =>
  createAgentSessionFixture({
    role: "build",
    taskId: "TASK-1",
    scenario: "build_implementation_start",
    ...overrides,
  });

const createState = (
  overrides: Partial<HumanReviewFeedbackState> = {},
): HumanReviewFeedbackState => ({
  taskId: "TASK-1",
  scenario: "build_after_human_request_changes",
  message: "Apply the requested changes.",
  builderSessions: [],
  selectedTarget: NEW_BUILDER_SESSION_TARGET,
  ...overrides,
});

const createProps = (overrides: Partial<HookProps> = {}): HookProps => ({
  sessions: [],
  openFeedback: async () => ({
    kind: "ready",
    state: createState(),
  }),
  createState: () => createState(),
  ...overrides,
});

describe("useHumanReviewFeedbackController", () => {
  test("opens feedback immediately when preparation is ready", async () => {
    const harness = createHookHarness(useHumanReviewFeedbackController, createProps());

    await harness.mount();
    await harness.run((state) => {
      state.openHumanReviewFeedback("TASK-1");
    });

    expect(harness.getLatest().humanReviewFeedbackState).toEqual(createState());

    await harness.unmount();
  });

  test("adopts hydrated builder sessions when follow-up sessions change later", async () => {
    const initialSessions: AgentSessionState[] = [];
    const hydratedBuilderSession = createBuilderSession({ sessionId: "builder-session-1" });
    const createHydratedState = mock((taskId: string) =>
      createState({
        taskId,
        builderSessions: [hydratedBuilderSession],
        selectedTarget: "builder-session-1",
      }),
    );

    const harness = createHookHarness(
      useHumanReviewFeedbackController,
      createProps({
        sessions: initialSessions,
        openFeedback: async () => ({
          kind: "ready_with_followup",
          state: createState(),
          hydrationFollowup: {
            taskId: "TASK-1",
            baselineSessions: initialSessions,
          },
        }),
        createState: createHydratedState,
      }),
    );

    await harness.mount();
    await harness.run((state) => {
      state.openHumanReviewFeedback("TASK-1");
    });

    expect(harness.getLatest().humanReviewFeedbackState?.selectedTarget).toBe(
      NEW_BUILDER_SESSION_TARGET,
    );

    await harness.update(
      createProps({
        sessions: [hydratedBuilderSession],
        openFeedback: async () => ({
          kind: "ready_with_followup",
          state: createState(),
          hydrationFollowup: {
            taskId: "TASK-1",
            baselineSessions: initialSessions,
          },
        }),
        createState: createHydratedState,
      }),
    );

    expect(createHydratedState).toHaveBeenCalledWith("TASK-1");
    expect(harness.getLatest().humanReviewFeedbackState?.selectedTarget).toBe("builder-session-1");

    await harness.unmount();
  });

  test("preserves the typed draft message when hydration adopts builder sessions", async () => {
    const initialSessions: AgentSessionState[] = [];
    const hydratedBuilderSession = createBuilderSession({ sessionId: "builder-session-1" });
    const createHydratedState = mock((taskId: string) =>
      createState({
        taskId,
        message: "Reset by hydration",
        builderSessions: [hydratedBuilderSession],
        selectedTarget: "builder-session-1",
      }),
    );

    const harness = createHookHarness(
      useHumanReviewFeedbackController,
      createProps({
        sessions: initialSessions,
        openFeedback: async () => ({
          kind: "ready_with_followup",
          state: createState(),
          hydrationFollowup: {
            taskId: "TASK-1",
            baselineSessions: initialSessions,
          },
        }),
        createState: createHydratedState,
      }),
    );

    await harness.mount();
    await harness.run((state) => {
      state.openHumanReviewFeedback("TASK-1");
    });
    await harness.run((state) => {
      state.setHumanReviewFeedbackState((current) =>
        current ? { ...current, message: "Keep this draft." } : current,
      );
    });

    await harness.update(
      createProps({
        sessions: [hydratedBuilderSession],
        openFeedback: async () => ({
          kind: "ready_with_followup",
          state: createState(),
          hydrationFollowup: {
            taskId: "TASK-1",
            baselineSessions: initialSessions,
          },
        }),
        createState: createHydratedState,
      }),
    );

    expect(harness.getLatest().humanReviewFeedbackState?.message).toBe("Keep this draft.");
    expect(harness.getLatest().humanReviewFeedbackState?.selectedTarget).toBe("builder-session-1");

    await harness.unmount();
  });

  test("keeps the hydration follow-up active until relevant builder sessions appear", async () => {
    const initialSessions: AgentSessionState[] = [];
    const unrelatedQaSession = createAgentSessionFixture({
      sessionId: "qa-session-1",
      role: "qa",
      taskId: "TASK-2",
      scenario: "qa_review",
    });
    const hydratedBuilderSession = createBuilderSession({ sessionId: "builder-session-1" });
    const createHydratedState = mock((taskId: string) =>
      createState({
        taskId,
        builderSessions: currentSessions.some(
          (session) => session.sessionId === "builder-session-1",
        )
          ? [hydratedBuilderSession]
          : [],
        selectedTarget: currentSessions.some((session) => session.sessionId === "builder-session-1")
          ? "builder-session-1"
          : NEW_BUILDER_SESSION_TARGET,
      }),
    );
    let currentSessions: AgentSessionState[] = initialSessions;

    const harness = createHookHarness(
      useHumanReviewFeedbackController,
      createProps({
        sessions: currentSessions,
        openFeedback: async () => ({
          kind: "ready_with_followup",
          state: createState(),
          hydrationFollowup: {
            taskId: "TASK-1",
            baselineSessions: initialSessions,
          },
        }),
        createState: createHydratedState,
      }),
    );

    await harness.mount();
    await harness.run((state) => {
      state.openHumanReviewFeedback("TASK-1");
    });

    currentSessions = [unrelatedQaSession];
    await harness.update(
      createProps({
        sessions: currentSessions,
        openFeedback: async () => ({
          kind: "ready_with_followup",
          state: createState(),
          hydrationFollowup: {
            taskId: "TASK-1",
            baselineSessions: initialSessions,
          },
        }),
        createState: createHydratedState,
      }),
    );

    expect(harness.getLatest().humanReviewFeedbackState?.selectedTarget).toBe(
      NEW_BUILDER_SESSION_TARGET,
    );

    currentSessions = [unrelatedQaSession, hydratedBuilderSession];
    await harness.update(
      createProps({
        sessions: currentSessions,
        openFeedback: async () => ({
          kind: "ready_with_followup",
          state: createState(),
          hydrationFollowup: {
            taskId: "TASK-1",
            baselineSessions: initialSessions,
          },
        }),
        createState: createHydratedState,
      }),
    );

    expect(harness.getLatest().humanReviewFeedbackState?.selectedTarget).toBe("builder-session-1");

    await harness.unmount();
  });

  test("clears feedback state and pending follow-up together", async () => {
    const initialSessions: AgentSessionState[] = [];
    const createHydratedState = mock((taskId: string) => createState({ taskId }));

    const harness = createHookHarness(
      useHumanReviewFeedbackController,
      createProps({
        sessions: initialSessions,
        openFeedback: async () => ({
          kind: "ready_with_followup",
          state: createState(),
          hydrationFollowup: {
            taskId: "TASK-1",
            baselineSessions: initialSessions,
          },
        }),
        createState: createHydratedState,
      }),
    );

    await harness.mount();
    await harness.run((state) => {
      state.openHumanReviewFeedback("TASK-1");
    });
    await harness.run((state) => {
      state.clearHumanReviewFeedback();
    });

    await harness.update(
      createProps({
        sessions: [createBuilderSession({ sessionId: "builder-session-1" })],
        openFeedback: async () => ({
          kind: "ready_with_followup",
          state: createState(),
          hydrationFollowup: {
            taskId: "TASK-1",
            baselineSessions: initialSessions,
          },
        }),
        createState: createHydratedState,
      }),
    );

    expect(harness.getLatest().humanReviewFeedbackState).toBeNull();
    expect(createHydratedState).not.toHaveBeenCalled();

    await harness.unmount();
  });
});

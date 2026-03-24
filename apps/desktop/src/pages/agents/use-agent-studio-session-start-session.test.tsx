import { beforeEach, describe, expect, mock, test } from "bun:test";
import type { Dispatch, MutableRefObject, SetStateAction } from "react";
import {
  createDeferred,
  createHookHarness as createSharedHookHarness,
  createTaskCardFixture,
  enableReactActEnvironment,
} from "./agent-studio-test-utils";
import { useAgentStudioSessionStartSession } from "./use-agent-studio-session-start-session";

enableReactActEnvironment();

type HookArgs = Parameters<typeof useAgentStudioSessionStartSession>[0];

const createHookHarness = (initialProps: HookArgs) =>
  createSharedHookHarness(useAgentStudioSessionStartSession, initialProps);

const createSetStartingActivityCountByContext = (): Dispatch<
  SetStateAction<Record<string, number>>
> => {
  let current: Record<string, number> = {};
  return (update) => {
    current = typeof update === "function" ? update(current) : update;
  };
};

const createBaseArgs = (overrides: Partial<HookArgs> = {}): HookArgs => ({
  activeRepo: "/repo",
  taskId: "task-1",
  role: "spec",
  scenario: "spec_initial",
  activeSession: null,
  selectedTask: createTaskCardFixture(),
  agentStudioReady: true,
  isActiveTaskHydrated: true,
  startAgentSession: async () => "session-new",
  updateAgentSessionModel: () => {},
  setStartingActivityCountByContext: createSetStartingActivityCountByContext(),
  startingSessionByTaskRef: {
    current: new Map<string, Promise<string | undefined>>(),
  } satisfies MutableRefObject<Map<string, Promise<string | undefined>>>,
  updateQuery: () => {},
  resolveRequestedDecision: async () => null,
  ...overrides,
});

describe("useAgentStudioSessionStartSession", () => {
  beforeEach(() => {
    // no-op placeholder to keep test structure consistent with other hook suites
  });

  test("scopes in-flight starts by task, role, and scenario", async () => {
    const specSelection = createDeferred<{
      selectedModel: null;
      startMode: "fresh";
      sourceSessionId: null;
    } | null>();
    const plannerSelection = createDeferred<{
      selectedModel: null;
      startMode: "fresh";
      sourceSessionId: null;
    } | null>();
    const resolveRequestedDecision = mock(async (request: { role: string }) =>
      request.role === "spec" ? specSelection.promise : plannerSelection.promise,
    );
    const startAgentSession = mock(async (request: { role: string }) => `${request.role}-session`);
    const startingSessionByTaskRef: MutableRefObject<Map<string, Promise<string | undefined>>> = {
      current: new Map<string, Promise<string | undefined>>(),
    };

    const harness = createHookHarness(
      createBaseArgs({
        startAgentSession,
        resolveRequestedDecision,
        startingSessionByTaskRef,
      }),
    );

    await harness.mount();

    let specStartPromise: Promise<string | undefined> | undefined;
    await harness.run((state) => {
      specStartPromise = state.startSession("composer_send");
    });

    await harness.update(
      createBaseArgs({
        role: "planner",
        scenario: "planner_initial",
        startAgentSession,
        resolveRequestedDecision,
        startingSessionByTaskRef,
      }),
    );

    let plannerStartPromise: Promise<string | undefined> | undefined;
    await harness.run((state) => {
      plannerStartPromise = state.startSession("composer_send");
    });

    expect(resolveRequestedDecision).toHaveBeenCalledTimes(2);
    expect(startingSessionByTaskRef.current.size).toBe(2);
    expect(specStartPromise).not.toBe(plannerStartPromise);

    specSelection.resolve({
      selectedModel: null,
      startMode: "fresh",
      sourceSessionId: null,
    });
    plannerSelection.resolve({
      selectedModel: null,
      startMode: "fresh",
      sourceSessionId: null,
    });

    await expect(specStartPromise).resolves.toBe("spec-session");
    await expect(plannerStartPromise).resolves.toBe("planner-session");
    expect(startAgentSession).toHaveBeenCalledTimes(2);

    await harness.unmount();
  });

  test("wraps QA builder-context resolution failures with session-start context", async () => {
    const resolveRequestedDecision = mock(async () => ({
      selectedModel: null,
      startMode: "fresh" as const,
      sourceSessionId: null,
    }));
    const startAgentSession = mock(async () => "session-new");

    const harness = createHookHarness(
      createBaseArgs({
        activeRepo: null,
        role: "qa",
        scenario: "qa_review",
        selectedTask: createTaskCardFixture({
          agentWorkflows: {
            spec: { required: false, canSkip: true, available: true, completed: true },
            planner: { required: false, canSkip: true, available: true, completed: true },
            builder: { required: true, canSkip: false, available: true, completed: true },
            qa: { required: true, canSkip: false, available: true, completed: false },
          },
        }),
        resolveRequestedDecision,
        startAgentSession,
      }),
    );

    await harness.mount();

    let startError: unknown = null;
    await harness.run(async (state) => {
      try {
        await state.startSession("composer_send");
      } catch (error) {
        startError = error;
      }
    });

    expect(startError).toBeInstanceOf(Error);
    expect((startError as Error).message).toBe(
      "Failed to resolve QA builder context for qa qa_review on task-1: No active repository selected.",
    );
    expect(startAgentSession).not.toHaveBeenCalled();

    await harness.unmount();
  });

  test("does not overwrite selected model when reusing an existing session", async () => {
    const updateAgentSessionModel = mock(() => {});
    const updateQuery = mock(() => {});
    const startAgentSession = mock(async () => "session-new");
    const harness = createHookHarness(
      createBaseArgs({
        startAgentSession,
        updateAgentSessionModel,
        updateQuery,
        resolveRequestedDecision: async () => ({
          selectedModel: {
            runtimeKind: "opencode",
            providerId: "openai",
            modelId: "gpt-5",
            variant: "high",
            profileId: "Hephaestus",
          },
          startMode: "reuse",
          sourceSessionId: "session-existing",
        }),
      }),
    );

    await harness.mount();
    await harness.run(async (state) => {
      await state.startSession("composer_send");
    });

    expect(startAgentSession).not.toHaveBeenCalled();
    expect(updateAgentSessionModel).not.toHaveBeenCalled();
    expect(updateQuery).toHaveBeenCalledWith(
      expect.objectContaining({
        task: "task-1",
        session: "session-existing",
        agent: "spec",
      }),
    );

    await harness.unmount();
  });
});

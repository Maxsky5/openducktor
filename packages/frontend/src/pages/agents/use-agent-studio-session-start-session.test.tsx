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

const MODEL_SELECTION = {
  runtimeKind: "opencode" as const,
  providerId: "openai",
  modelId: "gpt-5",
  variant: "default",
  profileId: "spec",
};

const createBaseArgs = (overrides: Partial<HookArgs> = {}): HookArgs => ({
  activeWorkspace: {
    repoPath: "/repo",
    workspaceId: "workspace-1",
    workspaceName: "Active Workspace",
  },
  taskId: "task-1",
  role: "spec",
  scenario: "spec_initial",
  activeSession: null,
  selectedTask: createTaskCardFixture(),
  agentStudioReady: true,
  isActiveTaskHydrated: true,
  startAgentSession: async () => "session-new",
  sendAgentMessage: async () => {},
  setStartingActivityCountByContext: createSetStartingActivityCountByContext(),
  startingSessionByTaskRef: {
    current: new Map<string, Promise<string | undefined>>(),
  } satisfies MutableRefObject<Map<string, Promise<string | undefined>>>,
  updateQuery: () => {},
  executeRequestedSessionStart: async () => undefined,
  ...overrides,
});

describe("useAgentStudioSessionStartSession", () => {
  beforeEach(() => {
    // no-op placeholder to keep test structure consistent with other hook suites
  });

  test("scopes in-flight starts by task, role, and scenario", async () => {
    const specSelection = createDeferred<{
      selectedModel: typeof MODEL_SELECTION;
      startMode: "fresh";
    } | null>();
    const plannerSelection = createDeferred<{
      selectedModel: typeof MODEL_SELECTION;
      startMode: "fresh";
    } | null>();
    const executeRequestedSessionStart: HookArgs["executeRequestedSessionStart"] = mock(
      async (request, executeWithDecision) => {
        const decision =
          request.role === "spec" ? await specSelection.promise : await plannerSelection.promise;
        return decision ? executeWithDecision(decision) : undefined;
      },
    );
    const startAgentSession = mock(async (request: { role: string }) => `${request.role}-session`);
    const startingSessionByTaskRef: MutableRefObject<Map<string, Promise<string | undefined>>> = {
      current: new Map<string, Promise<string | undefined>>(),
    };

    const harness = createHookHarness(
      createBaseArgs({
        startAgentSession,
        executeRequestedSessionStart,
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
        executeRequestedSessionStart,
        startingSessionByTaskRef,
      }),
    );

    let plannerStartPromise: Promise<string | undefined> | undefined;
    await harness.run((state) => {
      plannerStartPromise = state.startSession("composer_send");
    });

    expect(executeRequestedSessionStart).toHaveBeenCalledTimes(2);
    expect(startingSessionByTaskRef.current.size).toBe(2);
    expect(specStartPromise).not.toBe(plannerStartPromise);

    specSelection.resolve({
      selectedModel: MODEL_SELECTION,
      startMode: "fresh",
    });
    plannerSelection.resolve({
      selectedModel: MODEL_SELECTION,
      startMode: "fresh",
    });

    await expect(specStartPromise).resolves.toBe("spec-session");
    await expect(plannerStartPromise).resolves.toBe("planner-session");
    expect(startAgentSession).toHaveBeenCalledTimes(2);

    await harness.unmount();
  });

  test("delegates QA starts to the orchestrator without repo preflight in the hook", async () => {
    const executeRequestedSessionStart: HookArgs["executeRequestedSessionStart"] = mock(
      async (_request, executeWithDecision) =>
        executeWithDecision({
          selectedModel: MODEL_SELECTION,
          startMode: "fresh" as const,
        }),
    );
    const startAgentSession = mock(async () => "session-new");

    const harness = createHookHarness(
      createBaseArgs({
        activeWorkspace: null,
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
        executeRequestedSessionStart,
        startAgentSession,
      }),
    );

    await harness.mount();

    let sessionId: string | undefined;
    await harness.run(async (state) => {
      sessionId = await state.startSession("composer_send");
    });

    expect(sessionId).toBe("session-new");
    expect(startAgentSession).toHaveBeenCalledWith(
      expect.objectContaining({
        role: "qa",
        scenario: "qa_review",
        startMode: "fresh",
        selectedModel: MODEL_SELECTION,
      }),
    );

    await harness.unmount();
  });

  test("does not overwrite selected model when reusing an existing session", async () => {
    const updateQuery = mock(() => {});
    const startAgentSession = mock(
      async (input: { startMode: string; sourceSessionId?: string }) =>
        input.startMode === "reuse" ? (input.sourceSessionId ?? "session-existing") : "session-new",
    );
    const harness = createHookHarness(
      createBaseArgs({
        startAgentSession,
        updateQuery,
        executeRequestedSessionStart: async (_request, executeWithDecision) =>
          executeWithDecision({
            startMode: "reuse",
            sourceSessionId: "session-existing",
          }),
      }),
    );

    await harness.mount();
    await harness.run(async (state) => {
      await state.startSession("composer_send");
    });

    expect(startAgentSession).toHaveBeenCalledWith(
      expect.objectContaining({
        taskId: "task-1",
        role: "spec",
        scenario: "spec_initial",
        startMode: "reuse",
        sourceSessionId: "session-existing",
      }),
    );
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

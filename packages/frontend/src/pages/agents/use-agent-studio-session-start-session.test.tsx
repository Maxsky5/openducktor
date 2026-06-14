import { beforeEach, describe, expect, mock, test } from "bun:test";
import type { Dispatch, SetStateAction } from "react";
import type { SessionStartWorkflowResult } from "@/features/session-start";
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

const sessionIdentity = (externalSessionId: string) => ({
  externalSessionId,
  runtimeKind: "opencode" as const,
  workingDirectory: `/repo/worktrees/${externalSessionId}`,
});

const createBaseArgs = (overrides: Partial<HookArgs> = {}): HookArgs => ({
  activeWorkspace: {
    repoPath: "/repo",
    workspaceId: "workspace-1",
    workspaceName: "Active Workspace",
  },
  taskId: "task-1",
  role: "spec",
  launchActionId: "spec_initial",
  activeSession: null,
  selectedTask: createTaskCardFixture(),
  agentStudioReady: true,
  isActiveTaskReady: true,
  startAgentSession: async () => sessionIdentity("session-new"),
  settleStartedAgentSession: () => {},
  sendAgentMessage: async () => {},
  setStartingActivityCountByContext: createSetStartingActivityCountByContext(),
  startingSessionByTask: new Map<string, Promise<SessionStartWorkflowResult | undefined>>(),
  updateQuery: () => {},
  executeRequestedSessionStart: async () => undefined,
  ...overrides,
});

describe("useAgentStudioSessionStartSession", () => {
  beforeEach(() => {
    // no-op placeholder to keep test structure consistent with other hook suites
  });

  test("scopes in-flight starts by task, role, and launch action", async () => {
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
    const startAgentSession = mock(async (request: { role: string }) =>
      sessionIdentity(`${request.role}-session`),
    );
    const startingSessionByTask = new Map<
      string,
      Promise<SessionStartWorkflowResult | undefined>
    >();

    const harness = createHookHarness(
      createBaseArgs({
        startAgentSession,
        executeRequestedSessionStart,
        startingSessionByTask,
      }),
    );

    await harness.mount();

    let specStartPromise: Promise<SessionStartWorkflowResult | undefined> | undefined;
    await harness.run((state) => {
      specStartPromise = state.startSession();
    });

    await harness.update(
      createBaseArgs({
        role: "planner",
        startAgentSession,
        executeRequestedSessionStart,
        startingSessionByTask,
      }),
    );

    let plannerStartPromise: Promise<SessionStartWorkflowResult | undefined> | undefined;
    await harness.run((state) => {
      plannerStartPromise = state.startSession();
    });

    expect(executeRequestedSessionStart).toHaveBeenCalledTimes(2);
    expect(startingSessionByTask.size).toBe(2);
    expect(specStartPromise).not.toBe(plannerStartPromise);

    specSelection.resolve({
      selectedModel: MODEL_SELECTION,
      startMode: "fresh",
    });
    plannerSelection.resolve({
      selectedModel: MODEL_SELECTION,
      startMode: "fresh",
    });

    await expect(specStartPromise).resolves.toMatchObject({ externalSessionId: "spec-session" });
    await expect(plannerStartPromise).resolves.toMatchObject({
      externalSessionId: "planner-session",
    });
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
    const startAgentSession = mock(async () => sessionIdentity("session-new"));

    const harness = createHookHarness(
      createBaseArgs({
        activeWorkspace: null,
        role: "qa",
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

    let externalSessionId: string | undefined;
    await harness.run(async (state) => {
      externalSessionId = (await state.startSession())?.externalSessionId;
    });

    expect(externalSessionId).toBe("session-new");
    expect(startAgentSession).toHaveBeenCalledWith(
      expect.objectContaining({
        role: "qa",
        startMode: "fresh",
        selectedModel: MODEL_SELECTION,
      }),
    );

    await harness.unmount();
  });

  test("does not overwrite selected model when reusing an existing session", async () => {
    const updateQuery = mock(() => {});
    const startAgentSession = mock(
      async (input: { startMode: string; sourceSession?: { externalSessionId: string } }) =>
        sessionIdentity(
          input.startMode === "reuse"
            ? (input.sourceSession?.externalSessionId ?? "session-existing")
            : "session-new",
        ),
    );
    const harness = createHookHarness(
      createBaseArgs({
        startAgentSession,
        updateQuery,
        executeRequestedSessionStart: async (_request, executeWithDecision) =>
          executeWithDecision({
            startMode: "reuse",
            sourceSession: {
              externalSessionId: "session-existing",
              runtimeKind: "opencode",
              workingDirectory: "/repo/worktree",
            },
          }),
      }),
    );

    await harness.mount();
    await harness.run(async (state) => {
      await state.startSession();
    });

    expect(startAgentSession).toHaveBeenCalledWith(
      expect.objectContaining({
        taskId: "task-1",
        role: "spec",
        startMode: "reuse",
        sourceSession: {
          externalSessionId: "session-existing",
          runtimeKind: "opencode",
          workingDirectory: "/repo/worktree",
        },
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

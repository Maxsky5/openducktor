import { describe, expect, mock, test } from "bun:test";
import {
  createAgentSessionFixture,
  createHookHarness as createSharedHookHarness,
  createTaskCardFixture,
  enableReactActEnvironment,
} from "./agent-studio-test-utils";
import { useAgentStudioRebaseConflictResolution } from "./use-agent-studio-rebase-conflict-resolution";

enableReactActEnvironment();

type HookArgs = Parameters<typeof useAgentStudioRebaseConflictResolution>[0];

const createHookHarness = (initialProps: HookArgs) =>
  createSharedHookHarness(useAgentStudioRebaseConflictResolution, initialProps);

const buildSession = (overrides: Partial<ReturnType<typeof createAgentSessionFixture>> = {}) =>
  createAgentSessionFixture({
    runtimeKind: "opencode",
    taskId: "task-1",
    role: "build",
    scenario: "build_implementation_start",
    status: "running",
    ...overrides,
  });

const createConflict = (overrides: Record<string, unknown> = {}) => ({
  operation: "rebase" as const,
  currentBranch: "feature/task-1",
  targetBranch: "origin/main",
  conflictedFiles: ["src/conflict.ts"],
  output: "CONFLICT (content): Merge conflict in src/conflict.ts",
  workingDir: "/repo/worktrees/task-1",
  ...overrides,
});

const createBaseArgs = (overrides: Partial<HookArgs> = {}): HookArgs => {
  const builderSession = buildSession({
    sessionId: "build-1",
    workingDirectory: "/repo/worktrees/task-1",
    selectedModel: {
      runtimeKind: "opencode",
      providerId: "openai",
      modelId: "gpt-5",
    },
  });
  const plannerSession = createAgentSessionFixture({
    runtimeKind: "opencode",
    sessionId: "planner-1",
    taskId: "task-1",
    role: "planner",
    scenario: "planner_initial",
    status: "running",
  });

  return {
    activeRepo: "/repo",
    selection: {
      viewTaskId: "task-1",
      viewSelectedTask: createTaskCardFixture({
        id: "task-1",
        title: "Resolve rebase conflict",
        description: "Fix the branch divergence.",
      }),
      viewActiveSession: plannerSession,
      activeSession: plannerSession,
      selectedSessionById: null,
      viewSessionsForTask: [builderSession],
      sessionsForTask: [builderSession],
    },
    scheduleQueryUpdate: mock(() => {}),
    onContextSwitchIntent: mock(() => {}),
    startSessionRequest: mock(async () => "build-new-1"),
    loadPromptOverrides: mock(async () => ({})),
    ...overrides,
  };
};

describe("useAgentStudioRebaseConflictResolution", () => {
  test("routes conflict resolution through the shared session-start request", async () => {
    const args = createBaseArgs({
      startSessionRequest: mock(async () => "build-1"),
    });
    const harness = createHookHarness(args);

    try {
      await harness.mount();

      const resolved = await harness.getLatest().handleResolveRebaseConflict(createConflict());

      expect(resolved).toBe(true);
      expect(args.startSessionRequest).toHaveBeenCalledWith(
        expect.objectContaining({
          taskId: "task-1",
          role: "build",
          scenario: "build_rebase_conflict_resolution",
          reason: "rebase_conflict_resolution",
          postStartAction: "send_message",
          initialStartMode: "reuse",
          initialSourceSessionId: "build-1",
        }),
      );
      expect(args.scheduleQueryUpdate).toHaveBeenCalledWith({
        task: "task-1",
        session: "build-1",
        agent: "build",
      });
      expect(args.onContextSwitchIntent).toHaveBeenCalledTimes(1);
    } finally {
      await harness.unmount();
    }
  });

  test("filters reusable Builder sessions to the conflicted worktree", async () => {
    const matchingBuilderSession = buildSession({
      sessionId: "build-1",
      workingDirectory: "/repo/worktrees/task-1",
    });
    const otherBuilderSession = buildSession({
      sessionId: "build-other",
      workingDirectory: "/repo/worktrees/other",
    });
    const args = createBaseArgs({
      selection: {
        ...createBaseArgs().selection,
        viewSessionsForTask: [matchingBuilderSession, otherBuilderSession],
        sessionsForTask: [matchingBuilderSession, otherBuilderSession],
      },
      startSessionRequest: mock(async () => "build-1"),
    });
    const harness = createHookHarness(args);

    try {
      await harness.mount();

      const resolved = await harness.getLatest().handleResolveRebaseConflict(createConflict());

      expect(resolved).toBe(true);
      expect(args.startSessionRequest).toHaveBeenCalledWith(
        expect.objectContaining({
          existingSessionOptions: [expect.objectContaining({ value: "build-1" })],
          initialSourceSessionId: "build-1",
        }),
      );
    } finally {
      await harness.unmount();
    }
  });

  test("does not require an existing selected model to request a new conflict session", async () => {
    const args = createBaseArgs({
      selection: {
        ...createBaseArgs().selection,
        viewSessionsForTask: [
          buildSession({
            sessionId: "build-1",
            workingDirectory: "/repo/worktrees/task-1",
            selectedModel: null,
          }),
        ],
        sessionsForTask: [
          buildSession({
            sessionId: "build-1",
            workingDirectory: "/repo/worktrees/task-1",
            selectedModel: null,
          }),
        ],
      },
      startSessionRequest: mock(async () => "build-new-9"),
    });
    const harness = createHookHarness(args);

    try {
      await harness.mount();

      const resolved = await harness
        .getLatest()
        .handleResolveRebaseConflict(createConflict({ workingDir: undefined }));

      expect(resolved).toBe(true);
      expect(args.startSessionRequest).toHaveBeenCalledWith(
        expect.objectContaining({
          scenario: "build_rebase_conflict_resolution",
          initialStartMode: "reuse",
          initialSourceSessionId: "build-1",
        }),
      );
      expect(args.scheduleQueryUpdate).toHaveBeenCalledWith({
        task: "task-1",
        session: "build-new-9",
        agent: "build",
      });
    } finally {
      await harness.unmount();
    }
  });

  test("returns false when the shared session-start flow is cancelled", async () => {
    const args = createBaseArgs({
      startSessionRequest: mock(async () => undefined),
    });
    const harness = createHookHarness(args);

    try {
      await harness.mount();

      const resolved = await harness.getLatest().handleResolveRebaseConflict(createConflict());

      expect(resolved).toBe(false);
      expect(args.scheduleQueryUpdate).toHaveBeenCalledTimes(0);
      expect(args.onContextSwitchIntent).toHaveBeenCalledTimes(0);
    } finally {
      await harness.unmount();
    }
  });
});

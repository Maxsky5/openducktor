import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { BUILD_REBASE_CONFLICT_RESOLUTION_SCENARIO } from "@/features/git-conflict-resolution";
import { host } from "@/state/operations/shared/host";
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
    startAgentSession: mock(async () => "build-new-1"),
    sendAgentMessage: mock(async () => {}),
    loadPromptOverrides: mock(async () => ({})),
    ...overrides,
  };
};

describe("useAgentStudioRebaseConflictResolution", () => {
  const originalBuildContinuationTargetGet = host.buildContinuationTargetGet;

  beforeEach(() => {
    host.buildContinuationTargetGet = async () => ({
      workingDirectory: "/repo/worktrees/task-1",
      source: "builder_session",
    });
  });

  afterEach(() => {
    host.buildContinuationTargetGet = originalBuildContinuationTargetGet;
  });

  test("routes conflict resolution to an existing Builder session", async () => {
    const args = createBaseArgs();
    const harness = createHookHarness(args);

    try {
      await harness.mount();

      let resolved = false;
      await harness.run((state) => {
        void state.handleResolveRebaseConflict(createConflict()).then((result) => {
          resolved = result;
        });
      });

      await harness.waitFor((state) => state.pendingRebaseConflictResolutionRequest !== null);
      expect(harness.getLatest().pendingRebaseConflictResolutionRequest?.defaultSessionId).toBe(
        "build-1",
      );
      expect(harness.getLatest().pendingRebaseConflictResolutionRequest?.requestId).toBe(
        "git-conflict-0",
      );

      await harness.run((state) => {
        state.resolvePendingRebaseConflictResolution({
          mode: "existing",
          sessionId: "build-1",
        });
      });

      await harness.waitFor((_state) => resolved === true);
      expect(args.scheduleQueryUpdate).toHaveBeenCalledWith({
        task: "task-1",
        session: "build-1",
        agent: "build",
      });
      expect(args.onContextSwitchIntent).toHaveBeenCalledTimes(1);
      expect(args.startAgentSession).toHaveBeenCalledTimes(0);
      expect(args.sendAgentMessage).toHaveBeenCalledTimes(1);
      expect(args.sendAgentMessage).toHaveBeenCalledWith(
        "build-1",
        expect.stringContaining("task-1"),
      );
    } finally {
      await harness.unmount();
    }
  });

  test("starts a new Builder session when the user selects a new conflict workflow", async () => {
    const args = createBaseArgs({
      startAgentSession: mock(async () => "build-new-9"),
    });
    const harness = createHookHarness(args);

    try {
      await harness.mount();

      let resolved = false;
      await harness.run((state) => {
        void state.handleResolveRebaseConflict(createConflict()).then((result) => {
          resolved = result;
        });
      });

      await harness.waitFor((state) => state.pendingRebaseConflictResolutionRequest !== null);
      expect(harness.getLatest().pendingRebaseConflictResolutionRequest?.requestId).toBe(
        "git-conflict-0",
      );

      await harness.run((state) => {
        state.resolvePendingRebaseConflictResolution({ mode: "new" });
      });

      await harness.waitFor((_state) => resolved === true);
      expect(args.startAgentSession).toHaveBeenCalledWith({
        taskId: "task-1",
        role: "build",
        scenario: BUILD_REBASE_CONFLICT_RESOLUTION_SCENARIO,
        selectedModel: {
          runtimeKind: "opencode",
          providerId: "openai",
          modelId: "gpt-5",
        },
        startMode: "fresh",
      });
      expect(args.scheduleQueryUpdate).toHaveBeenCalledWith({
        task: "task-1",
        session: "build-new-9",
        agent: "build",
      });
      expect(args.onContextSwitchIntent).toHaveBeenCalledTimes(1);
      expect(args.sendAgentMessage).toHaveBeenCalledWith(
        "build-new-9",
        expect.stringContaining("task-1"),
      );
    } finally {
      await harness.unmount();
    }
  });

  test("returns false without starting work when the conflict dialog is cancelled", async () => {
    const args = createBaseArgs();
    const harness = createHookHarness(args);

    try {
      await harness.mount();

      let resolution: boolean | null = null;
      await harness.run((state) => {
        void state.handleResolveRebaseConflict(createConflict()).then((result) => {
          resolution = result;
        });
      });

      await harness.waitFor((state) => state.pendingRebaseConflictResolutionRequest !== null);
      expect(harness.getLatest().pendingRebaseConflictResolutionRequest?.requestId).toBe(
        "git-conflict-0",
      );
      await harness.run((state) => {
        state.resolvePendingRebaseConflictResolution(null);
      });

      await harness.waitFor((_state) => resolution !== null);
      if (resolution === null) {
        throw new Error("Expected cancellation resolution");
      }
      expect(resolution === false).toBe(true);
      expect(args.startAgentSession).toHaveBeenCalledTimes(0);
      expect(args.sendAgentMessage).toHaveBeenCalledTimes(0);
      expect(args.scheduleQueryUpdate).toHaveBeenCalledTimes(0);
    } finally {
      await harness.unmount();
    }
  });

  test("does not require a paused worktree to start a new builder conflict session", async () => {
    const args = createBaseArgs();
    const harness = createHookHarness(args);

    try {
      await harness.mount();

      let resolved = false;
      await harness.run((state) => {
        void state
          .handleResolveRebaseConflict(
            createConflict({
              workingDir: undefined,
            }),
          )
          .then((result) => {
            resolved = result;
          });
      });

      await harness.waitFor((state) => state.pendingRebaseConflictResolutionRequest !== null);
      await harness.run((state) => {
        state.resolvePendingRebaseConflictResolution({ mode: "new" });
      });

      await harness.waitFor((_state) => resolved === true);
      expect(args.startAgentSession).toHaveBeenCalledTimes(1);
      expect(args.sendAgentMessage).toHaveBeenCalledTimes(1);
    } finally {
      await harness.unmount();
    }
  });

  test("propagates Builder message delivery failures", async () => {
    const args = createBaseArgs({
      sendAgentMessage: mock(async () => {
        throw new Error("message delivery failed");
      }),
    });
    const harness = createHookHarness(args);

    try {
      await harness.mount();

      let rejectionMessage: string | null = null;
      await harness.run((state) => {
        void state.handleResolveRebaseConflict(createConflict()).catch((error) => {
          rejectionMessage = (error as Error).message;
        });
      });

      await harness.waitFor((state) => state.pendingRebaseConflictResolutionRequest !== null);
      await harness.run((state) => {
        state.resolvePendingRebaseConflictResolution({
          mode: "existing",
          sessionId: "build-1",
        });
      });

      await harness.waitFor((_state) => rejectionMessage !== null);
      if (rejectionMessage === null) {
        throw new Error("Expected conflict-resolution message delivery failure");
      }
      const message = String(rejectionMessage);
      expect(message.includes("Failed to send Builder conflict resolution request")).toBe(true);
    } finally {
      await harness.unmount();
    }
  });
});

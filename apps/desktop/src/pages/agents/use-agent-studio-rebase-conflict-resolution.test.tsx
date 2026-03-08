import { beforeAll, beforeEach, describe, expect, mock, test } from "bun:test";
import {
  createAgentSessionFixture,
  createHookHarness as createSharedHookHarness,
  createTaskCardFixture,
  enableReactActEnvironment,
} from "./agent-studio-test-utils";

enableReactActEnvironment();

const loadEffectivePromptOverridesMock = mock(async () => ({}));
const toastErrorMock = mock(() => {});

mock.module("../../state/operations/prompt-overrides", () => ({
  loadEffectivePromptOverrides: loadEffectivePromptOverridesMock,
}));

mock.module("sonner", () => ({
  toast: {
    error: toastErrorMock,
  },
}));

type UseAgentStudioRebaseConflictResolutionHook =
  typeof import("./use-agent-studio-rebase-conflict-resolution")["useAgentStudioRebaseConflictResolution"];

let useAgentStudioRebaseConflictResolution: UseAgentStudioRebaseConflictResolutionHook;

type HookArgs = Parameters<UseAgentStudioRebaseConflictResolutionHook>[0];

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
    ...overrides,
  };
};

beforeAll(async () => {
  ({ useAgentStudioRebaseConflictResolution } = await import(
    "./use-agent-studio-rebase-conflict-resolution"
  ));
});

beforeEach(() => {
  loadEffectivePromptOverridesMock.mockClear();
  toastErrorMock.mockClear();
  loadEffectivePromptOverridesMock.mockImplementation(async () => ({}));
});

describe("useAgentStudioRebaseConflictResolution", () => {
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

      await harness.run((state) => {
        state.resolvePendingRebaseConflictResolution({ mode: "new" });
      });

      await harness.waitFor((_state) => resolved === true);
      expect(args.startAgentSession).toHaveBeenCalledWith({
        taskId: "task-1",
        role: "build",
        scenario: "build_rebase_conflict_resolution",
        selectedModel: {
          runtimeKind: "opencode",
          providerId: "openai",
          modelId: "gpt-5",
        },
        sendKickoff: false,
        startMode: "fresh",
        requireModelReady: true,
        workingDirectoryOverride: "/repo/worktrees/task-1",
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
});

import { describe, expect, mock, test } from "bun:test";
import { agentSessionIdentityKey, toAgentSessionIdentity } from "@/lib/agent-session-identity";
import {
  createAgentSessionFixture,
  createAgentSessionSummaryFixture,
  createHookHarness as createSharedHookHarness,
  createTaskCardFixture,
  enableReactActEnvironment,
} from "./agent-studio-test-utils";
import { useAgentStudioRebaseConflictResolution } from "./use-agent-studio-rebase-conflict-resolution";

enableReactActEnvironment();

type HookArgs = Parameters<typeof useAgentStudioRebaseConflictResolution>[0];

const createHookHarness = (initialProps: HookArgs) =>
  createSharedHookHarness(useAgentStudioRebaseConflictResolution, initialProps);

const sessionWorkflowResult = (externalSessionId: string) => ({
  externalSessionId,
  runtimeKind: "opencode" as const,
  workingDirectory: `/repo/worktrees/${externalSessionId}`,
  postStartActionError: null,
});

const buildSession = (overrides: Parameters<typeof createAgentSessionSummaryFixture>[0] = {}) =>
  createAgentSessionSummaryFixture({
    runtimeKind: "opencode",
    taskId: "task-1",
    role: "build",
    status: "running",
    ...overrides,
  });

const createSelectedSession = (
  overrides: Partial<HookArgs["selection"]["view"]["selectedSession"]> = {},
): HookArgs["selection"]["view"]["selectedSession"] => ({
  identity: null,
  activityState: null,
  selectedModel: null,
  loadedSession: null,
  runtimeData: {
    modelCatalog: null,
    todos: [],
    isLoadingModelCatalog: false,
    error: null,
  },
  runtimeReadiness: {
    state: "ready",
    message: null,
    isLoadingChecks: false,
    refreshChecks: async () => {},
  },
  transcriptState: { kind: "visible" },
  sessionAuxiliaryError: null,
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
    externalSessionId: "build-1",
    workingDirectory: "/repo/worktrees/task-1",
    selectedModel: {
      runtimeKind: "opencode",
      providerId: "openai",
      modelId: "gpt-5",
    },
  });
  const plannerSession = createAgentSessionSummaryFixture({
    runtimeKind: "opencode",
    externalSessionId: "planner-1",
    taskId: "task-1",
    role: "planner",
    status: "running",
  });

  return {
    workspaceId: "workspace-repo",
    selection: {
      view: {
        taskId: "task-1",
        role: "planner",
        selectedTask: createTaskCardFixture({
          id: "task-1",
          title: "Resolve rebase conflict",
          description: "Fix the branch divergence.",
        }),
        selectedSession: createSelectedSession({
          identity: toAgentSessionIdentity(plannerSession),
        }),
        sessionsForTask: [builderSession],
      },
    },
    scheduleQueryUpdate: mock(() => {}),
    startSessionRequest: mock(async () => sessionWorkflowResult("build-new-1")),
    loadPromptOverrides: mock(async () => ({})),
    ...overrides,
  };
};

describe("useAgentStudioRebaseConflictResolution", () => {
  test("routes conflict resolution through the shared session-start request", async () => {
    const args = createBaseArgs({
      startSessionRequest: mock(async () => sessionWorkflowResult("build-1")),
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
          postStartAction: "send_message",
          initialStartMode: "reuse",
          initialSourceSession: {
            externalSessionId: "build-1",
            runtimeKind: "opencode",
            workingDirectory: "/repo/worktrees/task-1",
          },
        }),
      );
      expect(args.scheduleQueryUpdate).toHaveBeenCalledWith({
        task: "task-1",
        session: "build-1",
        agent: "build",
      });
    } finally {
      await harness.unmount();
    }
  });

  test("filters reusable Builder sessions to the conflicted worktree", async () => {
    const matchingBuilderSession = buildSession({
      externalSessionId: "build-1",
      workingDirectory: "/repo/worktrees/task-1",
    });
    const otherBuilderSession = buildSession({
      externalSessionId: "build-other",
      workingDirectory: "/repo/worktrees/other",
    });
    const baseSelection = createBaseArgs().selection;
    const args = createBaseArgs({
      selection: {
        ...baseSelection,
        view: {
          ...baseSelection.view,
          sessionsForTask: [matchingBuilderSession, otherBuilderSession],
        },
      },
      startSessionRequest: mock(async () => sessionWorkflowResult("build-1")),
    });
    const harness = createHookHarness(args);

    try {
      await harness.mount();

      const resolved = await harness.getLatest().handleResolveRebaseConflict(createConflict());

      expect(resolved).toBe(true);
      expect(args.startSessionRequest).toHaveBeenCalledWith(
        expect.objectContaining({
          existingSessionOptions: [
            expect.objectContaining({
              value: agentSessionIdentityKey(matchingBuilderSession),
              sourceSession: {
                externalSessionId: "build-1",
                runtimeKind: "opencode",
                workingDirectory: "/repo/worktrees/task-1",
              },
            }),
          ],
          initialSourceSession: {
            externalSessionId: "build-1",
            runtimeKind: "opencode",
            workingDirectory: "/repo/worktrees/task-1",
          },
        }),
      );
    } finally {
      await harness.unmount();
    }
  });

  test("does not require an existing selected model to request a new conflict session", async () => {
    const baseSelection = createBaseArgs().selection;
    const builderSession = buildSession({
      externalSessionId: "build-1",
      workingDirectory: "/repo/worktrees/task-1",
      selectedModel: null,
    });
    const args = createBaseArgs({
      selection: {
        ...baseSelection,
        view: {
          ...baseSelection.view,
          sessionsForTask: [builderSession],
        },
      },
      startSessionRequest: mock(async () => sessionWorkflowResult("build-new-9")),
    });
    const harness = createHookHarness(args);

    try {
      await harness.mount();

      const resolved = await harness.getLatest().handleResolveRebaseConflict(createConflict());

      expect(resolved).toBe(true);
      expect(args.startSessionRequest).toHaveBeenCalledWith(
        expect.objectContaining({
          initialStartMode: "reuse",
          initialSourceSession: {
            externalSessionId: "build-1",
            runtimeKind: "opencode",
            workingDirectory: "/repo/worktrees/task-1",
          },
          targetWorkingDirectory: "/repo/worktrees/task-1",
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

  test("passes the conflicted worktree when requesting a fresh conflict session", async () => {
    const baseSelection = createBaseArgs().selection;
    const args = createBaseArgs({
      selection: {
        ...baseSelection,
        view: {
          ...baseSelection.view,
          sessionsForTask: [],
        },
      },
      startSessionRequest: mock(async () => sessionWorkflowResult("build-new-9")),
    });
    const harness = createHookHarness(args);

    try {
      await harness.mount();

      const resolved = await harness.getLatest().handleResolveRebaseConflict(createConflict());

      expect(resolved).toBe(true);
      expect(args.startSessionRequest).toHaveBeenCalledWith(
        expect.objectContaining({
          initialStartMode: "fresh",
          targetWorkingDirectory: "/repo/worktrees/task-1",
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

  test("fails when the conflicted working directory is missing", async () => {
    const args = createBaseArgs();
    const harness = createHookHarness(args);

    try {
      await harness.mount();

      await expect(
        harness.getLatest().handleResolveRebaseConflict(createConflict({ workingDir: undefined })),
      ).rejects.toThrow(
        'Cannot resolve a git conflict for task "task-1" because the conflicted working directory is missing.',
      );

      expect(args.startSessionRequest).not.toHaveBeenCalled();
      expect(args.scheduleQueryUpdate).not.toHaveBeenCalled();
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
    } finally {
      await harness.unmount();
    }
  });

  test("uses the live selected Builder session without a shell-side summary wrapper", async () => {
    const liveBuilderSession = createAgentSessionFixture({
      externalSessionId: "build-live-1",
      taskId: "task-1",
      role: "build",
      status: "running",
      workingDirectory: "/repo/worktrees/task-1",
      selectedModel: {
        runtimeKind: "opencode",
        providerId: "openai",
        modelId: "gpt-5",
      },
    });
    const baseSelection = createBaseArgs().selection;
    const args = createBaseArgs({
      selection: {
        ...baseSelection,
        view: {
          ...baseSelection.view,
          selectedSession: createSelectedSession({
            identity: toAgentSessionIdentity(liveBuilderSession),
            loadedSession: liveBuilderSession,
          }),
          sessionsForTask: [],
        },
      },
      startSessionRequest: mock(async () => sessionWorkflowResult("build-live-1")),
    });
    const harness = createHookHarness(args);

    try {
      await harness.mount();

      const resolved = await harness.getLatest().handleResolveRebaseConflict(createConflict());

      expect(resolved).toBe(true);
      expect(args.startSessionRequest).toHaveBeenCalledWith(
        expect.objectContaining({
          initialStartMode: "reuse",
          initialSourceSession: {
            externalSessionId: "build-live-1",
            runtimeKind: "opencode",
            workingDirectory: "/repo/worktrees/task-1",
          },
        }),
      );
    } finally {
      await harness.unmount();
    }
  });

  test("keeps the resolve callback stable when the selection object is rebuilt", async () => {
    const args = createBaseArgs();
    const harness = createHookHarness(args);

    try {
      await harness.mount();

      const initialResolve = harness.getLatest().handleResolveRebaseConflict;

      await harness.update({
        ...args,
        selection: {
          ...args.selection,
        },
      });

      expect(harness.getLatest().handleResolveRebaseConflict).toBe(initialResolve);
    } finally {
      await harness.unmount();
    }
  });
});

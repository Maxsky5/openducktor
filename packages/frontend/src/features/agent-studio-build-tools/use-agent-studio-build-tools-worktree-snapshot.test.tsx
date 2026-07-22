import { beforeEach, describe, expect, mock, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import type { QueryClient } from "@tanstack/react-query";
import type { DiffDataState } from "@/features/agent-studio-git";
import { toAgentSessionIdentity } from "@/lib/agent-session-identity";
import { clearAppQueryClient, createQueryClient } from "@/lib/query-client";
import {
  createAgentSessionFixture,
  createDeferred,
  createHookHarness as createSharedHookHarness,
  createTaskCardFixture,
  enableReactActEnvironment,
} from "@/pages/agents/agent-studio-test-utils";
import { type AgentSessionSummary, toAgentSessionSummary } from "@/state/agent-sessions-store";
import { taskWorktreeQueryKeys } from "@/state/queries/build-runtime";
import type { AgentSessionIdentity, AgentSessionState } from "@/types/agent-orchestrator";
import {
  createAgentStudioBuildToolsWorktreeSnapshotHookForTest,
  type useAgentStudioBuildToolsWorktreeSnapshot,
} from "./use-agent-studio-build-tools-worktree-snapshot";

enableReactActEnvironment();
if (typeof document === "undefined") {
  GlobalRegistrator.register();
}

const refreshDiffMock = mock(async (_mode?: string) => {});
const setDiffScopeMock = mock((_scope: "target" | "uncommitted") => {});
const useAgentStudioDiffDataMock = mock(
  (args: Record<string, unknown>): DiffDataState => ({
    branch: "feature/task-24",
    worktreePath: (args.worktreePath as string | null) ?? null,
    targetBranch: "origin/main",
    diffScope: "uncommitted",
    gitConflict: null,
    scopeStatesByScope: {
      target: createEmptyScopeState(),
      uncommitted: createEmptyScopeState(),
    },
    loadedScopesByScope: { target: false, uncommitted: false },
    commitsAheadBehind: null,
    upstreamAheadBehind: null,
    upstreamStatus: "tracking",
    fileDiffs: [],
    fileStatuses: [],
    statusSnapshotKey: null,
    hashVersion: null,
    statusHash: null,
    diffHash: null,
    uncommittedFileCount: 0,
    isLoading: Boolean(args.isWorktreeResolutionResolving),
    error: (args.worktreeResolutionError as string | null) ?? null,
    refresh: refreshDiffMock,
    setDiffScope: setDiffScopeMock,
  }),
);
const useAgentStudioDevServerPanelMock = mock((args: Record<string, unknown>) => ({
  mode: "unconfigured" as const,
  repoPath: args.repoPath,
  taskId: args.taskId,
  enabled: args.enabled,
}));
const taskWorktreeGetMock = mock(
  async (_repoPath: string, _taskId: string): Promise<{ workingDirectory: string } | null> => ({
    workingDirectory: "/repo/.worktrees/task-24",
  }),
);

type SnapshotDependencies = Parameters<
  typeof createAgentStudioBuildToolsWorktreeSnapshotHookForTest
>[0];

const useSnapshotHookForTest = createAgentStudioBuildToolsWorktreeSnapshotHookForTest({
  taskWorktreeHost: {
    taskWorktreeGet: taskWorktreeGetMock,
  },
  useDiffData: useAgentStudioDiffDataMock as unknown as NonNullable<
    SnapshotDependencies["useDiffData"]
  >,
  useDevServerPanel: useAgentStudioDevServerPanelMock as unknown as NonNullable<
    SnapshotDependencies["useDevServerPanel"]
  >,
});

type UseSnapshotHook = typeof useAgentStudioBuildToolsWorktreeSnapshot;

const createEmptyScopeState = (): DiffDataState["scopeStatesByScope"]["target"] => ({
  branch: null,
  gitConflict: null,
  fileDiffs: [],
  fileStatuses: [],
  uncommittedFileCount: 0,
  commitsAheadBehind: null,
  upstreamAheadBehind: null,
  upstreamStatus: "tracking",
  error: null,
  hashVersion: null,
  statusHash: null,
  diffHash: null,
});

type HookArgs = Parameters<UseSnapshotHook>[0];
type SelectedViewOverrides = Partial<HookArgs["selectedView"]> & {
  loadedSession?: AgentSessionState | null;
  selectedSessionIdentity?: AgentSessionIdentity | null;
  selectedSessionActivityState?: HookArgs["selectedView"]["selectedSession"]["activityState"];
  selectedSessionSummary?: AgentSessionSummary | null;
};

const createSelectedSession = (
  overrides: Partial<HookArgs["selectedView"]["selectedSession"]> = {},
): HookArgs["selectedView"]["selectedSession"] => ({
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

const createSelectedView = (overrides: SelectedViewOverrides = {}): HookArgs["selectedView"] => {
  const {
    loadedSession: loadedSessionOverride,
    selectedSessionIdentity: selectedSessionIdentityOverride,
    selectedSessionSummary: selectedSessionSummaryOverride,
    role = "build",
    ...viewOverrides
  } = overrides;
  const defaultSession = createAgentSessionFixture({
    role: "build",
    status: "running",
    workingDirectory: "/repo",
  });
  const loadedSession =
    "loadedSession" in overrides ? (loadedSessionOverride ?? null) : defaultSession;
  const selectedSessionSummary =
    "selectedSessionSummary" in overrides
      ? (selectedSessionSummaryOverride ?? null)
      : loadedSession
        ? toAgentSessionSummary(loadedSession)
        : null;
  const selectedSessionIdentity =
    "selectedSessionIdentity" in overrides
      ? (selectedSessionIdentityOverride ?? null)
      : (selectedSessionSummary ?? (loadedSession ? toAgentSessionIdentity(loadedSession) : null));
  const selectedSessionActivityState =
    "selectedSessionActivityState" in overrides
      ? (overrides.selectedSessionActivityState ?? null)
      : (selectedSessionSummary?.activityState ?? null);

  return {
    role,
    taskId: "task-24",
    selectedTask: createTaskCardFixture({ id: "task-24" }),
    selectedSession: createSelectedSession({
      identity: selectedSessionIdentity,
      activityState: selectedSessionActivityState,
      loadedSession,
    }),
    ...viewOverrides,
  };
};

const createBaseArgs = (overrides: Partial<HookArgs> = {}): HookArgs => ({
  workspaceRepoPath: "/repo",
  activeBranch: { name: "main", detached: false },
  selectedView: createSelectedView(),
  isGitTabActive: true,
  isRightPanelOpen: true,
  repoSettings: null,
  ...overrides,
});

const createHookHarness = (initialProps: HookArgs, options?: { queryClient?: QueryClient }) =>
  createSharedHookHarness(useSnapshotHookForTest, initialProps, options);

beforeEach(async () => {
  await clearAppQueryClient();
  refreshDiffMock.mockClear();
  setDiffScopeMock.mockClear();
  useAgentStudioDiffDataMock.mockClear();
  useAgentStudioDevServerPanelMock.mockClear();
  taskWorktreeGetMock.mockClear();
  taskWorktreeGetMock.mockResolvedValue({ workingDirectory: "/repo/.worktrees/task-24" });
});

describe("useAgentStudioBuildToolsWorktreeSnapshot", () => {
  test("disables the snapshot when the build-tools panel is closed", async () => {
    const harness = createHookHarness(
      createBaseArgs({ isGitTabActive: false, isRightPanelOpen: false }),
    );

    try {
      await harness.mount();

      expect(harness.getLatest().isEnabled).toBe(false);
      expect(taskWorktreeGetMock).not.toHaveBeenCalled();
      expect(useAgentStudioDevServerPanelMock.mock.calls.at(-1)?.[0]).toMatchObject({
        repoPath: null,
        taskId: null,
        enabled: false,
      });
    } finally {
      await harness.unmount();
    }
  });

  test("keeps cached task worktree context while the git tab is inactive", async () => {
    const queryClient = createQueryClient();
    queryClient.setQueryData(
      taskWorktreeQueryKeys.taskWorktree({
        repoPath: "/repo",
        taskId: "task-25",
        taskVersion: "2026-02-22T12:00:00.000Z",
      }),
      { workingDirectory: "/repo/.worktrees/task-25" },
    );
    const harness = createHookHarness(
      createBaseArgs({
        isGitTabActive: false,
        selectedView: createSelectedView({
          taskId: "task-25",
          selectedTask: createTaskCardFixture({
            id: "task-25",
            updatedAt: "2026-02-22T12:00:00.000Z",
          }),
        }),
      }),
      { queryClient },
    );

    try {
      await harness.mount();

      expect(harness.getLatest().isEnabled).toBe(false);
      expect(taskWorktreeGetMock).not.toHaveBeenCalled();
      expect(harness.getLatest().worktree).toMatchObject({
        path: "/repo/.worktrees/task-25",
        status: "resolved",
        shouldBlockDiffLoading: true,
      });
      expect(useAgentStudioDiffDataMock.mock.calls.at(-1)?.[0]).toMatchObject({
        repoPath: "/repo",
        worktreePath: "/repo/.worktrees/task-25",
        worktreeResolutionTaskId: "task-25",
        shouldBlockDiffLoading: true,
      });
    } finally {
      await harness.unmount();
      queryClient.clear();
    }
  });

  test("resolves the task worktree while another task panel tab is active", async () => {
    const harness = createHookHarness(createBaseArgs({ isGitTabActive: false }));

    try {
      await harness.mount();
      await harness.waitFor((snapshot) => snapshot.worktree.path === "/repo/.worktrees/task-24");

      expect(taskWorktreeGetMock).toHaveBeenCalledWith("/repo", "task-24");
      expect(harness.getLatest().worktree).toMatchObject({
        path: "/repo/.worktrees/task-24",
        status: "resolved",
      });
      expect(harness.getLatest().isEnabled).toBe(false);
    } finally {
      await harness.unmount();
    }
  });

  test("uses a direct non-repo session working directory without querying", async () => {
    const harness = createHookHarness(
      createBaseArgs({
        selectedView: createSelectedView({
          loadedSession: createAgentSessionFixture({
            role: "build",
            status: "running",
            workingDirectory: "/repo/.worktrees/task-24",
          }),
        }),
      }),
    );

    try {
      await harness.mount();

      expect(taskWorktreeGetMock).not.toHaveBeenCalled();
      expect(harness.getLatest().worktree).toMatchObject({
        path: "/repo/.worktrees/task-24",
        status: "resolved",
        error: null,
        shouldBlockDiffLoading: false,
      });
      expect(harness.getLatest().openInTarget.path).toBe("/repo/.worktrees/task-24");
      expect(useAgentStudioDiffDataMock.mock.calls.at(-1)?.[0]).toMatchObject({
        repoPath: "/repo",
        worktreePath: "/repo/.worktrees/task-24",
        worktreeResolutionTaskId: null,
        shouldBlockDiffLoading: false,
      });
    } finally {
      await harness.unmount();
    }
  });

  test("uses the task worktree for QA session build tools", async () => {
    const harness = createHookHarness(
      createBaseArgs({
        selectedView: createSelectedView({
          role: "qa",
          loadedSession: createAgentSessionFixture({
            role: "qa",
            status: "running",
            workingDirectory: "/repo/.worktrees/task-24",
          }),
        }),
      }),
    );

    try {
      await harness.mount();

      expect(taskWorktreeGetMock).not.toHaveBeenCalled();
      expect(harness.getLatest().gitPanelContextMode).toBe("worktree");
      expect(harness.getLatest().worktree).toMatchObject({
        path: "/repo/.worktrees/task-24",
        status: "resolved",
        error: null,
        shouldBlockDiffLoading: false,
      });
      expect(harness.getLatest().openInTarget).toEqual({
        path: "/repo/.worktrees/task-24",
        disabledReason: null,
      });
      expect(useAgentStudioDiffDataMock.mock.calls.at(-1)?.[0]).toMatchObject({
        repoPath: "/repo",
        worktreePath: "/repo/.worktrees/task-24",
        worktreeResolutionTaskId: null,
        shouldBlockDiffLoading: false,
      });
    } finally {
      await harness.unmount();
    }
  });

  test("normalizes repository path variants before resolving the QA worktree", async () => {
    const harness = createHookHarness(
      createBaseArgs({
        selectedView: createSelectedView({
          role: "qa",
          loadedSession: createAgentSessionFixture({
            role: "qa",
            status: "running",
            workingDirectory: "/repo/",
          }),
        }),
      }),
    );

    try {
      await harness.mount();
      await harness.waitFor((snapshot) => snapshot.worktree.path === "/repo/.worktrees/task-24");

      expect(taskWorktreeGetMock).toHaveBeenCalledWith("/repo", "task-24");
      expect(harness.getLatest().worktree).toMatchObject({
        path: "/repo/.worktrees/task-24",
        status: "resolved",
        error: null,
      });
      expect(harness.getLatest().openInTarget).toEqual({
        path: "/repo/.worktrees/task-24",
        disabledReason: null,
      });
    } finally {
      await harness.unmount();
    }
  });

  test("rejects queried repository root path variants as task worktrees", async () => {
    taskWorktreeGetMock.mockResolvedValue({ workingDirectory: "/repo/" });
    const harness = createHookHarness(
      createBaseArgs({
        selectedView: createSelectedView({
          role: "qa",
          loadedSession: createAgentSessionFixture({
            role: "qa",
            status: "running",
            workingDirectory: "/repo/",
          }),
        }),
      }),
    );

    try {
      await harness.mount();
      await harness.waitFor((snapshot) => snapshot.worktree.status === "failed");

      expect(taskWorktreeGetMock).toHaveBeenCalledWith("/repo", "task-24");
      expect(harness.getLatest().worktree).toMatchObject({
        path: null,
        status: "failed",
      });
      expect(harness.getLatest().worktree.error).toContain(
        "Task worktree resolved to the repository root.",
      );
      expect(harness.getLatest().openInTarget.path).toBeNull();
    } finally {
      await harness.unmount();
    }
  });

  test("uses the selected session summary while the full session is still loading", async () => {
    const selectedSessionSummary = toAgentSessionSummary(
      createAgentSessionFixture({
        role: "build",
        status: "running",
        workingDirectory: "/repo/.worktrees/task-24",
      }),
    );
    const harness = createHookHarness(
      createBaseArgs({
        selectedView: createSelectedView({
          loadedSession: null,
          selectedSessionSummary,
        }),
      }),
    );

    try {
      await harness.mount();

      expect(taskWorktreeGetMock).not.toHaveBeenCalled();
      expect(harness.getLatest().context).toMatchObject({
        isSelectedBuilderWorking: true,
        sessionWorkingDirectory: "/repo/.worktrees/task-24",
      });
      expect(harness.getLatest().gitPanelContextMode).toBe("worktree");
      expect(harness.getLatest().worktree).toMatchObject({
        path: "/repo/.worktrees/task-24",
        status: "resolved",
        shouldBlockDiffLoading: false,
      });
    } finally {
      await harness.unmount();
    }
  });

  test("queries the canonical task worktree when no direct worktree exists", async () => {
    const harness = createHookHarness(createBaseArgs());

    try {
      await harness.mount();
      await harness.waitFor((snapshot) => snapshot.worktree.path === "/repo/.worktrees/task-24");

      expect(taskWorktreeGetMock).toHaveBeenCalledWith("/repo", "task-24");
      expect(harness.getLatest().worktree).toMatchObject({
        path: "/repo/.worktrees/task-24",
        status: "resolved",
        error: null,
      });
      expect(harness.getLatest().openInTarget.path).toBe("/repo/.worktrees/task-24");
      expect(useAgentStudioDevServerPanelMock.mock.calls.at(-1)?.[0]).toMatchObject({
        repoPath: "/repo",
        taskId: "task-24",
        enabled: true,
      });
    } finally {
      await harness.unmount();
    }
  });

  test("uses cached task worktree context while refetching canonical worktree", async () => {
    const queryClient = createQueryClient();
    const taskWorktreeFetch = createDeferred<{ workingDirectory: string } | null>();
    let didResolveTaskWorktreeFetch = false;
    queryClient.setQueryData(
      taskWorktreeQueryKeys.taskWorktree({
        repoPath: "/repo",
        taskId: "task-25",
        taskVersion: "2026-02-22T12:00:00.000Z",
      }),
      { workingDirectory: "/repo/.worktrees/task-25" },
      { updatedAt: 1 },
    );
    taskWorktreeGetMock.mockImplementation(async () => taskWorktreeFetch.promise);
    const harness = createHookHarness(
      createBaseArgs({
        selectedView: createSelectedView({
          taskId: "task-25",
          selectedTask: createTaskCardFixture({ id: "task-25" }),
        }),
      }),
      { queryClient },
    );

    try {
      await harness.mount();
      await harness.waitFor((snapshot) => snapshot.worktree.path === "/repo/.worktrees/task-25");

      expect(taskWorktreeGetMock).toHaveBeenCalledWith("/repo", "task-25");
      expect(harness.getLatest().worktree).toMatchObject({
        path: "/repo/.worktrees/task-25",
        status: "resolved",
        shouldBlockDiffLoading: false,
      });
      expect(useAgentStudioDiffDataMock.mock.calls.at(-1)?.[0]).toMatchObject({
        worktreePath: "/repo/.worktrees/task-25",
        worktreeResolutionTaskId: "task-25",
        isWorktreeResolutionResolving: true,
        shouldBlockDiffLoading: false,
      });

      didResolveTaskWorktreeFetch = true;
      taskWorktreeFetch.resolve({ workingDirectory: "/repo/.worktrees/task-25" });
      await taskWorktreeFetch.promise;
    } finally {
      if (!didResolveTaskWorktreeFetch) {
        taskWorktreeFetch.resolve({ workingDirectory: "/repo/.worktrees/task-25" });
      }
      await harness.unmount();
      queryClient.clear();
    }
  });

  test("fails closed when the task worktree is missing", async () => {
    taskWorktreeGetMock.mockResolvedValue(null);
    const harness = createHookHarness(createBaseArgs());

    try {
      await harness.mount();
      await harness.waitFor((snapshot) => snapshot.worktree.status === "failed");

      const snapshot = harness.getLatest();
      expect(snapshot.worktree.path).toBeNull();
      expect(snapshot.worktree.error).toContain("Task worktree is not available.");
      expect(snapshot.worktree.shouldBlockDiffLoading).toBe(true);
      expect(snapshot.openInTarget).toEqual({
        path: null,
        disabledReason: "Task worktree path is unavailable. Refresh the Git panel and try again.",
      });
      expect(useAgentStudioDiffDataMock.mock.calls.at(-1)?.[0]).toMatchObject({
        shouldBlockDiffLoading: true,
      });
    } finally {
      await harness.unmount();
    }
  });

  test("rejects a repo-root task worktree in worktree mode", async () => {
    taskWorktreeGetMock.mockResolvedValue({ workingDirectory: "/repo" });
    const harness = createHookHarness(createBaseArgs());

    try {
      await harness.mount();
      await harness.waitFor((snapshot) => snapshot.worktree.status === "failed");

      expect(harness.getLatest().worktree.error).toContain(
        "Task worktree resolved to the repository root.",
      );
      expect(harness.getLatest().worktree.path).toBeNull();
    } finally {
      await harness.unmount();
    }
  });

  test.each(["spec", "planner"] as const)(
    "uses a fresh %s session worktree for Git context and Open In",
    async (role) => {
      const specSession = createAgentSessionFixture({
        role,
        workingDirectory: "/repo/.worktrees/task-24",
      });
      const harness = createHookHarness(
        createBaseArgs({
          selectedView: createSelectedView({
            role,
            loadedSession: specSession,
          }),
        }),
      );

      try {
        await harness.mount();

        expect(taskWorktreeGetMock).not.toHaveBeenCalled();
        expect(harness.getLatest().gitPanelContextMode).toBe("worktree");
        expect(harness.getLatest().worktree.path).toBe("/repo/.worktrees/task-24");
        expect(harness.getLatest().openInTarget).toEqual({
          path: "/repo/.worktrees/task-24",
          disabledReason: null,
        });
        expect(useAgentStudioDiffDataMock.mock.calls.at(-1)?.[0]).toMatchObject({
          repoPath: "/repo",
          worktreePath: "/repo/.worktrees/task-24",
        });
      } finally {
        await harness.unmount();
      }
    },
  );

  test("keeps a legacy root-backed Spec session in repository context", async () => {
    const specSession = createAgentSessionFixture({ role: "spec", workingDirectory: "/repo" });
    const harness = createHookHarness(
      createBaseArgs({
        selectedView: createSelectedView({ role: "spec", loadedSession: specSession }),
      }),
    );

    try {
      await harness.mount();

      expect(taskWorktreeGetMock).not.toHaveBeenCalled();
      expect(harness.getLatest().gitPanelContextMode).toBe("repository");
      expect(harness.getLatest().openInTarget).toEqual({ path: "/repo", disabledReason: null });
    } finally {
      await harness.unmount();
    }
  });

  test("preserves target-branch validation for repository-mode UI locking without blocking diff", async () => {
    const harness = createHookHarness(
      createBaseArgs({
        selectedView: createSelectedView({
          role: "spec",
          loadedSession: createAgentSessionFixture({
            role: "spec",
            status: "running",
            workingDirectory: "/repo",
          }),
          selectedTask: createTaskCardFixture({
            id: "task-24",
            targetBranchError: "Invalid openducktor.targetBranch metadata: missing field `branch`.",
          }),
        }),
      }),
    );

    try {
      await harness.mount();

      const snapshot = harness.getLatest();
      expect(snapshot.gitPanelContextMode).toBe("repository");
      expect(snapshot.targetBranchState.validationError).toBe(
        "Invalid openducktor.targetBranch metadata: missing field `branch`.",
      );
      expect(useAgentStudioDiffDataMock.mock.calls.at(-1)?.[0]).not.toHaveProperty(
        "preconditionError",
      );
    } finally {
      await harness.unmount();
    }
  });

  test("keeps dev-server reads scoped to the hydrated selected task", async () => {
    const harness = createHookHarness(
      createBaseArgs({
        selectedView: createSelectedView({ selectedTask: null }),
      }),
    );

    try {
      await harness.mount();
      await harness.waitFor((snapshot) => snapshot.worktree.path === "/repo/.worktrees/task-24");

      expect(taskWorktreeGetMock).toHaveBeenCalledWith("/repo", "task-24");
      expect(harness.getLatest().context.taskId).toBe("task-24");
      expect(useAgentStudioDevServerPanelMock.mock.calls.at(-1)?.[0]).toMatchObject({
        repoPath: "/repo",
        taskId: null,
        enabled: false,
      });
    } finally {
      await harness.unmount();
    }
  });
});

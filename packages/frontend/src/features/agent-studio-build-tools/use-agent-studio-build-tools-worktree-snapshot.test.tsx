import { beforeEach, describe, expect, mock, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { repoConfigSchema, type GitWorktreeStatus } from "@openducktor/contracts";
import { useAgentStudioRepoSettings } from "@/pages/agents/use-agent-studio-repo-settings";
import type { QueryClient } from "@tanstack/react-query";
import type { DiffDataState } from "@/features/agent-studio-git";
import { toAgentSessionIdentity } from "@/lib/agent-session-identity";
import { clearAppQueryClient, createQueryClient } from "@/lib/query-client";
import { configureShellBridge, createUnavailableShellBridge } from "@/lib/shell-bridge";
import { createShellBridgeFixture } from "@/test-utils/focused-fixture";
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
if (globalThis.document === undefined) {
  GlobalRegistrator.register();
}

const refreshDiffMock = mock(async (_mode?: string) => {});
const setDiffScopeMock = mock((_scope: "target" | "uncommitted") => {});
type SnapshotDependencies = Parameters<
  typeof createAgentStudioBuildToolsWorktreeSnapshotHookForTest
>[0];
type UseDiffData = NonNullable<SnapshotDependencies["useDiffData"]>;

const useAgentStudioDiffDataMock = mock(
  (args: Parameters<UseDiffData>[0]): ReturnType<UseDiffData> => ({
    branch: "feature/task-24",
    worktreePath: args.worktreePath,
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
    error: args.worktreeResolutionError,
    refresh: refreshDiffMock,
    refreshAllScopes: async () => {},
    refreshInactiveScope: async () => {},
    loadAllScopes: async () => {},
    loadInactiveScope: async () => {},
    setDiffScope: setDiffScopeMock,
  }),
);
const taskWorktreeGetMock = mock(
  async (_repoPath: string, _taskId: string): Promise<{ workingDirectory: string } | null> => ({
    workingDirectory: "/repo/.worktrees/task-24",
  }),
);

const useSnapshotHookForTest = createAgentStudioBuildToolsWorktreeSnapshotHookForTest({
  taskWorktreeHost: {
    taskWorktreeGet: taskWorktreeGetMock,
  },
  useDiffData: useAgentStudioDiffDataMock,
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
    catalogError: null,
    todosError: null,
    runtimePolicyError: null,
    contextError: null,
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
    sessionAssociation: { kind: "workflow", taskId: "task-1", role: "build" },
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
  repoSettingsError: null,
  loadRepoSettings: async () => {
    throw new Error("Unexpected repository settings read.");
  },
  ...overrides,
});

const createHookHarness = (initialProps: HookArgs, options?: { queryClient?: QueryClient }) =>
  createSharedHookHarness(useSnapshotHookForTest, initialProps, options);

beforeEach(async () => {
  await clearAppQueryClient();
  refreshDiffMock.mockClear();
  setDiffScopeMock.mockClear();
  useAgentStudioDiffDataMock.mockClear();
  taskWorktreeGetMock.mockClear();
  taskWorktreeGetMock.mockResolvedValue({ workingDirectory: "/repo/.worktrees/task-24" });
});

describe("useAgentStudioBuildToolsWorktreeSnapshot", () => {
  test("scheduled task refresh fetches its saved target before checking the branch", async () => {
    const fetch = mock(async () => ({ outcome: "fetched" as const, output: "Fetched." }));
    configureShellBridge(
      createShellBridgeFixture({
        client: {
          gitGetCurrentBranch: async () => ({ name: "feature/task-24", detached: false }),
          gitGetComparisonTarget: async () => ({
            kind: "available",
            reference: "refs/remotes/origin/release",
          }),
          gitFetchRemote: fetch,
        },
      }),
    );
    const harness = createHookHarness(
      createBaseArgs({
        repoSettingsError: new Error("Repair config permissions."),
        selectedView: createSelectedView({
          selectedTask: createTaskCardFixture({
            id: "task-24",
            targetBranch: { branch: "release", remote: "origin" },
          }),
        }),
      }),
    );
    try {
      await harness.mount();
      await harness.waitFor(
        (state) => state.comparison?.resolvedTarget === "refs/remotes/origin/release",
      );
      await harness.run(async (state) => {
        await state.refreshWorktree("scheduled");
      });
      expect(fetch).toHaveBeenCalledWith(
        "/repo",
        "refs/remotes/origin/release",
        "/repo/.worktrees/task-24",
      );
      expect(harness.getLatest().comparison?.unavailableReason).toBeNull();
    } finally {
      await harness.unmount();
      configureShellBridge(createUnavailableShellBridge());
    }
  });

  test("shows a failed default-target read and retries settings from Refresh", async () => {
    let fails = true;
    const config = repoConfigSchema.parse({
      workspaceId: "workspace-repo",
      workspaceName: "Repo",
      repoPath: "/repo",
    });
    const readConfig = mock(async () => {
      if (fails) throw new Error("Repair config permissions.");
      return config;
    });
    const readComparison = mock(async () => ({
      kind: "available" as const,
      reference: "refs/remotes/origin/main",
    }));
    configureShellBridge(
      createShellBridgeFixture({
        client: {
          gitGetCurrentBranch: async () => ({ name: "feature/task-24", detached: false }),
          gitGetComparisonTarget: readComparison,
          gitFetchRemote: async () => ({ outcome: "fetched", output: "Fetched." }),
        },
      }),
    );
    const harness = createSharedHookHarness(() => {
      const settings = useAgentStudioRepoSettings({
        activeWorkspaceId: "workspace-repo",
        activeRepoPath: "/repo",
        hostClient: {
          workspaceGetRepoConfig: readConfig,
          workspaceGetGitProviderContext: async () => null,
        },
      });
      const snapshot = useSnapshotHookForTest(
        createBaseArgs({
          repoSettings: settings.repoSettings,
          repoSettingsError: settings.repoSettingsError,
          loadRepoSettings: settings.loadRepoSettings,
        }),
      );
      return { settings, snapshot };
    }, undefined);
    try {
      await harness.mount();
      await harness.waitFor(
        (state) => !state.settings.isLoadingRepoSettings && state.snapshot.worktree.path !== null,
      );
      expect(harness.getLatest().snapshot.diffData.comparisonUnavailableReason).toBe(
        "Repair config permissions.",
      );
      expect(readComparison).not.toHaveBeenCalled();
      let retryError: unknown;
      await harness.run(async (state) => {
        try {
          await state.snapshot.refreshWorktree("hard");
        } catch (error) {
          retryError = error;
        }
      });
      expect(retryError).toBeInstanceOf(Error);
      expect(retryError).toMatchObject({ message: "Repair config permissions." });
      expect(harness.getLatest().snapshot.diffData.comparisonUnavailableReason).toBe(
        "Repair config permissions.",
      );
      fails = false;
      await harness.run(async (state) => {
        await state.snapshot.refreshWorktree("hard");
      });
      await harness.waitFor(
        (state) => state.snapshot.comparison?.resolvedTarget === "refs/remotes/origin/main",
      );
      expect(readConfig).toHaveBeenCalledTimes(3);
      expect(harness.getLatest().snapshot.comparison?.unavailableReason).toBeNull();
      expect(readComparison).toHaveBeenCalled();
    } finally {
      await harness.unmount();
      configureShellBridge(createUnavailableShellBridge());
    }
  });

  test("uses the saved task comparison while settings load and clears it during a target change", async () => {
    const nextComparison = createDeferred<{ kind: "available"; reference: string }>();
    const readStatus = mock(
      async (_repo: string, target: string, scope: "target" | "uncommitted" = "uncommitted") =>
        taskStatus(target, scope),
    );
    configureShellBridge(
      createShellBridgeFixture({
        client: {
          gitGetCurrentBranch: async () => ({ name: "feature/task-24", detached: false }),
          gitGetComparisonTarget: async (_repo, _dir, target) =>
            target.branch === "release"
              ? { kind: "available", reference: "refs/heads/release" }
              : nextComparison.promise,
          gitGetWorktreeStatus: readStatus,
          gitGetWorktreeStatusSummary: async (_repo, target, scope = "uncommitted") => {
            const full = taskStatus(target, scope);
            return {
              currentBranch: full.currentBranch,
              fileStatusCounts: { total: 1, staged: 0, unstaged: 1 },
              targetAheadBehind: full.targetAheadBehind,
              upstreamAheadBehind: full.upstreamAheadBehind,
              snapshot: full.snapshot,
            };
          },
        },
      }),
    );
    const useRealSnapshot = createAgentStudioBuildToolsWorktreeSnapshotHookForTest({
      taskWorktreeHost: { taskWorktreeGet: taskWorktreeGetMock },
    });
    const args = createBaseArgs({
      selectedView: createSelectedView({
        selectedTask: createTaskCardFixture({
          id: "task-24",
          targetBranch: { branch: "release" },
        }),
      }),
    });
    const harness = createSharedHookHarness(useRealSnapshot, args);
    try {
      await harness.mount();
      await harness.waitFor((state) => state.diffData.comparisonReference === "refs/heads/release");
      expect(harness.getLatest().diffData.commitsAheadBehind).toEqual({ ahead: 2, behind: 1 });
      expect(harness.getLatest().diffData.statusHash).toBe("0123456789abcdef");
      expect(readStatus.mock.calls.some((call) => call[1] === "HEAD")).toBe(true);
      await harness.update({
        ...args,
        selectedView: createSelectedView({
          selectedTask: createTaskCardFixture({ id: "task-24", targetBranch: { branch: "next" } }),
        }),
      });
      expect(harness.getLatest().diffData.comparisonReference).toBeNull();
      expect(harness.getLatest().diffData.commitsAheadBehind).toBeNull();
      expect(harness.getLatest().diffData.scopeStatesByScope.target.fileDiffs).toEqual([]);
      await harness.waitFor((state) => state.diffData.fileStatuses[0]?.path === "draft.ts");
      await harness.run(async () => {
        nextComparison.resolve({ kind: "available", reference: "refs/heads/next" });
        await nextComparison.promise;
      });
      await harness.waitFor((state) => state.diffData.comparisonReference === "refs/heads/next");
      expect(readStatus.mock.calls.some((call) => call[1] === "refs/heads/next")).toBe(true);
    } finally {
      await harness.unmount();
      configureShellBridge(createUnavailableShellBridge());
    }
  });

  test("reuses branch and comparison reads when task sessions share a worktree", async () => {
    const readBranch = mock(async () => ({ name: "feature/task-24", detached: false }));
    const readComparison = mock(async () => ({
      kind: "available" as const,
      reference: "refs/heads/release",
    }));
    const readStatus = mock(
      async (_repo: string, target: string, scope: "target" | "uncommitted" = "uncommitted") =>
        taskStatus(target, scope),
    );
    configureShellBridge(
      createShellBridgeFixture({
        client: {
          gitGetCurrentBranch: readBranch,
          gitGetComparisonTarget: readComparison,
          gitGetWorktreeStatus: readStatus,
        },
      }),
    );
    const useRealSnapshot = createAgentStudioBuildToolsWorktreeSnapshotHookForTest({
      taskWorktreeHost: { taskWorktreeGet: taskWorktreeGetMock },
    });
    const argsFor = (sessionId: string) =>
      createBaseArgs({
        selectedView: createSelectedView({
          loadedSession: createAgentSessionFixture({
            externalSessionId: sessionId,
            workingDirectory: "/repo/.worktrees/task-24",
            sessionAssociation: { kind: "workflow", taskId: "task-24", role: "build" },
          }),
          selectedTask: createTaskCardFixture({
            id: "task-24",
            targetBranch: { branch: "release" },
          }),
        }),
      });
    const harness = createSharedHookHarness(useRealSnapshot, argsFor("first"));
    try {
      await harness.mount();
      await harness.waitFor(
        (state) =>
          state.diffData.comparisonReference === "refs/heads/release" && !state.diffData.isLoading,
      );
      const reads = readStatus.mock.calls.length;
      for (const sessionId of ["second", "first"]) {
        await harness.update(argsFor(sessionId));
        expect(harness.getLatest().resolvedGitPanelBranch).toBe("feature/task-24");
        expect(harness.getLatest().diffData.comparisonReference).toBe("refs/heads/release");
        expect(harness.getLatest().diffData.commitsAheadBehind).toEqual({ ahead: 2, behind: 1 });
        expect(harness.getLatest().diffData.fileStatuses[0]?.path).toBe("draft.ts");
        expect(readStatus).toHaveBeenCalledTimes(reads);
        expect(readBranch).toHaveBeenCalledTimes(1);
        expect(readComparison).toHaveBeenCalledTimes(1);
      }
    } finally {
      await harness.unmount();
      configureShellBridge(createUnavailableShellBridge());
    }
  });

  test("keeps task comparison and counts while its branch and status reads refresh", async () => {
    const nextBranch = createDeferred<{ name: string; detached: boolean }>();
    let holdBranch = false;
    let holdStatus = false;
    const nextStatus = createDeferred<void>();
    const readBranch = mock(async () =>
      holdBranch ? nextBranch.promise : { name: "feature/task-24", detached: false },
    );
    const readStatus = mock(
      async (_repo: string, target: string, scope: "target" | "uncommitted" = "uncommitted") => {
        if (holdStatus) await nextStatus.promise;
        return taskStatus(target, scope);
      },
    );
    configureShellBridge(
      createShellBridgeFixture({
        client: {
          gitGetCurrentBranch: readBranch,
          gitGetComparisonTarget: async () => ({
            kind: "available",
            reference: "refs/heads/release",
          }),
          gitGetWorktreeStatus: readStatus,
          gitGetWorktreeStatusSummary: async (_repo, target, scope = "uncommitted") => {
            const full = taskStatus(target, scope);
            return {
              currentBranch: full.currentBranch,
              fileStatusCounts: { total: 1, staged: 0, unstaged: 1 },
              targetAheadBehind: full.targetAheadBehind,
              upstreamAheadBehind: full.upstreamAheadBehind,
              snapshot: full.snapshot,
            };
          },
        },
      }),
    );
    const useRealSnapshot = createAgentStudioBuildToolsWorktreeSnapshotHookForTest({
      taskWorktreeHost: { taskWorktreeGet: taskWorktreeGetMock },
    });
    const args = createBaseArgs({
      selectedView: createSelectedView({
        selectedTask: createTaskCardFixture({
          id: "task-24",
          targetBranch: { branch: "release" },
        }),
      }),
    });
    const harness = createSharedHookHarness(useRealSnapshot, args);
    try {
      await harness.mount();
      await harness.waitFor((state) => state.diffData.comparisonReference === "refs/heads/release");
      expect(harness.getLatest().diffData.commitsAheadBehind).toEqual({ ahead: 2, behind: 1 });
      expect(harness.getLatest().diffData.statusHash).toBe("0123456789abcdef");
      expect(readStatus.mock.calls.some((call) => call[1] === "HEAD")).toBe(true);
      holdBranch = true;
      let refresh: Promise<void> | undefined;
      await harness.run((state) => {
        refresh = state.refreshWorktree("soft");
      });
      await harness.waitFor(() => readBranch.mock.calls.length === 2);
      // Query notifications use a timer. Flush them while the host read stays pending.
      await harness.run(async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
      });
      expect(harness.getLatest().diffData.comparisonReference).toBe("refs/heads/release");
      expect(harness.getLatest().diffData.commitsAheadBehind).toEqual({ ahead: 2, behind: 1 });
      expect(harness.getLatest().diffData.branch).toBe("feature/task-24");
      await harness.run(async () => {
        nextBranch.resolve({ name: "feature/task-24", detached: false });
        await refresh;
      });
      expect(harness.getLatest().diffData.comparisonReference).toBe("refs/heads/release");
      expect(harness.getLatest().diffData.commitsAheadBehind).toEqual({ ahead: 2, behind: 1 });
      holdBranch = false;
      holdStatus = true;
      await harness.run((state) => {
        refresh = state.refreshWorktree("soft");
      });
      await harness.waitFor((state) => state.diffData.isLoading);
      expect(harness.getLatest().diffData.comparisonReference).toBe("refs/heads/release");
      expect(harness.getLatest().diffData.commitsAheadBehind).toEqual({ ahead: 2, behind: 1 });
      expect(harness.getLatest().diffData.fileStatuses[0]?.path).toBe("draft.ts");
      await harness.run(async () => {
        nextStatus.resolve();
        await refresh;
      });
      expect(harness.getLatest().diffData.comparisonReference).toBe("refs/heads/release");
    } finally {
      nextStatus.resolve();
      nextBranch.resolve({ name: "feature/task-24", detached: false });
      await harness.unmount();
      configureShellBridge(createUnavailableShellBridge());
    }
  });

  test("disables the snapshot when the build-tools panel is closed", async () => {
    const harness = createHookHarness(
      createBaseArgs({ isGitTabActive: false, isRightPanelOpen: false }),
    );

    try {
      await harness.mount();

      expect(harness.getLatest().isEnabled).toBe(false);
      expect(taskWorktreeGetMock).not.toHaveBeenCalled();
      expect(harness.getLatest().devServerTarget).toEqual({
        repoPath: null,
        owner: null,
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
            sessionAssociation: { kind: "workflow", taskId: "task-1", role: "build" },
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
            sessionAssociation: { kind: "workflow", taskId: "task-1", role: "qa" },
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
            sessionAssociation: { kind: "workflow", taskId: "task-1", role: "qa" },
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
            sessionAssociation: { kind: "workflow", taskId: "task-1", role: "qa" },
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
        sessionAssociation: { kind: "workflow", taskId: "task-1", role: "build" },
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
      expect(harness.getLatest().devServerTarget).toEqual({
        repoPath: "/repo",
        owner: { kind: "task", taskId: "task-24" },
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
        sessionAssociation: { kind: "workflow", taskId: "task-1", role: role },
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
    const specSession = createAgentSessionFixture({
      sessionAssociation: { kind: "workflow", taskId: "task-1", role: "spec" },
      workingDirectory: "/repo",
    });
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

  test("keeps the selected detached revision for repository file reads", async () => {
    const args = createBaseArgs({
      activeBranch: { detached: true, revision: "head-before" },
      selectedView: createSelectedView({
        role: "spec",
        loadedSession: createAgentSessionFixture({
          sessionAssociation: { kind: "workflow", taskId: "task-1", role: "spec" },
          workingDirectory: "/repo",
        }),
      }),
    });
    const harness = createHookHarness(args);
    try {
      await harness.mount();
      expect(harness.getLatest().repositoryBranchIdentityKey).toBe("detached:head-before");
      await harness.update({
        ...args,
        activeBranch: { detached: true, revision: "head-after" },
      });
      expect(harness.getLatest().repositoryBranchIdentityKey).toBe("detached:head-after");
      expect(harness.getLatest().resolvedGitPanelBranch).toBeNull();
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
            sessionAssociation: { kind: "workflow", taskId: "task-1", role: "spec" },
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
      expect(harness.getLatest().devServerTarget).toEqual({
        repoPath: "/repo",
        owner: null,
        enabled: false,
      });
    } finally {
      await harness.unmount();
    }
  });
});

function taskStatus(target: string, scope: "target" | "uncommitted"): GitWorktreeStatus {
  return {
    currentBranch: { name: "feature/task-24", detached: false },
    fileStatuses: [{ path: "draft.ts", status: "M", staged: false }],
    fileDiffs: [],
    targetAheadBehind: { ahead: target === "HEAD" ? 0 : 2, behind: 1 },
    upstreamAheadBehind: { outcome: "tracking", ahead: 0, behind: 0 },
    snapshot: {
      effectiveWorkingDir: "/repo/.worktrees/task-24",
      targetBranch: target,
      diffScope: scope,
      observedAtMs: 1,
      hashVersion: 1,
      statusHash: target === "HEAD" ? "0123456789abcdef" : "1111111111111111",
      diffHash: "fedcba9876543210",
    },
  };
}

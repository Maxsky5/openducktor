import { beforeEach, describe, expect, mock, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import type { DiffDataState } from "@/features/agent-studio-git";
import { clearAppQueryClient } from "@/lib/query-client";
import {
  createAgentSessionFixture,
  createHookHarness as createSharedHookHarness,
  createTaskCardFixture,
  enableReactActEnvironment,
} from "@/pages/agents/agent-studio-test-utils";
import { useAgentStudioBuildToolsWorktreeSnapshot } from "./use-agent-studio-build-tools-worktree-snapshot";

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

const createBaseArgs = (overrides: Partial<HookArgs> = {}): HookArgs => ({
  workspaceRepoPath: "/repo",
  activeBranch: { name: "main", detached: false },
  viewRole: "build",
  viewTaskId: "task-24",
  session: {
    role: "build",
    status: "running",
    workingDirectory: null,
    hasActiveSession: true,
  },
  viewSelectedTask: createTaskCardFixture({ id: "task-24" }),
  panelKind: "build_tools",
  isPanelOpen: true,
  isViewSessionHistoryHydrating: false,
  repoSettings: null,
  worktreeRecoverySignal: 0,
  taskWorktreeHost: {
    taskWorktreeGet: taskWorktreeGetMock,
  },
  useDiffDataHook: useAgentStudioDiffDataMock as NonNullable<HookArgs["useDiffDataHook"]>,
  useDevServerPanelHook: useAgentStudioDevServerPanelMock as unknown as NonNullable<
    HookArgs["useDevServerPanelHook"]
  >,
  ...overrides,
});

const createHookHarness = (initialProps: HookArgs) =>
  createSharedHookHarness(useAgentStudioBuildToolsWorktreeSnapshot, initialProps);

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
    const harness = createHookHarness(createBaseArgs({ isPanelOpen: false }));

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

  test("uses a direct non-repo session working directory without querying", async () => {
    const harness = createHookHarness(
      createBaseArgs({
        session: {
          role: "build",
          status: "running",
          workingDirectory: "/repo/.worktrees/task-24",
          hasActiveSession: true,
        },
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
        worktreePath: "/repo/.worktrees/task-24",
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
        disabledReason:
          "Builder worktree path is unavailable. Refresh the Git panel and try again.",
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

  test("repository mode intentionally uses the repo root for Open In", async () => {
    const repoSession = createAgentSessionFixture({ role: "spec", workingDirectory: "/repo" });
    const harness = createHookHarness(
      createBaseArgs({
        session: {
          role: repoSession.role,
          status: repoSession.status,
          workingDirectory: repoSession.workingDirectory,
          hasActiveSession: true,
        },
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
});

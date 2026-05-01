import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import type { GitWorktreeStatus, GitWorktreeStatusSummary } from "@openducktor/contracts";
import { clearAppQueryClient } from "@/lib/query-client";
import {
  createHookHarness as createSharedHookHarness,
  enableReactActEnvironment,
} from "@/pages/agents/agent-studio-test-utils";
import { restoreMockedModules } from "@/test-utils/mock-module-cleanup";

const actualHostOperationsModule = await import("@/state/operations/host");
const actualHostClientModule = await import("@/lib/host-client");

enableReactActEnvironment();
if (typeof document === "undefined") {
  GlobalRegistrator.register();
}

const taskWorktreeEntriesMock = mock(
  async (): Promise<Array<{ taskId: string; worktreePath: string }>> => [],
);
const taskWorktreeGetMock = mock(async (_repoPath: string, taskId: string) => {
  const runs = await taskWorktreeEntriesMock();
  const matchingRun = runs.find((run) => run.taskId === taskId) ?? null;
  return matchingRun ? { workingDirectory: matchingRun.worktreePath } : null;
});
const gitFetchRemoteMock = mock(
  async (
    _repoPath: string,
    _targetBranch: string,
    _workingDir?: string,
  ): Promise<{ outcome: "fetched" | "skipped_no_remote"; output: string }> => ({
    outcome: "fetched",
    output: "From origin",
  }),
);
const retryWorktreeResolutionMock = mock(async () => {});
type GitFetchRemoteMockResult = Awaited<ReturnType<typeof gitFetchRemoteMock>>;
const gitGetWorktreeStatusMock = mock(
  async (
    _repoPath: string,
    targetBranch: string,
    diffScope?: "target" | "uncommitted",
    workingDir?: string,
  ): Promise<GitWorktreeStatus> =>
    withSnapshotHashes({
      currentBranch: { name: "feature/task-10", detached: false },
      fileStatuses: [{ path: "src/main.ts", status: "M", staged: false }],
      fileDiffs:
        (diffScope ?? "target") === "target"
          ? [
              {
                file: "src/main.ts",
                type: "modified",
                additions: 1,
                deletions: 0,
                diff: "@@ -1 +1 @@",
              },
            ]
          : [],
      targetAheadBehind: { ahead: 0, behind: 0 },
      upstreamAheadBehind: { outcome: "tracking", ahead: 1, behind: 0 },
      snapshot: {
        effectiveWorkingDir: workingDir ?? "/repo",
        targetBranch,
        diffScope: diffScope ?? "target",
        observedAtMs: 1731000000000,
      },
    }),
);
const gitGetWorktreeStatusSummaryMock = mock(
  async (
    _repoPath: string,
    targetBranch: string,
    diffScope?: "target" | "uncommitted",
    workingDir?: string,
  ): Promise<GitWorktreeStatusSummary> => {
    const fullStatus = withSnapshotHashes({
      currentBranch: { name: "feature/task-10", detached: false },
      fileStatuses: [{ path: "src/main.ts", status: "M", staged: false }],
      fileDiffs:
        (diffScope ?? "target") === "target"
          ? [
              {
                file: "src/main.ts",
                type: "modified",
                additions: 1,
                deletions: 0,
                diff: "@@ -1 +1 @@",
              },
            ]
          : [],
      targetAheadBehind: { ahead: 0, behind: 0 },
      upstreamAheadBehind: { outcome: "tracking", ahead: 1, behind: 0 },
      snapshot: {
        effectiveWorkingDir: workingDir ?? "/repo",
        targetBranch,
        diffScope: diffScope ?? "target",
        observedAtMs: 1731000000000,
      },
    });

    return toWorktreeStatusSummary(fullStatus);
  },
);

type UseAgentStudioDiffDataHook =
  typeof import("./use-agent-studio-diff-data")["useAgentStudioDiffData"];

let useAgentStudioDiffData: UseAgentStudioDiffDataHook;

type HookArgs = Parameters<UseAgentStudioDiffDataHook>[0];

const createHookHarness = (initialProps: HookArgs) => {
  return createSharedHookHarness(useAgentStudioDiffData, initialProps);
};

const createDeferred = <T,>() => {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });

  return { promise, resolve, reject };
};

const hashTestPayload = (value: unknown): string => {
  const payload = new TextEncoder().encode(JSON.stringify(value));
  let hash = 0xcbf29ce484222325n;
  for (const byte of payload) {
    hash ^= BigInt(byte);
    hash = (hash * 0x100000001b3n) & 0xffffffffffffffffn;
  }

  return hash.toString(16).padStart(16, "0");
};

const withSnapshotHashes = (
  status: Omit<GitWorktreeStatus, "snapshot"> & {
    snapshot: Omit<GitWorktreeStatus["snapshot"], "hashVersion" | "statusHash" | "diffHash">;
  },
): GitWorktreeStatus => {
  const statusHash = hashTestPayload({
    currentBranch: status.currentBranch,
    fileStatuses: status.fileStatuses,
    targetAheadBehind: status.targetAheadBehind,
    upstreamAheadBehind: status.upstreamAheadBehind,
  });
  const diffHash = hashTestPayload({
    fileDiffs: status.fileDiffs,
  });

  return {
    ...status,
    snapshot: {
      ...status.snapshot,
      hashVersion: 1,
      statusHash,
      diffHash,
    },
  };
};

const toWorktreeStatusSummary = (status: GitWorktreeStatus): GitWorktreeStatusSummary => {
  const staged = status.fileStatuses.filter((fileStatus) => fileStatus.staged).length;
  const total = status.fileStatuses.length;
  return {
    currentBranch: status.currentBranch,
    fileStatusCounts: {
      total,
      staged,
      unstaged: total - staged,
    },
    targetAheadBehind: status.targetAheadBehind,
    upstreamAheadBehind: status.upstreamAheadBehind,
    ...(status.gitConflict ? { gitConflict: status.gitConflict } : {}),
    snapshot: status.snapshot,
  };
};

const createBaseArgs = (): HookArgs => ({
  repoPath: "/repo",
  worktreePath: null,
  worktreeResolutionTaskId: null,
  shouldBlockDiffLoading: false,
  isWorktreeResolutionResolving: false,
  worktreeResolutionError: null,
  retryWorktreeResolution: retryWorktreeResolutionMock,
  defaultTargetBranch: { remote: "origin", branch: "main" },
  branchIdentityKey: null,
  enablePolling: false,
});

const dispatchDiffRefresh = (): void => {
  document.dispatchEvent(new Event("visibilitychange"));
};

const dispatchScheduledRefresh = (): void => {
  globalThis.dispatchEvent(new Event("focus"));
};

beforeEach(async () => {
  mock.module("@/state/operations/host", () => ({
    host: {
      taskWorktreeGet: taskWorktreeGetMock,
      runsList: taskWorktreeEntriesMock,
      gitFetchRemote: gitFetchRemoteMock,
      gitGetWorktreeStatus: gitGetWorktreeStatusMock,
      gitGetWorktreeStatusSummary: gitGetWorktreeStatusSummaryMock,
    },
  }));

  mock.module("@/lib/host-client", () => ({
    hostClient: {
      taskWorktreeGet: taskWorktreeGetMock,
      runsList: taskWorktreeEntriesMock,
      gitFetchRemote: gitFetchRemoteMock,
      gitGetWorktreeStatus: gitGetWorktreeStatusMock,
      gitGetWorktreeStatusSummary: gitGetWorktreeStatusSummaryMock,
    },
  }));

  ({ useAgentStudioDiffData } = await import("./use-agent-studio-diff-data"));
  await clearAppQueryClient();
  taskWorktreeEntriesMock.mockClear();
  taskWorktreeGetMock.mockClear();
  gitFetchRemoteMock.mockClear();
  retryWorktreeResolutionMock.mockClear();
  gitGetWorktreeStatusMock.mockClear();
  gitGetWorktreeStatusSummaryMock.mockClear();
  gitFetchRemoteMock.mockResolvedValue({ outcome: "fetched", output: "From origin" });
  gitGetWorktreeStatusMock.mockImplementation(
    async (
      _repoPath: string,
      targetBranch: string,
      diffScope?: "target" | "uncommitted",
      workingDir?: string,
    ): Promise<GitWorktreeStatus> =>
      withSnapshotHashes({
        currentBranch: { name: "feature/task-10", detached: false },
        fileStatuses: [{ path: "src/main.ts", status: "M", staged: false }],
        fileDiffs:
          (diffScope ?? "target") === "target"
            ? [
                {
                  file: "src/main.ts",
                  type: "modified",
                  additions: 1,
                  deletions: 0,
                  diff: "@@ -1 +1 @@",
                },
              ]
            : [],
        targetAheadBehind: { ahead: 0, behind: 0 },
        upstreamAheadBehind: { outcome: "tracking", ahead: 1, behind: 0 },
        snapshot: {
          effectiveWorkingDir: workingDir ?? "/repo",
          targetBranch,
          diffScope: diffScope ?? "target",
          observedAtMs: 1731000000000,
        },
      }),
  );
  gitGetWorktreeStatusSummaryMock.mockImplementation(
    async (
      _repoPath: string,
      targetBranch: string,
      diffScope?: "target" | "uncommitted",
      workingDir?: string,
    ): Promise<GitWorktreeStatusSummary> => {
      const fullStatus = withSnapshotHashes({
        currentBranch: { name: "feature/task-10", detached: false },
        fileStatuses: [{ path: "src/main.ts", status: "M", staged: false }],
        fileDiffs:
          (diffScope ?? "target") === "target"
            ? [
                {
                  file: "src/main.ts",
                  type: "modified",
                  additions: 1,
                  deletions: 0,
                  diff: "@@ -1 +1 @@",
                },
              ]
            : [],
        targetAheadBehind: { ahead: 0, behind: 0 },
        upstreamAheadBehind: { outcome: "tracking", ahead: 1, behind: 0 },
        snapshot: {
          effectiveWorkingDir: workingDir ?? "/repo",
          targetBranch,
          diffScope: diffScope ?? "target",
          observedAtMs: 1731000000000,
        },
      });

      return toWorktreeStatusSummary(fullStatus);
    },
  );
});

afterEach(async () => {
  await restoreMockedModules([
    ["@/state/operations/host", async () => actualHostOperationsModule],
    ["@/lib/host-client", async () => actualHostClientModule],
  ]);
});

describe("useAgentStudioDiffData", () => {
  test("loads active scope and reuses cache when switching back to loaded tabs", async () => {
    const harness = createHookHarness(createBaseArgs());

    try {
      await harness.mount();
      await harness.waitFor(() => gitGetWorktreeStatusMock.mock.calls.length >= 1);

      expect(harness.getLatest().diffScope).toBe("uncommitted");
      expect(gitGetWorktreeStatusMock).toHaveBeenNthCalledWith(
        1,
        "/repo",
        "origin/main",
        "uncommitted",
        undefined,
      );
      expect(harness.getLatest().upstreamAheadBehind).toEqual({ ahead: 1, behind: 0 });
      expect(harness.getLatest().fileDiffs).toEqual([]);

      await harness.run((state) => {
        state.setDiffScope("target");
      });
      await harness.waitFor(() => gitGetWorktreeStatusMock.mock.calls.length >= 2);
      expect(gitGetWorktreeStatusMock).toHaveBeenNthCalledWith(
        2,
        "/repo",
        "origin/main",
        "target",
        undefined,
      );
      expect(gitGetWorktreeStatusMock.mock.calls.length).toBe(2);
      expect(harness.getLatest().fileDiffs.length).toBe(1);

      await harness.run((state) => {
        state.setDiffScope("uncommitted");
      });
      await harness.waitFor(() => harness.getLatest().diffScope === "uncommitted");
      expect(gitGetWorktreeStatusMock.mock.calls.length).toBe(2);
      expect(harness.getLatest().fileDiffs).toEqual([]);

      await harness.run((state) => {
        state.setDiffScope("target");
      });
      await harness.waitFor(() => harness.getLatest().diffScope === "target");
      expect(gitGetWorktreeStatusMock.mock.calls.length).toBe(2);
    } finally {
      await harness.unmount();
    }
  });

  test("reuses the cached full snapshot when remounting within the stale window", async () => {
    const firstHarness = createHookHarness(createBaseArgs());
    const secondHarness = createHookHarness(createBaseArgs());

    try {
      await firstHarness.mount();
      await firstHarness.waitFor(() => gitGetWorktreeStatusMock.mock.calls.length >= 1);
      await firstHarness.unmount();

      await secondHarness.mount();
      await secondHarness.waitFor((state) => state.diffScope === "uncommitted" && !state.isLoading);
      expect(secondHarness.getLatest().fileStatuses[0]?.path).toBe("src/main.ts");
      expect(secondHarness.getLatest().upstreamAheadBehind).toEqual({ ahead: 1, behind: 0 });

      expect(gitGetWorktreeStatusMock.mock.calls.length).toBe(1);
    } finally {
      await firstHarness.unmount();
      await secondHarness.unmount();
    }
  });

  test("manual refresh fetches remote before reloading the active scope", async () => {
    const harness = createHookHarness(createBaseArgs());

    try {
      await harness.mount();
      await harness.waitFor(() => gitGetWorktreeStatusMock.mock.calls.length >= 1);

      await harness.run((state) => {
        state.refresh();
      });

      await harness.waitFor(() => gitGetWorktreeStatusMock.mock.calls.length >= 2);
      expect(gitFetchRemoteMock).toHaveBeenCalledTimes(1);
      expect(gitFetchRemoteMock).toHaveBeenNthCalledWith(1, "/repo", "origin/main", undefined);
      expect(gitGetWorktreeStatusMock).toHaveBeenNthCalledWith(
        2,
        "/repo",
        "origin/main",
        "uncommitted",
        undefined,
      );
      expect(gitFetchRemoteMock.mock.invocationCallOrder[0]).toBeLessThan(
        gitGetWorktreeStatusMock.mock.invocationCallOrder[1] ?? Number.POSITIVE_INFINITY,
      );
    } finally {
      await harness.unmount();
    }
  });

  test("manual refresh surfaces fetch failures and does not reload status", async () => {
    const harness = createHookHarness(createBaseArgs());

    try {
      await harness.mount();
      await harness.waitFor(() => gitGetWorktreeStatusMock.mock.calls.length >= 1);
      gitFetchRemoteMock.mockRejectedValueOnce(new Error("Cannot resolve safe remote for refresh"));

      await harness.run((state) => {
        state.refresh();
      });

      await harness.waitFor(
        (state) => state.error === "Error: Cannot resolve safe remote for refresh",
      );
      expect(gitFetchRemoteMock).toHaveBeenCalledTimes(1);
      expect(gitGetWorktreeStatusMock.mock.calls.length).toBe(1);
    } finally {
      await harness.unmount();
    }
  });

  test("manual refresh still reloads local status when fetch is skipped for no remote", async () => {
    const harness = createHookHarness(createBaseArgs());

    try {
      await harness.mount();
      await harness.waitFor(() => gitGetWorktreeStatusMock.mock.calls.length >= 1);
      gitFetchRemoteMock.mockResolvedValueOnce({
        outcome: "skipped_no_remote",
        output:
          "Skipped git fetch because no applicable remote is configured for this repo or branch.",
      });

      await harness.run((state) => {
        state.refresh();
      });

      await harness.waitFor(() => gitGetWorktreeStatusMock.mock.calls.length >= 2);
      expect(gitFetchRemoteMock).toHaveBeenCalledTimes(1);
      expect(gitGetWorktreeStatusMock).toHaveBeenNthCalledWith(
        2,
        "/repo",
        "origin/main",
        "uncommitted",
        undefined,
      );
      expect(harness.getLatest().error).toBeNull();
    } finally {
      await harness.unmount();
    }
  });

  test("soft refresh reloads local status without fetching remote", async () => {
    const harness = createHookHarness(createBaseArgs());

    try {
      await harness.mount();
      await harness.waitFor(() => gitGetWorktreeStatusMock.mock.calls.length >= 1);

      await harness.run((state) => {
        state.refresh("soft");
      });

      await harness.waitFor(() => gitGetWorktreeStatusMock.mock.calls.length >= 2);
      expect(gitFetchRemoteMock).toHaveBeenCalledTimes(0);
      expect(gitGetWorktreeStatusMock).toHaveBeenNthCalledWith(
        2,
        "/repo",
        "origin/main",
        "uncommitted",
        undefined,
      );
    } finally {
      await harness.unmount();
    }
  });

  test("refresh returns a promise that settles after the queued soft reload finishes", async () => {
    const harness = createHookHarness(createBaseArgs());

    try {
      await harness.mount();
      await harness.waitFor(() => gitGetWorktreeStatusMock.mock.calls.length >= 1);

      const deferredRefresh = createDeferred<GitWorktreeStatus>();
      gitGetWorktreeStatusMock.mockImplementationOnce(
        async (
          _repoPath: string,
          targetBranch: string,
          diffScope?: "target" | "uncommitted",
          workingDir?: string,
        ): Promise<GitWorktreeStatus> =>
          deferredRefresh.promise.then((snapshot) => ({
            ...snapshot,
            snapshot: {
              ...snapshot.snapshot,
              targetBranch,
              diffScope: diffScope ?? snapshot.snapshot.diffScope,
              effectiveWorkingDir: workingDir ?? snapshot.snapshot.effectiveWorkingDir,
            },
          })),
      );

      let didSettle = false;
      let refreshPromise: Promise<void> | null = null;
      await harness.run((state) => {
        refreshPromise = state.refresh("soft");
        void refreshPromise.then(() => {
          didSettle = true;
        });
      });

      expect(harness.getLatest().isLoading).toBe(true);
      expect(didSettle).toBe(false);

      if (!refreshPromise) {
        throw new Error("Expected refresh promise");
      }

      await harness.run(async () => {
        deferredRefresh.resolve(
          withSnapshotHashes({
            currentBranch: { name: "feature/task-10", detached: false },
            fileStatuses: [{ path: "src/after-refresh.ts", status: "M", staged: false }],
            fileDiffs: [],
            targetAheadBehind: { ahead: 0, behind: 0 },
            upstreamAheadBehind: { outcome: "tracking", ahead: 1, behind: 0 },
            snapshot: {
              effectiveWorkingDir: "/repo",
              targetBranch: "origin/main",
              diffScope: "uncommitted",
              observedAtMs: 1731000001111,
            },
          }),
        );

        await refreshPromise;
      });
      await harness.waitFor((state) => !state.isLoading);
      expect(didSettle).toBe(true);
      expect(harness.getLatest().fileStatuses[0]?.path).toBe("src/after-refresh.ts");
    } finally {
      await harness.unmount();
    }
  });

  test("scheduled refresh fetches at most once within the cooldown window", async () => {
    const originalDateNow = Date.now;
    let nowMs = 1_731_000_000_000;

    const harness = createHookHarness({
      ...createBaseArgs(),
      enablePolling: true,
    });

    try {
      await harness.mount();
      await harness.waitFor(() => gitGetWorktreeStatusMock.mock.calls.length >= 1);

      Date.now = () => nowMs;
      await harness.run(() => {
        dispatchScheduledRefresh();
      });
      Date.now = originalDateNow;
      await harness.waitFor(() => gitGetWorktreeStatusSummaryMock.mock.calls.length >= 1);
      await harness.run(async () => {
        await Promise.resolve();
      });
      expect(gitFetchRemoteMock).toHaveBeenCalledTimes(1);

      Date.now = () => nowMs;
      await harness.run(() => {
        dispatchScheduledRefresh();
      });
      Date.now = originalDateNow;
      await harness.run(async () => {
        await Promise.resolve();
      });
      expect(gitFetchRemoteMock).toHaveBeenCalledTimes(1);

      nowMs += 5 * 60 * 1000 + 1;
      Date.now = () => nowMs;
      await harness.run(() => {
        dispatchScheduledRefresh();
      });
      Date.now = originalDateNow;
      await harness.waitFor(() => gitFetchRemoteMock.mock.calls.length >= 2);
      await harness.run(async () => {
        await Promise.resolve();
      });
      expect(gitFetchRemoteMock).toHaveBeenCalledTimes(2);
    } finally {
      Date.now = originalDateNow;
      await harness.unmount();
    }
  });

  test("manual refresh bypasses the scheduled refresh cooldown", async () => {
    const originalDateNow = Date.now;
    let nowMs = 1_731_000_000_000;

    const harness = createHookHarness({
      ...createBaseArgs(),
      enablePolling: true,
    });

    try {
      await harness.mount();
      await harness.waitFor(() => gitGetWorktreeStatusMock.mock.calls.length >= 1);

      Date.now = () => nowMs;
      await harness.run(() => {
        dispatchScheduledRefresh();
      });
      Date.now = originalDateNow;
      await harness.waitFor(() => gitGetWorktreeStatusSummaryMock.mock.calls.length >= 1);
      await harness.run(async () => {
        await Promise.resolve();
      });
      expect(gitFetchRemoteMock).toHaveBeenCalledTimes(1);

      nowMs += 60_000;
      Date.now = () => nowMs;
      await harness.run((state) => {
        state.refresh();
      });
      Date.now = originalDateNow;
      await harness.waitFor(() => gitGetWorktreeStatusMock.mock.calls.length >= 2);
      expect(gitFetchRemoteMock).toHaveBeenCalledTimes(2);
    } finally {
      Date.now = originalDateNow;
      await harness.unmount();
    }
  });

  test("scheduled refresh updates the cooldown when fetch is skipped for no remote", async () => {
    const originalDateNow = Date.now;
    let nowMs = 1_731_000_000_000;

    const harness = createHookHarness({
      ...createBaseArgs(),
      enablePolling: true,
    });

    try {
      await harness.mount();
      await harness.waitFor(() => gitGetWorktreeStatusMock.mock.calls.length >= 1);
      gitFetchRemoteMock.mockResolvedValueOnce({
        outcome: "skipped_no_remote",
        output:
          "Skipped git fetch because no applicable remote is configured for this repo or branch.",
      });

      Date.now = () => nowMs;
      await harness.run(() => {
        dispatchScheduledRefresh();
      });
      Date.now = originalDateNow;
      await harness.waitFor(() => gitGetWorktreeStatusSummaryMock.mock.calls.length >= 1);
      await harness.run(async () => {
        await Promise.resolve();
      });
      expect(gitFetchRemoteMock).toHaveBeenCalledTimes(1);

      nowMs += 60_000;
      Date.now = () => nowMs;
      await harness.run(() => {
        dispatchScheduledRefresh();
      });
      Date.now = originalDateNow;
      await harness.waitFor(() => gitGetWorktreeStatusSummaryMock.mock.calls.length >= 2);
      await harness.run(async () => {
        await Promise.resolve();
      });
      expect(gitFetchRemoteMock).toHaveBeenCalledTimes(1);
    } finally {
      Date.now = originalDateNow;
      await harness.unmount();
    }
  });

  test("successful non-refresh loads clear a stale refresh error", async () => {
    const harness = createHookHarness(createBaseArgs());

    try {
      await harness.mount();
      await harness.waitFor(() => gitGetWorktreeStatusMock.mock.calls.length >= 1);
      gitFetchRemoteMock.mockRejectedValueOnce(new Error("Cannot resolve safe remote for refresh"));

      await harness.run((state) => {
        state.refresh();
      });
      await harness.waitFor(
        (state) => state.error === "Error: Cannot resolve safe remote for refresh",
      );

      await harness.run((state) => {
        state.setDiffScope("target");
      });

      await harness.waitFor((state) => state.diffScope === "target");
      await harness.waitFor((state) => state.error === null);
    } finally {
      await harness.unmount();
    }
  });

  test("resets diff scope to uncommitted when repository context changes", async () => {
    const harness = createHookHarness({
      ...createBaseArgs(),
      repoPath: "/repo-a",
    });

    try {
      await harness.mount();
      await harness.waitFor(() => gitGetWorktreeStatusMock.mock.calls.length >= 1);

      await harness.run((state) => {
        state.setDiffScope("target");
      });
      await harness.waitFor(() => gitGetWorktreeStatusMock.mock.calls.length >= 2);
      await harness.waitFor((state) => state.diffScope === "target");

      await harness.update({
        ...createBaseArgs(),
        repoPath: "/repo-b",
      });

      await harness.waitFor((state) => state.diffScope === "uncommitted");
      await harness.waitFor(() => gitGetWorktreeStatusMock.mock.calls.length >= 3);
      expect(gitGetWorktreeStatusMock).toHaveBeenNthCalledWith(
        3,
        "/repo-b",
        "origin/main",
        "uncommitted",
        undefined,
      );
    } finally {
      await harness.unmount();
    }
  });

  test("refresh syncs shared branch/upstream fields for cached inactive scope", async () => {
    const harness = createHookHarness(createBaseArgs());

    try {
      await harness.mount();
      await harness.waitFor(() => gitGetWorktreeStatusMock.mock.calls.length >= 1);

      await harness.run((state) => {
        state.setDiffScope("target");
      });
      await harness.waitFor(() => gitGetWorktreeStatusMock.mock.calls.length >= 2);
      await harness.waitFor((state) => state.diffScope === "target");

      gitGetWorktreeStatusMock.mockImplementation(
        async (
          _repoPath: string,
          targetBranch: string,
          diffScope?: "target" | "uncommitted",
          workingDir?: string,
        ): Promise<GitWorktreeStatus> =>
          withSnapshotHashes({
            currentBranch: { name: "feature/task-11", detached: false },
            fileStatuses: [{ path: "src/updated.ts", status: "M", staged: false }],
            fileDiffs:
              (diffScope ?? "target") === "target"
                ? [
                    {
                      file: "src/updated.ts",
                      type: "modified",
                      additions: 4,
                      deletions: 1,
                      diff: "@@ -1 +1 @@",
                    },
                  ]
                : [],
            targetAheadBehind: { ahead: 2, behind: 1 },
            upstreamAheadBehind: { outcome: "tracking", ahead: 5, behind: 2 },
            snapshot: {
              effectiveWorkingDir: workingDir ?? "/repo",
              targetBranch,
              diffScope: diffScope ?? "target",
              observedAtMs: 1731000000001,
            },
          }),
      );

      await harness.run((state) => {
        state.refresh();
      });
      await harness.waitFor((state) => state.branch === "feature/task-11");
      expect(gitGetWorktreeStatusMock.mock.calls.length).toBe(3);

      await harness.run((state) => {
        state.setDiffScope("uncommitted");
      });
      await harness.waitFor((state) => state.diffScope === "uncommitted");

      expect(gitGetWorktreeStatusMock.mock.calls.length).toBe(3);
      expect(harness.getLatest().branch).toBe("feature/task-11");
      expect(harness.getLatest().upstreamAheadBehind).toEqual({ ahead: 5, behind: 2 });
      expect(harness.getLatest().fileDiffs).toEqual([]);
    } finally {
      await harness.unmount();
    }
  });

  test("reloads compare data when repository branch identity changes", async () => {
    const harness = createHookHarness({
      ...createBaseArgs(),
      defaultTargetBranch: { branch: "@{upstream}" },
      branchIdentityKey: "branch:main",
    });

    try {
      await harness.mount();
      await harness.waitFor(() => gitGetWorktreeStatusMock.mock.calls.length >= 1);
      expect(harness.getLatest().branch).toBe("feature/task-10");

      gitGetWorktreeStatusMock.mockImplementation(
        async (
          _repoPath: string,
          targetBranch: string,
          diffScope?: "target" | "uncommitted",
          workingDir?: string,
        ): Promise<GitWorktreeStatus> =>
          withSnapshotHashes({
            currentBranch: { name: "feature/switched", detached: false },
            fileStatuses: [{ path: "src/switched.ts", status: "M", staged: false }],
            fileDiffs:
              (diffScope ?? "target") === "target"
                ? [
                    {
                      file: "src/switched.ts",
                      type: "modified",
                      additions: 5,
                      deletions: 1,
                      diff: "@@ -1 +1,5 @@",
                    },
                  ]
                : [],
            targetAheadBehind: { ahead: 2, behind: 0 },
            upstreamAheadBehind: { outcome: "tracking", ahead: 2, behind: 0 },
            snapshot: {
              effectiveWorkingDir: workingDir ?? "/repo",
              targetBranch,
              diffScope: diffScope ?? "target",
              observedAtMs: 1731000000200,
            },
          }),
      );

      await harness.update({
        ...createBaseArgs(),
        defaultTargetBranch: { branch: "@{upstream}" },
        branchIdentityKey: "branch:feature/switched",
      });

      await harness.waitFor((state) => state.branch === "feature/switched");
      await harness.run((state) => {
        state.setDiffScope("target");
      });
      await harness.waitFor((state) => state.diffScope === "target");
      expect(harness.getLatest().fileDiffs[0]).toMatchObject({
        file: "src/switched.ts",
        additions: 5,
      });
    } finally {
      await harness.unmount();
    }
  });

  test("forces the first inactive-scope reload after branch identity changes", async () => {
    const harness = createHookHarness({
      ...createBaseArgs(),
      defaultTargetBranch: { branch: "@{upstream}" },
      branchIdentityKey: "branch:main",
    });

    try {
      await harness.mount();
      await harness.waitFor(() => gitGetWorktreeStatusMock.mock.calls.length >= 1);

      await harness.run((state) => {
        state.setDiffScope("target");
      });
      await harness.waitFor(() => gitGetWorktreeStatusMock.mock.calls.length >= 2);
      expect(gitGetWorktreeStatusMock.mock.calls.length).toBe(2);

      gitGetWorktreeStatusMock.mockImplementation(
        async (
          _repoPath: string,
          targetBranch: string,
          diffScope?: "target" | "uncommitted",
          workingDir?: string,
        ): Promise<GitWorktreeStatus> =>
          withSnapshotHashes({
            currentBranch: { name: "feature/switched", detached: false },
            fileStatuses:
              (diffScope ?? "target") === "target"
                ? [{ path: "src/switched.ts", status: "M", staged: false }]
                : [{ path: "src/worktree-switched.ts", status: "M", staged: false }],
            fileDiffs:
              (diffScope ?? "target") === "target"
                ? [
                    {
                      file: "src/switched.ts",
                      type: "modified",
                      additions: 5,
                      deletions: 1,
                      diff: "@@ -1 +1,5 @@",
                    },
                  ]
                : [
                    {
                      file: "src/worktree-switched.ts",
                      type: "modified",
                      additions: 3,
                      deletions: 0,
                      diff: "@@ -1 +1,3 @@",
                    },
                  ],
            targetAheadBehind: { ahead: 2, behind: 0 },
            upstreamAheadBehind: { outcome: "tracking", ahead: 2, behind: 0 },
            snapshot: {
              effectiveWorkingDir: workingDir ?? "/repo",
              targetBranch,
              diffScope: diffScope ?? "target",
              observedAtMs: 1731000000300,
            },
          }),
      );

      await harness.update({
        ...createBaseArgs(),
        defaultTargetBranch: { branch: "@{upstream}" },
        branchIdentityKey: "branch:feature/switched",
      });

      await harness.waitFor((state) => state.branch === "feature/switched");
      await harness.waitFor((state) => state.diffScope === "uncommitted");
      expect(gitGetWorktreeStatusMock.mock.calls.length).toBe(3);

      expect(harness.getLatest().fileDiffs).toEqual([
        {
          file: "src/worktree-switched.ts",
          type: "modified",
          additions: 3,
          deletions: 0,
          diff: "@@ -1 +1,3 @@",
        },
      ]);
    } finally {
      await harness.unmount();
    }
  });

  test("refresh syncs upstream status changes across cached inactive scope", async () => {
    const harness = createHookHarness({
      ...createBaseArgs(),
      defaultTargetBranch: { branch: "@{upstream}" },
    });

    try {
      await harness.mount();
      await harness.waitFor(() => gitGetWorktreeStatusMock.mock.calls.length >= 1);
      expect(harness.getLatest().upstreamStatus).toBe("tracking");

      await harness.run((state) => {
        state.setDiffScope("target");
      });
      await harness.waitFor(() => gitGetWorktreeStatusMock.mock.calls.length >= 2);
      expect(harness.getLatest().upstreamStatus).toBe("tracking");
      await harness.waitFor((state) => state.diffScope === "target");

      gitGetWorktreeStatusMock.mockImplementation(
        async (
          _repoPath: string,
          targetBranch: string,
          diffScope?: "target" | "uncommitted",
          workingDir?: string,
        ): Promise<GitWorktreeStatus> =>
          withSnapshotHashes({
            currentBranch: { name: "feature/task-10", detached: false },
            fileStatuses: [{ path: "src/main.ts", status: "M", staged: false }],
            fileDiffs:
              (diffScope ?? "target") === "target"
                ? []
                : [
                    {
                      file: "src/main.ts",
                      type: "modified",
                      additions: 1,
                      deletions: 0,
                      diff: "@@ -1 +1 @@",
                    },
                  ],
            targetAheadBehind: { ahead: 1, behind: 0 },
            upstreamAheadBehind: { outcome: "untracked", ahead: 1 },
            snapshot: {
              effectiveWorkingDir: workingDir ?? "/repo",
              targetBranch,
              diffScope: diffScope ?? "target",
              observedAtMs: 1731000000001,
            },
          }),
      );

      await harness.run((state) => {
        state.refresh();
      });
      await harness.waitFor((state) => state.upstreamStatus === "untracked");
      expect(harness.getLatest().upstreamAheadBehind).toEqual({ ahead: 1, behind: 0 });

      await harness.run((state) => {
        state.setDiffScope("uncommitted");
      });
      await harness.waitFor((state) => state.diffScope === "uncommitted");

      expect(gitGetWorktreeStatusMock.mock.calls.length).toBe(3);
      expect(harness.getLatest().upstreamStatus).toBe("untracked");
      expect(harness.getLatest().upstreamAheadBehind).toEqual({ ahead: 1, behind: 0 });
    } finally {
      await harness.unmount();
    }
  });

  test("visibility refresh invalidates the inactive scope so switching scopes triggers a fresh full reload", async () => {
    const harness = createHookHarness({
      ...createBaseArgs(),
      enablePolling: true,
    });

    try {
      await harness.mount();
      await harness.waitFor(() => gitGetWorktreeStatusMock.mock.calls.length >= 1);

      await harness.run((state) => {
        state.setDiffScope("target");
      });
      await harness.waitFor(() => gitGetWorktreeStatusMock.mock.calls.length >= 2);
      await harness.waitFor((state) => state.diffScope === "target");

      gitGetWorktreeStatusMock.mockImplementation(
        async (
          _repoPath: string,
          targetBranch: string,
          diffScope?: "target" | "uncommitted",
          workingDir?: string,
        ): Promise<GitWorktreeStatus> =>
          withSnapshotHashes({
            currentBranch: { name: "feature/task-11", detached: false },
            fileStatuses: [{ path: "src/updated.ts", status: "M", staged: false }],
            fileDiffs:
              (diffScope ?? "target") === "target"
                ? [
                    {
                      file: "src/updated.ts",
                      type: "modified",
                      additions: 4,
                      deletions: 1,
                      diff: "@@ -1 +1 @@",
                    },
                  ]
                : [
                    {
                      file: "src/worktree.ts",
                      type: "modified",
                      additions: 2,
                      deletions: 0,
                      diff: "@@ -1 +1,2 @@",
                    },
                  ],
            targetAheadBehind: { ahead: 2, behind: 1 },
            upstreamAheadBehind: { outcome: "tracking", ahead: 5, behind: 2 },
            snapshot: {
              effectiveWorkingDir: workingDir ?? "/repo",
              targetBranch,
              diffScope: diffScope ?? "target",
              observedAtMs: 1731000000001,
            },
          }),
      );
      gitGetWorktreeStatusSummaryMock.mockImplementation(
        async (
          _repoPath: string,
          targetBranch: string,
          diffScope?: "target" | "uncommitted",
          workingDir?: string,
        ): Promise<GitWorktreeStatusSummary> =>
          toWorktreeStatusSummary(
            withSnapshotHashes({
              currentBranch: { name: "feature/task-11", detached: false },
              fileStatuses: [{ path: "src/updated.ts", status: "M", staged: false }],
              fileDiffs:
                (diffScope ?? "target") === "target"
                  ? [
                      {
                        file: "src/updated.ts",
                        type: "modified",
                        additions: 4,
                        deletions: 1,
                        diff: "@@ -1 +1 @@",
                      },
                    ]
                  : [
                      {
                        file: "src/worktree.ts",
                        type: "modified",
                        additions: 2,
                        deletions: 0,
                        diff: "@@ -1 +1,2 @@",
                      },
                    ],
              targetAheadBehind: { ahead: 2, behind: 1 },
              upstreamAheadBehind: { outcome: "tracking", ahead: 5, behind: 2 },
              snapshot: {
                effectiveWorkingDir: workingDir ?? "/repo",
                targetBranch,
                diffScope: diffScope ?? "target",
                observedAtMs: 1731000000001,
              },
            }),
          ),
      );

      await harness.run(() => {
        dispatchDiffRefresh();
      });
      await harness.waitFor(() => gitGetWorktreeStatusSummaryMock.mock.calls.length >= 1);
      await harness.waitFor(() => gitGetWorktreeStatusMock.mock.calls.length >= 3);
      expect(harness.getLatest().branch).toBe("feature/task-11");

      await harness.run((state) => {
        state.setDiffScope("uncommitted");
      });
      await harness.waitFor(() => gitGetWorktreeStatusMock.mock.calls.length >= 4);
      await harness.waitFor((state) => state.diffScope === "uncommitted");

      expect(harness.getLatest().fileDiffs).toEqual([
        {
          file: "src/worktree.ts",
          type: "modified",
          additions: 2,
          deletions: 0,
          diff: "@@ -1 +1,2 @@",
        },
      ]);
    } finally {
      await harness.unmount();
    }
  });

  test("visibility refresh requests a summary for the active scope", async () => {
    const harness = createHookHarness({
      ...createBaseArgs(),
      enablePolling: true,
    });

    try {
      await harness.mount();
      await harness.waitFor(() => gitGetWorktreeStatusMock.mock.calls.length >= 1);

      await harness.run(() => {
        dispatchDiffRefresh();
      });
      await harness.waitFor(() => gitGetWorktreeStatusSummaryMock.mock.calls.length >= 1);
      expect(gitGetWorktreeStatusSummaryMock).toHaveBeenNthCalledWith(
        1,
        "/repo",
        "origin/main",
        "uncommitted",
        undefined,
      );
      expect(gitGetWorktreeStatusMock.mock.calls.length).toBe(1);

      await harness.run((state) => {
        state.setDiffScope("target");
      });
      await harness.waitFor(() => gitGetWorktreeStatusMock.mock.calls.length >= 2);
      expect(gitGetWorktreeStatusMock).toHaveBeenNthCalledWith(
        2,
        "/repo",
        "origin/main",
        "target",
        undefined,
      );

      await harness.run(() => {
        dispatchDiffRefresh();
      });
      await harness.waitFor(() => gitGetWorktreeStatusSummaryMock.mock.calls.length >= 2);
      expect(gitGetWorktreeStatusSummaryMock).toHaveBeenNthCalledWith(
        2,
        "/repo",
        "origin/main",
        "target",
        undefined,
      );
      expect(gitGetWorktreeStatusMock.mock.calls.length).toBe(2);
    } finally {
      await harness.unmount();
    }
  });

  test("visibility refresh summary requests do not invalidate an in-flight full reload", async () => {
    const pendingFullReload = createDeferred<GitWorktreeStatus>();
    let fullRequestCount = 0;
    gitGetWorktreeStatusMock.mockImplementation(
      async (
        _repoPath: string,
        targetBranch: string,
        diffScope?: "target" | "uncommitted",
        workingDir?: string,
      ): Promise<GitWorktreeStatus> => {
        fullRequestCount += 1;

        if (fullRequestCount === 2) {
          return pendingFullReload.promise.then((snapshot) => ({
            ...snapshot,
            snapshot: {
              ...snapshot.snapshot,
              targetBranch,
              diffScope: diffScope ?? snapshot.snapshot.diffScope,
              effectiveWorkingDir: workingDir ?? snapshot.snapshot.effectiveWorkingDir,
            },
          }));
        }

        return withSnapshotHashes({
          currentBranch: { name: "feature/base", detached: false },
          fileStatuses: [{ path: "src/base.ts", status: "M", staged: false }],
          fileDiffs: [
            {
              file: "src/base.ts",
              type: "modified",
              additions: 1,
              deletions: 0,
              diff: "@@ -1 +1 @@",
            },
          ],
          targetAheadBehind: { ahead: 0, behind: 0 },
          upstreamAheadBehind: { outcome: "tracking", ahead: 0, behind: 0 },
          snapshot: {
            effectiveWorkingDir: workingDir ?? "/repo",
            targetBranch,
            diffScope: diffScope ?? "target",
            observedAtMs: 1731000000000,
          },
        });
      },
    );
    gitGetWorktreeStatusSummaryMock.mockImplementation(
      async (
        _repoPath: string,
        targetBranch: string,
        diffScope?: "target" | "uncommitted",
        workingDir?: string,
      ): Promise<GitWorktreeStatusSummary> =>
        toWorktreeStatusSummary(
          withSnapshotHashes({
            currentBranch: { name: "feature/summary", detached: false },
            fileStatuses: [{ path: "src/summary.ts", status: "M", staged: false }],
            fileDiffs: [],
            targetAheadBehind: { ahead: 1, behind: 0 },
            upstreamAheadBehind: { outcome: "tracking", ahead: 1, behind: 0 },
            snapshot: {
              effectiveWorkingDir: workingDir ?? "/repo",
              targetBranch,
              diffScope: diffScope ?? "target",
              observedAtMs: 1731000000100,
            },
          }),
        ),
    );

    const harness = createHookHarness({
      ...createBaseArgs(),
      enablePolling: true,
    });

    try {
      await harness.mount();
      await harness.waitFor(() => gitGetWorktreeStatusMock.mock.calls.length >= 1);

      await harness.run((state) => {
        state.refresh();
      });
      await harness.waitFor(() => gitGetWorktreeStatusMock.mock.calls.length >= 2);

      await harness.run(() => {
        dispatchDiffRefresh();
      });
      await harness.run(async () => {
        await Promise.resolve();
      });
      expect(gitGetWorktreeStatusSummaryMock.mock.calls.length).toBe(0);
      expect(harness.getLatest().branch).toBe("feature/base");

      pendingFullReload.resolve(
        withSnapshotHashes({
          currentBranch: { name: "feature/full", detached: false },
          fileStatuses: [{ path: "src/full.ts", status: "M", staged: false }],
          fileDiffs: [
            {
              file: "src/full.ts",
              type: "modified",
              additions: 5,
              deletions: 1,
              diff: "@@ -1 +1 @@\n-old\n+new\n",
            },
          ],
          targetAheadBehind: { ahead: 2, behind: 0 },
          upstreamAheadBehind: { outcome: "tracking", ahead: 2, behind: 0 },
          snapshot: {
            effectiveWorkingDir: "/repo",
            targetBranch: "origin/main",
            diffScope: "target",
            observedAtMs: 1731000000200,
          },
        }),
      );

      await harness.waitFor((state) => state.branch === "feature/full");
      expect(harness.getLatest().fileDiffs[0]?.file).toBe("src/full.ts");

      await harness.run(() => {
        dispatchDiffRefresh();
      });
      await harness.waitFor(() => gitGetWorktreeStatusSummaryMock.mock.calls.length >= 1);
      await harness.waitFor(() => gitGetWorktreeStatusMock.mock.calls.length >= 3);
      expect(harness.getLatest().branch).toBe("feature/base");
    } finally {
      await harness.unmount();
    }
  });

  test("visibility refresh persists hash metadata changes even when derived shared fields stay equal", async () => {
    const originalDateNow = Date.now;
    let nowMs = 1_731_000_000_000;

    let fullRequestCount = 0;
    gitGetWorktreeStatusMock.mockImplementation(
      async (
        _repoPath: string,
        targetBranch: string,
        diffScope?: "target" | "uncommitted",
        workingDir?: string,
      ): Promise<GitWorktreeStatus> => {
        fullRequestCount += 1;

        if (fullRequestCount === 1) {
          return withSnapshotHashes({
            currentBranch: { name: "feature/task-10", detached: false },
            fileStatuses: [{ path: "src/main.ts", status: "M", staged: false }],
            fileDiffs:
              (diffScope ?? "target") === "target"
                ? [
                    {
                      file: "src/main.ts",
                      type: "modified",
                      additions: 1,
                      deletions: 0,
                      diff: "@@ -1 +1 @@",
                    },
                  ]
                : [],
            targetAheadBehind: { ahead: 1, behind: 0 },
            upstreamAheadBehind: { outcome: "tracking", ahead: 1, behind: 0 },
            snapshot: {
              effectiveWorkingDir: workingDir ?? "/repo",
              targetBranch,
              diffScope: diffScope ?? "target",
              observedAtMs: 1731000000000,
            },
          });
        }

        return withSnapshotHashes({
          currentBranch: { name: "feature/task-10", detached: false },
          fileStatuses: [
            { path: "src/a.ts", status: "M", staged: false },
            { path: "src/b.ts", status: "A", staged: true },
            { path: "src/c.ts", status: "D", staged: false },
            { path: "src/d.ts", status: "M", staged: false },
          ],
          fileDiffs:
            (diffScope ?? "target") === "target"
              ? [
                  {
                    file: "src/main.ts",
                    type: "modified",
                    additions: 1,
                    deletions: 0,
                    diff: "@@ -1 +1 @@",
                  },
                ]
              : [],
          targetAheadBehind: { ahead: 1, behind: 0 },
          upstreamAheadBehind: { outcome: "tracking", ahead: 1, behind: 0 },
          snapshot: {
            effectiveWorkingDir: workingDir ?? "/repo",
            targetBranch,
            diffScope: diffScope ?? "target",
            observedAtMs: 1731000000100,
          },
        });
      },
    );

    gitGetWorktreeStatusSummaryMock.mockImplementation(
      async (
        _repoPath: string,
        targetBranch: string,
        diffScope?: "target" | "uncommitted",
        workingDir?: string,
      ): Promise<GitWorktreeStatusSummary> => {
        const status = withSnapshotHashes({
          currentBranch: { name: "feature/task-10", detached: false },
          fileStatuses: [{ path: "src/main.ts", status: "M", staged: false }],
          fileDiffs:
            (diffScope ?? "target") === "target"
              ? [
                  {
                    file: "src/main.ts",
                    type: "modified",
                    additions: 1,
                    deletions: 0,
                    diff: "@@ -1 +1 @@",
                  },
                ]
              : [],
          targetAheadBehind: { ahead: 1, behind: 0 },
          upstreamAheadBehind: { outcome: "untracked", ahead: 1 },
          snapshot: {
            effectiveWorkingDir: workingDir ?? "/repo",
            targetBranch,
            diffScope: diffScope ?? "target",
            observedAtMs: 1731000000000,
          },
        });

        return toWorktreeStatusSummary(status);
      },
    );

    Date.now = () => nowMs;

    const harness = createHookHarness({
      ...createBaseArgs(),
      enablePolling: true,
    });

    try {
      await harness.mount();
      await harness.waitFor(() => gitGetWorktreeStatusMock.mock.calls.length >= 1);
      const firstState = harness.getLatest();
      expect(firstState.upstreamAheadBehind).toEqual({ ahead: 1, behind: 0 });

      await harness.run(() => {
        dispatchDiffRefresh();
      });
      await harness.waitFor(() => gitGetWorktreeStatusSummaryMock.mock.calls.length >= 1);
      const secondState = harness.getLatest();
      expect(secondState.upstreamAheadBehind).toEqual({ ahead: 1, behind: 0 });
      expect(secondState).not.toBe(firstState);

      nowMs += 6_000;
      await harness.run(() => {
        dispatchDiffRefresh();
      });
      await harness.waitFor(() => gitGetWorktreeStatusSummaryMock.mock.calls.length >= 2);
      const thirdState = harness.getLatest();
      expect(thirdState).toEqual(secondState);
    } finally {
      await harness.unmount();
      Date.now = originalDateNow;
    }
  });

  test("visibility refresh updates uncommitted file count from summary payloads", async () => {
    let fullRequestCount = 0;
    gitGetWorktreeStatusMock.mockImplementation(
      async (
        _repoPath: string,
        targetBranch: string,
        diffScope?: "target" | "uncommitted",
        workingDir?: string,
      ): Promise<GitWorktreeStatus> => {
        fullRequestCount += 1;

        if (fullRequestCount === 1) {
          return withSnapshotHashes({
            currentBranch: { name: "feature/task-10", detached: false },
            fileStatuses: [{ path: "src/main.ts", status: "M", staged: false }],
            fileDiffs:
              (diffScope ?? "target") === "target"
                ? [
                    {
                      file: "src/main.ts",
                      type: "modified",
                      additions: 1,
                      deletions: 0,
                      diff: "@@ -1 +1 @@",
                    },
                  ]
                : [],
            targetAheadBehind: { ahead: 1, behind: 0 },
            upstreamAheadBehind: { outcome: "tracking", ahead: 1, behind: 0 },
            snapshot: {
              effectiveWorkingDir: workingDir ?? "/repo",
              targetBranch,
              diffScope: diffScope ?? "target",
              observedAtMs: 1731000000000,
            },
          });
        }

        return withSnapshotHashes({
          currentBranch: { name: "feature/task-10", detached: false },
          fileStatuses: [
            { path: "src/a.ts", status: "M", staged: false },
            { path: "src/b.ts", status: "A", staged: true },
            { path: "src/c.ts", status: "D", staged: false },
            { path: "src/d.ts", status: "M", staged: false },
          ],
          fileDiffs:
            (diffScope ?? "target") === "target"
              ? [
                  {
                    file: "src/main.ts",
                    type: "modified",
                    additions: 1,
                    deletions: 0,
                    diff: "@@ -1 +1 @@",
                  },
                ]
              : [],
          targetAheadBehind: { ahead: 1, behind: 0 },
          upstreamAheadBehind: { outcome: "tracking", ahead: 1, behind: 0 },
          snapshot: {
            effectiveWorkingDir: workingDir ?? "/repo",
            targetBranch,
            diffScope: diffScope ?? "target",
            observedAtMs: 1731000000100,
          },
        });
      },
    );

    gitGetWorktreeStatusSummaryMock.mockImplementation(
      async (
        _repoPath: string,
        targetBranch: string,
        diffScope?: "target" | "uncommitted",
        workingDir?: string,
      ): Promise<GitWorktreeStatusSummary> => {
        const status = withSnapshotHashes({
          currentBranch: { name: "feature/task-10", detached: false },
          fileStatuses: [
            { path: "src/a.ts", status: "M", staged: false },
            { path: "src/b.ts", status: "A", staged: true },
            { path: "src/c.ts", status: "D", staged: false },
            { path: "src/d.ts", status: "M", staged: false },
          ],
          fileDiffs:
            (diffScope ?? "target") === "target"
              ? [
                  {
                    file: "src/main.ts",
                    type: "modified",
                    additions: 1,
                    deletions: 0,
                    diff: "@@ -1 +1 @@",
                  },
                ]
              : [],
          targetAheadBehind: { ahead: 1, behind: 0 },
          upstreamAheadBehind: { outcome: "tracking", ahead: 1, behind: 0 },
          snapshot: {
            effectiveWorkingDir: workingDir ?? "/repo",
            targetBranch,
            diffScope: diffScope ?? "target",
            observedAtMs: 1731000000000,
          },
        });

        return toWorktreeStatusSummary(status);
      },
    );

    const harness = createHookHarness({
      ...createBaseArgs(),
      enablePolling: true,
    });

    try {
      await harness.mount();
      await harness.waitFor(() => gitGetWorktreeStatusMock.mock.calls.length >= 1);
      expect(harness.getLatest().uncommittedFileCount).toBe(1);

      await harness.run(() => {
        dispatchDiffRefresh();
      });
      await harness.waitFor(() => gitGetWorktreeStatusSummaryMock.mock.calls.length >= 1);
      await harness.waitFor(() => gitGetWorktreeStatusMock.mock.calls.length >= 2);
      await harness.waitFor((state) => state.uncommittedFileCount === 4);
    } finally {
      await harness.unmount();
    }
  });

  test("visibility refresh triggers a full reload when summary hashes show file status changes", async () => {
    let fullRequestCount = 0;
    gitGetWorktreeStatusMock.mockImplementation(
      async (
        _repoPath: string,
        targetBranch: string,
        diffScope?: "target" | "uncommitted",
        workingDir?: string,
      ): Promise<GitWorktreeStatus> => {
        fullRequestCount += 1;

        if (fullRequestCount === 1) {
          return withSnapshotHashes({
            currentBranch: { name: "feature/conflict", detached: false },
            fileStatuses: [{ path: "AGENTS.md", status: "unmerged", staged: false }],
            fileDiffs:
              (diffScope ?? "target") === "target"
                ? [
                    {
                      file: "AGENTS.md",
                      type: "modified",
                      additions: 3,
                      deletions: 1,
                      diff: "@@ -1 +1 @@",
                    },
                  ]
                : [],
            targetAheadBehind: { ahead: 1, behind: 0 },
            upstreamAheadBehind: { outcome: "tracking", ahead: 1, behind: 0 },
            snapshot: {
              effectiveWorkingDir: workingDir ?? "/repo",
              targetBranch,
              diffScope: diffScope ?? "target",
              observedAtMs: 1731000000000,
            },
          });
        }

        return withSnapshotHashes({
          currentBranch: { name: "feature/resolved", detached: false },
          fileStatuses: [{ path: "AGENTS.md", status: "M", staged: false }],
          fileDiffs:
            (diffScope ?? "target") === "target"
              ? [
                  {
                    file: "AGENTS.md",
                    type: "modified",
                    additions: 5,
                    deletions: 2,
                    diff: "@@ -1 +1 @@\n-old\n+new\n",
                  },
                ]
              : [],
          targetAheadBehind: { ahead: 1, behind: 0 },
          upstreamAheadBehind: { outcome: "tracking", ahead: 1, behind: 0 },
          snapshot: {
            effectiveWorkingDir: workingDir ?? "/repo",
            targetBranch,
            diffScope: diffScope ?? "target",
            observedAtMs: 1731000000100,
          },
        });
      },
    );
    gitGetWorktreeStatusSummaryMock.mockImplementation(
      async (
        _repoPath: string,
        targetBranch: string,
        diffScope?: "target" | "uncommitted",
        workingDir?: string,
      ): Promise<GitWorktreeStatusSummary> =>
        toWorktreeStatusSummary(
          withSnapshotHashes({
            currentBranch: { name: "feature/resolved", detached: false },
            fileStatuses: [{ path: "AGENTS.md", status: "M", staged: false }],
            fileDiffs:
              (diffScope ?? "target") === "target"
                ? [
                    {
                      file: "AGENTS.md",
                      type: "modified",
                      additions: 5,
                      deletions: 2,
                      diff: "@@ -1 +1 @@\n-old\n+new\n",
                    },
                  ]
                : [],
            targetAheadBehind: { ahead: 1, behind: 0 },
            upstreamAheadBehind: { outcome: "tracking", ahead: 1, behind: 0 },
            snapshot: {
              effectiveWorkingDir: workingDir ?? "/repo",
              targetBranch,
              diffScope: diffScope ?? "target",
              observedAtMs: 1731000000100,
            },
          }),
        ),
    );

    const harness = createHookHarness({
      ...createBaseArgs(),
      enablePolling: true,
    });

    try {
      await harness.mount();
      await harness.waitFor(() => gitGetWorktreeStatusMock.mock.calls.length >= 1);
      expect(harness.getLatest().fileStatuses).toEqual([
        { path: "AGENTS.md", status: "unmerged", staged: false },
      ]);

      await harness.run(() => {
        dispatchDiffRefresh();
      });
      await harness.waitFor(() => gitGetWorktreeStatusSummaryMock.mock.calls.length >= 1);
      await harness.waitFor(() => gitGetWorktreeStatusMock.mock.calls.length >= 2);

      expect(harness.getLatest().fileStatuses).toEqual([
        { path: "AGENTS.md", status: "M", staged: false },
      ]);
      expect(harness.getLatest().branch).toBe("feature/resolved");
    } finally {
      await harness.unmount();
    }
  });

  test("visibility refresh triggers a full reload when non-conflict summary hashes change", async () => {
    let targetFullRequestCount = 0;
    gitGetWorktreeStatusMock.mockImplementation(
      async (
        _repoPath: string,
        targetBranch: string,
        diffScope?: "target" | "uncommitted",
        workingDir?: string,
      ): Promise<GitWorktreeStatus> => {
        if ((diffScope ?? "target") !== "target") {
          return withSnapshotHashes({
            currentBranch: { name: "feature/task-10", detached: false },
            fileStatuses: [{ path: "src/main.ts", status: "M", staged: false }],
            fileDiffs: [],
            targetAheadBehind: { ahead: 1, behind: 0 },
            upstreamAheadBehind: { outcome: "tracking", ahead: 1, behind: 0 },
            snapshot: {
              effectiveWorkingDir: workingDir ?? "/repo",
              targetBranch,
              diffScope: diffScope ?? "target",
              observedAtMs: 1731000000000,
            },
          });
        }

        targetFullRequestCount += 1;

        if (targetFullRequestCount === 1) {
          return withSnapshotHashes({
            currentBranch: { name: "feature/task-10", detached: false },
            fileStatuses: [{ path: "src/main.ts", status: "M", staged: false }],
            fileDiffs: [
              {
                file: "src/main.ts",
                type: "modified",
                additions: 1,
                deletions: 1,
                diff: "@@ -1 +1 @@\n-old\n+draft\n",
              },
            ],
            targetAheadBehind: { ahead: 1, behind: 0 },
            upstreamAheadBehind: { outcome: "tracking", ahead: 1, behind: 0 },
            snapshot: {
              effectiveWorkingDir: workingDir ?? "/repo",
              targetBranch,
              diffScope: diffScope ?? "target",
              observedAtMs: 1731000000000,
            },
          });
        }

        return withSnapshotHashes({
          currentBranch: { name: "feature/task-10", detached: false },
          fileStatuses: [{ path: "src/main.ts", status: "M", staged: false }],
          fileDiffs: [
            {
              file: "src/main.ts",
              type: "modified",
              additions: 3,
              deletions: 1,
              diff: "@@ -1 +1,2 @@\n-old\n+new\n+line\n",
            },
          ],
          targetAheadBehind: { ahead: 1, behind: 0 },
          upstreamAheadBehind: { outcome: "tracking", ahead: 1, behind: 0 },
          snapshot: {
            effectiveWorkingDir: workingDir ?? "/repo",
            targetBranch,
            diffScope: diffScope ?? "target",
            observedAtMs: 1731000000100,
          },
        });
      },
    );
    gitGetWorktreeStatusSummaryMock.mockImplementation(
      async (
        _repoPath: string,
        targetBranch: string,
        diffScope?: "target" | "uncommitted",
        workingDir?: string,
      ): Promise<GitWorktreeStatusSummary> =>
        toWorktreeStatusSummary(
          withSnapshotHashes({
            currentBranch: { name: "feature/task-10", detached: false },
            fileStatuses: [{ path: "src/main.ts", status: "M", staged: false }],
            fileDiffs:
              (diffScope ?? "target") === "target"
                ? [
                    {
                      file: "src/main.ts",
                      type: "modified",
                      additions: 3,
                      deletions: 1,
                      diff: "@@ -1 +1,2 @@\n-old\n+new\n+line\n",
                    },
                  ]
                : [],
            targetAheadBehind: { ahead: 1, behind: 0 },
            upstreamAheadBehind: { outcome: "tracking", ahead: 1, behind: 0 },
            snapshot: {
              effectiveWorkingDir: workingDir ?? "/repo",
              targetBranch,
              diffScope: diffScope ?? "target",
              observedAtMs: 1731000000100,
            },
          }),
        ),
    );

    const harness = createHookHarness({
      ...createBaseArgs(),
      enablePolling: true,
    });

    try {
      await harness.mount();
      await harness.waitFor(() => gitGetWorktreeStatusMock.mock.calls.length >= 1);
      await harness.run((state) => {
        state.setDiffScope("target");
      });
      await harness.waitFor(() => gitGetWorktreeStatusMock.mock.calls.length >= 2);
      expect(harness.getLatest().fileDiffs[0]?.additions).toBe(1);

      await harness.run(() => {
        dispatchDiffRefresh();
      });
      await harness.waitFor(() => gitGetWorktreeStatusSummaryMock.mock.calls.length >= 1);
      await harness.waitFor(() => gitGetWorktreeStatusMock.mock.calls.length >= 3);

      expect(harness.getLatest().fileDiffs[0]).toMatchObject({
        file: "src/main.ts",
        additions: 3,
      });
    } finally {
      await harness.unmount();
    }
  });

  test("reloads inactive scope after repository context changes", async () => {
    const harness = createHookHarness({
      ...createBaseArgs(),
      repoPath: "/repo-a",
    });

    try {
      await harness.mount();
      await harness.waitFor(() => gitGetWorktreeStatusMock.mock.calls.length >= 1);

      await harness.run((state) => {
        state.setDiffScope("target");
      });
      await harness.waitFor(() => gitGetWorktreeStatusMock.mock.calls.length >= 2);
      expect(gitGetWorktreeStatusMock.mock.calls.length).toBe(2);

      await harness.update({
        ...createBaseArgs(),
        repoPath: "/repo-b",
      });
      await harness.waitFor(() => gitGetWorktreeStatusMock.mock.calls.length >= 3);
      expect(gitGetWorktreeStatusMock).toHaveBeenNthCalledWith(
        3,
        "/repo-b",
        "origin/main",
        "uncommitted",
        undefined,
      );

      await harness.run((state) => {
        state.setDiffScope("target");
      });
      await harness.waitFor(() => gitGetWorktreeStatusMock.mock.calls.length >= 4);
      expect(gitGetWorktreeStatusMock).toHaveBeenNthCalledWith(
        4,
        "/repo-b",
        "origin/main",
        "target",
        undefined,
      );
    } finally {
      await harness.unmount();
    }
  });

  test("does not drop same-scope reload when context changes during in-flight request", async () => {
    const firstRequest = createDeferred<GitWorktreeStatus>();
    const secondRequest = createDeferred<GitWorktreeStatus>();
    const queue = [firstRequest, secondRequest];

    gitGetWorktreeStatusMock.mockImplementation(
      async (
        _repoPath: string,
        targetBranch: string,
        diffScope?: "target" | "uncommitted",
        workingDir?: string,
      ): Promise<GitWorktreeStatus> => {
        const deferred = queue.shift();
        if (!deferred) {
          throw new Error("No deferred response left");
        }

        return deferred.promise.then((snapshot) => ({
          ...snapshot,
          snapshot: {
            ...snapshot.snapshot,
            targetBranch,
            diffScope: diffScope ?? snapshot.snapshot.diffScope,
            effectiveWorkingDir: workingDir ?? snapshot.snapshot.effectiveWorkingDir,
          },
        }));
      },
    );

    const harness = createHookHarness({
      ...createBaseArgs(),
      repoPath: "/repo-a",
    });

    try {
      await harness.mount();
      await harness.waitFor(() => gitGetWorktreeStatusMock.mock.calls.length >= 1);

      await harness.update({
        ...createBaseArgs(),
        repoPath: "/repo-b",
      });

      await harness.waitFor(() => gitGetWorktreeStatusMock.mock.calls.length >= 2);
      expect(gitGetWorktreeStatusMock).toHaveBeenNthCalledWith(
        2,
        "/repo-b",
        "origin/main",
        "uncommitted",
        undefined,
      );

      secondRequest.resolve(
        withSnapshotHashes({
          currentBranch: { name: "feature/repo-b", detached: false },
          fileStatuses: [{ path: "src/repo-b.ts", status: "M", staged: false }],
          fileDiffs: [
            {
              file: "src/repo-b.ts",
              type: "modified",
              additions: 3,
              deletions: 1,
              diff: "@@ -1 +1 @@",
            },
          ],
          targetAheadBehind: { ahead: 0, behind: 0 },
          upstreamAheadBehind: { outcome: "tracking", ahead: 0, behind: 0 },
          snapshot: {
            effectiveWorkingDir: "/repo-b",
            targetBranch: "origin/main",
            diffScope: "target",
            observedAtMs: 1731000002000,
          },
        }),
      );

      await harness.waitFor((state) => state.branch === "feature/repo-b");

      firstRequest.resolve(
        withSnapshotHashes({
          currentBranch: { name: "feature/repo-a", detached: false },
          fileStatuses: [{ path: "src/repo-a.ts", status: "M", staged: false }],
          fileDiffs: [
            {
              file: "src/repo-a.ts",
              type: "modified",
              additions: 1,
              deletions: 0,
              diff: "@@ -1 +1 @@",
            },
          ],
          targetAheadBehind: { ahead: 0, behind: 0 },
          upstreamAheadBehind: { outcome: "tracking", ahead: 0, behind: 0 },
          snapshot: {
            effectiveWorkingDir: "/repo-a",
            targetBranch: "origin/main",
            diffScope: "target",
            observedAtMs: 1731000001000,
          },
        }),
      );

      await harness.run(async () => {
        await Promise.resolve();
      });

      expect(harness.getLatest().branch).toBe("feature/repo-b");
      expect(harness.getLatest().fileDiffs[0]?.file).toBe("src/repo-b.ts");
    } finally {
      await harness.unmount();
    }
  });

  test("keeps loading active until the latest diff scope request settles", async () => {
    const targetRequest = createDeferred<GitWorktreeStatus>();
    const uncommittedRequest = createDeferred<GitWorktreeStatus>();

    gitGetWorktreeStatusMock.mockImplementation(
      async (
        _repoPath: string,
        targetBranch: string,
        diffScope?: "target" | "uncommitted",
        workingDir?: string,
      ): Promise<GitWorktreeStatus> => {
        const deferred = diffScope === "uncommitted" ? uncommittedRequest : targetRequest;
        return deferred.promise.then((snapshot) => ({
          ...snapshot,
          snapshot: {
            ...snapshot.snapshot,
            targetBranch,
            diffScope: diffScope ?? snapshot.snapshot.diffScope,
            effectiveWorkingDir: workingDir ?? snapshot.snapshot.effectiveWorkingDir,
          },
        }));
      },
    );

    const harness = createHookHarness(createBaseArgs());

    try {
      await harness.mount();
      await harness.waitFor((state) => state.isLoading);

      await harness.run((state) => {
        state.setDiffScope("target");
      });
      await harness.waitFor(() => gitGetWorktreeStatusMock.mock.calls.length >= 2);

      uncommittedRequest.resolve(
        withSnapshotHashes({
          currentBranch: { name: "feature/uncommitted", detached: false },
          fileStatuses: [{ path: "src/uncommitted.ts", status: "M", staged: false }],
          fileDiffs: [],
          targetAheadBehind: { ahead: 0, behind: 0 },
          upstreamAheadBehind: { outcome: "tracking", ahead: 0, behind: 0 },
          snapshot: {
            effectiveWorkingDir: "/repo",
            targetBranch: "origin/main",
            diffScope: "uncommitted",
            observedAtMs: 1731000001000,
          },
        }),
      );

      await harness.run(async () => {
        await Promise.resolve();
      });

      expect(harness.getLatest().isLoading).toBe(true);

      targetRequest.resolve(
        withSnapshotHashes({
          currentBranch: { name: "feature/target", detached: false },
          fileStatuses: [{ path: "src/target.ts", status: "M", staged: false }],
          fileDiffs: [
            {
              file: "src/target.ts",
              type: "modified",
              additions: 1,
              deletions: 0,
              diff: "@@ -1 +1 @@",
            },
          ],
          targetAheadBehind: { ahead: 0, behind: 0 },
          upstreamAheadBehind: { outcome: "tracking", ahead: 0, behind: 0 },
          snapshot: {
            effectiveWorkingDir: "/repo",
            targetBranch: "origin/main",
            diffScope: "target",
            observedAtMs: 1731000002000,
          },
        }),
      );

      await harness.waitFor((state) => !state.isLoading && state.diffScope === "target");
    } finally {
      await harness.unmount();
    }
  });

  test("keeps loading active when a stale request settles after repository context reset", async () => {
    const firstRequest = createDeferred<GitWorktreeStatus>();
    const secondRequest = createDeferred<GitWorktreeStatus>();
    const queue = [firstRequest, secondRequest];

    gitGetWorktreeStatusMock.mockImplementation(
      async (
        _repoPath: string,
        targetBranch: string,
        diffScope?: "target" | "uncommitted",
        workingDir?: string,
      ): Promise<GitWorktreeStatus> => {
        const deferred = queue.shift();
        if (!deferred) {
          throw new Error("No deferred response left");
        }

        return deferred.promise.then((snapshot) => ({
          ...snapshot,
          snapshot: {
            ...snapshot.snapshot,
            targetBranch,
            diffScope: diffScope ?? snapshot.snapshot.diffScope,
            effectiveWorkingDir: workingDir ?? snapshot.snapshot.effectiveWorkingDir,
          },
        }));
      },
    );

    const harness = createHookHarness({
      ...createBaseArgs(),
      repoPath: "/repo-a",
    });

    try {
      await harness.mount();
      await harness.waitFor((state) => state.isLoading);

      await harness.update({
        ...createBaseArgs(),
        repoPath: "/repo-b",
      });
      await harness.waitFor(() => gitGetWorktreeStatusMock.mock.calls.length >= 2);
      expect(harness.getLatest().isLoading).toBe(true);

      firstRequest.resolve(
        withSnapshotHashes({
          currentBranch: { name: "feature/repo-a", detached: false },
          fileStatuses: [{ path: "src/repo-a.ts", status: "M", staged: false }],
          fileDiffs: [
            {
              file: "src/repo-a.ts",
              type: "modified",
              additions: 1,
              deletions: 0,
              diff: "@@ -1 +1 @@",
            },
          ],
          targetAheadBehind: { ahead: 0, behind: 0 },
          upstreamAheadBehind: { outcome: "tracking", ahead: 0, behind: 0 },
          snapshot: {
            effectiveWorkingDir: "/repo-a",
            targetBranch: "origin/main",
            diffScope: "target",
            observedAtMs: 1731000001000,
          },
        }),
      );

      await harness.run(async () => {
        await Promise.resolve();
      });

      expect(harness.getLatest().isLoading).toBe(true);

      secondRequest.resolve(
        withSnapshotHashes({
          currentBranch: { name: "feature/repo-b", detached: false },
          fileStatuses: [{ path: "src/repo-b.ts", status: "M", staged: false }],
          fileDiffs: [
            {
              file: "src/repo-b.ts",
              type: "modified",
              additions: 2,
              deletions: 0,
              diff: "@@ -1 +1,2 @@",
            },
          ],
          targetAheadBehind: { ahead: 0, behind: 0 },
          upstreamAheadBehind: { outcome: "tracking", ahead: 0, behind: 0 },
          snapshot: {
            effectiveWorkingDir: "/repo-b",
            targetBranch: "origin/main",
            diffScope: "target",
            observedAtMs: 1731000002000,
          },
        }),
      );

      await harness.waitFor((state) => !state.isLoading && state.branch === "feature/repo-b");
    } finally {
      await harness.unmount();
    }
  });

  test("replays queued full refreshes after an in-flight refresh settles", async () => {
    const firstRequest = createDeferred<GitWorktreeStatus>();
    const secondRequest = createDeferred<GitWorktreeStatus>();
    const queue = [firstRequest, secondRequest];

    gitGetWorktreeStatusMock.mockImplementation(
      async (
        _repoPath: string,
        targetBranch: string,
        diffScope?: "target" | "uncommitted",
        workingDir?: string,
      ): Promise<GitWorktreeStatus> => {
        const deferred = queue.shift();
        if (!deferred) {
          throw new Error("No deferred response left");
        }

        return deferred.promise.then((snapshot) => ({
          ...snapshot,
          snapshot: {
            ...snapshot.snapshot,
            targetBranch,
            diffScope: diffScope ?? snapshot.snapshot.diffScope,
            effectiveWorkingDir: workingDir ?? snapshot.snapshot.effectiveWorkingDir,
          },
        }));
      },
    );

    const harness = createHookHarness(createBaseArgs());

    try {
      await harness.mount();
      await harness.waitFor(() => gitGetWorktreeStatusMock.mock.calls.length >= 1);

      await harness.run((state) => {
        state.refresh();
      });
      expect(gitGetWorktreeStatusMock.mock.calls.length).toBe(1);

      firstRequest.resolve(
        withSnapshotHashes({
          currentBranch: { name: "feature/first", detached: false },
          fileStatuses: [{ path: "src/first.ts", status: "M", staged: false }],
          fileDiffs: [
            {
              file: "src/first.ts",
              type: "modified",
              additions: 1,
              deletions: 0,
              diff: "@@ -1 +1 @@",
            },
          ],
          targetAheadBehind: { ahead: 0, behind: 0 },
          upstreamAheadBehind: { outcome: "tracking", ahead: 0, behind: 0 },
          snapshot: {
            effectiveWorkingDir: "/repo",
            targetBranch: "origin/main",
            diffScope: "target",
            observedAtMs: 1731000001000,
          },
        }),
      );
      await harness.waitFor(() => gitGetWorktreeStatusMock.mock.calls.length >= 2);

      secondRequest.resolve(
        withSnapshotHashes({
          currentBranch: { name: "feature/second", detached: false },
          fileStatuses: [{ path: "src/second.ts", status: "M", staged: false }],
          fileDiffs: [
            {
              file: "src/second.ts",
              type: "modified",
              additions: 2,
              deletions: 0,
              diff: "@@ -1 +1,2 @@",
            },
          ],
          targetAheadBehind: { ahead: 0, behind: 0 },
          upstreamAheadBehind: { outcome: "tracking", ahead: 0, behind: 0 },
          snapshot: {
            effectiveWorkingDir: "/repo",
            targetBranch: "origin/main",
            diffScope: "target",
            observedAtMs: 1731000002000,
          },
        }),
      );
      await harness.waitFor((state) => state.branch === "feature/second");

      expect(harness.getLatest().fileDiffs[0]?.file).toBe("src/second.ts");
    } finally {
      await harness.unmount();
    }
  });

  test("queues one additional refresh cycle while fetch is in flight", async () => {
    const firstFetch = createDeferred<GitFetchRemoteMockResult>();
    const secondFetch = createDeferred<GitFetchRemoteMockResult>();
    const fetchQueue = [firstFetch, secondFetch];

    gitFetchRemoteMock.mockImplementation(async () => {
      const deferred = fetchQueue.shift();
      if (!deferred) {
        throw new Error("No deferred fetch response left");
      }

      return deferred.promise;
    });

    const harness = createHookHarness(createBaseArgs());

    try {
      await harness.mount();
      await harness.waitFor(() => gitGetWorktreeStatusMock.mock.calls.length >= 1);

      await harness.run((state) => {
        state.refresh();
        state.refresh();
      });

      expect(gitFetchRemoteMock).toHaveBeenCalledTimes(1);

      firstFetch.resolve({ outcome: "fetched", output: "From origin" });
      await harness.waitFor(() => gitFetchRemoteMock.mock.calls.length >= 2);

      secondFetch.resolve({ outcome: "fetched", output: "From origin" });
      await harness.waitFor(() => gitGetWorktreeStatusMock.mock.calls.length >= 3);

      expect(gitFetchRemoteMock).toHaveBeenCalledTimes(2);
      expect(gitGetWorktreeStatusMock.mock.calls.length).toBe(3);
    } finally {
      await harness.unmount();
    }
  });

  test("does not reload a new repo context when an older refresh fetch resolves", async () => {
    const pendingFetch = createDeferred<GitFetchRemoteMockResult>();

    gitFetchRemoteMock.mockImplementation(async () => pendingFetch.promise);

    const harness = createHookHarness({
      ...createBaseArgs(),
      repoPath: "/repo-a",
    });

    try {
      await harness.mount();
      await harness.waitFor(() => gitGetWorktreeStatusMock.mock.calls.length >= 1);

      await harness.run((state) => {
        state.refresh();
      });
      expect(gitFetchRemoteMock).toHaveBeenCalledTimes(1);
      expect(gitGetWorktreeStatusMock.mock.calls.length).toBe(1);

      await harness.update({
        ...createBaseArgs(),
        repoPath: "/repo-b",
      });
      await harness.waitFor(() => gitGetWorktreeStatusMock.mock.calls.length >= 2);
      expect(gitGetWorktreeStatusMock).toHaveBeenNthCalledWith(
        2,
        "/repo-b",
        "origin/main",
        "uncommitted",
        undefined,
      );

      pendingFetch.resolve({ outcome: "fetched", output: "From origin" });
      await harness.run(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(gitGetWorktreeStatusMock.mock.calls.length).toBe(2);
      expect(gitFetchRemoteMock).toHaveBeenCalledTimes(1);
    } finally {
      await harness.unmount();
    }
  });

  test("does not reload a new worktree context when an older refresh fetch resolves", async () => {
    const pendingFetch = createDeferred<GitFetchRemoteMockResult>();

    gitFetchRemoteMock.mockImplementation(async () => pendingFetch.promise);

    const harness = createHookHarness({
      ...createBaseArgs(),
      worktreePath: "/repo/.worktrees/run-1",
    });

    try {
      await harness.mount();
      await harness.waitFor(() => gitGetWorktreeStatusMock.mock.calls.length >= 1);
      expect(gitGetWorktreeStatusMock).toHaveBeenNthCalledWith(
        1,
        "/repo",
        "origin/main",
        "uncommitted",
        "/repo/.worktrees/run-1",
      );

      await harness.run((state) => {
        state.refresh();
      });
      expect(gitFetchRemoteMock).toHaveBeenCalledTimes(1);
      expect(gitFetchRemoteMock).toHaveBeenNthCalledWith(
        1,
        "/repo",
        "origin/main",
        "/repo/.worktrees/run-1",
      );

      await harness.update({
        ...createBaseArgs(),
        worktreePath: "/repo/.worktrees/run-2",
      });
      await harness.waitFor(() => gitGetWorktreeStatusMock.mock.calls.length >= 2);
      expect(gitGetWorktreeStatusMock).toHaveBeenNthCalledWith(
        2,
        "/repo",
        "origin/main",
        "uncommitted",
        "/repo/.worktrees/run-2",
      );

      pendingFetch.resolve({ outcome: "fetched", output: "From origin" });
      await harness.run(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(gitGetWorktreeStatusMock.mock.calls.length).toBe(2);
      expect(gitFetchRemoteMock).toHaveBeenCalledTimes(1);
    } finally {
      await harness.unmount();
    }
  });

  test("ignores stale in-flight response after repo path is cleared", async () => {
    const pendingRequest = createDeferred<GitWorktreeStatus>();

    gitGetWorktreeStatusMock.mockImplementation(
      async (
        _repoPath: string,
        targetBranch: string,
        diffScope?: "target" | "uncommitted",
        workingDir?: string,
      ): Promise<GitWorktreeStatus> => {
        return pendingRequest.promise.then((snapshot) => ({
          ...snapshot,
          snapshot: {
            ...snapshot.snapshot,
            targetBranch,
            diffScope: diffScope ?? snapshot.snapshot.diffScope,
            effectiveWorkingDir: workingDir ?? snapshot.snapshot.effectiveWorkingDir,
          },
        }));
      },
    );

    const harness = createHookHarness({
      ...createBaseArgs(),
      repoPath: "/repo-a",
    });

    try {
      await harness.mount();
      await harness.waitFor(() => gitGetWorktreeStatusMock.mock.calls.length >= 1);

      await harness.update({
        ...createBaseArgs(),
        repoPath: null,
      });
      await harness.waitFor((state) => state.branch === null && state.fileDiffs.length === 0);

      pendingRequest.resolve(
        withSnapshotHashes({
          currentBranch: { name: "feature/stale", detached: false },
          fileStatuses: [{ path: "src/stale.ts", status: "M", staged: false }],
          fileDiffs: [
            {
              file: "src/stale.ts",
              type: "modified",
              additions: 1,
              deletions: 0,
              diff: "@@ -1 +1 @@",
            },
          ],
          targetAheadBehind: { ahead: 0, behind: 0 },
          upstreamAheadBehind: { outcome: "tracking", ahead: 0, behind: 0 },
          snapshot: {
            effectiveWorkingDir: "/repo-a",
            targetBranch: "origin/main",
            diffScope: "target",
            observedAtMs: 1731000003000,
          },
        }),
      );

      await harness.run(async () => {
        await Promise.resolve();
      });

      expect(harness.getLatest().branch).toBeNull();
      expect(harness.getLatest().fileDiffs).toEqual([]);
      expect(harness.getLatest().fileStatuses).toEqual([]);
    } finally {
      await harness.unmount();
    }
  });

  test("keeps newer shared fields when older response resolves from another scope", async () => {
    const targetRequest = createDeferred<GitWorktreeStatus>();
    const uncommittedRequest = createDeferred<GitWorktreeStatus>();
    const queue = [uncommittedRequest, targetRequest];

    gitGetWorktreeStatusMock.mockImplementation(
      async (
        _repoPath: string,
        targetBranch: string,
        diffScope?: "target" | "uncommitted",
        workingDir?: string,
      ): Promise<GitWorktreeStatus> => {
        const deferred = queue.shift();
        if (!deferred) {
          throw new Error("No deferred response left");
        }

        return deferred.promise.then((snapshot) => ({
          ...snapshot,
          snapshot: {
            ...snapshot.snapshot,
            targetBranch,
            diffScope: diffScope ?? snapshot.snapshot.diffScope,
            effectiveWorkingDir: workingDir ?? snapshot.snapshot.effectiveWorkingDir,
          },
        }));
      },
    );

    const harness = createHookHarness(createBaseArgs());

    try {
      await harness.mount();
      await harness.waitFor(() => gitGetWorktreeStatusMock.mock.calls.length >= 1);

      await harness.run((state) => {
        state.setDiffScope("target");
      });
      await harness.waitFor(() => gitGetWorktreeStatusMock.mock.calls.length >= 2);

      targetRequest.resolve(
        withSnapshotHashes({
          currentBranch: { name: "feature/newer", detached: false },
          fileStatuses: [{ path: "src/newer.ts", status: "M", staged: false }],
          fileDiffs: [
            {
              file: "src/newer.ts",
              type: "modified",
              additions: 1,
              deletions: 0,
              diff: "@@ -1 +1 @@",
            },
          ],
          targetAheadBehind: { ahead: 2, behind: 1 },
          upstreamAheadBehind: { outcome: "tracking", ahead: 4, behind: 1 },
          snapshot: {
            effectiveWorkingDir: "/repo",
            targetBranch: "origin/main",
            diffScope: "target",
            observedAtMs: 1731000004000,
          },
        }),
      );
      await harness.waitFor((state) => state.branch === "feature/newer");

      uncommittedRequest.resolve(
        withSnapshotHashes({
          currentBranch: { name: "feature/older", detached: false },
          fileStatuses: [{ path: "src/older.ts", status: "M", staged: false }],
          fileDiffs: [],
          targetAheadBehind: { ahead: 0, behind: 0 },
          upstreamAheadBehind: { outcome: "tracking", ahead: 0, behind: 0 },
          snapshot: {
            effectiveWorkingDir: "/repo",
            targetBranch: "origin/main",
            diffScope: "uncommitted",
            observedAtMs: 1731000003000,
          },
        }),
      );

      await harness.run(async () => {
        await Promise.resolve();
      });

      const latest = harness.getLatest();
      expect(latest.diffScope).toBe("target");
      expect(latest.branch).toBe("feature/newer");
      expect(latest.fileStatuses[0]?.path).toBe("src/newer.ts");
      expect(latest.commitsAheadBehind).toEqual({ ahead: 2, behind: 1 });
    } finally {
      await harness.unmount();
    }
  });

  test("blocks diff loading while the snapshot reports worktree resolution is pending", async () => {
    const harness = createHookHarness({
      ...createBaseArgs(),
      worktreeResolutionTaskId: "run-1",
      shouldBlockDiffLoading: true,
      isWorktreeResolutionResolving: true,
    });

    try {
      await harness.mount();
      await harness.run(async () => {
        await Promise.resolve();
      });

      expect(gitGetWorktreeStatusMock).not.toHaveBeenCalled();
      expect(harness.getLatest().worktreePath).toBeNull();
      expect(harness.getLatest().isLoading).toBe(true);
    } finally {
      await harness.unmount();
    }
  });

  test("refresh retries snapshot-owned worktree resolution before loading diff data", async () => {
    const harness = createHookHarness({
      ...createBaseArgs(),
      worktreeResolutionTaskId: "run-1",
      shouldBlockDiffLoading: true,
      worktreeResolutionError:
        "Failed to resolve task worktree path for task run-1. Use Refresh to retry.",
    });

    try {
      await harness.mount();
      expect(gitGetWorktreeStatusMock).not.toHaveBeenCalled();

      await harness.run((state) => {
        state.refresh();
      });

      expect(retryWorktreeResolutionMock).toHaveBeenCalledTimes(1);
      expect(gitGetWorktreeStatusMock).not.toHaveBeenCalled();
    } finally {
      await harness.unmount();
    }
  });

  test("blocks diff loading and reports actionable error when task target branch metadata is invalid", async () => {
    const harness = createHookHarness({
      ...createBaseArgs(),
      preconditionError:
        "Invalid openducktor.targetBranch metadata: missing field `branch`. Fix the saved task metadata or choose a valid target branch again.",
    });

    try {
      await harness.mount();
      await harness.waitFor(
        (state) =>
          state.error ===
          "Invalid openducktor.targetBranch metadata: missing field `branch`. Fix the saved task metadata or choose a valid target branch again.",
      );

      expect(taskWorktreeEntriesMock).not.toHaveBeenCalled();
      expect(gitGetWorktreeStatusMock).not.toHaveBeenCalled();
      expect(harness.getLatest().worktreePath).toBeNull();
    } finally {
      await harness.unmount();
    }
  });

  test("keeps polling listeners stable across rerenders with unchanged inputs", async () => {
    const originalWindowAddEventListener = globalThis.addEventListener.bind(globalThis);
    const originalWindowRemoveEventListener = globalThis.removeEventListener.bind(globalThis);
    const originalDocumentAddEventListener = document.addEventListener.bind(document);
    const originalDocumentRemoveEventListener = document.removeEventListener.bind(document);
    const windowAddEventListenerMock = mock(
      (
        type: string,
        listener: EventListenerOrEventListenerObject,
        options?: AddEventListenerOptions | boolean,
      ) => {
        originalWindowAddEventListener(type, listener, options);
      },
    );
    const windowRemoveEventListenerMock = mock(
      (
        type: string,
        listener: EventListenerOrEventListenerObject,
        options?: EventListenerOptions | boolean,
      ) => {
        originalWindowRemoveEventListener(type, listener, options);
      },
    );
    const documentAddEventListenerMock = mock(
      (
        type: string,
        listener: EventListenerOrEventListenerObject,
        options?: AddEventListenerOptions | boolean,
      ) => {
        originalDocumentAddEventListener(type, listener, options);
      },
    );
    const documentRemoveEventListenerMock = mock(
      (
        type: string,
        listener: EventListenerOrEventListenerObject,
        options?: EventListenerOptions | boolean,
      ) => {
        originalDocumentRemoveEventListener(type, listener, options);
      },
    );
    globalThis.addEventListener = windowAddEventListenerMock as typeof globalThis.addEventListener;
    globalThis.removeEventListener =
      windowRemoveEventListenerMock as typeof globalThis.removeEventListener;
    document.addEventListener = documentAddEventListenerMock as typeof document.addEventListener;
    document.removeEventListener =
      documentRemoveEventListenerMock as typeof document.removeEventListener;

    const pollingArgs = {
      ...createBaseArgs(),
      enablePolling: true,
    } satisfies HookArgs;
    const harness = createHookHarness(pollingArgs);

    try {
      await harness.mount();
      await harness.waitFor(() => gitGetWorktreeStatusMock.mock.calls.length >= 1);

      expect(windowAddEventListenerMock).toHaveBeenCalledWith("focus", expect.any(Function));
      expect(documentAddEventListenerMock).toHaveBeenCalledWith(
        "visibilitychange",
        expect.any(Function),
      );
      expect(windowRemoveEventListenerMock).not.toHaveBeenCalled();
      expect(documentRemoveEventListenerMock).not.toHaveBeenCalled();

      windowAddEventListenerMock.mockClear();
      windowRemoveEventListenerMock.mockClear();
      documentAddEventListenerMock.mockClear();
      documentRemoveEventListenerMock.mockClear();

      await harness.update(pollingArgs);
      await harness.run(async () => {
        await Promise.resolve();
      });

      expect(windowAddEventListenerMock).not.toHaveBeenCalled();
      expect(windowRemoveEventListenerMock).not.toHaveBeenCalled();
      expect(documentAddEventListenerMock).not.toHaveBeenCalled();
      expect(documentRemoveEventListenerMock).not.toHaveBeenCalled();
    } finally {
      await harness.unmount();
      globalThis.addEventListener = originalWindowAddEventListener;
      globalThis.removeEventListener = originalWindowRemoveEventListener;
      document.addEventListener = originalDocumentAddEventListener;
      document.removeEventListener = originalDocumentRemoveEventListener;
    }
  });

  test("canonicalizes short target branch names to origin-prefixed refs", async () => {
    const harness = createHookHarness({
      ...createBaseArgs(),
      defaultTargetBranch: { remote: "origin", branch: "main" },
    });

    try {
      await harness.mount();
      await harness.waitFor(() => gitGetWorktreeStatusMock.mock.calls.length >= 1);

      expect(harness.getLatest().targetBranch).toBe("origin/main");
      expect(gitGetWorktreeStatusMock).toHaveBeenNthCalledWith(
        1,
        "/repo",
        "origin/main",
        "uncommitted",
        undefined,
      );
    } finally {
      await harness.unmount();
    }
  });

  test("maps untracked-upstream outcome to push-ahead count without error banner", async () => {
    gitGetWorktreeStatusMock.mockImplementation(
      async (
        _repoPath: string,
        targetBranch: string,
        _diffScope?: "target" | "uncommitted",
        _workingDir?: string,
      ): Promise<GitWorktreeStatus> =>
        withSnapshotHashes({
          currentBranch: { name: "feature/task-10", detached: false },
          fileStatuses: [],
          fileDiffs: [],
          targetAheadBehind: { ahead: 3, behind: 1 },
          upstreamAheadBehind: { outcome: "untracked", ahead: 3 },
          snapshot: {
            effectiveWorkingDir: "/repo",
            targetBranch,
            diffScope: "target",
            observedAtMs: 1731000000000,
          },
        }),
    );

    const harness = createHookHarness(createBaseArgs());

    try {
      await harness.mount();
      await harness.waitFor(() => gitGetWorktreeStatusMock.mock.calls.length >= 1);

      expect(harness.getLatest().upstreamAheadBehind).toEqual({ ahead: 3, behind: 0 });
      expect(harness.getLatest().error).toBeNull();
    } finally {
      await harness.unmount();
    }
  });

  test("preserves tracking upstream behind counts for UI divergence indicators", async () => {
    gitGetWorktreeStatusMock.mockImplementation(
      async (
        _repoPath: string,
        targetBranch: string,
        _diffScope?: "target" | "uncommitted",
        _workingDir?: string,
      ): Promise<GitWorktreeStatus> =>
        withSnapshotHashes({
          currentBranch: { name: "feature/task-10", detached: false },
          fileStatuses: [],
          fileDiffs: [],
          targetAheadBehind: { ahead: 1, behind: 0 },
          upstreamAheadBehind: { outcome: "tracking", ahead: 0, behind: 1 },
          snapshot: {
            effectiveWorkingDir: "/repo",
            targetBranch,
            diffScope: "target",
            observedAtMs: 1731000000000,
          },
        }),
    );

    const harness = createHookHarness(createBaseArgs());

    try {
      await harness.mount();
      await harness.waitFor(() => gitGetWorktreeStatusMock.mock.calls.length >= 1);

      expect(harness.getLatest().upstreamAheadBehind).toEqual({ ahead: 0, behind: 1 });
      expect(harness.getLatest().error).toBeNull();
    } finally {
      await harness.unmount();
    }
  });

  test("keeps upstream ahead/behind null when upstream lookup fails", async () => {
    gitGetWorktreeStatusMock.mockImplementation(
      async (
        _repoPath: string,
        targetBranch: string,
        _diffScope?: "target" | "uncommitted",
        _workingDir?: string,
      ): Promise<GitWorktreeStatus> => {
        return withSnapshotHashes({
          currentBranch: { name: "feature/task-10", detached: false },
          fileStatuses: [],
          fileDiffs: [],
          targetAheadBehind: { ahead: 0, behind: 0 },
          upstreamAheadBehind: { outcome: "error", message: "upstream unavailable" },
          snapshot: {
            effectiveWorkingDir: "/repo",
            targetBranch,
            diffScope: "target",
            observedAtMs: 1731000000000,
          },
        });
      },
    );

    const harness = createHookHarness(createBaseArgs());

    try {
      await harness.mount();
      await harness.waitFor(() => gitGetWorktreeStatusMock.mock.calls.length >= 1);

      expect(harness.getLatest().upstreamAheadBehind).toBeNull();
      expect(harness.getLatest().error).toContain("Upstream status unavailable");
    } finally {
      await harness.unmount();
    }
  });
});

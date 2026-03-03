import { beforeAll, beforeEach, describe, expect, mock, test } from "bun:test";
import type { GitWorktreeStatus } from "@openducktor/contracts";
import {
  createHookHarness as createSharedHookHarness,
  enableReactActEnvironment,
} from "./agent-studio-test-utils";

enableReactActEnvironment();

const runsListMock = mock(async (): Promise<Array<{ runId: string; worktreePath: string }>> => []);
const gitGetWorktreeStatusMock = mock(
  async (
    _repoPath: string,
    targetBranch: string,
    diffScope?: "target" | "uncommitted",
    workingDir?: string,
  ): Promise<GitWorktreeStatus> => ({
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

mock.module("@/state/operations/host", () => ({
  host: {
    runsList: runsListMock,
    gitGetWorktreeStatus: gitGetWorktreeStatusMock,
  },
}));

type UseAgentStudioDiffDataHook =
  typeof import("./use-agent-studio-diff-data")["useAgentStudioDiffData"];

let useAgentStudioDiffData: UseAgentStudioDiffDataHook;

type HookArgs = Parameters<UseAgentStudioDiffDataHook>[0];

const createHookHarness = (initialProps: HookArgs) =>
  createSharedHookHarness(useAgentStudioDiffData, initialProps);

const createDeferred = <T,>() => {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });

  return { promise, resolve, reject };
};

const createBaseArgs = (): HookArgs => ({
  repoPath: "/repo",
  sessionWorkingDirectory: null,
  sessionRunId: null,
  defaultTargetBranch: "origin/main",
  enablePolling: false,
});

beforeAll(async () => {
  ({ useAgentStudioDiffData } = await import("./use-agent-studio-diff-data"));
});

beforeEach(() => {
  runsListMock.mockClear();
  gitGetWorktreeStatusMock.mockClear();
  gitGetWorktreeStatusMock.mockImplementation(
    async (
      _repoPath: string,
      targetBranch: string,
      diffScope?: "target" | "uncommitted",
      workingDir?: string,
    ): Promise<GitWorktreeStatus> => ({
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
});

describe("useAgentStudioDiffData", () => {
  test("loads active scope and reuses cache when switching back to loaded tabs", async () => {
    const harness = createHookHarness(createBaseArgs());

    try {
      await harness.mount();
      await harness.waitFor(() => gitGetWorktreeStatusMock.mock.calls.length >= 1);

      expect(harness.getLatest().diffScope).toBe("target");
      expect(gitGetWorktreeStatusMock).toHaveBeenNthCalledWith(
        1,
        "/repo",
        "origin/main",
        "target",
        undefined,
      );
      expect(harness.getLatest().upstreamAheadBehind).toEqual({ ahead: 1, behind: 0 });
      expect(harness.getLatest().fileDiffs.length).toBe(1);

      await harness.run((state) => {
        state.setDiffScope("uncommitted");
      });
      await harness.waitFor(() => gitGetWorktreeStatusMock.mock.calls.length >= 2);
      expect(gitGetWorktreeStatusMock).toHaveBeenNthCalledWith(
        2,
        "/repo",
        "origin/main",
        "uncommitted",
        undefined,
      );
      expect(gitGetWorktreeStatusMock.mock.calls.length).toBe(2);
      expect(harness.getLatest().fileDiffs).toEqual([]);

      await harness.run((state) => {
        state.setDiffScope("target");
      });
      await harness.waitFor(() => harness.getLatest().diffScope === "target");
      expect(gitGetWorktreeStatusMock.mock.calls.length).toBe(2);
      expect(harness.getLatest().fileDiffs.length).toBe(1);

      await harness.run((state) => {
        state.setDiffScope("uncommitted");
      });
      await harness.waitFor(() => harness.getLatest().diffScope === "uncommitted");
      expect(gitGetWorktreeStatusMock.mock.calls.length).toBe(2);
    } finally {
      await harness.unmount();
    }
  });

  test("manual refresh updates active scope without extra background scope call", async () => {
    const harness = createHookHarness(createBaseArgs());

    try {
      await harness.mount();
      await harness.waitFor(() => gitGetWorktreeStatusMock.mock.calls.length >= 1);

      await harness.run((state) => {
        state.refresh();
      });

      await harness.waitFor(() => gitGetWorktreeStatusMock.mock.calls.length >= 2);
      expect(gitGetWorktreeStatusMock).toHaveBeenNthCalledWith(
        2,
        "/repo",
        "origin/main",
        "target",
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
        state.setDiffScope("uncommitted");
      });
      await harness.waitFor(() => gitGetWorktreeStatusMock.mock.calls.length >= 2);

      await harness.run((state) => {
        state.setDiffScope("target");
      });
      await harness.waitFor((state) => state.diffScope === "target");

      gitGetWorktreeStatusMock.mockImplementation(
        async (
          _repoPath: string,
          targetBranch: string,
          diffScope?: "target" | "uncommitted",
          workingDir?: string,
        ): Promise<GitWorktreeStatus> => ({
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

  test("polling schedules one periodic request for the active scope", async () => {
    const originalSetInterval = globalThis.setInterval;
    const originalClearInterval = globalThis.clearInterval;
    let intervalCallback: (() => void) | null = null;

    const setIntervalMock = mock((callback: TimerHandler, _delay?: number) => {
      if (typeof callback !== "function") {
        throw new Error("Expected polling callback function");
      }
      intervalCallback = () => {
        callback();
      };
      return 1;
    });
    const clearIntervalMock = mock((_intervalId: number) => {});

    globalThis.setInterval = setIntervalMock as unknown as typeof globalThis.setInterval;
    globalThis.clearInterval = clearIntervalMock as unknown as typeof globalThis.clearInterval;

    const harness = createHookHarness({
      ...createBaseArgs(),
      enablePolling: true,
    });

    try {
      await harness.mount();
      await harness.waitFor(() => gitGetWorktreeStatusMock.mock.calls.length >= 1);

      expect(setIntervalMock).toHaveBeenCalledTimes(1);
      expect(setIntervalMock.mock.calls[0]?.[1]).toBe(30_000);
      const runTick = (): void => {
        if (intervalCallback == null) {
          throw new Error("Polling callback was not registered");
        }
        intervalCallback();
      };

      await harness.run(() => {
        runTick();
      });
      await harness.waitFor(() => gitGetWorktreeStatusMock.mock.calls.length >= 2);
      expect(gitGetWorktreeStatusMock).toHaveBeenNthCalledWith(
        2,
        "/repo",
        "origin/main",
        "target",
        undefined,
      );

      await harness.run((state) => {
        state.setDiffScope("uncommitted");
      });
      await harness.waitFor(() => gitGetWorktreeStatusMock.mock.calls.length >= 3);
      expect(gitGetWorktreeStatusMock).toHaveBeenNthCalledWith(
        3,
        "/repo",
        "origin/main",
        "uncommitted",
        undefined,
      );

      await harness.run(() => {
        runTick();
      });
      await harness.waitFor(() => gitGetWorktreeStatusMock.mock.calls.length >= 4);
      expect(gitGetWorktreeStatusMock).toHaveBeenNthCalledWith(
        4,
        "/repo",
        "origin/main",
        "uncommitted",
        undefined,
      );
    } finally {
      await harness.unmount();
      expect(clearIntervalMock).toHaveBeenCalledTimes(1);
      globalThis.setInterval = originalSetInterval;
      globalThis.clearInterval = originalClearInterval;
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
        state.setDiffScope("uncommitted");
      });
      await harness.waitFor(() => gitGetWorktreeStatusMock.mock.calls.length >= 2);

      await harness.run((state) => {
        state.setDiffScope("target");
      });
      await harness.waitFor((state) => state.diffScope === "target");
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
        "target",
        undefined,
      );

      await harness.run((state) => {
        state.setDiffScope("uncommitted");
      });
      await harness.waitFor(() => gitGetWorktreeStatusMock.mock.calls.length >= 4);
      expect(gitGetWorktreeStatusMock).toHaveBeenNthCalledWith(
        4,
        "/repo-b",
        "origin/main",
        "uncommitted",
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
        "target",
        undefined,
      );

      secondRequest.resolve({
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
      });

      await harness.waitFor((state) => state.branch === "feature/repo-b");

      firstRequest.resolve({
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
      });

      await harness.run(async () => {
        await Promise.resolve();
      });

      expect(harness.getLatest().branch).toBe("feature/repo-b");
      expect(harness.getLatest().fileDiffs[0]?.file).toBe("src/repo-b.ts");
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

      pendingRequest.resolve({
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
      });

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
    const queue = [targetRequest, uncommittedRequest];

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
        state.setDiffScope("uncommitted");
      });
      await harness.waitFor(() => gitGetWorktreeStatusMock.mock.calls.length >= 2);

      uncommittedRequest.resolve({
        currentBranch: { name: "feature/newer", detached: false },
        fileStatuses: [{ path: "src/newer.ts", status: "M", staged: false }],
        fileDiffs: [],
        targetAheadBehind: { ahead: 2, behind: 1 },
        upstreamAheadBehind: { outcome: "tracking", ahead: 4, behind: 1 },
        snapshot: {
          effectiveWorkingDir: "/repo",
          targetBranch: "origin/main",
          diffScope: "uncommitted",
          observedAtMs: 1731000004000,
        },
      });
      await harness.waitFor((state) => state.branch === "feature/newer");

      targetRequest.resolve({
        currentBranch: { name: "feature/older", detached: false },
        fileStatuses: [{ path: "src/older.ts", status: "M", staged: false }],
        fileDiffs: [
          {
            file: "src/older.ts",
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
          observedAtMs: 1731000003000,
        },
      });

      await harness.run(async () => {
        await Promise.resolve();
      });

      const latest = harness.getLatest();
      expect(latest.diffScope).toBe("uncommitted");
      expect(latest.branch).toBe("feature/newer");
      expect(latest.fileStatuses[0]?.path).toBe("src/newer.ts");
      expect(latest.commitsAheadBehind).toEqual({ ahead: 2, behind: 1 });
    } finally {
      await harness.unmount();
    }
  });

  test("clears stale resolved worktree when run context changes", async () => {
    runsListMock.mockImplementation(async () => [
      { runId: "run-1", worktreePath: "/repo/.worktrees/run-1" },
    ]);

    const harness = createHookHarness({
      ...createBaseArgs(),
      sessionRunId: "run-1",
    });

    try {
      await harness.mount();
      await harness.waitFor((state) => state.worktreePath === "/repo/.worktrees/run-1");

      runsListMock.mockImplementation(async () => []);
      await harness.update({
        ...createBaseArgs(),
        sessionRunId: "run-2",
      });

      await harness.waitFor((state) => state.worktreePath === null);
      expect(harness.getLatest().worktreePath).toBeNull();
    } finally {
      await harness.unmount();
    }
  });

  test("canonicalizes short target branch names to origin-prefixed refs", async () => {
    const harness = createHookHarness({
      ...createBaseArgs(),
      defaultTargetBranch: "main",
    });

    try {
      await harness.mount();
      await harness.waitFor(() => gitGetWorktreeStatusMock.mock.calls.length >= 1);

      expect(harness.getLatest().targetBranch).toBe("origin/main");
      expect(gitGetWorktreeStatusMock).toHaveBeenNthCalledWith(
        1,
        "/repo",
        "origin/main",
        "target",
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
      ): Promise<GitWorktreeStatus> => ({
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
      ): Promise<GitWorktreeStatus> => ({
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
        return {
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
        };
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

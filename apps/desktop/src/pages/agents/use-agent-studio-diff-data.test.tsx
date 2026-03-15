import { beforeAll, beforeEach, describe, expect, mock, test } from "bun:test";
import type { GitWorktreeStatus, GitWorktreeStatusSummary } from "@openducktor/contracts";
import { clearAppQueryClient } from "@/lib/query-client";
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

mock.module("@/lib/host-client", () => ({
  hostClient: {
    runsList: runsListMock,
  },
}));

mock.module("@/state/operations/host", () => ({
  host: {
    runsList: runsListMock,
    gitGetWorktreeStatus: gitGetWorktreeStatusMock,
    gitGetWorktreeStatusSummary: gitGetWorktreeStatusSummaryMock,
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
    snapshot: status.snapshot,
  };
};

const createBaseArgs = (): HookArgs => ({
  repoPath: "/repo",
  sessionWorkingDirectory: null,
  sessionRunId: null,
  defaultTargetBranch: { remote: "origin", branch: "main" },
  branchIdentityKey: null,
  enablePolling: false,
});

beforeAll(async () => {
  ({ useAgentStudioDiffData } = await import("./use-agent-studio-diff-data"));
});

beforeEach(async () => {
  await clearAppQueryClient();
  runsListMock.mockClear();
  gitGetWorktreeStatusMock.mockClear();
  gitGetWorktreeStatusSummaryMock.mockClear();
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

  test("selected file triggers on-demand full reload for the active scope", async () => {
    const harness = createHookHarness(createBaseArgs());

    try {
      await harness.mount();
      await harness.waitFor(() => gitGetWorktreeStatusMock.mock.calls.length >= 1);

      await harness.run((state) => {
        state.setDiffScope("uncommitted");
      });
      await harness.waitFor(() => gitGetWorktreeStatusMock.mock.calls.length >= 2);

      await harness.run((state) => {
        state.setSelectedFile("src/main.ts");
      });
      await harness.waitFor(() => gitGetWorktreeStatusMock.mock.calls.length >= 3);

      expect(gitGetWorktreeStatusMock).toHaveBeenNthCalledWith(
        3,
        "/repo",
        "origin/main",
        "uncommitted",
        undefined,
      );
    } finally {
      await harness.unmount();
    }
  });

  test("clears selected file when repository context changes", async () => {
    const harness = createHookHarness({
      ...createBaseArgs(),
      repoPath: "/repo-a",
    });

    try {
      await harness.mount();
      await harness.waitFor(() => gitGetWorktreeStatusMock.mock.calls.length >= 1);

      await harness.run((state) => {
        state.setSelectedFile("src/main.ts");
      });
      await harness.waitFor((state) => state.selectedFile === "src/main.ts");

      await harness.update({
        ...createBaseArgs(),
        repoPath: "/repo-b",
      });

      await harness.waitFor((state) => state.selectedFile === null);
    } finally {
      await harness.unmount();
    }
  });

  test("clears selected file when the resolved run context changes", async () => {
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
      await harness.waitFor(() => gitGetWorktreeStatusMock.mock.calls.length >= 1);

      await harness.run((state) => {
        state.setSelectedFile("src/main.ts");
      });
      await harness.waitFor((state) => state.selectedFile === "src/main.ts");

      runsListMock.mockImplementation(async () => [
        { runId: "run-2", worktreePath: "/repo/.worktrees/run-2" },
      ]);
      await harness.update({
        ...createBaseArgs(),
        sessionRunId: "run-2",
      });

      await harness.waitFor((state) => state.selectedFile === null);
      await harness.waitFor((state) => state.worktreePath === "/repo/.worktrees/run-2");
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
      expect(harness.getLatest().fileDiffs[0]).toMatchObject({
        file: "src/switched.ts",
        additions: 5,
      });
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
        state.setDiffScope("uncommitted");
      });
      await harness.waitFor(() => gitGetWorktreeStatusMock.mock.calls.length >= 2);
      expect(harness.getLatest().upstreamStatus).toBe("tracking");

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

  test("polling invalidates the inactive scope so switching scopes triggers a fresh full reload", async () => {
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

    const runTick = (): void => {
      if (intervalCallback == null) {
        throw new Error("Polling callback was not registered");
      }
      intervalCallback();
    };

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
        runTick();
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
      globalThis.setInterval = originalSetInterval;
      globalThis.clearInterval = originalClearInterval;
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
      await harness.waitFor(() => gitGetWorktreeStatusSummaryMock.mock.calls.length >= 1);
      expect(gitGetWorktreeStatusSummaryMock).toHaveBeenNthCalledWith(
        1,
        "/repo",
        "origin/main",
        "target",
        undefined,
      );
      expect(gitGetWorktreeStatusMock.mock.calls.length).toBe(1);

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

      await harness.run(() => {
        runTick();
      });
      await harness.waitFor(() => gitGetWorktreeStatusSummaryMock.mock.calls.length >= 2);
      expect(gitGetWorktreeStatusSummaryMock).toHaveBeenNthCalledWith(
        2,
        "/repo",
        "origin/main",
        "uncommitted",
        undefined,
      );
      expect(gitGetWorktreeStatusMock.mock.calls.length).toBe(2);
    } finally {
      await harness.unmount();
      expect(clearIntervalMock).toHaveBeenCalledTimes(1);
      globalThis.setInterval = originalSetInterval;
      globalThis.clearInterval = originalClearInterval;
    }
  });

  test("polling summary requests do not invalidate an in-flight full reload", async () => {
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

    const runTick = (): void => {
      if (intervalCallback == null) {
        throw new Error("Polling callback was not registered");
      }
      intervalCallback();
    };

    try {
      await harness.mount();
      await harness.waitFor(() => gitGetWorktreeStatusMock.mock.calls.length >= 1);

      await harness.run((state) => {
        state.setSelectedFile("src/full.ts");
      });
      await harness.waitFor(() => gitGetWorktreeStatusMock.mock.calls.length >= 2);

      await harness.run(() => {
        runTick();
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
        runTick();
      });
      await harness.waitFor(() => gitGetWorktreeStatusSummaryMock.mock.calls.length >= 1);
      await harness.waitFor(() => gitGetWorktreeStatusMock.mock.calls.length >= 3);
      expect(harness.getLatest().branch).toBe("feature/base");
    } finally {
      await harness.unmount();
      globalThis.setInterval = originalSetInterval;
      globalThis.clearInterval = originalClearInterval;
    }
  });

  test("polling persists hash metadata changes even when derived shared fields stay equal", async () => {
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

    globalThis.setInterval = setIntervalMock as unknown as typeof globalThis.setInterval;
    globalThis.clearInterval = clearIntervalMock as unknown as typeof globalThis.clearInterval;

    const harness = createHookHarness({
      ...createBaseArgs(),
      enablePolling: true,
    });

    const runTick = (): void => {
      if (intervalCallback == null) {
        throw new Error("Polling callback was not registered");
      }
      intervalCallback();
    };

    try {
      await harness.mount();
      await harness.waitFor(() => gitGetWorktreeStatusMock.mock.calls.length >= 1);
      const firstState = harness.getLatest();
      expect(firstState.upstreamAheadBehind).toEqual({ ahead: 1, behind: 0 });

      await harness.run(() => {
        runTick();
      });
      await harness.waitFor(() => gitGetWorktreeStatusSummaryMock.mock.calls.length >= 1);
      const secondState = harness.getLatest();
      expect(secondState.upstreamAheadBehind).toEqual({ ahead: 1, behind: 0 });
      expect(secondState).not.toBe(firstState);

      await harness.run(() => {
        runTick();
      });
      await harness.waitFor(() => gitGetWorktreeStatusSummaryMock.mock.calls.length >= 2);
      const thirdState = harness.getLatest();
      expect(thirdState).toEqual(secondState);
    } finally {
      await harness.unmount();
      globalThis.setInterval = originalSetInterval;
      globalThis.clearInterval = originalClearInterval;
    }
  });

  test("polling updates uncommitted file count from summary payloads", async () => {
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

    globalThis.setInterval = setIntervalMock as unknown as typeof globalThis.setInterval;
    globalThis.clearInterval = clearIntervalMock as unknown as typeof globalThis.clearInterval;

    const harness = createHookHarness({
      ...createBaseArgs(),
      enablePolling: true,
    });

    const runTick = (): void => {
      if (intervalCallback == null) {
        throw new Error("Polling callback was not registered");
      }
      intervalCallback();
    };

    try {
      await harness.mount();
      await harness.waitFor(() => gitGetWorktreeStatusMock.mock.calls.length >= 1);
      expect(harness.getLatest().uncommittedFileCount).toBe(1);

      await harness.run(() => {
        runTick();
      });
      await harness.waitFor(() => gitGetWorktreeStatusSummaryMock.mock.calls.length >= 1);
      await harness.waitFor(() => gitGetWorktreeStatusMock.mock.calls.length >= 2);
      await harness.waitFor((state) => state.uncommittedFileCount === 4);
    } finally {
      await harness.unmount();
      globalThis.setInterval = originalSetInterval;
      globalThis.clearInterval = originalClearInterval;
    }
  });

  test("polling triggers a full reload when summary hashes show file status changes", async () => {
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

    globalThis.setInterval = setIntervalMock as unknown as typeof globalThis.setInterval;
    globalThis.clearInterval = clearIntervalMock as unknown as typeof globalThis.clearInterval;

    const harness = createHookHarness({
      ...createBaseArgs(),
      enablePolling: true,
    });

    const runTick = (): void => {
      if (intervalCallback == null) {
        throw new Error("Polling callback was not registered");
      }
      intervalCallback();
    };

    try {
      await harness.mount();
      await harness.waitFor(() => gitGetWorktreeStatusMock.mock.calls.length >= 1);
      expect(harness.getLatest().fileStatuses).toEqual([
        { path: "AGENTS.md", status: "unmerged", staged: false },
      ]);

      await harness.run(() => {
        runTick();
      });
      await harness.waitFor(() => gitGetWorktreeStatusSummaryMock.mock.calls.length >= 1);
      await harness.waitFor(() => gitGetWorktreeStatusMock.mock.calls.length >= 2);

      expect(harness.getLatest().fileStatuses).toEqual([
        { path: "AGENTS.md", status: "M", staged: false },
      ]);
      expect(harness.getLatest().branch).toBe("feature/resolved");
    } finally {
      await harness.unmount();
      globalThis.setInterval = originalSetInterval;
      globalThis.clearInterval = originalClearInterval;
    }
  });

  test("polling triggers a full reload when non-conflict summary hashes change", async () => {
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
                      deletions: 1,
                      diff: "@@ -1 +1 @@\n-old\n+draft\n",
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

    globalThis.setInterval = setIntervalMock as unknown as typeof globalThis.setInterval;
    globalThis.clearInterval = clearIntervalMock as unknown as typeof globalThis.clearInterval;

    const harness = createHookHarness({
      ...createBaseArgs(),
      enablePolling: true,
    });

    const runTick = (): void => {
      if (intervalCallback == null) {
        throw new Error("Polling callback was not registered");
      }
      intervalCallback();
    };

    try {
      await harness.mount();
      await harness.waitFor(() => gitGetWorktreeStatusMock.mock.calls.length >= 1);
      expect(harness.getLatest().fileDiffs[0]?.additions).toBe(1);

      await harness.run(() => {
        runTick();
      });
      await harness.waitFor(() => gitGetWorktreeStatusSummaryMock.mock.calls.length >= 1);
      await harness.waitFor(() => gitGetWorktreeStatusMock.mock.calls.length >= 2);

      expect(harness.getLatest().fileDiffs[0]).toMatchObject({
        file: "src/main.ts",
        additions: 3,
      });
    } finally {
      await harness.unmount();
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
        state.setDiffScope("uncommitted");
      });
      await harness.waitFor(() => gitGetWorktreeStatusMock.mock.calls.length >= 2);

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
            observedAtMs: 1731000001000,
          },
        }),
      );

      await harness.run(async () => {
        await Promise.resolve();
      });

      expect(harness.getLatest().isLoading).toBe(true);

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
            observedAtMs: 1731000002000,
          },
        }),
      );

      await harness.waitFor((state) => !state.isLoading && state.diffScope === "uncommitted");
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

      uncommittedRequest.resolve(
        withSnapshotHashes({
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
        }),
      );
      await harness.waitFor((state) => state.branch === "feature/newer");

      targetRequest.resolve(
        withSnapshotHashes({
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
        }),
      );

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

      runsListMock.mockImplementation(async () => [{ runId: "run-2", worktreePath: "/repo" }]);
      await harness.update({
        ...createBaseArgs(),
        sessionRunId: "run-2",
      });

      await harness.waitFor((state) => state.worktreePath === null);
      expect(harness.getLatest().worktreePath).toBeNull();
      expect(harness.getLatest().error).toBeNull();
    } finally {
      await harness.unmount();
    }
  });

  test("blocks diff loading and reports actionable error when worktree resolution fails", async () => {
    runsListMock.mockImplementation(async () => {
      throw new Error("runs_list unavailable");
    });

    const harness = createHookHarness({
      ...createBaseArgs(),
      sessionRunId: "run-1",
    });

    try {
      await harness.mount();
      await harness.waitFor((state) =>
        (state.error ?? "").includes("Failed to resolve run worktree path for session run-1"),
      );

      expect(gitGetWorktreeStatusMock).not.toHaveBeenCalled();
      expect(harness.getLatest().worktreePath).toBeNull();
    } finally {
      await harness.unmount();
    }
  });

  test("refresh retries failed worktree resolution before loading diff data", async () => {
    let resolveAttempt = 0;
    runsListMock.mockImplementation(async () => {
      resolveAttempt += 1;
      if (resolveAttempt === 1) {
        throw new Error("runs_list unavailable");
      }

      return [{ runId: "run-1", worktreePath: "/repo/.worktrees/run-1" }];
    });

    const harness = createHookHarness({
      ...createBaseArgs(),
      sessionRunId: "run-1",
    });

    try {
      await harness.mount();
      await harness.waitFor((state) =>
        (state.error ?? "").includes("Failed to resolve run worktree path for session run-1"),
      );
      expect(gitGetWorktreeStatusMock).not.toHaveBeenCalled();

      await harness.run((state) => {
        state.refresh();
      });

      await harness.waitFor((state) => state.worktreePath === "/repo/.worktrees/run-1");
      await harness.waitFor(() => gitGetWorktreeStatusMock.mock.calls.length >= 1);
      expect(runsListMock).toHaveBeenCalledTimes(2);
      expect(gitGetWorktreeStatusMock).toHaveBeenNthCalledWith(
        1,
        "/repo",
        "origin/main",
        "target",
        "/repo/.worktrees/run-1",
      );
      expect(harness.getLatest().error).toBeNull();
    } finally {
      await harness.unmount();
    }
  });

  test("blocks diff loading and reports actionable error when run summary is missing", async () => {
    runsListMock.mockImplementation(async () => [
      { runId: "run-2", worktreePath: "/repo/.worktrees/run-2" },
    ]);

    const harness = createHookHarness({
      ...createBaseArgs(),
      sessionRunId: "run-1",
    });

    try {
      await harness.mount();
      await harness.waitFor((state) =>
        (state.error ?? "").includes("Run not found in runs list response."),
      );

      const latest = harness.getLatest();
      expect(latest.error).toContain("Use Refresh to retry.");
      expect(latest.worktreePath).toBeNull();
      expect(gitGetWorktreeStatusMock).not.toHaveBeenCalled();
    } finally {
      await harness.unmount();
    }
  });

  test("refresh retries missing-run resolution before loading diff data", async () => {
    let resolveAttempt = 0;
    runsListMock.mockImplementation(async () => {
      resolveAttempt += 1;
      if (resolveAttempt === 1) {
        return [{ runId: "run-2", worktreePath: "/repo/.worktrees/run-2" }];
      }

      return [{ runId: "run-1", worktreePath: "/repo/.worktrees/run-1" }];
    });

    const harness = createHookHarness({
      ...createBaseArgs(),
      sessionRunId: "run-1",
    });

    try {
      await harness.mount();
      await harness.waitFor((state) =>
        (state.error ?? "").includes("Run not found in runs list response."),
      );
      expect(gitGetWorktreeStatusMock).not.toHaveBeenCalled();

      await harness.run((state) => {
        state.refresh();
      });

      await harness.waitFor((state) => state.worktreePath === "/repo/.worktrees/run-1");
      await harness.waitFor(() => gitGetWorktreeStatusMock.mock.calls.length >= 1);
      expect(runsListMock).toHaveBeenCalledTimes(2);
      expect(gitGetWorktreeStatusMock).toHaveBeenNthCalledWith(
        1,
        "/repo",
        "origin/main",
        "target",
        "/repo/.worktrees/run-1",
      );
      expect(harness.getLatest().error).toBeNull();
    } finally {
      await harness.unmount();
    }
  });

  test("run completion signal retries missing worktree resolution automatically", async () => {
    let resolveAttempt = 0;
    runsListMock.mockImplementation(async () => {
      resolveAttempt += 1;
      if (resolveAttempt === 1) {
        return [{ runId: "run-2", worktreePath: "/repo/.worktrees/run-2" }];
      }

      return [{ runId: "run-1", worktreePath: "/repo/.worktrees/run-1" }];
    });

    const harness = createHookHarness({
      ...createBaseArgs(),
      sessionRunId: "run-1",
      runCompletionRecoverySignal: 0,
    });

    try {
      await harness.mount();
      await harness.waitFor((state) =>
        (state.error ?? "").includes("Run not found in runs list response."),
      );
      expect(gitGetWorktreeStatusMock).not.toHaveBeenCalled();

      await harness.update({
        ...createBaseArgs(),
        sessionRunId: "run-1",
        runCompletionRecoverySignal: 1,
      });

      await harness.waitFor((state) => state.worktreePath === "/repo/.worktrees/run-1");
      await harness.waitFor(() => gitGetWorktreeStatusMock.mock.calls.length >= 1);
      expect(runsListMock).toHaveBeenCalledTimes(2);
      expect(gitGetWorktreeStatusMock).toHaveBeenNthCalledWith(
        1,
        "/repo",
        "origin/main",
        "target",
        "/repo/.worktrees/run-1",
      );
      expect(harness.getLatest().error).toBeNull();
    } finally {
      await harness.unmount();
    }
  });

  test("run completion signal does not re-resolve after worktree resolution already succeeded", async () => {
    runsListMock.mockResolvedValue([{ runId: "run-1", worktreePath: "/repo/.worktrees/run-1" }]);

    const harness = createHookHarness({
      ...createBaseArgs(),
      sessionRunId: "run-1",
      runCompletionRecoverySignal: 0,
    });

    try {
      await harness.mount();
      await harness.waitFor((state) => state.worktreePath === "/repo/.worktrees/run-1");
      await harness.waitFor(() => gitGetWorktreeStatusMock.mock.calls.length >= 1);
      expect(runsListMock).toHaveBeenCalledTimes(1);

      await harness.update({
        ...createBaseArgs(),
        sessionRunId: "run-1",
        runCompletionRecoverySignal: 1,
      });

      await harness.run(async () => {
        await Promise.resolve();
      });

      expect(harness.getLatest().worktreePath).toBe("/repo/.worktrees/run-1");
      expect(harness.getLatest().error).toBeNull();
      expect(runsListMock).toHaveBeenCalledTimes(1);
      expect(gitGetWorktreeStatusMock).toHaveBeenCalledTimes(1);
    } finally {
      await harness.unmount();
    }
  });

  test("run completion signal queued during in-flight resolution retries automatically after failure", async () => {
    const firstAttempt = createDeferred<Array<{ runId: string; worktreePath: string }>>();
    let resolveAttempt = 0;
    runsListMock.mockImplementation(async () => {
      resolveAttempt += 1;
      if (resolveAttempt === 1) {
        return firstAttempt.promise;
      }

      return [{ runId: "run-1", worktreePath: "/repo/.worktrees/run-1" }];
    });

    const harness = createHookHarness({
      ...createBaseArgs(),
      sessionRunId: "run-1",
      runCompletionRecoverySignal: 0,
    });

    try {
      await harness.mount();
      await harness.waitFor((state) => state.isLoading);
      expect(runsListMock).toHaveBeenCalledTimes(1);

      await harness.update({
        ...createBaseArgs(),
        sessionRunId: "run-1",
        runCompletionRecoverySignal: 1,
      });

      firstAttempt.resolve([{ runId: "run-2", worktreePath: "/repo/.worktrees/run-2" }]);

      await harness.waitFor((state) => state.worktreePath === "/repo/.worktrees/run-1");
      await harness.waitFor(() => gitGetWorktreeStatusMock.mock.calls.length >= 1);

      expect(runsListMock).toHaveBeenCalledTimes(2);
      expect(harness.getLatest().error).toBeNull();
    } finally {
      await harness.unmount();
    }
  });

  test("queued run completion signal does not leak to a different run context", async () => {
    const firstAttempt = createDeferred<Array<{ runId: string; worktreePath: string }>>();
    let resolveAttempt = 0;
    runsListMock.mockImplementation(async () => {
      resolveAttempt += 1;
      if (resolveAttempt === 1) {
        return firstAttempt.promise;
      }

      return [{ runId: "run-2", worktreePath: "/repo/.worktrees/run-2" }];
    });

    const harness = createHookHarness({
      ...createBaseArgs(),
      sessionRunId: "run-1",
      runCompletionRecoverySignal: 0,
    });

    try {
      await harness.mount();
      await harness.waitFor((state) => state.isLoading);
      expect(runsListMock).toHaveBeenCalledTimes(1);

      await harness.update({
        ...createBaseArgs(),
        sessionRunId: "run-1",
        runCompletionRecoverySignal: 1,
      });

      await harness.update({
        ...createBaseArgs(),
        sessionRunId: "run-2",
        runCompletionRecoverySignal: 1,
      });

      firstAttempt.resolve([{ runId: "run-3", worktreePath: "/repo/.worktrees/run-3" }]);

      await harness.waitFor((state) => state.worktreePath === "/repo/.worktrees/run-2");
      await harness.waitFor(() => gitGetWorktreeStatusMock.mock.calls.length >= 1);

      expect(runsListMock).toHaveBeenCalledTimes(2);
      expect(harness.getLatest().worktreePath).toBe("/repo/.worktrees/run-2");
      expect(harness.getLatest().error).toBeNull();
    } finally {
      await harness.unmount();
    }
  });

  test("times out worktree resolution after 5 seconds and shows retry guidance", async () => {
    const pendingRunsList = createDeferred<Array<{ runId: string; worktreePath: string }>>();
    runsListMock.mockImplementation(async () => pendingRunsList.promise);

    const originalSetTimeout = globalThis.setTimeout;
    const originalClearTimeout = globalThis.clearTimeout;
    const setTimeoutMock = mock((handler: TimerHandler, _delay?: number) => {
      if (typeof handler !== "function") {
        throw new Error("Expected timeout callback function");
      }
      return originalSetTimeout(() => {
        handler();
      }, 0);
    });
    const clearTimeoutMock = mock((timeoutId: ReturnType<typeof globalThis.setTimeout>) => {
      originalClearTimeout(timeoutId);
    });

    globalThis.setTimeout = setTimeoutMock as unknown as typeof globalThis.setTimeout;
    globalThis.clearTimeout = clearTimeoutMock as unknown as typeof globalThis.clearTimeout;

    const harness = createHookHarness({
      ...createBaseArgs(),
      sessionRunId: "run-1",
    });

    try {
      await harness.mount();
      await harness.waitFor((state) =>
        (state.error ?? "").includes("Timed out after 5000ms while loading runs list."),
      );

      const latest = harness.getLatest();
      expect(latest.error).toContain("Use Refresh to retry.");
      expect(gitGetWorktreeStatusMock).not.toHaveBeenCalled();
    } finally {
      await harness.unmount();
      globalThis.setTimeout = originalSetTimeout;
      globalThis.clearTimeout = originalClearTimeout;
      pendingRunsList.reject(new Error("cleanup"));
    }
  });

  test("does not start polling while worktree resolution is still pending", async () => {
    const pendingRunsList = createDeferred<Array<{ runId: string; worktreePath: string }>>();
    runsListMock.mockImplementation(async () => pendingRunsList.promise);

    const originalSetInterval = globalThis.setInterval;
    const originalClearInterval = globalThis.clearInterval;
    const setIntervalMock = mock((_callback: TimerHandler, _delay?: number) => 1);
    const clearIntervalMock = mock((_intervalId: number) => {});

    globalThis.setInterval = setIntervalMock as unknown as typeof globalThis.setInterval;
    globalThis.clearInterval = clearIntervalMock as unknown as typeof globalThis.clearInterval;

    const harness = createHookHarness({
      ...createBaseArgs(),
      sessionRunId: "run-1",
      enablePolling: true,
    });

    try {
      await harness.mount();
      await harness.run(async () => {
        await Promise.resolve();
      });

      expect(setIntervalMock).not.toHaveBeenCalled();
      expect(gitGetWorktreeStatusMock).not.toHaveBeenCalled();
      expect(gitGetWorktreeStatusSummaryMock).not.toHaveBeenCalled();
    } finally {
      await harness.unmount();
      globalThis.setInterval = originalSetInterval;
      globalThis.clearInterval = originalClearInterval;
      pendingRunsList.reject(new Error("cleanup"));
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

import { afterEach, beforeEach, mock } from "bun:test";
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

export const taskWorktreeEntriesMock = mock(
  async (): Promise<Array<{ taskId: string; worktreePath: string }>> => [],
);
export const taskWorktreeGetMock = mock(async (_repoPath: string, taskId: string) => {
  const runs = await taskWorktreeEntriesMock();
  const matchingRun = runs.find((run) => run.taskId === taskId) ?? null;
  return matchingRun ? { workingDirectory: matchingRun.worktreePath } : null;
});
export const gitFetchRemoteMock = mock(
  async (
    _repoPath: string,
    _targetBranch: string,
    _workingDir?: string,
  ): Promise<{ outcome: "fetched" | "skipped_no_remote"; output: string }> => ({
    outcome: "fetched",
    output: "From origin",
  }),
);
export const retryWorktreeResolutionMock = mock(async () => {});
export type GitFetchRemoteMockResult = Awaited<ReturnType<typeof gitFetchRemoteMock>>;
export const gitGetWorktreeStatusMock = mock(
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
export const gitGetWorktreeStatusSummaryMock = mock(
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

export type HookArgs = Parameters<UseAgentStudioDiffDataHook>[0];

export const createHookHarness = (initialProps: HookArgs) => {
  return createSharedHookHarness(useAgentStudioDiffData, initialProps);
};

export const createDeferred = <T>() => {
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

export const withSnapshotHashes = (
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

export const toWorktreeStatusSummary = (status: GitWorktreeStatus): GitWorktreeStatusSummary => {
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

export const createBaseArgs = (): HookArgs => ({
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

export const dispatchDiffRefresh = (): void => {
  document.dispatchEvent(new Event("visibilitychange"));
};

export const dispatchScheduledRefresh = (): void => {
  globalThis.dispatchEvent(new Event("focus"));
};

export const setupAgentStudioDiffDataTestHarness = (): void => {
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
};

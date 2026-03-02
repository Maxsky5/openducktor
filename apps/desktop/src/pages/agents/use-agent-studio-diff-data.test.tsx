import { beforeAll, beforeEach, describe, expect, mock, test } from "bun:test";
import type { GitWorktreeStatus } from "@openducktor/contracts";
import {
  createHookHarness as createSharedHookHarness,
  enableReactActEnvironment,
} from "./agent-studio-test-utils";

enableReactActEnvironment();

const runsListMock = mock(async () => []);
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
  test("routes consolidated worktree-status by selected diff scope", async () => {
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

      await harness.run((state) => {
        state.setDiffScope("target");
      });
      await harness.waitFor(() => gitGetWorktreeStatusMock.mock.calls.length >= 3);
      expect(gitGetWorktreeStatusMock).toHaveBeenNthCalledWith(
        3,
        "/repo",
        "origin/main",
        "target",
        undefined,
      );
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

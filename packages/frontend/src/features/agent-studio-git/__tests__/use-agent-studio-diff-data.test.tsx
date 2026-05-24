import { describe, expect, mock, test } from "bun:test";
import type { GitWorktreeStatus } from "@openducktor/contracts";
import {
  createBaseArgs,
  createHookHarness,
  gitGetWorktreeStatusMock,
  type HookArgs,
  setupAgentStudioDiffDataTestHarness,
  withSnapshotHashes,
} from "../test-support/diff-data-test-harness";

setupAgentStudioDiffDataTestHarness();

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

  test("refetches full snapshots when remounting because worktree status is immediately stale", async () => {
    const firstHarness = createHookHarness(createBaseArgs());
    const secondHarness = createHookHarness(createBaseArgs());

    try {
      await firstHarness.mount();
      await firstHarness.waitFor(() => gitGetWorktreeStatusMock.mock.calls.length >= 1);
      await firstHarness.unmount();

      await secondHarness.mount();
      await secondHarness.waitFor(() => gitGetWorktreeStatusMock.mock.calls.length >= 2);
      await secondHarness.waitFor((state) => state.diffScope === "uncommitted" && !state.isLoading);
      expect(secondHarness.getLatest().fileStatuses[0]?.path).toBe("src/main.ts");
      expect(secondHarness.getLatest().upstreamAheadBehind).toEqual({ ahead: 1, behind: 0 });

      expect(gitGetWorktreeStatusMock.mock.calls.length).toBe(2);
    } finally {
      await firstHarness.unmount();
      await secondHarness.unmount();
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

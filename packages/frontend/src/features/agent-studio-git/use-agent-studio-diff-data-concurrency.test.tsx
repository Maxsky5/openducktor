import { describe, expect, test } from "bun:test";
import type { GitWorktreeStatus } from "@openducktor/contracts";
import {
  createBaseArgs,
  createDeferred,
  createHookHarness,
  type GitFetchRemoteMockResult,
  gitFetchRemoteMock,
  gitGetWorktreeStatusMock,
  setupAgentStudioDiffDataTestHarness,
  withSnapshotHashes,
} from "./use-agent-studio-diff-data-test-harness";

setupAgentStudioDiffDataTestHarness();

describe("useAgentStudioDiffData", () => {
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
});

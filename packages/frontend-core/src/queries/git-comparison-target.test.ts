import { expect, test } from "bun:test";
import { QueryClient } from "@tanstack/react-query";
import { createTestClientConnection } from "../test-support/test-client-connection";
import {
  gitComparisonTargetQueryOptions,
  gitQueryKeys,
  invalidateGitWorkingDirectoryQueries,
  currentBranchQueryOptions,
  worktreeBranchQueryOptions,
  worktreeStatusQueryOptions,
} from "./git";

test("comparison target reads keep the working directory and target in their query keys", async () => {
  const calls: Array<{ repoPath: string; workingDir: string; branch: string }> = [];
  const { queryClient: client } = createTestClientConnection({
    client: {
      gitGetComparisonTarget: async (
        repoPath: string,
        workingDir: string,
        target: { branch: string },
      ) => {
        calls.push({ repoPath, workingDir, branch: target.branch });
        return { kind: "available" as const, reference: target.branch };
      },
    },
  });
  await client.fetchQuery(
    gitComparisonTargetQueryOptions("/repo", "/repo", { branch: "@{upstream}" }, "main"),
  );
  await client.fetchQuery(
    gitComparisonTargetQueryOptions("/repo", "/worktree", { branch: "main" }, ""),
  );
  expect(calls).toEqual([
    { repoPath: "/repo", workingDir: "/repo", branch: "@{upstream}" },
    { repoPath: "/repo", workingDir: "/worktree", branch: "main" },
  ]);
  const cached: unknown = client.getQueryData(
    gitComparisonTargetQueryOptions("/repo", "/repo", { branch: "@{upstream}" }, "main").queryKey,
  );
  expect(cached).toEqual({ kind: "available", reference: "@{upstream}" });
  await client.fetchQuery(
    gitComparisonTargetQueryOptions("/repo", "/repo", { branch: "@{upstream}" }, "feature"),
  );
  expect(calls).toHaveLength(3);
});

test("Git invalidation keeps other worktrees fresh", async () => {
  const client = new QueryClient();
  const rootTarget = gitQueryKeys.comparisonTarget(
    "/repo",
    "/repo",
    { branch: "@{upstream}" },
    "main",
  );
  const worktreeTarget = gitQueryKeys.comparisonTarget(
    "/repo",
    "/worktree",
    { branch: "main" },
    "",
  );
  const rootStatus = gitQueryKeys.worktreeStatus("/repo", "@{upstream}", "/repo");
  const worktreeStatus = gitQueryKeys.worktreeStatus("/repo", "main", "/worktree");
  for (const key of [rootTarget, worktreeTarget, rootStatus, worktreeStatus]) {
    client.setQueryData(key, {});
  }

  await invalidateGitWorkingDirectoryQueries(client, "/repo", "/repo");

  expect(client.getQueryState(rootTarget)?.isInvalidated).toBe(true);
  expect(client.getQueryState(rootStatus)?.isInvalidated).toBe(true);
  expect(client.getQueryState(worktreeTarget)?.isInvalidated).toBe(false);
  expect(client.getQueryState(worktreeStatus)?.isInvalidated).toBe(false);
});

test.each(["/repo", "/worktree"])(
  "a branch change in %s invalidates completed and pending comparisons",
  async (directory) => {
    let name = "feature";
    const { queryClient: client } = createTestClientConnection({
      client: { gitGetCurrentBranch: async () => ({ name, detached: false }) },
    });
    const readBranch = () =>
      directory === "/repo"
        ? client.fetchQuery({ ...currentBranchQueryOptions("/repo"), staleTime: 0 })
        : client.fetchQuery({
            ...worktreeBranchQueryOptions("/repo", directory),
            staleTime: 0,
          });
    const statusKey = gitQueryKeys.worktreeStatus("/repo", "HEAD", directory, "feature");
    const otherKey = gitQueryKeys.worktreeStatus("/repo", "HEAD", "/other", "feature");
    const pending = Promise.withResolvers<string>();
    try {
      await readBranch();
      client.setQueryData(statusKey, "before");
      client.setQueryData(otherKey, "other");
      await readBranch();
      expect(client.getQueryState(statusKey)?.isInvalidated).toBe(false);
      const read = client
        .fetchQuery({ queryKey: statusKey, queryFn: () => pending.promise, staleTime: 0 })
        .catch(() => undefined);
      name = "other";
      await readBranch();
      expect(client.getQueryState(statusKey)?.isInvalidated).toBe(true);
      pending.resolve("late");
      await read;
      expect(client.getQueryData<string>(statusKey)).toBe("before");
      expect(client.getQueryState(statusKey)?.isInvalidated).toBe(true);
      expect(client.getQueryState(otherKey)?.isInvalidated).toBe(false);
    } finally {
      pending.resolve("late");
      client.clear();
    }
  },
);

test("Git actions invalidate root status cached without an explicit working directory", async () => {
  let revision = 1;
  const status = () => ({
    currentBranch: { name: "feature", detached: false },
    fileStatuses: [],
    fileDiffs: [],
    targetAheadBehind: { ahead: revision, behind: 0 },
    upstreamAheadBehind: { outcome: "untracked" as const, ahead: revision },
    snapshot: {
      effectiveWorkingDir: "/repo",
      targetBranch: "HEAD",
      diffScope: "uncommitted" as const,
      observedAtMs: revision,
      hashVersion: 1,
      statusHash: "0123456789abcdef",
      diffHash: "fedcba9876543210",
    },
  });
  const { queryClient: client } = createTestClientConnection({
    client: { gitGetWorktreeStatus: async () => status() },
  });
  const read = () =>
    client.fetchQuery({
      ...worktreeStatusQueryOptions("/repo", "HEAD", null, "feature"),
      staleTime: Infinity,
    });
  try {
    await read();
    revision = 2;
    await invalidateGitWorkingDirectoryQueries(client, "/repo", "/repo");
    const status = await read();
    expect(status.targetAheadBehind.ahead).toBe(2);
  } finally {
    client.clear();
  }
});

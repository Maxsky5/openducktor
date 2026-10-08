import { expect, test } from "bun:test";
import { QueryClient } from "@tanstack/react-query";
import {
  gitComparisonTargetQueryOptions,
  gitQueryKeys,
  invalidateGitWorkingDirectoryQueries,
  currentBranchQueryOptions,
  worktreeBranchQueryOptions,
} from "./git";

test("comparison target reads keep the working directory and target in their query keys", async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const calls: Array<{ repoPath: string; workingDir: string; branch: string }> = [];
  const host = {
    gitGetComparisonTarget: async (
      repoPath: string,
      workingDir: string,
      target: { branch: string },
    ) => {
      calls.push({ repoPath, workingDir, branch: target.branch });
      return { kind: "available" as const, reference: target.branch };
    },
  };
  await client.fetchQuery(
    gitComparisonTargetQueryOptions("/repo", "/repo", { branch: "@{upstream}" }, "main", host),
  );
  await client.fetchQuery(
    gitComparisonTargetQueryOptions("/repo", "/worktree", { branch: "main" }, "", host),
  );
  expect(calls).toEqual([
    { repoPath: "/repo", workingDir: "/repo", branch: "@{upstream}" },
    { repoPath: "/repo", workingDir: "/worktree", branch: "main" },
  ]);
  const cached: unknown = client.getQueryData(
    gitComparisonTargetQueryOptions("/repo", "/repo", { branch: "@{upstream}" }, "main", host)
      .queryKey,
  );
  expect(cached).toEqual({ kind: "available", reference: "@{upstream}" });
  await client.fetchQuery(
    gitComparisonTargetQueryOptions("/repo", "/repo", { branch: "@{upstream}" }, "feature", host),
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
  const rootStatus = gitQueryKeys.worktreeStatus("/repo", "@{upstream}", "uncommitted", "/repo");
  const worktreeStatus = gitQueryKeys.worktreeStatus("/repo", "main", "uncommitted", "/worktree");
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
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    let name = "feature";
    const host = { gitGetCurrentBranch: async () => ({ name, detached: false }) };
    const readBranch = () =>
      directory === "/repo"
        ? client.fetchQuery({ ...currentBranchQueryOptions("/repo", host), staleTime: 0 })
        : client.fetchQuery({
            ...worktreeBranchQueryOptions("/repo", directory, host),
            staleTime: 0,
          });
    const statusKey = gitQueryKeys.worktreeStatus(
      "/repo",
      "HEAD",
      "uncommitted",
      directory,
      "feature",
    );
    const otherKey = gitQueryKeys.worktreeStatus(
      "/repo",
      "HEAD",
      "uncommitted",
      "/other",
      "feature",
    );
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

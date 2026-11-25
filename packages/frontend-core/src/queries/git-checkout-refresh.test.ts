import { expect, test } from "bun:test";
import type { GitCurrentBranch, GitLocalChanges } from "@openducktor/contracts";
import { QueryObserver } from "@tanstack/react-query";
import { createTestClientConnection } from "../test-support/test-client-connection";
import {
  localChangesQueryOptions,
  refreshGitWorkingDirectory,
  worktreeBranchQueryOptions,
} from "./git";

const REPO = "/repo";
const WORKTREE = "/repo/.worktrees/task-1";

/** Local changes that name their read in their only file. */
const localChanges = (read: string): GitLocalChanges => {
  const fileStatuses = [{ path: read, status: "modified", staged: false }];
  const snapshot = { hashVersion: 2, statusHash: "0123456789abcdef", diffHash: "fedcba9876543210" };
  return {
    currentBranch: { name: "feature", detached: false },
    fileStatuses,
    unstaged: { fileStatuses, fileDiffs: [], snapshot },
    staged: { fileStatuses: [], fileDiffs: [], snapshot },
    conflicted: { fileStatuses: [], fileDiffs: [] },
    upstreamAheadBehind: { outcome: "untracked", ahead: 0 },
    snapshot: {
      effectiveWorkingDir: WORKTREE,
      targetBranch: "origin/main",
      diffScope: "uncommitted",
      observedAtMs: 1,
      ...snapshot,
    },
  };
};
const shownRead = (data: GitLocalChanges | undefined): string | undefined =>
  data?.fileStatuses[0]?.path;

test("keeps the shown changes until the read after a new commit finishes", async () => {
  const refreshedReadStarted = Promise.withResolvers<void>();
  const refreshedChanges = Promise.withResolvers<GitLocalChanges>();
  let revision = "first";
  const { queryClient } = createTestClientConnection({
    client: {
      gitGetCurrentBranch: async () => ({ name: "feature", detached: false, revision }),
      gitGetLocalChanges: async () => {
        if (revision === "first") return localChanges("before-commit");
        refreshedReadStarted.resolve();
        return refreshedChanges.promise;
      },
    },
  });
  const branch = new QueryObserver(queryClient, worktreeBranchQueryOptions(REPO, WORKTREE));
  const local = new QueryObserver(queryClient, {
    ...localChangesQueryOptions(REPO, WORKTREE, "branch:feature"),
    staleTime: Number.POSITIVE_INFINITY,
  });
  const stopBranch = branch.subscribe(() => {});
  const stopLocal = local.subscribe(() => {});

  try {
    await branch.refetch();
    await local.refetch();
    expect(shownRead(local.getCurrentResult().data)).toBe("before-commit");

    revision = "second";
    const refreshed = refreshGitWorkingDirectory(queryClient, REPO, WORKTREE);
    await refreshedReadStarted.promise;
    expect(shownRead(local.getCurrentResult().data)).toBe("before-commit");
    refreshedChanges.resolve(localChanges("after-commit"));
    await refreshed;

    const result = local.getCurrentResult();
    expect(result.isFetching).toBe(false);
    expect(result.isStale).toBe(false);
    expect(shownRead(result.data)).toBe("after-commit");
  } finally {
    refreshedChanges.resolve(localChanges("after-commit"));
    stopBranch();
    stopLocal();
    queryClient.clear();
  }
});

test("drops the reads of an earlier visit to that checkout and keeps the others", async () => {
  let branch: GitCurrentBranch = { name: "feature", detached: false, revision: "first" };
  // Each local read names the cache key of the read that asked for it.
  let localRead = "";
  const { queryClient } = createTestClientConnection({
    client: {
      gitGetCurrentBranch: async () => branch,
      gitGetLocalChanges: async () => localChanges(localRead),
    },
  });
  const readBranch = () =>
    queryClient.fetchQuery({
      ...worktreeBranchQueryOptions(REPO, WORKTREE),
      staleTime: 0,
    });
  const cachedRead = async (cacheKey: string, checkoutIdentity: string) => {
    localRead = cacheKey;
    const options = localChangesQueryOptions(REPO, WORKTREE, cacheKey);
    await queryClient.fetchQuery({ ...options, meta: { checkoutIdentity } });
    return options.queryKey;
  };
  // An earlier rebase left reads of the detached checkout in the cache.
  const earlierRebase = await cachedRead("detached", "detached");
  const branchReads = await cachedRead("branch:feature", "branch:feature");
  await readBranch();

  // A new rebase detaches HEAD again.
  branch = { detached: true, revision: "rebasing" };
  await readBranch();

  expect(queryClient.getQueryData(earlierRebase)).toBeUndefined();
  expect(shownRead(queryClient.getQueryData<GitLocalChanges>(branchReads))).toBe("branch:feature");
});

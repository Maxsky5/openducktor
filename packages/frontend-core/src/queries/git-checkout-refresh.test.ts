import { afterEach, describe, expect, test } from "bun:test";
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
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

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

let stop: (() => void)[] = [];
afterEach(() => {
  for (const unsubscribe of stop) unsubscribe();
  stop = [];
});

/** Shows the checkout and the local changes of one directory, as the Git panel does. */
const showDirectory = (checkout: () => GitCurrentBranch) => {
  const reads: number[] = [];
  const { queryClient } = createTestClientConnection({
    client: {
      gitGetCurrentBranch: async () => checkout(),
      gitGetLocalChanges: async () => {
        const read = reads.length + 1;
        reads.push(read);
        // The local read is slower than the branch read, as with real Git.
        await sleep(20);
        return localChanges(`read-${read}`);
      },
    },
  });
  const branch = new QueryObserver(queryClient, worktreeBranchQueryOptions(REPO, WORKTREE));
  const local = new QueryObserver(queryClient, {
    ...localChangesQueryOptions(REPO, WORKTREE, "branch:feature"),
    staleTime: Number.POSITIVE_INFINITY,
  });
  stop.push(
    branch.subscribe(() => {}),
    local.subscribe(() => {}),
  );
  return { queryClient, local, reads };
};

describe("a branch read that finds a new commit", () => {
  test("reads the shown local changes again after an agent turn that committed", async () => {
    let revision = "first";
    const view = showDirectory(() => ({ name: "feature", detached: false, revision }));
    await sleep(50);
    expect(shownRead(view.local.getCurrentResult().data)).toBe("read-1");

    // The agent committed during its turn, and the turn end reads the directory again.
    revision = "second";
    await refreshGitWorkingDirectory(view.queryClient, REPO, WORKTREE);
    await sleep(50);

    const result = view.local.getCurrentResult();
    expect(result.isFetching).toBe(false);
    expect(
      view.queryClient.getQueryState(view.local.getCurrentQuery().queryKey)?.isInvalidated,
    ).toBe(false);
    expect(shownRead(result.data)).toBe(`read-${view.reads.length}`);
    expect(view.reads.length).toBeGreaterThan(1);
  });
});

describe("a branch read that finds another checkout", () => {
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
      const observer = new QueryObserver(queryClient, {
        ...localChangesQueryOptions(REPO, WORKTREE, cacheKey),
        meta: { checkoutIdentity },
      });
      const stopObserving = observer.subscribe(() => {});
      await sleep(10);
      stopObserving();
      return observer.getCurrentQuery().queryKey;
    };
    // An earlier rebase left reads of the detached checkout in the cache.
    const earlierRebase = await cachedRead("detached", "detached");
    const branchReads = await cachedRead("branch:feature", "branch:feature");
    await readBranch();

    // A new rebase detaches HEAD again.
    branch = { detached: true, revision: "rebasing" };
    await readBranch();

    expect(queryClient.getQueryData(earlierRebase)).toBeUndefined();
    expect(shownRead(queryClient.getQueryData<GitLocalChanges>(branchReads))).toBe(
      "branch:feature",
    );
  });
});

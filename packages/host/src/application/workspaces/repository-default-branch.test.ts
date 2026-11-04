import { describe, expect, test } from "bun:test";
import type { GitBranchRefs } from "../../ports/git-port";
import { repositoryDefaultBranch } from "./repository-default-branch";

const refs = (overrides: Partial<GitBranchRefs>): GitBranchRefs => ({
  remotes: [],
  branches: [],
  remoteHeads: {},
  head: { kind: "branch", name: "feature" },
  ...overrides,
});

describe("repository default branch", () => {
  test("uses the HEAD branch of origin, else of the only remote", () => {
    expect(
      repositoryDefaultBranch(
        refs({ remotes: ["fork", "origin"], remoteHeads: { fork: "main", origin: "develop" } }),
      ),
    ).toEqual({ kind: "detected", targetBranch: { remote: "origin", branch: "develop" } });
    expect(
      repositoryDefaultBranch(refs({ remotes: ["upstream"], remoteHeads: { upstream: "master" } })),
    ).toEqual({ kind: "detected", targetBranch: { remote: "upstream", branch: "master" } });
  });

  test("uses the HEAD branch without a remote", () => {
    expect(repositoryDefaultBranch(refs({ head: { kind: "branch", name: "master" } }))).toEqual({
      kind: "detected",
      targetBranch: { branch: "master" },
    });
  });

  test.each([
    {
      case: "a remote without HEAD",
      input: refs({ remotes: ["origin"] }),
      reason:
        'Git does not know the default branch of the remote origin. Run "git remote set-head origin --auto" in the repository, or choose a target branch.',
    },
    {
      case: "several remotes without origin",
      input: refs({ remotes: ["fork", "upstream"], remoteHeads: { fork: "main" } }),
      reason:
        "The repository has the remotes fork, upstream and none is named origin, so Git does not tell which default branch to use. Choose a target branch.",
    },
    {
      case: "a branch without commits",
      input: refs({ head: { kind: "unborn", name: "main" } }),
      reason:
        "The repository has no remote and its branch main has no commits. Make a first commit, then choose the repository again.",
    },
    {
      case: "a detached HEAD",
      input: refs({ head: { kind: "detached" } }),
      reason:
        "The repository has no remote and its HEAD is detached, so Git does not tell which default branch to use. Choose a target branch.",
    },
  ])("tells the reason for $case", ({ input, reason }) => {
    expect(repositoryDefaultBranch(input)).toEqual({ kind: "unknown", reason });
  });
});

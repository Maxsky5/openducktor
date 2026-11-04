import type { GitRepositoryDefaultBranch } from "@openducktor/contracts";
import type { GitBranchRefs } from "../../ports/git-port";

const unknown = (reason: string): GitRepositoryDefaultBranch => ({ kind: "unknown", reason });

/** Git names the remote of a clone `origin`, so a repository with several remotes uses that one. */
const defaultRemote = (remotes: string[]): string | null => {
  if (remotes.includes("origin")) return "origin";
  return remotes.length === 1 ? (remotes[0] ?? null) : null;
};

/**
 * The default branch of a repository. With a remote, it is the branch that the remote HEAD names.
 * Without a remote, it is the branch of HEAD. When Git does not tell, the result says why.
 */
export const repositoryDefaultBranch = ({
  remotes,
  remoteHeads,
  head,
}: GitBranchRefs): GitRepositoryDefaultBranch => {
  if (remotes.length > 0) {
    const remote = defaultRemote(remotes);
    if (!remote)
      return unknown(
        `The repository has the remotes ${remotes.join(", ")} and none is named origin, so Git does not tell which default branch to use. Choose a target branch.`,
      );
    const branch = remoteHeads[remote];
    if (!branch)
      return unknown(
        `Git does not know the default branch of the remote ${remote}. Run "git remote set-head ${remote} --auto" in the repository, or choose a target branch.`,
      );
    return { kind: "detected", targetBranch: { remote, branch } };
  }
  switch (head.kind) {
    case "branch":
      return { kind: "detected", targetBranch: { branch: head.name } };
    case "unborn":
      return unknown(
        `The repository has no remote and its branch ${head.name} has no commits. Make a first commit, then choose the repository again.`,
      );
    case "detached":
      return unknown(
        "The repository has no remote and its HEAD is detached, so Git does not tell which default branch to use. Choose a target branch.",
      );
  }
};

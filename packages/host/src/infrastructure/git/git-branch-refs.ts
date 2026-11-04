import { Effect } from "effect";
import type { GitBranchRefs } from "../../ports/git-port";
import { type GitCommandRunner, runGit } from "./git-command-runner";
import { listBranchRefsUnchecked, parseRemoteNames } from "./git-status";

/** A HEAD without a local branch row is detached, or names a branch without commits. */
const readHeadWithoutBranchRow = (runner: GitCommandRunner, repoPath: string) =>
  Effect.map(
    runGit(runner, repoPath, ["branch", "--show-current"]),
    (output): GitBranchRefs["head"] => {
      const name = output.trim();
      return name ? { kind: "unborn", name } : { kind: "detached" };
    },
  );

/**
 * Reads the remotes, the branches, and the remote HEADs of a repository in two parallel Git
 * commands. Only a HEAD without a local branch row needs another read.
 */
export const readBranchRefs = (runner: GitCommandRunner, repoPath: string) =>
  Effect.gen(function* () {
    const [remoteOutput, { branches, remoteHeads }] = yield* Effect.all(
      [runGit(runner, repoPath, ["remote"]), listBranchRefsUnchecked(runner, repoPath)],
      { concurrency: 2 },
    );
    const current = branches.find((branch) => branch.isCurrent && !branch.isRemote);
    const head: GitBranchRefs["head"] = current
      ? { kind: "branch", name: current.name }
      : yield* readHeadWithoutBranchRow(runner, repoPath);
    return {
      remotes: parseRemoteNames(remoteOutput),
      branches,
      remoteHeads,
      head,
    } satisfies GitBranchRefs;
  });

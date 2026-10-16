import type { GitCurrentBranch, GitReadContext } from "@openducktor/contracts";
import type { Effect } from "effect";
import type { GitCommandRunner } from "../../infrastructure/git/git-command-runner";
import { readHistoryPage } from "../../infrastructure/git/git-history";
import { changeLocalSelection } from "../../infrastructure/git/git-local-change-selection";
import { commitStaged, loadLocalChanges } from "../../infrastructure/git/git-local-changes";
import type { GitPort, GitPortError } from "../../ports/git-port";

type CapturedRead<A> = (dir: string, context?: GitReadContext) => Effect.Effect<A, GitPortError>;

/**
 * The Git panel methods: the staged and unstaged groups and their writes, the staged commit, and
 * History. Local changes use the read captures of the adapter, so one refresh shares their reads.
 */
export const createGitCliLocalChangeMethods = (
  runner: GitCommandRunner,
  reads: { branch: CapturedRead<GitCurrentBranch>; statusOutput: CapturedRead<string> },
): Pick<GitPort, "getLocalChanges" | "changeSelection" | "commitStaged" | "getHistoryPage"> => ({
  getLocalChanges(workingDirectory, context) {
    return loadLocalChanges(runner, workingDirectory, {
      branch: () => reads.branch(workingDirectory, context),
      statusOutput: () => reads.statusOutput(workingDirectory, context),
    });
  },
  changeSelection(workingDirectory, changes, input) {
    return changeLocalSelection(runner, workingDirectory, changes, input);
  },
  commitStaged(workingDirectory, message) {
    return commitStaged(runner, workingDirectory, message);
  },
  getHistoryPage(workingDirectory, input) {
    return readHistoryPage(runner, workingDirectory, input);
  },
});

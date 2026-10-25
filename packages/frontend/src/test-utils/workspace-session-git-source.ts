import type { GitCurrentBranch, GitTargetBranch } from "@openducktor/contracts";
import type { WorkspaceSessionGitSource } from "@openducktor/frontend-core/git/workspace-session/use-workspace-session-git-panel";

/** The session Git fields of a test, as flat values. */
export type FlatWorkspaceSessionGit = {
  workingDirectory: string | null;
  branchKey: string;
  currentBranch: GitCurrentBranch | null;
  branchReady: boolean;
  branchError?: string | null;
  target: GitTargetBranch | null;
  savedTarget: GitTargetBranch | null;
  targetError: string | null;
  retryTarget: () => Promise<void>;
  readBranch: () => Promise<string>;
};

/** Builds the `useWorkspaceSessionGit` result that the session tools read. */
export const workspaceSessionGitSource = ({
  workingDirectory,
  branchKey,
  currentBranch,
  branchReady,
  branchError = null,
  target,
  savedTarget,
  targetError,
  retryTarget,
  readBranch,
}: FlatWorkspaceSessionGit): WorkspaceSessionGitSource => ({
  workingDirectory,
  branch: { branchKey, currentBranch, branchReady, readBranch },
  branchError,
  target,
  savedTarget,
  targetError,
  retryTarget,
});

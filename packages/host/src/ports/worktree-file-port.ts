export type WorktreeFilePort = {
  ensureDirectory?(path: string): Promise<void>;
  copyConfiguredPaths(
    repoPath: string,
    worktreePath: string,
    relativePaths: string[],
  ): Promise<void>;
  removePathIfPresent(path: string): Promise<void>;
  resolveWorktreePath(repoPath: string, worktreePath: string): string;
  pathIsWithinRoot(root: string, candidate: string): Promise<boolean>;
};

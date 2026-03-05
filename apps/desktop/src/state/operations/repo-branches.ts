import type { GitBranch } from "@openducktor/contracts";
import { host } from "./host";

export const loadRepoBranches = async (repoPath: string): Promise<GitBranch[]> => {
  const normalizedRepoPath = repoPath.trim();
  if (normalizedRepoPath.length === 0) {
    throw new Error("Cannot load repository branches: repository path is empty.");
  }

  return host.gitGetBranches(normalizedRepoPath);
};

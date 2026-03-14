import type { GitBranch } from "@openducktor/contracts";
import { appQueryClient } from "@/lib/query-client";
import { loadRepoBranchesFromQuery } from "../queries/git";

export const loadRepoBranches = async (repoPath: string): Promise<GitBranch[]> => {
  const normalizedRepoPath = repoPath.trim();
  if (normalizedRepoPath.length === 0) {
    throw new Error("Cannot load repository branches: repository path is empty.");
  }

  return loadRepoBranchesFromQuery(appQueryClient, normalizedRepoPath);
};

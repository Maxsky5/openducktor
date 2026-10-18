import type { QueryClient } from "@tanstack/react-query";

export const issueItemsQueryKeys = {
  repo: (repoPath: string) => ["issue-items", repoPath] as const,
};

export const invalidateRepoIssueItemsQueries = (
  queryClient: QueryClient,
  repoPath: string,
): Promise<void> => queryClient.invalidateQueries({ queryKey: issueItemsQueryKeys.repo(repoPath) });

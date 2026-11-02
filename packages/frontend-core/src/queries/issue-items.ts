import { workspaceScopeValue } from "./workspace-scope";
import type { WorkspaceRef } from "@openducktor/contracts";
import type { QueryClient } from "@tanstack/react-query";

export const issueItemsQueryKeys = {
  repo: (repoPath: WorkspaceRef) => ["issue-items", workspaceScopeValue(repoPath)] as const,
};

export const invalidateRepoIssueItemsQueries = (
  queryClient: QueryClient,
  repoPath: WorkspaceRef,
): Promise<void> => queryClient.invalidateQueries({ queryKey: issueItemsQueryKeys.repo(repoPath) });

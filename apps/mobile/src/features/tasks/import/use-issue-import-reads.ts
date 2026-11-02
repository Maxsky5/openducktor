import type { IssueItemsListResult, RepositoryGitProviderContext } from "@openducktor/contracts";
import { useMinimumLoader } from "@openducktor/frontend-core/lib/use-minimum-loader";
import { repositoryGitProviderContextQueryOptions } from "@openducktor/frontend-core/queries/git-provider-context";
import {
  issueImportListQueryOptions,
  issueImportUnavailableReason,
} from "@openducktor/frontend-core/tasks/issue-import/issue-import-model";
import {
  type IssueImportState,
  toIssueImportState,
} from "@openducktor/frontend-core/tasks/issue-import/issue-import-provider";
import { useIssueImportSearch } from "@openducktor/frontend-core/tasks/issue-import/issue-import-state";
import { keepPreviousData, type UseQueryResult, useQuery } from "@tanstack/react-query";
import { useState } from "react";

export type IssueImportReads = {
  providerQuery: UseQueryResult<RepositoryGitProviderContext>;
  state: IssueImportState;
  query: UseQueryResult<IssueItemsListResult>;
  search: ReturnType<typeof useIssueImportSearch>;
  loading: boolean;
};

/** Keeps one loader running while the provider and first issue page load. */
export function useIssueImportReads(repoPath: string): IssueImportReads {
  const providerQuery = useQuery(repositoryGitProviderContextQueryOptions(repoPath));
  const state = toIssueImportState(providerQuery.data, providerQuery.error);
  const provider = state.kind === "ready" ? state.provider : null;
  const canList = provider !== null && issueImportUnavailableReason(provider) === null;
  const search = useIssueImportSearch();
  const query = useQuery({
    ...issueImportListQueryOptions({
      repoPath,
      provider,
      search: search.search,
      cursor: search.cursors[search.pageIndex],
    }),
    enabled: canList && !search.searchPending,
    placeholderData: keepPreviousData,
  });
  // Later reads must keep the list visible.
  const [hasShown, setHasShown] = useState(false);
  const pending = state.kind === "loading" || (canList && query.isPending);
  const loading = useMinimumLoader(!hasShown && pending);
  if (!hasShown && canList && !loading) {
    setHasShown(true);
  }
  return { providerQuery, state, query, search, loading };
}

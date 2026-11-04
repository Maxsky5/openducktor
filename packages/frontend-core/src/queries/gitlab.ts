import type {
  GitlabAccount,
  GitlabConnectionStatus,
  GitlabConnectionStatusInput,
} from "@openducktor/contracts";
import { type QueryClient, type QueryKey, queryOptions } from "@tanstack/react-query";
import { connectionHost } from "../connection/client-connection";
import { skippedQueryOptions } from "./skipped-query";

const GITLAB_ACCOUNTS_STALE_TIME_MS = 30_000;
const GITLAB_STATUS_STALE_TIME_MS = 30_000;

export const gitlabQueryKeys = {
  all: ["gitlab"] as const,
  accounts: (instanceUrl: string | null) =>
    [...gitlabQueryKeys.all, "accounts", instanceUrl] as const,
  status: (input: GitlabConnectionStatusInput | null) =>
    [
      ...gitlabQueryKeys.all,
      "status",
      input?.instanceUrl ?? null,
      input?.projectPath ?? null,
      input?.accountId ?? null,
      input?.httpConsentInstanceUrl ?? null,
    ] as const,
};

/** The saved accounts of one canonical instance URL. */
export const gitlabAccountsQueryOptionsOrSkip = (instanceUrl: string | null) =>
  instanceUrl === null
    ? skippedQueryOptions<GitlabAccount[], QueryKey>({
        queryKey: gitlabQueryKeys.accounts(null),
        staleTime: GITLAB_ACCOUNTS_STALE_TIME_MS,
      })
    : queryOptions<GitlabAccount[], Error, GitlabAccount[], QueryKey>({
        queryKey: gitlabQueryKeys.accounts(instanceUrl),
        queryFn: ({ client }) => connectionHost(client).gitlabAccountsList({ instanceUrl }),
        staleTime: GITLAB_ACCOUNTS_STALE_TIME_MS,
      });

/** Whether the linked account can reach the project. */
export const gitlabConnectionStatusQueryOptionsOrSkip = (
  input: GitlabConnectionStatusInput | null,
) =>
  input === null
    ? skippedQueryOptions<GitlabConnectionStatus, QueryKey>({
        queryKey: gitlabQueryKeys.status(null),
        staleTime: GITLAB_STATUS_STALE_TIME_MS,
      })
    : queryOptions<GitlabConnectionStatus, Error, GitlabConnectionStatus, QueryKey>({
        queryKey: gitlabQueryKeys.status(input),
        queryFn: ({ client }) => connectionHost(client).gitlabConnectionStatus(input),
        staleTime: GITLAB_STATUS_STALE_TIME_MS,
        retry: false,
      });

/** The account to link to a new repository: the only saved account of the instance. */
export const singleGitlabAccountId = async (
  queryClient: QueryClient,
  instanceUrl: string,
): Promise<string | null> => {
  const saved = await queryClient.fetchQuery(gitlabAccountsQueryOptionsOrSkip(instanceUrl));
  return saved.length === 1 ? (saved[0]?.accountId ?? null) : null;
};

/** An account change can change every account list and connection status. */
export const invalidateGitlabQueries = (queryClient: QueryClient): Promise<void> =>
  queryClient.invalidateQueries({ queryKey: gitlabQueryKeys.all });

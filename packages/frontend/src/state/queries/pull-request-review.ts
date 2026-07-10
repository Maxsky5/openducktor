import type { PullRequest, PullRequestReviewContext } from "@openducktor/contracts";
import { type QueryClient, queryOptions } from "@tanstack/react-query";
import { host } from "@/state/operations/host";

type PullRequestReviewQueryHost = Pick<typeof host, "pullRequestReviewContextGet">;
export type PullRequestReviewContextQueryInput = {
  repoPath: string;
  taskId?: string;
  pullRequest?: Pick<PullRequest, "providerId" | "number">;
};

const PULL_REQUEST_REVIEW_STALE_TIME_MS = 30_000;
const EMPTY_VALUE = "__none__";
const PULL_REQUEST_REVIEW_QUERY_VERSION = "v5";

export const pullRequestReviewQueryKeys = {
  all: ["pull-request-review", PULL_REQUEST_REVIEW_QUERY_VERSION] as const,
  context: (input: PullRequestReviewContextQueryInput) =>
    [
      ...pullRequestReviewQueryKeys.all,
      "context",
      input.repoPath,
      input.taskId ?? EMPTY_VALUE,
      input.pullRequest?.providerId ?? EMPTY_VALUE,
      input.pullRequest?.number ?? EMPTY_VALUE,
    ] as const,
};

export const pullRequestReviewContextQueryOptions = (
  input: PullRequestReviewContextQueryInput,
  hostClient: PullRequestReviewQueryHost = host,
) =>
  queryOptions({
    queryKey: pullRequestReviewQueryKeys.context(input),
    queryFn: (): Promise<PullRequestReviewContext> =>
      hostClient.pullRequestReviewContextGet({
        repoPath: input.repoPath,
        ...(input.taskId ? { taskId: input.taskId } : {}),
      }),
    staleTime: PULL_REQUEST_REVIEW_STALE_TIME_MS,
  });

export const prefetchPullRequestReviewContextFromQuery = (
  queryClient: QueryClient,
  input: PullRequestReviewContextQueryInput,
  hostClient?: PullRequestReviewQueryHost,
): Promise<void> =>
  queryClient.prefetchQuery(pullRequestReviewContextQueryOptions(input, hostClient));

export const invalidatePullRequestReviewContextQueries = (
  queryClient: QueryClient,
): Promise<void> =>
  queryClient.invalidateQueries({
    queryKey: pullRequestReviewQueryKeys.all,
  });

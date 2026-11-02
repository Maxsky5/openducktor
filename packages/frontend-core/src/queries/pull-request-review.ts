import { workspaceScopeValue } from "./workspace-scope";
import type { PullRequest, PullRequestReviewContext, WorkspaceRef } from "@openducktor/contracts";
import { type QueryClient, queryOptions } from "@tanstack/react-query";
import type { HostClient } from "@openducktor/host-client";
import { connectionHost } from "../connection/client-connection";

type PullRequestReviewQueryHost = Pick<HostClient, "pullRequestReviewContextGet">;
export type PullRequestReviewContextQueryInput = WorkspaceRef & {
  taskId?: string;
  pullRequest?: Pick<PullRequest, "providerId" | "number">;
};

const PULL_REQUEST_REVIEW_STALE_TIME_MS = 30_000;
const EMPTY_VALUE = "__none__";
const PULL_REQUEST_REVIEW_QUERY_VERSION = "v6";

export const pullRequestReviewQueryKeys = {
  all: ["pull-request-review", PULL_REQUEST_REVIEW_QUERY_VERSION] as const,
  context: (input: PullRequestReviewContextQueryInput) =>
    [
      ...pullRequestReviewQueryKeys.all,
      "context",
      workspaceScopeValue(input),
      input.taskId ?? EMPTY_VALUE,
      input.pullRequest?.providerId ?? EMPTY_VALUE,
      input.pullRequest?.number ?? EMPTY_VALUE,
    ] as const,
};

export const pullRequestReviewContextQueryOptions = (input: PullRequestReviewContextQueryInput) =>
  queryOptions({
    queryKey: pullRequestReviewQueryKeys.context(input),
    queryFn: ({ client }): Promise<PullRequestReviewContext> => {
      const request: Parameters<PullRequestReviewQueryHost["pullRequestReviewContextGet"]>[0] = {
        workspaceId: input.workspaceId,
        repoPath: input.repoPath,
      };
      if (input.taskId) {
        request.taskId = input.taskId;
      }
      return connectionHost(client).pullRequestReviewContextGet(request);
    },
    staleTime: PULL_REQUEST_REVIEW_STALE_TIME_MS,
  });

export const prefetchPullRequestReviewContextFromQuery = (
  queryClient: QueryClient,
  input: PullRequestReviewContextQueryInput,
): Promise<void> => queryClient.prefetchQuery(pullRequestReviewContextQueryOptions(input));

export const invalidatePullRequestReviewContextQueries = (
  queryClient: QueryClient,
): Promise<void> =>
  queryClient.invalidateQueries({
    queryKey: pullRequestReviewQueryKeys.all,
  });

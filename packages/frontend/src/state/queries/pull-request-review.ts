import type { PullRequestReviewContext } from "@openducktor/contracts";
import { queryOptions } from "@tanstack/react-query";
import { host } from "@/state/operations/host";

type PullRequestReviewQueryHost = Pick<typeof host, "pullRequestReviewContextGet">;

const PULL_REQUEST_REVIEW_STALE_TIME_MS = 30_000;
const EMPTY_VALUE = "__none__";

export const pullRequestReviewQueryKeys = {
  all: ["pull-request-review"] as const,
  context: (input: { repoPath: string; taskId?: string; workingDirectory?: string }) =>
    [
      ...pullRequestReviewQueryKeys.all,
      "context",
      input.repoPath,
      input.taskId ?? EMPTY_VALUE,
      input.workingDirectory ?? EMPTY_VALUE,
      "github",
    ] as const,
};

export const pullRequestReviewContextQueryOptions = (
  input: { repoPath: string; taskId?: string; workingDirectory?: string },
  hostClient: PullRequestReviewQueryHost = host,
) =>
  queryOptions({
    queryKey: pullRequestReviewQueryKeys.context(input),
    queryFn: (): Promise<PullRequestReviewContext> => hostClient.pullRequestReviewContextGet(input),
    staleTime: PULL_REQUEST_REVIEW_STALE_TIME_MS,
  });

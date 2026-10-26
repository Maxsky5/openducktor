import type { PullRequest, RepositoryGitProviderContext } from "@openducktor/contracts";

/**
 * Tells whether the Pull Request review of a task shows, whether its linked Pull Request belongs
 * to the current provider, and why the review is unavailable.
 */
export const resolvePullRequestReviewAvailability = ({
  gitProviderContext,
  gitProviderReadError,
  linkedPullRequest,
}: {
  gitProviderContext: RepositoryGitProviderContext | undefined;
  gitProviderReadError?: string | null;
  linkedPullRequest: PullRequest | undefined;
}) => {
  const supportsPullRequestReview =
    gitProviderContext?.descriptor.capabilities.supportsPullRequestReview === true;
  const readFailedWithoutContext = gitProviderContext == null && gitProviderReadError != null;
  const canShowPullRequestReview = supportsPullRequestReview || readFailedWithoutContext;
  const hasLinkedPullRequest =
    linkedPullRequest !== undefined &&
    (readFailedWithoutContext || linkedPullRequest.providerId === gitProviderContext?.config.id);
  let unavailableReason: string | null = null;
  if (canShowPullRequestReview && gitProviderReadError) {
    unavailableReason = gitProviderReadError;
  } else if (
    supportsPullRequestReview &&
    gitProviderContext &&
    gitProviderContext.health.available === false
  ) {
    unavailableReason =
      gitProviderContext.health.reason ??
      `${gitProviderContext.descriptor.label} is not available for Pull Request review.`;
  }
  return { canShowPullRequestReview, hasLinkedPullRequest, unavailableReason };
};

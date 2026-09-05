import type { RepositoryGitProviderContext } from "@openducktor/contracts";
import { errorMessage } from "@/lib/errors";

export const gitProviderReadError = (error: Error | null): string | null =>
  error ? `Could not load the current Git provider: ${errorMessage(error)}` : null;

export const pullRequestHealthError = (
  context: RepositoryGitProviderContext | undefined,
): string | null => {
  if (!context?.descriptor.capabilities.supportsPullRequests || context.health.available) {
    return null;
  }

  return context.health.reason ?? `${context.descriptor.label} is not available for Pull Requests.`;
};

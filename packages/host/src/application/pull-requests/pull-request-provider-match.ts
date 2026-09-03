import type { GitProviderId } from "@openducktor/contracts";
import { Effect } from "effect";
import { HostValidationError, type HostValidationErrorAggregate } from "../../effect/host-errors";

export const requirePullRequestProviderMatch = ({
  configuredProviderId,
  linkedProviderId,
  field = "pullRequest.providerId",
}: {
  configuredProviderId: GitProviderId;
  linkedProviderId: string;
  field?: string;
}): Effect.Effect<void, HostValidationErrorAggregate> => {
  if (linkedProviderId === configuredProviderId) {
    return Effect.void;
  }

  return Effect.fail(
    new HostValidationError({
      field,
      message: `Pull request provider '${linkedProviderId}' does not match configured provider '${configuredProviderId}'.`,
      details: { linkedProviderId, configuredProviderId },
    }),
  );
};

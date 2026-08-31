import type { RepoConfig } from "@openducktor/contracts";
import { Effect } from "effect";
import {
  type GitProviderCapability,
  GitProviderCapabilityError,
  GitProviderRegistrationError,
  GitProviderResolutionError,
} from "../../ports/git-provider-errors";
import type { GitProviderPort } from "../../ports/git-provider-port";

export {
  GitProviderCapabilityError,
  GitProviderRegistrationError,
  GitProviderResolutionError,
} from "../../ports/git-provider-errors";

export type GitProviderResolver = {
  resolve(repoConfig: RepoConfig): Effect.Effect<GitProviderPort, GitProviderResolutionError>;
};

type CapabilityRegistration = {
  capability: GitProviderCapability;
  declared: boolean;
  isSupplied: () => boolean;
};

const hasCapabilityPort = <Port>(
  accessor: () => Effect.Effect<Port, GitProviderCapabilityError>,
): boolean => Effect.runSync(accessor().pipe(Effect.either))._tag === "Right";

const validateCapabilityRegistration = (
  provider: GitProviderPort,
  registration: CapabilityRegistration,
): void => {
  const providerId = provider.getDescriptor().id;
  const supplied = registration.isSupplied();
  if (registration.declared === supplied) {
    return;
  }

  if (registration.declared) {
    throw new GitProviderRegistrationError({
      reason: "declared_capability_missing_port",
      providerId,
      capability: registration.capability,
      message: `Git provider '${providerId}' declares '${registration.capability}' but does not supply its port.`,
    });
  }

  throw new GitProviderRegistrationError({
    reason: "undeclared_capability_has_port",
    providerId,
    capability: registration.capability,
    message: `Git provider '${providerId}' supplies '${registration.capability}' without declaring support.`,
  });
};

const validateProviderRegistration = (provider: GitProviderPort): void => {
  const { capabilities } = provider.getDescriptor();
  validateCapabilityRegistration(provider, {
    capability: "pull_requests",
    declared: capabilities.supportsPullRequests,
    isSupplied: () => hasCapabilityPort(() => provider.pullRequests()),
  });
  validateCapabilityRegistration(provider, {
    capability: "pull_request_review",
    declared: capabilities.supportsPullRequestReview,
    isSupplied: () => hasCapabilityPort(() => provider.pullRequestReview()),
  });
};

export const createGitProviderResolver = (
  registrations: readonly GitProviderPort[],
): GitProviderResolver => {
  const providers = Object.freeze([...registrations]);
  const providersById = new Map<string, GitProviderPort>();

  for (const provider of providers) {
    validateProviderRegistration(provider);
    const providerId = provider.getDescriptor().id;
    if (providersById.has(providerId)) {
      throw new GitProviderRegistrationError({
        reason: "duplicate_provider_id",
        providerId,
        message: `Git provider '${providerId}' is registered more than once.`,
      });
    }
    providersById.set(providerId, provider);
  }

  return {
    resolve(repoConfig) {
      const providerConfig = repoConfig.git.provider;
      if (!providerConfig) {
        return Effect.fail(
          new GitProviderResolutionError({
            reason: "not_configured",
            message: "No Git provider is configured for this repository.",
          }),
        );
      }
      if (!providerConfig.enabled) {
        return Effect.fail(
          new GitProviderResolutionError({
            reason: "disabled",
            providerId: providerConfig.id,
            message: `Git provider '${providerConfig.id}' is disabled for this repository.`,
          }),
        );
      }

      const provider = providersById.get(providerConfig.id);
      if (!provider) {
        return Effect.fail(
          new GitProviderResolutionError({
            reason: "not_registered",
            providerId: providerConfig.id,
            message: `Git provider '${providerConfig.id}' has no registered implementation.`,
          }),
        );
      }
      return Effect.succeed(provider);
    },
  };
};

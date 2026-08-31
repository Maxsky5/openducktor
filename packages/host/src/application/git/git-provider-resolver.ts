import type { RepoConfig } from "@openducktor/contracts";
import { Effect } from "effect";
import {
  type GitProviderCapability,
  GitProviderCapabilityError,
  GitProviderRegistrationError,
  GitProviderResolutionError,
} from "../../ports/git-provider-errors";
import type { GitProviderPort } from "../../ports/git-provider-port";
import type { PullRequestReviewProviderPort } from "../../ports/pull-request-review-provider-port";

export {
  GitProviderCapabilityError,
  GitProviderRegistrationError,
  GitProviderResolutionError,
} from "../../ports/git-provider-errors";

export type GitProviderResolver = {
  resolve(repoConfig: RepoConfig): Effect.Effect<GitProviderPort, GitProviderResolutionError>;
};

type CapabilityRegistration<Port> = {
  capability: GitProviderCapability;
  declared: boolean;
  access: () => Effect.Effect<Port, GitProviderCapabilityError>;
  validatePort?: (
    port: Port,
    providerId: string,
  ) => Effect.Effect<void, GitProviderRegistrationError>;
};

const validateCapabilityRegistration = <Port>(
  provider: GitProviderPort,
  registration: CapabilityRegistration<Port>,
): Effect.Effect<void, GitProviderRegistrationError> =>
  Effect.gen(function* () {
    const providerId = provider.getDescriptor().id;
    const portResult = yield* Effect.either(registration.access());
    const supplied = portResult._tag === "Right";
    if (registration.declared !== supplied) {
      if (registration.declared) {
        return yield* Effect.fail(
          new GitProviderRegistrationError({
            reason: "declared_capability_missing_port",
            providerId,
            capability: registration.capability,
            message: `Git provider '${providerId}' declares '${registration.capability}' but does not supply its port.`,
          }),
        );
      }

      return yield* Effect.fail(
        new GitProviderRegistrationError({
          reason: "undeclared_capability_has_port",
          providerId,
          capability: registration.capability,
          message: `Git provider '${providerId}' supplies '${registration.capability}' without declaring support.`,
        }),
      );
    }

    if (portResult._tag === "Right" && registration.validatePort) {
      yield* registration.validatePort(portResult.right, providerId);
    }
  });

const validateReviewPortOwner = (
  port: PullRequestReviewProviderPort,
  providerId: string,
): Effect.Effect<void, GitProviderRegistrationError> => {
  if (port.providerId === providerId) {
    return Effect.void;
  }

  return Effect.fail(
    new GitProviderRegistrationError({
      reason: "capability_provider_id_mismatch",
      providerId,
      capability: "pull_request_review",
      message: `Git provider '${providerId}' supplies a Pull Request review port owned by '${port.providerId}'.`,
    }),
  );
};

const validateProviderRegistration = (
  provider: GitProviderPort,
): Effect.Effect<void, GitProviderRegistrationError> =>
  Effect.gen(function* () {
    const { capabilities } = provider.getDescriptor();
    yield* validateCapabilityRegistration(provider, {
      capability: "pull_requests",
      declared: capabilities.supportsPullRequests,
      access: () => provider.pullRequests(),
    });
    yield* validateCapabilityRegistration(provider, {
      capability: "pull_request_review",
      declared: capabilities.supportsPullRequestReview,
      access: () => provider.pullRequestReview(),
      validatePort: validateReviewPortOwner,
    });
  });

export const createGitProviderResolver = (
  registrations: readonly GitProviderPort[],
): Effect.Effect<GitProviderResolver, GitProviderRegistrationError> => {
  const providers = Object.freeze([...registrations]);

  return Effect.gen(function* () {
    const providersById = new Map<string, GitProviderPort>();

    for (const provider of providers) {
      const providerId = provider.getDescriptor().id;
      if (providersById.has(providerId)) {
        return yield* Effect.fail(
          new GitProviderRegistrationError({
            reason: "duplicate_provider_id",
            providerId,
            message: `Git provider '${providerId}' is registered more than once.`,
          }),
        );
      }
      providersById.set(providerId, provider);
    }

    for (const provider of providers) {
      yield* validateProviderRegistration(provider);
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
    } satisfies GitProviderResolver;
  });
};

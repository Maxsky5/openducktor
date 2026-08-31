import type { GitProviderId, RepoConfig } from "@openducktor/contracts";
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

export const createGitProviderResolver = (
  ports: readonly GitProviderPort[],
): Effect.Effect<GitProviderResolver, GitProviderRegistrationError> => {
  const providers = Object.freeze([...ports]);

  return Effect.gen(function* () {
    const providersById = new Map<GitProviderId, GitProviderPort>();

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
      yield* checkProvider(provider);
    }

    return {
      resolve(repoConfig) {
        const selection = repoConfig.git.provider;
        if (!selection) {
          return Effect.fail(
            new GitProviderResolutionError({
              reason: "not_configured",
              message: "No Git provider is configured for this repository.",
            }),
          );
        }
        if (!selection.enabled) {
          return Effect.fail(
            new GitProviderResolutionError({
              reason: "disabled",
              providerId: selection.id,
              message: `Git provider '${selection.id}' is disabled for this repository.`,
            }),
          );
        }

        const provider = providersById.get(selection.id);
        if (!provider) {
          return Effect.fail(
            new GitProviderResolutionError({
              reason: "not_registered",
              providerId: selection.id,
              message: `Git provider '${selection.id}' has no registered implementation.`,
            }),
          );
        }
        return Effect.succeed(provider);
      },
    } satisfies GitProviderResolver;
  });
};

type CapabilityRule<Port> = {
  capability: GitProviderCapability;
  supported: boolean;
  getPort: () => Effect.Effect<Port, GitProviderCapabilityError>;
  checkPort?: (
    port: Port,
    providerId: GitProviderId,
  ) => Effect.Effect<void, GitProviderRegistrationError>;
};

function checkProvider(
  provider: GitProviderPort,
): Effect.Effect<void, GitProviderRegistrationError> {
  return Effect.gen(function* () {
    const { capabilities } = provider.getDescriptor();
    yield* checkCapability(provider, {
      capability: "pull_requests",
      supported: capabilities.supportsPullRequests,
      getPort: () => provider.pullRequests(),
    });
    yield* checkCapability(provider, {
      capability: "pull_request_review",
      supported: capabilities.supportsPullRequestReview,
      getPort: () => provider.pullRequestReview(),
      checkPort: checkReviewPortOwner,
    });
  });
}

function checkCapability<Port>(
  provider: GitProviderPort,
  rule: CapabilityRule<Port>,
): Effect.Effect<void, GitProviderRegistrationError> {
  return Effect.gen(function* () {
    const providerId = provider.getDescriptor().id;
    const portResult = yield* Effect.either(rule.getPort());
    const hasPort = portResult._tag === "Right";
    if (rule.supported !== hasPort) {
      if (rule.supported) {
        return yield* Effect.fail(
          new GitProviderRegistrationError({
            reason: "declared_capability_missing_port",
            providerId,
            capability: rule.capability,
            message: `Git provider '${providerId}' declares '${rule.capability}' but does not supply its port.`,
          }),
        );
      }

      return yield* Effect.fail(
        new GitProviderRegistrationError({
          reason: "undeclared_capability_has_port",
          providerId,
          capability: rule.capability,
          message: `Git provider '${providerId}' supplies '${rule.capability}' without declaring support.`,
        }),
      );
    }

    if (portResult._tag === "Right" && rule.checkPort) {
      yield* rule.checkPort(portResult.right, providerId);
    }
  });
}

function checkReviewPortOwner(
  port: PullRequestReviewProviderPort,
  providerId: GitProviderId,
): Effect.Effect<void, GitProviderRegistrationError> {
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
}

import type { GitProviderId, RepoConfig } from "@openducktor/contracts";
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
  resolveConfigured(
    repoConfig: RepoConfig,
  ): Effect.Effect<GitProviderPort, GitProviderResolutionError>;
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

    const resolveConfigured = (
      repoConfig: RepoConfig,
    ): Effect.Effect<GitProviderPort, GitProviderResolutionError> => {
      const selection = repoConfig.git.provider;
      if (!selection) {
        return Effect.fail(
          new GitProviderResolutionError({
            reason: "not_configured",
            message: "No Git provider is configured for this repository.",
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
    };

    return {
      resolveConfigured,
      resolve(repoConfig) {
        const selection = repoConfig.git.provider;
        if (!selection) {
          return resolveConfigured(repoConfig);
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
        return resolveConfigured(repoConfig);
      },
    } satisfies GitProviderResolver;
  });
};

type CapabilityRule<Port extends { providerId: GitProviderId }> = {
  capability: GitProviderCapability;
  supported: boolean;
  getPort: () => Effect.Effect<Port, GitProviderCapabilityError>;
};

const PORT_LABELS = {
  pull_requests: "Pull Request",
  pull_request_review: "Pull Request review",
} satisfies Record<GitProviderCapability, string>;

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
    });
  });
}

function checkCapability<Port extends { providerId: GitProviderId }>(
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

    if (portResult._tag === "Right" && portResult.right.providerId !== providerId) {
      return yield* Effect.fail(
        new GitProviderRegistrationError({
          reason: "capability_provider_id_mismatch",
          providerId,
          capability: rule.capability,
          message: `Git provider '${providerId}' supplies a ${PORT_LABELS[rule.capability]} port owned by '${portResult.right.providerId}'.`,
        }),
      );
    }
  });
}

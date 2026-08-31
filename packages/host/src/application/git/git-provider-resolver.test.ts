import { describe, expect, test } from "bun:test";
import { repoConfigSchema, type GitProviderDescriptor } from "@openducktor/contracts";
import { Effect } from "effect";
import type {
  GitProviderHealthPort,
  GitProviderPort,
  GitProviderRepositoryPort,
  PullRequestProviderPort,
} from "../../ports/git-provider-port";
import type { PullRequestReviewProviderPort } from "../../ports/pull-request-review-provider-port";
import {
  GitProviderCapabilityError,
  GitProviderRegistrationError,
  GitProviderResolutionError,
  createGitProviderResolver,
  type GitProviderResolver,
} from "./git-provider-resolver";

const unexpectedPortCall = <Success>(): Effect.Effect<Success, never> =>
  Effect.die("Capability port operation is not expected in resolver tests");

const repositoryPort: GitProviderRepositoryPort = {
  getReadRepository: () => unexpectedPortCall(),
  getWriteContext: () => unexpectedPortCall(),
};
const healthPort: GitProviderHealthPort = {
  getStatus: () => unexpectedPortCall(),
};
const pullRequestPort: PullRequestProviderPort = {
  findByBranch: () => unexpectedPortCall(),
  getByNumber: () => unexpectedPortCall(),
  upsert: () => unexpectedPortCall(),
};
const pullRequestReviewPort: PullRequestReviewProviderPort = {
  providerId: "github",
  readContext: () => unexpectedPortCall(),
};

const descriptor = ({
  id,
  supportsPullRequests = false,
  supportsPullRequestReview = false,
}: {
  id: string;
  supportsPullRequests?: boolean;
  supportsPullRequestReview?: boolean;
}): GitProviderDescriptor => ({
  id,
  label: id,
  description: `${id} provider`,
  capabilities: {
    supportsPullRequests,
    supportsPullRequestReview,
  },
});

const provider = ({
  providerDescriptor,
  pullRequests,
  pullRequestReview,
  asyncCapabilityAccess = false,
}: {
  providerDescriptor: GitProviderDescriptor;
  pullRequests?: PullRequestProviderPort;
  pullRequestReview?: PullRequestReviewProviderPort;
  asyncCapabilityAccess?: boolean;
}): GitProviderPort => ({
  getDescriptor: () => providerDescriptor,
  repository: () => repositoryPort,
  health: () => healthPort,
  pullRequests: () => {
    if (pullRequests) {
      return asyncCapabilityAccess
        ? Effect.promise(() => Promise.resolve(pullRequests))
        : Effect.succeed(pullRequests);
    }
    return Effect.fail(
      new GitProviderCapabilityError({
        providerId: providerDescriptor.id,
        capability: "pull_requests",
        message: `Provider '${providerDescriptor.id}' does not support Pull Requests.`,
      }),
    );
  },
  pullRequestReview: () => {
    if (pullRequestReview) {
      return asyncCapabilityAccess
        ? Effect.promise(() => Promise.resolve(pullRequestReview))
        : Effect.succeed(pullRequestReview);
    }
    return Effect.fail(
      new GitProviderCapabilityError({
        providerId: providerDescriptor.id,
        capability: "pull_request_review",
        message: `Provider '${providerDescriptor.id}' does not support Pull Request review.`,
      }),
    );
  },
});

const repoConfig = (providerConfig?: { id: string; enabled: boolean }) =>
  repoConfigSchema.parse({
    workspaceId: "repo",
    workspaceName: "Repo",
    repoPath: "/repo",
    defaultRuntimeKind: "opencode",
    git: providerConfig ? { provider: providerConfig } : {},
  });

const resolveEither = (resolver: GitProviderResolver, config: ReturnType<typeof repoConfig>) =>
  Effect.runPromise(resolver.resolve(config).pipe(Effect.either));

const createResolverSync = (providers: readonly GitProviderPort[]) =>
  Effect.runSync(createGitProviderResolver(providers));

const registrationEither = (providers: readonly GitProviderPort[]) =>
  Effect.runPromise(createGitProviderResolver(providers).pipe(Effect.either));

describe("createGitProviderResolver", () => {
  test("fails with a typed error when no provider is configured", async () => {
    const resolver = createResolverSync([]);

    const result = await resolveEither(resolver, repoConfig());

    expect(result._tag).toBe("Left");
    if (result._tag === "Left") {
      expect(result.left).toBeInstanceOf(GitProviderResolutionError);
      expect(result.left.reason).toBe("not_configured");
      expect(result.left.providerId).toBeUndefined();
    }
  });

  test("fails with a typed error when the configured provider is disabled", async () => {
    const github = provider({ providerDescriptor: descriptor({ id: "github" }) });
    const resolver = createResolverSync([github]);

    const result = await resolveEither(resolver, repoConfig({ id: "github", enabled: false }));

    expect(result._tag).toBe("Left");
    if (result._tag === "Left") {
      expect(result.left).toBeInstanceOf(GitProviderResolutionError);
      expect(result.left.reason).toBe("disabled");
      expect(result.left.providerId).toBe("github");
    }
  });

  test("fails with a typed error when the configured provider is not registered", async () => {
    const github = provider({ providerDescriptor: descriptor({ id: "github" }) });
    const resolver = createResolverSync([github]);

    const result = await resolveEither(resolver, repoConfig({ id: "gitlab", enabled: true }));

    expect(result._tag).toBe("Left");
    if (result._tag === "Left") {
      expect(result.left).toBeInstanceOf(GitProviderResolutionError);
      expect(result.left.reason).toBe("not_registered");
      expect(result.left.providerId).toBe("gitlab");
    }
  });

  test("resolves the exact configured GitHub provider", async () => {
    const github = provider({ providerDescriptor: descriptor({ id: "github" }) });
    const other = provider({ providerDescriptor: descriptor({ id: "gitlab" }) });
    const resolver = createResolverSync([other, github]);

    const resolved = await Effect.runPromise(
      resolver.resolve(repoConfig({ id: "github", enabled: true })),
    );

    expect(resolved).toBe(github);
  });

  test("copies the registered provider collection", async () => {
    const github = provider({ providerDescriptor: descriptor({ id: "github" }) });
    const providers: GitProviderPort[] = [github];
    const resolver = createResolverSync(providers);
    providers.push(provider({ providerDescriptor: descriptor({ id: "gitlab" }) }));

    const result = await resolveEither(resolver, repoConfig({ id: "gitlab", enabled: true }));

    expect(result._tag).toBe("Left");
    if (result._tag === "Left") {
      expect(result.left.reason).toBe("not_registered");
    }
  });

  test("rejects duplicate descriptor IDs", async () => {
    const first = provider({ providerDescriptor: descriptor({ id: "github" }) });
    const second = provider({ providerDescriptor: descriptor({ id: "github" }) });

    const result = await registrationEither([first, second]);

    expect(result._tag).toBe("Left");
    if (result._tag === "Left") {
      expect(result.left).toBeInstanceOf(GitProviderRegistrationError);
      expect(result.left.reason).toBe("duplicate_provider_id");
    }
  });

  test("rejects a review port owned by another provider", async () => {
    const foreignReviewPort: PullRequestReviewProviderPort = {
      providerId: "gitlab",
      readContext: () => unexpectedPortCall(),
    };
    const github = provider({
      providerDescriptor: descriptor({
        id: "github",
        supportsPullRequests: true,
        supportsPullRequestReview: true,
      }),
      pullRequests: pullRequestPort,
      pullRequestReview: foreignReviewPort,
    });

    const result = await registrationEither([github]);

    expect(result._tag).toBe("Left");
    if (result._tag === "Left") {
      expect(result.left).toEqual(
        expect.objectContaining({
          _tag: "GitProviderRegistrationError",
          reason: "capability_provider_id_mismatch",
          capability: "pull_request_review",
          providerId: "github",
        }),
      );
    }
  });

  test("accepts asynchronous capability accessors", async () => {
    const github = provider({
      providerDescriptor: descriptor({
        id: "github",
        supportsPullRequests: true,
        supportsPullRequestReview: true,
      }),
      pullRequests: pullRequestPort,
      pullRequestReview: pullRequestReviewPort,
      asyncCapabilityAccess: true,
    });

    const resolver = await Effect.runPromise(createGitProviderResolver([github]));
    const resolved = await Effect.runPromise(
      resolver.resolve(repoConfig({ id: "github", enabled: true })),
    );

    expect(resolved).toBe(github);
  });

  test.each([
    {
      name: "declared Pull Request support without a port",
      providerDescriptor: descriptor({ id: "github", supportsPullRequests: true }),
      pullRequests: undefined,
      pullRequestReview: undefined,
      reason: "declared_capability_missing_port",
      capability: "pull_requests",
    },
    {
      name: "declared review support without a port",
      providerDescriptor: descriptor({
        id: "github",
        supportsPullRequests: true,
        supportsPullRequestReview: true,
      }),
      pullRequests: pullRequestPort,
      pullRequestReview: undefined,
      reason: "declared_capability_missing_port",
      capability: "pull_request_review",
    },
    {
      name: "a Pull Request port without declared support",
      providerDescriptor: descriptor({ id: "github" }),
      pullRequests: pullRequestPort,
      pullRequestReview: undefined,
      reason: "undeclared_capability_has_port",
      capability: "pull_requests",
    },
    {
      name: "a review port without declared support",
      providerDescriptor: descriptor({ id: "github" }),
      pullRequests: undefined,
      pullRequestReview: pullRequestReviewPort,
      reason: "undeclared_capability_has_port",
      capability: "pull_request_review",
    },
  ])(
    "rejects $name",
    async ({ providerDescriptor, pullRequests, pullRequestReview, reason, capability }) => {
      const providerInput: Parameters<typeof provider>[0] = { providerDescriptor };
      if (pullRequests) {
        providerInput.pullRequests = pullRequests;
      }
      if (pullRequestReview) {
        providerInput.pullRequestReview = pullRequestReview;
      }
      const invalidProvider = provider(providerInput);

      const result = await registrationEither([invalidProvider]);

      expect(result._tag).toBe("Left");
      if (result._tag === "Left") {
        expect(result.left).toEqual(
          expect.objectContaining({
            _tag: "GitProviderRegistrationError",
            reason,
            capability,
            providerId: "github",
          }),
        );
      }
    },
  );

  test("unsupported capability access fails with a typed error", async () => {
    const basicProvider = provider({ providerDescriptor: descriptor({ id: "basic" }) });
    const resolver = createResolverSync([basicProvider]);
    const resolved = await Effect.runPromise(
      resolver.resolve(repoConfig({ id: "basic", enabled: true })),
    );

    const pullRequests = await Effect.runPromise(resolved.pullRequests().pipe(Effect.either));
    const review = await Effect.runPromise(resolved.pullRequestReview().pipe(Effect.either));

    expect(pullRequests._tag).toBe("Left");
    expect(review._tag).toBe("Left");
    if (pullRequests._tag === "Left" && review._tag === "Left") {
      expect(pullRequests.left).toBeInstanceOf(GitProviderCapabilityError);
      expect(review.left).toBeInstanceOf(GitProviderCapabilityError);
    }
  });

  test("capability checks use direct typed descriptor fields", () => {
    const github = provider({
      providerDescriptor: descriptor({
        id: "github",
        supportsPullRequests: true,
        supportsPullRequestReview: true,
      }),
      pullRequests: pullRequestPort,
      pullRequestReview: pullRequestReviewPort,
    });

    expect(github.getDescriptor().capabilities.supportsPullRequests).toBe(true);
    expect(github.getDescriptor().capabilities.supportsPullRequestReview).toBe(true);
  });
});

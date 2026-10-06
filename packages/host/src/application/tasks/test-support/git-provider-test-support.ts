import { GITHUB_PROVIDER_DESCRIPTOR } from "@openducktor/contracts";
import { Effect } from "effect";
import type { GitProviderResolver } from "../../git/git-provider-resolver";

export const createDefaultGitProviderResolver = (): GitProviderResolver => {
  const resolve = (repoConfig: Parameters<GitProviderResolver["resolve"]>[0]) =>
    Effect.succeed({
      getDescriptor: () => GITHUB_PROVIDER_DESCRIPTOR,
      repository: () => ({
        detectRepository: () => Effect.die(new Error("unexpected repository detection")),
        getRepository: (configuredRepo: Parameters<GitProviderResolver["resolve"]>[0]) => {
          const repository = configuredRepo.git.provider?.repository;
          return repository
            ? Effect.succeed(repository)
            : Effect.die(new Error("test repository mapping is missing"));
        },
        getMapping: (configuredRepo: Parameters<GitProviderResolver["resolve"]>[0]) => {
          const repository = configuredRepo.git.provider?.repository;
          return repository
            ? Effect.succeed({ repository, remoteName: "origin" })
            : Effect.die(new Error("test repository mapping is missing"));
        },
      }),
      health: () => ({
        getStatus: () =>
          Effect.succeed({
            providerId: repoConfig.git.provider?.id ?? GITHUB_PROVIDER_DESCRIPTOR.id,
            enabled: repoConfig.git.provider?.enabled ?? false,
            available: true,
            executablePath: "gh",
            version: "gh version test",
            authenticated: true,
            account: "octocat",
            repositoryMappingValid: true,
          }),
      }),
      pullRequests: () => Effect.die(new Error("unexpected Pull Request port")),
      pullRequestReview: () => Effect.die(new Error("unexpected Pull Request review port")),
      issues: () => Effect.die(new Error("unexpected Issue reader port")),
    });
  return { resolve, resolveConfigured: resolve };
};

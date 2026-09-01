import type { GitProviderHealth, GitProviderRepository, RepoConfig } from "@openducktor/contracts";
import { Effect } from "effect";
import type { HostError } from "../../effect/host-errors";
import type {
  GitProviderRepositoryError,
  GitProviderResolutionError,
} from "../../ports/git-provider-errors";
import type { GitProviderResolver } from "./git-provider-resolver";

export type GitProviderServiceError =
  | GitProviderRepositoryError
  | GitProviderResolutionError
  | HostError;

export type GitProviderService = {
  detectRepository(input: {
    repoConfig: RepoConfig;
  }): Effect.Effect<GitProviderRepository, GitProviderServiceError>;
  getHealth(
    repoConfig: RepoConfig,
  ): Effect.Effect<GitProviderHealth, GitProviderResolutionError | HostError>;
};

export const createGitProviderService = (resolver: GitProviderResolver): GitProviderService => ({
  detectRepository({ repoConfig }) {
    return Effect.gen(function* () {
      const provider = yield* resolver.resolve(repoConfig);
      return yield* provider.repository().detectRepository(repoConfig.repoPath);
    });
  },
  getHealth(repoConfig) {
    return Effect.gen(function* () {
      const provider = yield* resolver.resolve(repoConfig);
      return yield* provider.health().getStatus(repoConfig);
    });
  },
});

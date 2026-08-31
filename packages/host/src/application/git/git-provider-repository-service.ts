import type { GitProviderRepository, RepoConfig } from "@openducktor/contracts";
import { Effect } from "effect";
import type { HostError } from "../../effect/host-errors";
import type {
  GitProviderRepositoryError,
  GitProviderResolutionError,
} from "../../ports/git-provider-errors";
import type { GitProviderResolver } from "./git-provider-resolver";

export type GitProviderRepositoryServiceError =
  | GitProviderRepositoryError
  | GitProviderResolutionError
  | HostError;

export type GitProviderRepositoryService = {
  detectRepository(input: {
    repoConfig: RepoConfig;
  }): Effect.Effect<GitProviderRepository, GitProviderRepositoryServiceError>;
};

export const createGitProviderRepositoryService = (
  resolver: GitProviderResolver,
): GitProviderRepositoryService => ({
  detectRepository({ repoConfig }) {
    return Effect.gen(function* () {
      const provider = yield* resolver.resolve(repoConfig);
      return yield* provider.repository().detectRepository(repoConfig.repoPath);
    });
  },
});

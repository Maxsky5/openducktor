import type {
  GitProviderId,
  GitProviderRepository,
  RepoConfig,
  RepositoryGitProviderContext,
} from "@openducktor/contracts";
import { Effect } from "effect";
import type { HostError } from "../../effect/host-errors";
import type {
  GitProviderRepositoryError,
  GitProviderResolutionError,
} from "../../ports/git-provider-errors";
import type {
  WorkspaceSettingsError,
  WorkspaceSettingsService,
} from "../workspaces/workspace-settings-service";
import type { GitProviderResolver } from "./git-provider-resolver";

export type GitProviderServiceError =
  | GitProviderRepositoryError
  | GitProviderResolutionError
  | HostError
  | WorkspaceSettingsError;

export type GitProviderService = {
  detectRepository(input: {
    repoPath: string;
    providerId: GitProviderId;
  }): Effect.Effect<GitProviderRepository, GitProviderServiceError>;
  getContext(
    repoPath: string,
  ): Effect.Effect<RepositoryGitProviderContext, GitProviderServiceError>;
};

export const createGitProviderService = ({
  resolver,
  workspaceSettingsService,
}: {
  resolver: GitProviderResolver;
  workspaceSettingsService: Pick<WorkspaceSettingsService, "getRepoConfigByRepoPath">;
}): GitProviderService => ({
  detectRepository({ repoPath, providerId }) {
    return Effect.gen(function* () {
      const repoConfig = yield* workspaceSettingsService.getRepoConfigByRepoPath(repoPath);
      const provider = yield* resolver.resolve(detectionConfig(repoConfig, providerId));
      return yield* provider.repository().detectRepository(repoConfig.repoPath);
    });
  },
  getContext(repoPath) {
    return Effect.gen(function* () {
      const repoConfig = yield* workspaceSettingsService.getRepoConfigByRepoPath(repoPath);
      const config = repoConfig.git.provider;
      if (!config) {
        return null;
      }
      const provider = yield* resolver.resolveConfigured(repoConfig);
      const health = yield* provider.health().getStatus(repoConfig);
      return {
        descriptor: provider.getDescriptor(),
        config,
        health,
      };
    });
  },
});

const detectionConfig = (repoConfig: RepoConfig, providerId: GitProviderId): RepoConfig => {
  const configuredProvider = repoConfig.git.provider;
  const matchingProvider = configuredProvider?.id === providerId ? configuredProvider : undefined;
  return {
    ...repoConfig,
    git: {
      provider: {
        ...matchingProvider,
        id: providerId,
        enabled: true,
        autoDetected: matchingProvider?.autoDetected ?? false,
      },
    },
  };
};

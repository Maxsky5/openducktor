import type {
  GitProviderId,
  GitProviderRepository,
  RepoConfig,
  RepositoryGitProviderContext,
} from "@openducktor/contracts";
import { Effect } from "effect";
import { type HostError, HostValidationError } from "../../effect/host-errors";
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
      const provider = yield* resolver.resolve(yield* detectionConfig(repoConfig, providerId));
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

const detectionConfig = (repoConfig: RepoConfig, providerId: GitProviderId) =>
  Effect.gen(function* () {
    const configuredProvider = repoConfig.git.provider;
    if (configuredProvider !== undefined && configuredProvider.id !== providerId) {
      return yield* Effect.fail(
        new HostValidationError({
          field: "git.provider.id",
          message: `Cannot detect provider '${providerId}' while provider '${configuredProvider.id}' is configured.`,
          details: { repoPath: repoConfig.repoPath },
        }),
      );
    }

    return {
      ...repoConfig,
      git: {
        provider: {
          ...configuredProvider,
          id: providerId,
          enabled: true,
          autoDetected: configuredProvider?.autoDetected ?? false,
        },
      },
    };
  });

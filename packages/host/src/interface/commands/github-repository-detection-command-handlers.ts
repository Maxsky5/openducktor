import { GITHUB_PROVIDER_DESCRIPTOR, type RepoConfig } from "@openducktor/contracts";
import { Effect } from "effect";
import type { GitProviderRepositoryService } from "../../application/git/git-provider-repository-service";
import type { WorkspaceSettingsService } from "../../application/workspaces/workspace-settings-service";
import { errorMessage, HostValidationError, isHostError } from "../../effect/host-errors";
import { GitProviderRepositoryError } from "../../ports/git-provider-errors";
import type { HostCommandHandlerDefinitions } from "../router/host-command-router";
import {
  commandInputRecordSchema,
  commandInputStringSchema,
  type HostCommandArgs,
  requireRecord,
  requireString,
} from "./command-inputs";

const parseRepoPath = (args: HostCommandArgs): string => {
  const record = requireRecord(
    commandInputRecordSchema.safeParse(args),
    "workspace_detect_github_repository input",
  );
  return requireString(commandInputStringSchema.safeParse(record.repoPath), "repoPath");
};

const detectionConfig = (repoConfig: RepoConfig): RepoConfig => {
  const configuredProvider = repoConfig.git.provider;
  if (configuredProvider !== undefined && configuredProvider.id !== GITHUB_PROVIDER_DESCRIPTOR.id) {
    throw new HostValidationError({
      field: "git.provider.id",
      message: `Cannot detect a GitHub repository while provider '${configuredProvider.id}' is configured.`,
      details: { repoPath: repoConfig.repoPath },
    });
  }

  return {
    ...repoConfig,
    git: {
      provider: {
        ...configuredProvider,
        id: GITHUB_PROVIDER_DESCRIPTOR.id,
        enabled: true,
        autoDetected: configuredProvider?.autoDetected ?? false,
      },
    },
  };
};

export const createGithubRepositoryDetectionCommandHandlers = ({
  service,
  workspaceSettingsService,
}: {
  service: GitProviderRepositoryService;
  workspaceSettingsService: Pick<WorkspaceSettingsService, "getRepoConfigByRepoPath">;
}) =>
  ({
    workspace_detect_github_repository: (args) =>
      Effect.gen(function* () {
        const repoPath = parseRepoPath(args);
        const repoConfig = yield* workspaceSettingsService.getRepoConfigByRepoPath(repoPath);
        return yield* service.detectRepository({
          repoConfig: detectionConfig(repoConfig),
        });
      }).pipe(
        Effect.mapError((cause) => {
          if (isHostError(cause)) {
            return cause;
          }
          if (cause instanceof GitProviderRepositoryError) {
            return new HostValidationError({
              field: "git.provider.repository",
              message: cause.message,
              cause,
              details: {
                reason: cause.reason,
                repoPath: cause.repoPath,
                remoteNames: cause.remoteNames,
                repositories: cause.repositories,
              },
            });
          }
          return new HostValidationError({
            message: errorMessage(cause),
            cause,
          });
        }),
      ),
  }) satisfies HostCommandHandlerDefinitions;

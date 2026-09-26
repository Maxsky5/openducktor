import { Effect } from "effect";
import { HostValidationError } from "../../effect/host-errors";
import type { AzureAreaPathsPort } from "../../ports/azure-area-paths-port";
import type { WorkspaceSettingsService } from "../workspaces/workspace-settings-service";
import type { GitProviderResolver } from "./git-provider-resolver";

export const createAzureAreaPathsService = ({
  resolver,
  areaPaths,
  workspaceSettingsService,
}: {
  resolver: GitProviderResolver;
  areaPaths: AzureAreaPathsPort;
  workspaceSettingsService: Pick<WorkspaceSettingsService, "getRepoConfigByRepoPath">;
}) => ({
  list(repoPath: string) {
    return Effect.gen(function* () {
      const repoConfig = yield* workspaceSettingsService.getRepoConfigByRepoPath(repoPath);
      const provider = yield* resolver.resolve(repoConfig);
      if (provider.getDescriptor().id !== "azure_devops") {
        return yield* new HostValidationError({
          field: "provider",
          message: "Choose Azure DevOps to list area paths.",
        });
      }
      return yield* areaPaths.list(repoConfig);
    });
  },
});

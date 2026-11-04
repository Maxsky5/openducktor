import { linkedGitlabAccountId } from "@openducktor/core";
import { Effect } from "effect";
import type { BrowserService } from "../../application/browser/browser-service-types";
import type { WorkspaceStoragePort } from "../../application/workspaces/workspace-lifecycle-service";
import { HostOperationError } from "../../effect/host-errors";
import type { AzureDevOpsConnectionPort } from "../../ports/azure-devops-connection-port";
import type { GitlabConnectionPort } from "../../ports/gitlab-connection-port";

/** The workspace data that workspace removal deletes beside its registration. */
export const createNodeWorkspaceStorageRemoval = ({
  taskAssets,
  azureDevOpsConnection,
  gitlabConnection,
  browserService,
}: {
  taskAssets: Pick<WorkspaceStoragePort, "removeWorkspaceTaskAssets">;
  azureDevOpsConnection: AzureDevOpsConnectionPort | undefined;
  gitlabConnection: Pick<GitlabConnectionPort, "release">;
  browserService: Pick<BrowserService, "removeWorkspace">;
}): WorkspaceStoragePort => ({
  removeWorkspaceTaskAssets: taskAssets.removeWorkspaceTaskAssets,
  removeWorkspaceCredentials: (repoConfig) => {
    if (!azureDevOpsConnection) {
      const provider = repoConfig.git.provider;
      if (provider?.id !== "azure_devops") return Effect.void;
      return Effect.fail(
        new HostOperationError({
          operation: "workspace.removeWorkspace.credentials",
          message:
            "Azure DevOps credential cleanup is unavailable. Retry workspace removal after restarting the host.",
        }),
      );
    }
    return azureDevOpsConnection.removeWorkspaceCredentials(repoConfig).pipe(
      Effect.mapError(
        (cause) =>
          new HostOperationError({
            operation: "workspace.removeWorkspace.credentials",
            message: `Failed to remove Azure DevOps credentials: ${cause.message}. The workspace remains registered. Retry removal to continue.`,
            cause,
          }),
      ),
    );
  },
  // The workspace link blocks the account delete, so this runs after the registration is gone.
  releaseWorkspaceAccounts: (repoConfig) => {
    const accountId = linkedGitlabAccountId(repoConfig.git.provider);
    return accountId ? gitlabConnection.release([accountId]) : Effect.void;
  },
  removeWorkspaceBrowserData: (workspaceId) =>
    browserService.removeWorkspace(workspaceId).pipe(
      Effect.mapError(
        (cause) =>
          new HostOperationError({
            operation: "workspace.removeWorkspace.browser",
            message: `Failed to remove the browser data of the workspace: ${cause.message} Retry removal to continue.`,
            cause,
          }),
      ),
    ),
});

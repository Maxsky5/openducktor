import { Effect } from "effect";
import type { BrowserService } from "../../application/browser/browser-service-types";
import type { WorkspaceStoragePort } from "../../application/workspaces/workspace-lifecycle-service";
import { HostOperationError } from "../../effect/host-errors";
import type { AzureDevOpsConnectionPort } from "../../ports/azure-devops-connection-port";

/** The workspace data that workspace removal deletes beside its registration. */
export const createNodeWorkspaceStorageRemoval = ({
  taskAssets,
  azureDevOpsConnection,
  browserService,
}: {
  taskAssets: Pick<WorkspaceStoragePort, "removeWorkspaceTaskAssets" | "removeWorkspaceTaskStore">;
  azureDevOpsConnection: AzureDevOpsConnectionPort | undefined;
  browserService: Pick<BrowserService, "removeWorkspace">;
}): WorkspaceStoragePort => ({
  removeWorkspaceTaskAssets: taskAssets.removeWorkspaceTaskAssets,
  removeWorkspaceTaskStore: taskAssets.removeWorkspaceTaskStore,
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

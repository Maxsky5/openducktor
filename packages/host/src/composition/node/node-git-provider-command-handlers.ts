import { createAzureDevOpsConnectionService } from "../../application/git/azure-devops-connection-service";
import { createAzureAreaPathsService } from "../../application/git/azure-area-paths-service";
import { createGitProviderService } from "../../application/git/git-provider-service";
import type { GitProviderResolver } from "../../application/git/git-provider-resolver";
import { createIssueImportService } from "../../application/git/issue-import-service";
import type { WorkspaceSettingsService } from "../../application/workspaces/workspace-settings-model";
import { createAzureDevOpsConnectionCommandHandlers } from "../../interface/commands/azure-devops-connection-command-handlers";
import { createAzureAreaPathsCommandHandlers } from "../../interface/commands/azure-area-paths-command-handlers";
import { createGitProviderCommandHandlers } from "../../interface/commands/git-provider-command-handlers";
import { createIssueImportCommandHandlers } from "../../interface/commands/issue-import-command-handlers";
import type { AzureDevOpsConnectionPort } from "../../ports/azure-devops-connection-port";
import type { AzureAreaPathsPort } from "../../ports/azure-area-paths-port";
import type { IssueImportStorePort } from "../../ports/issue-import-store-port";

type NodeGitProviderCommandHandlers = ReturnType<typeof createGitProviderCommandHandlers> &
  ReturnType<typeof createIssueImportCommandHandlers> &
  ReturnType<typeof createAzureAreaPathsCommandHandlers> &
  ReturnType<typeof createAzureDevOpsConnectionCommandHandlers>;

export const createNodeGitProviderCommandHandlers = ({
  resolver,
  issueImportStore,
  workspaceSettingsService,
  azureDevOpsConnection,
  azureAreaPaths,
}: {
  resolver: GitProviderResolver;
  issueImportStore: IssueImportStorePort;
  workspaceSettingsService: WorkspaceSettingsService;
  azureDevOpsConnection: AzureDevOpsConnectionPort | undefined;
  azureAreaPaths: AzureAreaPathsPort;
}): NodeGitProviderCommandHandlers => ({
  ...createGitProviderCommandHandlers({
    service: createGitProviderService({ resolver, workspaceSettingsService }),
  }),
  ...createIssueImportCommandHandlers(
    createIssueImportService({ resolver, store: issueImportStore, workspaceSettingsService }),
  ),
  ...createAzureAreaPathsCommandHandlers(
    createAzureAreaPathsService({ resolver, areaPaths: azureAreaPaths, workspaceSettingsService }),
  ),
  ...createAzureDevOpsConnectionCommandHandlers({
    service: createAzureDevOpsConnectionService({
      connection: azureDevOpsConnection,
      workspaceSettingsService,
    }),
  }),
});

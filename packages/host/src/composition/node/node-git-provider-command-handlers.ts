import { createPullRequestReviewService } from "../../application/pull-requests/pull-request-review-service";
import { createPullRequestReviewCommandHandlers } from "../../interface/commands/pull-request-review-command-handlers";
import type { TaskReader } from "../../ports/task-repository-ports";
import type { TaskWorkflowResolver, WorkspaceWorkflowPort } from "../../ports/task-workflow-port";
import { createAzureDevOpsConnectionService } from "../../application/git/azure-devops-connection-service";
import { createAzureAreaPathsService } from "../../application/git/azure-area-paths-service";
import { createGitProviderService } from "../../application/git/git-provider-service";
import type { GitProviderResolver } from "../../application/git/git-provider-resolver";
import { createIssueImportService } from "../../application/git/issue-import-service";
import type { TaskSyncService } from "../../application/tasks/sync/task-sync-service";
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
  ReturnType<typeof createAzureDevOpsConnectionCommandHandlers> &
  ReturnType<typeof createPullRequestReviewCommandHandlers>;

export const createNodeGitProviderCommandHandlers = ({
  resolver,
  issueImportStore,
  taskReader,
  workflows: { taskWorkflows, workspaceWorkflows },
  taskSyncService,
  workspaceSettingsService,
  azureDevOpsConnection,
  azureAreaPaths,
}: {
  resolver: GitProviderResolver;
  issueImportStore: IssueImportStorePort;
  taskReader: Pick<TaskReader, "getTask">;
  /** The workflow ports, such as the shared ports of the host. */
  workflows: {
    taskWorkflows: TaskWorkflowResolver;
    workspaceWorkflows: Pick<WorkspaceWorkflowPort, "newTaskWorkflow">;
  };
  taskSyncService: Pick<TaskSyncService, "publishExternalTaskCreated" | "runStatusMutation">;
  workspaceSettingsService: WorkspaceSettingsService;
  azureDevOpsConnection: AzureDevOpsConnectionPort | undefined;
  azureAreaPaths: AzureAreaPathsPort;
}): NodeGitProviderCommandHandlers => ({
  ...createGitProviderCommandHandlers({
    service: createGitProviderService({ resolver, workspaceSettingsService }),
  }),
  ...createPullRequestReviewCommandHandlers(
    createPullRequestReviewService({ resolver, taskReader, workspaceSettingsService }),
  ),
  ...createIssueImportCommandHandlers(
    createIssueImportService({
      resolver,
      store: issueImportStore,
      taskWorkflows,
      workspaceWorkflows,
      workspaceSettingsService,
      publishTaskCreated: taskSyncService.publishExternalTaskCreated,
      runStatusMutation: taskSyncService.runStatusMutation,
    }),
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

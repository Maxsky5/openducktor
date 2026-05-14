import type {
  AgentSessionRecord,
  BuildSessionBootstrap,
  PullRequest,
  TaskApprovalContextLoadResult,
  TaskCard,
  TaskDirectMergeResult,
  TaskMetadataDocument,
  TaskMetadataPayload,
  TaskPullRequestDetectResult,
} from "@openducktor/contracts";
import type { GitPort } from "../../ports/git-port";
import type { RuntimeRegistryPort } from "../../ports/runtime-registry-port";
import type { SettingsConfigPort } from "../../ports/settings-config-port";
import type { SystemCommandPort } from "../../ports/system-command-port";
import type { TaskActivityGuardPort } from "../../ports/task-activity-guard-port";
import type { TaskStorePort } from "../../ports/task-repository-ports";
import type { WorktreeFilePort } from "../../ports/worktree-file-port";
import type { DevServerService } from "../dev-servers/dev-server-service";
import type { RuntimeDefinitionsService } from "../runtimes/runtime-definitions-service";
import type { WorkspaceSettingsService } from "../workspaces/workspace-settings-service";
import type {
  AgentSessionsListBulkInput,
  AgentSessionUpsertInput,
  BuildBlockedInput,
  BuildCompletedInput,
  BuildStartInput,
  CreateTaskUseCaseInput,
  DeleteTaskInput,
  DirectMergeInput,
  ListTasksInput,
  MarkdownDocumentInput,
  OptionalNoteInput,
  PullRequestLinkMergedInput,
  PullRequestNumberInput,
  PullRequestUpsertInput,
  RepoPathInput,
  SetPlanInput,
  TaskIdInput,
  TransitionTaskInput,
  UpdateTaskInput,
} from "./task-inputs";
import { createTaskCompleteDirectMergeUseCase } from "./use-cases/complete-direct-merge";
import { createTaskDeleteUseCase } from "./use-cases/delete-task";
import { createTaskPullRequestDetectionUseCase } from "./use-cases/detect-pull-request";
import { createTaskDirectMergeUseCase } from "./use-cases/direct-merge";
import { createTaskLinkMergedPullRequestUseCase } from "./use-cases/link-merged-pull-request";
import { createTaskApprovalContextUseCase } from "./use-cases/load-approval-context";
import { createTaskDocumentUseCases } from "./use-cases/manage-documents";
import { createTaskPullRequestManagementUseCases } from "./use-cases/manage-pull-requests";
import { createTaskCrudUseCases } from "./use-cases/manage-tasks";
import { createTaskQueryUseCases } from "./use-cases/query-tasks";
import { createTaskImplementationResetUseCase } from "./use-cases/reset-implementation";
import { createTaskFullResetUseCase } from "./use-cases/reset-task";
import { createTaskReviewUseCases } from "./use-cases/review-task";
import { createTaskBuildStartUseCase } from "./use-cases/start-build";
import { createTaskSyncDeferUseCases } from "./use-cases/sync-deferred-tasks";
import { createTaskBuildStateUseCases } from "./use-cases/update-build-state";
import type { TaskWorktreeService } from "./worktrees/task-worktree-service";

export type TaskService = {
  listTasks(input: ListTasksInput): Promise<TaskCard[]>;
  getTaskMetadata(input: TaskIdInput): Promise<TaskMetadataPayload>;
  agentSessionsList(input: TaskIdInput): Promise<AgentSessionRecord[]>;
  agentSessionsListBulk(
    input: AgentSessionsListBulkInput,
  ): Promise<Record<string, AgentSessionRecord[]>>;
  agentSessionUpsert(input: AgentSessionUpsertInput): Promise<boolean>;
  getApprovalContext(input: TaskIdInput): Promise<TaskApprovalContextLoadResult>;
  detectPullRequest(input: TaskIdInput): Promise<TaskPullRequestDetectResult>;
  linkPullRequest(input: PullRequestNumberInput): Promise<PullRequest>;
  upsertPullRequest(input: PullRequestUpsertInput): Promise<PullRequest>;
  unlinkPullRequest(input: TaskIdInput): Promise<boolean>;
  linkMergedPullRequest(input: PullRequestLinkMergedInput): Promise<TaskCard>;
  directMerge(input: DirectMergeInput): Promise<TaskDirectMergeResult>;
  completeDirectMerge(input: TaskIdInput): Promise<TaskCard>;
  createTask(input: CreateTaskUseCaseInput): Promise<TaskCard>;
  deleteTask(input: DeleteTaskInput): Promise<{ ok: boolean }>;
  resetImplementation(input: TaskIdInput): Promise<TaskCard>;
  resetTask(input: TaskIdInput): Promise<TaskCard>;
  updateTask(input: UpdateTaskInput): Promise<TaskCard>;
  transitionTask(input: TransitionTaskInput): Promise<TaskCard>;
  specGet(input: TaskIdInput): Promise<TaskMetadataDocument>;
  setSpec(input: MarkdownDocumentInput): Promise<TaskMetadataDocument>;
  saveSpecDocument(input: MarkdownDocumentInput): Promise<TaskMetadataDocument>;
  planGet(input: TaskIdInput): Promise<TaskMetadataDocument>;
  setPlan(input: SetPlanInput): Promise<TaskMetadataDocument>;
  savePlanDocument(input: MarkdownDocumentInput): Promise<TaskMetadataDocument>;
  qaGetReport(input: TaskIdInput): Promise<TaskMetadataDocument>;
  buildBlocked(input: BuildBlockedInput): Promise<TaskCard>;
  buildStart(input: BuildStartInput): Promise<BuildSessionBootstrap>;
  buildResumed(input: TaskIdInput): Promise<TaskCard>;
  buildCompleted(input: BuildCompletedInput): Promise<TaskCard>;
  qaApproved(input: MarkdownDocumentInput): Promise<TaskCard>;
  qaRejected(input: MarkdownDocumentInput): Promise<TaskCard>;
  humanRequestChanges(input: OptionalNoteInput): Promise<TaskCard>;
  humanApprove(input: TaskIdInput): Promise<TaskCard>;
  repoPullRequestSync(input: RepoPathInput): Promise<{ ok: boolean }>;
  repoPullRequestSyncDetailed(input: RepoPathInput): Promise<RepoPullRequestSyncResult>;
  deferTask(input: TaskIdInput): Promise<TaskCard>;
  resumeDeferredTask(input: TaskIdInput): Promise<TaskCard>;
};

export type RepoPullRequestSyncResult = {
  ran: boolean;
  changedTaskIds: string[];
};

export type CreateTaskServiceInput = {
  devServerService?: DevServerService;
  gitPort?: GitPort;
  taskStore: TaskStorePort;
  taskActivityGuard?: TaskActivityGuardPort;
  settingsConfig?: SettingsConfigPort;
  systemCommands?: SystemCommandPort;
  taskWorktreeService?: TaskWorktreeService;
  workspaceSettingsService?: WorkspaceSettingsService;
  runtimeDefinitionsService?: RuntimeDefinitionsService;
  runtimeRegistry?: RuntimeRegistryPort;
  worktreeFiles?: WorktreeFilePort;
};

export const createTaskService = (input: CreateTaskServiceInput): TaskService => ({
  ...createTaskQueryUseCases(input),
  ...createTaskApprovalContextUseCase(input),
  ...createTaskPullRequestDetectionUseCase(input),
  ...createTaskPullRequestManagementUseCases(input),
  ...createTaskLinkMergedPullRequestUseCase(input),
  ...createTaskDirectMergeUseCase(input),
  ...createTaskCompleteDirectMergeUseCase(input),
  ...createTaskCrudUseCases(input),
  ...createTaskDeleteUseCase(input),
  ...createTaskImplementationResetUseCase(input),
  ...createTaskFullResetUseCase(input),
  ...createTaskDocumentUseCases(input),
  ...createTaskBuildStartUseCase(input),
  ...createTaskBuildStateUseCases(input),
  ...createTaskReviewUseCases(input),
  ...createTaskSyncDeferUseCases(input),
});

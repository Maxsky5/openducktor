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
import { Effect } from "effect";
import { TaskPolicyError } from "../../domain/task/task-policy-error";
import type {
  HostDependencyError,
  HostInvariantError,
  HostOperationError,
  HostResourceError,
  HostValidationError,
} from "../../effect/host-errors";
import {
  errorMessage,
  HostOperationError as HostOperationErrorValue,
  isHostError,
} from "../../effect/host-errors";
import type { GitPort, GitPortError } from "../../ports/git-port";
import type { RuntimeRegistryError, RuntimeRegistryPort } from "../../ports/runtime-registry-port";
import type { SettingsConfigError, SettingsConfigPort } from "../../ports/settings-config-port";
import type { SystemCommandPort } from "../../ports/system-command-port";
import type { TaskActivityGuardPort } from "../../ports/task-activity-guard-port";
import type { TaskStoreError, TaskStorePort } from "../../ports/task-repository-ports";
import type { ToolDiscoveryError, ToolDiscoveryPort } from "../../ports/tool-discovery-port";
import type { WorktreeFileError, WorktreeFilePort } from "../../ports/worktree-file-port";
import type { DevServerService, DevServerServiceError } from "../dev-servers/dev-server-service";
import type { RuntimeDefinitionsService } from "../runtimes/runtime-definitions-service";
import type {
  WorkspaceSettingsError,
  WorkspaceSettingsService,
} from "../workspaces/workspace-settings-service";
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

export type TaskServiceError =
  | DevServerServiceError
  | GitPortError
  | HostDependencyError
  | HostInvariantError
  | HostOperationError
  | HostResourceError
  | HostValidationError
  | RuntimeRegistryError
  | SettingsConfigError
  | TaskPolicyError
  | TaskStoreError
  | ToolDiscoveryError
  | WorktreeFileError
  | WorkspaceSettingsError;

export type TaskService = {
  listTasks(input: ListTasksInput): Effect.Effect<TaskCard[], TaskServiceError>;
  getTaskMetadata(input: TaskIdInput): Effect.Effect<TaskMetadataPayload, TaskServiceError>;
  agentSessionsList(input: TaskIdInput): Effect.Effect<AgentSessionRecord[], TaskServiceError>;
  agentSessionsListBulk(
    input: AgentSessionsListBulkInput,
  ): Effect.Effect<Record<string, AgentSessionRecord[]>, TaskServiceError>;
  agentSessionUpsert(input: AgentSessionUpsertInput): Effect.Effect<boolean, TaskServiceError>;
  getApprovalContext(
    input: TaskIdInput,
  ): Effect.Effect<TaskApprovalContextLoadResult, TaskServiceError>;
  detectPullRequest(
    input: TaskIdInput,
  ): Effect.Effect<TaskPullRequestDetectResult, TaskServiceError>;
  linkPullRequest(input: PullRequestNumberInput): Effect.Effect<PullRequest, TaskServiceError>;
  upsertPullRequest(input: PullRequestUpsertInput): Effect.Effect<PullRequest, TaskServiceError>;
  unlinkPullRequest(input: TaskIdInput): Effect.Effect<boolean, TaskServiceError>;
  linkMergedPullRequest(
    input: PullRequestLinkMergedInput,
  ): Effect.Effect<TaskCard, TaskServiceError>;
  directMerge(input: DirectMergeInput): Effect.Effect<TaskDirectMergeResult, TaskServiceError>;
  completeDirectMerge(input: TaskIdInput): Effect.Effect<TaskCard, TaskServiceError>;
  createTask(input: CreateTaskUseCaseInput): Effect.Effect<TaskCard, TaskServiceError>;
  deleteTask(input: DeleteTaskInput): Effect.Effect<
    {
      ok: boolean;
    },
    TaskServiceError
  >;
  resetImplementation(input: TaskIdInput): Effect.Effect<TaskCard, TaskServiceError>;
  resetTask(input: TaskIdInput): Effect.Effect<TaskCard, TaskServiceError>;
  updateTask(input: UpdateTaskInput): Effect.Effect<TaskCard, TaskServiceError>;
  transitionTask(input: TransitionTaskInput): Effect.Effect<TaskCard, TaskServiceError>;
  specGet(input: TaskIdInput): Effect.Effect<TaskMetadataDocument, TaskServiceError>;
  setSpec(input: MarkdownDocumentInput): Effect.Effect<TaskMetadataDocument, TaskServiceError>;
  saveSpecDocument(
    input: MarkdownDocumentInput,
  ): Effect.Effect<TaskMetadataDocument, TaskServiceError>;
  planGet(input: TaskIdInput): Effect.Effect<TaskMetadataDocument, TaskServiceError>;
  setPlan(input: SetPlanInput): Effect.Effect<TaskMetadataDocument, TaskServiceError>;
  savePlanDocument(
    input: MarkdownDocumentInput,
  ): Effect.Effect<TaskMetadataDocument, TaskServiceError>;
  qaGetReport(input: TaskIdInput): Effect.Effect<TaskMetadataDocument, TaskServiceError>;
  buildBlocked(input: BuildBlockedInput): Effect.Effect<TaskCard, TaskServiceError>;
  buildStart(input: BuildStartInput): Effect.Effect<BuildSessionBootstrap, TaskServiceError>;
  buildResumed(input: TaskIdInput): Effect.Effect<TaskCard, TaskServiceError>;
  buildCompleted(input: BuildCompletedInput): Effect.Effect<TaskCard, TaskServiceError>;
  qaApproved(input: MarkdownDocumentInput): Effect.Effect<TaskCard, TaskServiceError>;
  qaRejected(input: MarkdownDocumentInput): Effect.Effect<TaskCard, TaskServiceError>;
  humanRequestChanges(input: OptionalNoteInput): Effect.Effect<TaskCard, TaskServiceError>;
  humanApprove(input: TaskIdInput): Effect.Effect<TaskCard, TaskServiceError>;
  repoPullRequestSync(input: RepoPathInput): Effect.Effect<
    {
      ok: boolean;
    },
    TaskServiceError
  >;
  repoPullRequestSyncDetailed(
    input: RepoPathInput,
  ): Effect.Effect<RepoPullRequestSyncResult, TaskServiceError>;
  deferTask(input: TaskIdInput): Effect.Effect<TaskCard, TaskServiceError>;
  resumeDeferredTask(input: TaskIdInput): Effect.Effect<TaskCard, TaskServiceError>;
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
  toolDiscovery?: ToolDiscoveryPort;
  taskWorktreeService?: TaskWorktreeService;
  workspaceSettingsService?: WorkspaceSettingsService;
  runtimeDefinitionsService?: RuntimeDefinitionsService;
  runtimeRegistry?: RuntimeRegistryPort;
  worktreeFiles?: WorktreeFilePort;
};
const isTaskServiceError = (cause: unknown): cause is TaskServiceError =>
  cause instanceof TaskPolicyError || isHostError(cause);

const toTaskServiceError = (cause: unknown): TaskServiceError => {
  if (isTaskServiceError(cause)) {
    return cause;
  }
  return new HostOperationErrorValue({
    operation: "task.service",
    message: errorMessage(cause),
    cause,
  });
};

const mapTaskServiceErrors = <A, E>(
  effect: Effect.Effect<A, E>,
): Effect.Effect<A, TaskServiceError> => effect.pipe(Effect.mapError(toTaskServiceError));

export const createTaskService = (input: CreateTaskServiceInput): TaskService => {
  const service = {
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
  };
  return {
    agentSessionsList: (input) => mapTaskServiceErrors(service.agentSessionsList(input)),
    agentSessionsListBulk: (input) => mapTaskServiceErrors(service.agentSessionsListBulk(input)),
    agentSessionUpsert: (input) => mapTaskServiceErrors(service.agentSessionUpsert(input)),
    buildBlocked: (input) => mapTaskServiceErrors(service.buildBlocked(input)),
    buildCompleted: (input) => mapTaskServiceErrors(service.buildCompleted(input)),
    buildResumed: (input) => mapTaskServiceErrors(service.buildResumed(input)),
    buildStart: (input) => mapTaskServiceErrors(service.buildStart(input)),
    completeDirectMerge: (input) => mapTaskServiceErrors(service.completeDirectMerge(input)),
    createTask: (input) => mapTaskServiceErrors(service.createTask(input)),
    deferTask: (input) => mapTaskServiceErrors(service.deferTask(input)),
    deleteTask: (input) => mapTaskServiceErrors(service.deleteTask(input)),
    detectPullRequest: (input) => mapTaskServiceErrors(service.detectPullRequest(input)),
    directMerge: (input) => mapTaskServiceErrors(service.directMerge(input)),
    getApprovalContext: (input) => mapTaskServiceErrors(service.getApprovalContext(input)),
    getTaskMetadata: (input) => mapTaskServiceErrors(service.getTaskMetadata(input)),
    humanApprove: (input) => mapTaskServiceErrors(service.humanApprove(input)),
    humanRequestChanges: (input) => mapTaskServiceErrors(service.humanRequestChanges(input)),
    linkMergedPullRequest: (input) => mapTaskServiceErrors(service.linkMergedPullRequest(input)),
    linkPullRequest: (input) => mapTaskServiceErrors(service.linkPullRequest(input)),
    listTasks: (input) => mapTaskServiceErrors(service.listTasks(input)),
    planGet: (input) => mapTaskServiceErrors(service.planGet(input)),
    qaApproved: (input) => mapTaskServiceErrors(service.qaApproved(input)),
    qaGetReport: (input) => mapTaskServiceErrors(service.qaGetReport(input)),
    qaRejected: (input) => mapTaskServiceErrors(service.qaRejected(input)),
    repoPullRequestSync: (input) => mapTaskServiceErrors(service.repoPullRequestSync(input)),
    repoPullRequestSyncDetailed: (input) =>
      mapTaskServiceErrors(service.repoPullRequestSyncDetailed(input)),
    resetImplementation: (input) => mapTaskServiceErrors(service.resetImplementation(input)),
    resetTask: (input) => mapTaskServiceErrors(service.resetTask(input)),
    resumeDeferredTask: (input) => mapTaskServiceErrors(service.resumeDeferredTask(input)),
    savePlanDocument: (input) => mapTaskServiceErrors(service.savePlanDocument(input)),
    saveSpecDocument: (input) => mapTaskServiceErrors(service.saveSpecDocument(input)),
    setPlan: (input) => mapTaskServiceErrors(service.setPlan(input)),
    setSpec: (input) => mapTaskServiceErrors(service.setSpec(input)),
    specGet: (input) => mapTaskServiceErrors(service.specGet(input)),
    transitionTask: (input) => mapTaskServiceErrors(service.transitionTask(input)),
    unlinkPullRequest: (input) => mapTaskServiceErrors(service.unlinkPullRequest(input)),
    updateTask: (input) => mapTaskServiceErrors(service.updateTask(input)),
    upsertPullRequest: (input) => mapTaskServiceErrors(service.upsertPullRequest(input)),
  };
};

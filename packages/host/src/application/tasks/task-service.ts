import type { TaskSearchInput } from "../../ports/task-repository-ports";
import {
  type AgentSessionRecord,
  type ArtifactReadResult,
  type ArtifactCreateRequest,
  type ArtifactDeleteRequest,
  type ArtifactDeleteResult,
  type ArtifactReadRequest,
  type ArtifactRenameRequest,
  type ArtifactReplaceRequest,
  type ArtifactSaveResult,
  type ArtifactScope,
  type PullRequest,
  type RepoPullRequestSyncRequest,
  type RepoPullRequestSyncResponse,
  type RepoPullRequestSyncSkipReason,
  type TaskAgentSessions,
  type TaskApprovalContextLoadResult,
  type TaskArtifactCollection,
  type TaskCard,
  type TaskChangeSet,
  type TaskDirectMergeResult,
  type TaskMetadataArtifact,
  type TaskMetadataPayload,
  type TaskPullRequestDetectResult,
  type TaskStopImpact,
  type TaskStopImpactRequest,
  type TaskWorktreeCleanupImpact,
  type TaskWorktreeOwners,
  type TaskWorktreeOwnersRequest,
} from "@openducktor/contracts";
import { Effect } from "effect";
import { TaskPolicyError } from "../../domain/task/task-policy-error";
import {
  type HostCommandErrorAggregate,
  type HostDependencyErrorAggregate,
  type HostInvariantErrorAggregate,
  type HostOperationErrorAggregate,
  type HostResourceErrorAggregate,
  type HostValidationErrorAggregate,
} from "../../effect/host-errors";
import { TaskAssetError } from "../../effect/task-asset-error";
import {
  GitProviderCapabilityError,
  GitProviderRepositoryError,
  GitProviderResolutionError,
} from "../../ports/git-provider-errors";
import type { GitPortError } from "../../ports/git-port";
import type { RuntimeRegistryError } from "../../ports/runtime-registry-port";
import type { SettingsConfigError } from "../../ports/settings-config-port";
import type { TaskReference, TaskStoreError } from "../../ports/task-repository-ports";
import type { ToolDiscoveryError } from "../../ports/tool-discovery-port";
import type { WorktreeFileError } from "../../ports/worktree-file-port";
import type { TerminalServiceError } from "../terminals/terminal-service";
import type { WorkspaceSettingsError } from "../workspaces/workspace-settings-service";
import {
  mapTaskServiceErrors,
  mapTaskCreationProgressErrors,
  mapTaskMutationProgressErrors,
} from "./task-error-mapping";
import { createTaskStopImpactUseCase } from "./use-cases/get-task-stop-impact";
import { createTaskWorktreeOwnersUseCase } from "./use-cases/get-task-worktree-owners";
import type { CreateTaskServiceInput, TaskServiceUseCaseInput } from "./task-dependencies";
import { createTaskWorktreeUseCases } from "./use-cases/manage-task-worktree";
import type {
  AgentSessionDeleteInput,
  AgentSessionUpdateModelInput,
  AgentSessionUpsertInput,
  CloseTaskInput,
  CreateTaskUseCaseInput,
  DeleteTaskInput,
  DirectMergeInput,
  ListAgentSessionsForTasksInput,
  ListTasksInput,
  WorkflowArtifactInput,
  WorkflowArtifactSaveInput,
  OptionalNoteInput,
  PullRequestLinkMergedInput,
  PullRequestNumberInput,
  PullRequestUpsertInput,
  RepoPathInput,
  TaskIdInput,
  ApplyTaskEventInput,
  UpdateTaskInput,
} from "./task-inputs";
import {
  TaskMutationProgressFailure,
  TaskCreationProgressFailure,
} from "./task-mutation-progress-failure";
import { withoutTaskMutationProgress } from "./task-mutation-result";
import { createTaskCloseUseCase } from "./use-cases/close-task";
import { createTaskCompleteDirectMergeUseCase } from "./use-cases/complete-direct-merge";
import { createTaskCompletionState } from "./task-completion-state";
import { createTaskDeleteUseCase } from "./use-cases/delete-task";
import { createTaskPullRequestDetectionUseCase } from "./use-cases/detect-pull-request";
import { createTaskDirectMergeUseCase } from "./use-cases/direct-merge";
import { createTaskLinkMergedPullRequestUseCase } from "./use-cases/link-merged-pull-request";
import { createTaskApprovalContextUseCase } from "./use-cases/load-approval-context";
import { createArtifactUseCases } from "./use-cases/manage-artifacts";
import {
  createWorkflowArtifactUseCases,
  type WorkflowArtifactSaveResult,
} from "./use-cases/manage-workflow-artifacts";
import { createTaskPullRequestManagementUseCases } from "./use-cases/manage-pull-requests";
import { createTaskCrudUseCases } from "./use-cases/manage-tasks";
import { createTaskAgentEventUseCase } from "./use-cases/apply-agent-event";
import { createTaskQueryUseCases } from "./use-cases/query-tasks";
import { createTaskImplementationResetUseCase } from "./use-cases/reset-implementation";
import { createTaskFullResetUseCase } from "./use-cases/reset-task";
import { createTaskReviewUseCases } from "./use-cases/review-task";
import { createTaskPullRequestSyncUseCases } from "./use-cases/sync-pull-requests";
import { createTaskBuildStateUseCases } from "./use-cases/update-build-state";
import { createTaskSessionLifecycleCoordinator } from "./worktrees/task-session-lifecycle-coordinator";

export type TaskServiceError =
  | GitProviderRepositoryError
  | GitProviderCapabilityError
  | GitProviderResolutionError
  | HostCommandErrorAggregate
  | GitPortError
  | HostDependencyErrorAggregate
  | HostInvariantErrorAggregate
  | HostOperationErrorAggregate
  | HostResourceErrorAggregate
  | HostValidationErrorAggregate
  | RuntimeRegistryError
  | SettingsConfigError
  | TaskAssetError
  | TaskPolicyError
  | TaskStoreError
  | ToolDiscoveryError
  | TerminalServiceError
  | WorktreeFileError
  | WorkspaceSettingsError;

export type TaskService = {
  listTaskArtifacts(input: ArtifactScope): Effect.Effect<TaskArtifactCollection, TaskServiceError>;
  readTaskArtifact(input: ArtifactReadRequest): Effect.Effect<ArtifactReadResult, TaskServiceError>;
  createTaskArtifact(
    input: ArtifactCreateRequest,
  ): Effect.Effect<Omit<ArtifactSaveResult, "cursor">, TaskServiceError>;
  renameTaskArtifact(
    input: ArtifactRenameRequest,
  ): Effect.Effect<Omit<ArtifactSaveResult, "cursor">, TaskServiceError>;
  replaceTaskArtifact(
    input: ArtifactReplaceRequest,
  ): Effect.Effect<Omit<ArtifactSaveResult, "cursor">, TaskServiceError>;
  deleteTaskArtifact(
    input: ArtifactDeleteRequest,
  ): Effect.Effect<Omit<ArtifactDeleteResult, "cursor">, TaskServiceError>;
  findTask(input: TaskIdInput): Effect.Effect<TaskCard | null, TaskServiceError>;
  listTaskReferences(input: RepoPathInput): Effect.Effect<TaskReference[], TaskServiceError>;
  searchTasks(
    input: TaskSearchInput,
  ): Effect.Effect<{ tasks: TaskCard[]; totalCount: number }, TaskServiceError>;
  listTasks(input: ListTasksInput): Effect.Effect<TaskCard[], TaskServiceError>;
  listKanbanTasks(input: RepoPathInput): Effect.Effect<TaskCard[], TaskServiceError>;
  /** The IDs of all tasks of a repository, also closed tasks that the Kanban board hides. */
  listTaskIds(input: RepoPathInput): Effect.Effect<string[], TaskServiceError>;
  getTaskStopImpact(input: TaskStopImpactRequest): Effect.Effect<TaskStopImpact, TaskServiceError>;
  getTaskWorktreeCleanupImpact(
    input: TaskIdInput,
  ): Effect.Effect<TaskWorktreeCleanupImpact, TaskServiceError>;
  /** The others that need a worktree that a task action removes, for its confirmation. */
  getTaskWorktreeOwners(
    input: TaskWorktreeOwnersRequest,
  ): Effect.Effect<TaskWorktreeOwners, TaskServiceError>;
  /** Removes the worktree and local branches of a closed task. */
  removeTaskWorktree(input: TaskIdInput): Effect.Effect<void, TaskServiceError>;
  getTaskMetadata(input: TaskIdInput): Effect.Effect<TaskMetadataPayload, TaskServiceError>;
  agentSessionsList(input: TaskIdInput): Effect.Effect<AgentSessionRecord[], TaskServiceError>;
  agentSessionsListForTasks(
    input: ListAgentSessionsForTasksInput,
  ): Effect.Effect<TaskAgentSessions[], TaskServiceError>;
  agentSessionUpsert(input: AgentSessionUpsertInput): Effect.Effect<boolean, TaskServiceError>;
  agentSessionUpdateModel(
    input: AgentSessionUpdateModelInput,
  ): Effect.Effect<boolean, TaskServiceError>;
  agentSessionDelete(input: AgentSessionDeleteInput): Effect.Effect<boolean, TaskServiceError>;
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
  completeDirectMerge(
    input: import("@openducktor/contracts").TaskDirectMergeCompleteIntent,
  ): Effect.Effect<TaskCard, TaskServiceError>;
  createTask(input: CreateTaskUseCaseInput): Effect.Effect<TaskCard, TaskServiceError>;
  deleteTask(input: DeleteTaskInput): Effect.Effect<TaskDeleteResult, TaskServiceError>;
  closeTask(input: CloseTaskInput): Effect.Effect<TaskCard, TaskServiceError>;
  resetImplementation(input: TaskIdInput): Effect.Effect<TaskCard, TaskServiceError>;
  resetTask(input: TaskIdInput): Effect.Effect<TaskCard, TaskServiceError>;
  updateTask(input: UpdateTaskInput): Effect.Effect<TaskCard, TaskServiceError>;
  applyTaskEvent(input: ApplyTaskEventInput): Effect.Effect<TaskCard, TaskServiceError>;
  /** Commits the start event of a role step. A session start sends it after session creation. */
  applyStartEvent(input: ApplyTaskEventInput): Effect.Effect<TaskCard, TaskServiceError>;
  /** Commits an agent event that has no host effect. */
  applyAgentEvent(input: ApplyTaskEventInput): Effect.Effect<TaskCard, TaskServiceError>;
  workflowArtifactGet(
    input: WorkflowArtifactInput,
  ): Effect.Effect<TaskMetadataArtifact, TaskServiceError>;
  workflowArtifactSave(
    input: WorkflowArtifactSaveInput,
  ): Effect.Effect<WorkflowArtifactSaveResult, TaskServiceError>;
  buildBlocked(input: TaskIdInput): Effect.Effect<TaskCard, TaskServiceError>;
  buildResumed(input: TaskIdInput): Effect.Effect<TaskCard, TaskServiceError>;
  buildCompleted(input: TaskIdInput): Effect.Effect<TaskCard, TaskServiceError>;
  humanRequestChanges(input: OptionalNoteInput): Effect.Effect<TaskCard, TaskServiceError>;
  repoPullRequestSync(
    input: RepoPullRequestSyncRequest,
  ): Effect.Effect<RepoPullRequestSyncResponse, TaskServiceError>;
  repoPullRequestSyncDetailed(
    input: RepoPathInput,
  ): Effect.Effect<RepoPullRequestSyncResult, RepoPullRequestSyncDetailedError>;
};
export type TaskDeleteResult = {
  ok: boolean;
  changes: TaskChangeSet;
};
export type TaskResetResult = {
  task: TaskCard;
  removedArtifactIds: string[];
};
export type TaskServiceWithMutationProgress = Omit<
  TaskService,
  | "buildCompleted"
  | "createTask"
  | "deleteTask"
  | "directMerge"
  | "completeDirectMerge"
  | "linkMergedPullRequest"
  | "resetImplementation"
  | "resetTask"
  | "workflowArtifactSave"
  | "updateTask"
> & {
  buildCompleted(
    input: TaskIdInput,
  ): Effect.Effect<TaskCard, TaskServiceError | TaskMutationProgressFailure>;
  createTask(
    input: CreateTaskUseCaseInput,
  ): Effect.Effect<TaskCard, TaskServiceError | TaskCreationProgressFailure>;
  deleteTask(
    input: DeleteTaskInput,
  ): Effect.Effect<TaskDeleteResult, TaskServiceError | TaskMutationProgressFailure>;
  directMerge(
    input: DirectMergeInput,
  ): Effect.Effect<TaskDirectMergeResult, TaskServiceError | TaskMutationProgressFailure>;
  completeDirectMerge(
    input: import("@openducktor/contracts").TaskDirectMergeCompleteIntent,
  ): Effect.Effect<TaskCard, TaskServiceError | TaskMutationProgressFailure>;
  linkMergedPullRequest(
    input: PullRequestLinkMergedInput,
  ): Effect.Effect<TaskCard, TaskServiceError | TaskMutationProgressFailure>;
  resetImplementation(
    input: TaskIdInput,
  ): Effect.Effect<TaskCard, TaskServiceError | TaskMutationProgressFailure>;
  resetTask(
    input: TaskIdInput,
  ): Effect.Effect<TaskResetResult, TaskServiceError | TaskMutationProgressFailure>;
  workflowArtifactSave(
    input: WorkflowArtifactSaveInput,
  ): Effect.Effect<WorkflowArtifactSaveResult, TaskServiceError | TaskMutationProgressFailure>;
  updateTask(
    input: UpdateTaskInput,
  ): Effect.Effect<TaskCard, TaskServiceError | TaskMutationProgressFailure>;
};
/** A merged task that the pull request sync could not close. */
export type AutoCloseFailure = { taskId: string; failure: TaskServiceError };
export type RepoPullRequestSyncResult =
  | { ran: true; changedTaskIds: string[]; autoCloseFailures: AutoCloseFailure[] }
  | { ran: false; changedTaskIds: []; reason: RepoPullRequestSyncSkipReason; message: string };
export type RepoPullRequestSyncDetailedError = TaskServiceError | TaskMutationProgressFailure;
export type {
  CreateTaskServiceInput,
  TaskServiceUseCaseInput,
  TaskTerminalCleanupPort,
} from "./task-dependencies";
export const createTaskServiceWithMutationProgress = (
  input: CreateTaskServiceInput,
): TaskServiceWithMutationProgress => createTaskServiceImplementation(input);

export const createTaskService = (input: CreateTaskServiceInput): TaskService =>
  withoutTaskMutationProgress(createTaskServiceWithMutationProgress(input));

const createTaskServiceImplementation = (
  input: CreateTaskServiceInput,
): TaskServiceWithMutationProgress => {
  const taskSessionLifecycleCoordinator =
    input.taskSessionLifecycleCoordinator ?? createTaskSessionLifecycleCoordinator();
  const useCaseInput: TaskServiceUseCaseInput = {
    ...input,
    taskSessionLifecycleCoordinator,
    completionState: createTaskCompletionState(input.publishCompletion),
  };
  const service = {
    ...createArtifactUseCases(useCaseInput),
    ...createTaskQueryUseCases(useCaseInput),
    ...createTaskStopImpactUseCase(useCaseInput),
    ...createTaskWorktreeOwnersUseCase(useCaseInput),
    ...createTaskWorktreeUseCases(useCaseInput),
    ...createTaskApprovalContextUseCase(useCaseInput),
    ...createTaskPullRequestDetectionUseCase(useCaseInput),
    ...createTaskPullRequestManagementUseCases(useCaseInput),
    ...createTaskLinkMergedPullRequestUseCase(useCaseInput),
    ...createTaskDirectMergeUseCase(useCaseInput),
    ...createTaskCompleteDirectMergeUseCase(useCaseInput),
    ...createTaskCrudUseCases(useCaseInput),
    ...createTaskAgentEventUseCase(useCaseInput),
    ...createTaskDeleteUseCase(useCaseInput),
    ...createTaskCloseUseCase(useCaseInput),
    ...createTaskImplementationResetUseCase(useCaseInput),
    ...createTaskFullResetUseCase(useCaseInput),
    ...createWorkflowArtifactUseCases(useCaseInput),
    ...createTaskBuildStateUseCases(useCaseInput),
    ...createTaskReviewUseCases(useCaseInput),
    ...createTaskPullRequestSyncUseCases(useCaseInput),
  };
  return {
    listTaskArtifacts: (input) => mapTaskServiceErrors(service.listTaskArtifacts(input)),
    readTaskArtifact: (input) => mapTaskServiceErrors(service.readTaskArtifact(input)),
    createTaskArtifact: (input) => mapTaskServiceErrors(service.createTaskArtifact(input)),
    renameTaskArtifact: (input) => mapTaskServiceErrors(service.renameTaskArtifact(input)),
    replaceTaskArtifact: (input) => mapTaskServiceErrors(service.replaceTaskArtifact(input)),
    deleteTaskArtifact: (input) => mapTaskServiceErrors(service.deleteTaskArtifact(input)),
    agentSessionDelete: (input) => mapTaskServiceErrors(service.agentSessionDelete(input)),
    agentSessionUpdateModel: (input) =>
      mapTaskServiceErrors(service.agentSessionUpdateModel(input)),
    agentSessionsList: (input) => mapTaskServiceErrors(service.agentSessionsList(input)),
    agentSessionsListForTasks: (input) =>
      mapTaskServiceErrors(service.agentSessionsListForTasks(input)),
    agentSessionUpsert: (input) => mapTaskServiceErrors(service.agentSessionUpsert(input)),
    buildBlocked: (input) => mapTaskServiceErrors(service.buildBlocked(input)),
    buildCompleted: (input) => mapTaskMutationProgressErrors(service.buildCompleted(input)),
    buildResumed: (input) => mapTaskServiceErrors(service.buildResumed(input)),
    completeDirectMerge: (input) =>
      mapTaskMutationProgressErrors(service.completeDirectMerge(input)),
    createTask: (input) => mapTaskCreationProgressErrors(service.createTask(input)),
    closeTask: (input) => mapTaskServiceErrors(service.closeTask(input)),
    deleteTask: (input) => mapTaskMutationProgressErrors(service.deleteTask(input)),
    detectPullRequest: (input) => mapTaskServiceErrors(service.detectPullRequest(input)),
    directMerge: (input) => mapTaskMutationProgressErrors(service.directMerge(input)),
    getApprovalContext: (input) => mapTaskServiceErrors(service.getApprovalContext(input)),
    findTask: (input) => mapTaskServiceErrors(service.findTask(input)),
    listTaskReferences: (input) => mapTaskServiceErrors(service.listTaskReferences(input)),
    getTaskMetadata: (input) => mapTaskServiceErrors(service.getTaskMetadata(input)),
    humanRequestChanges: (input) => mapTaskServiceErrors(service.humanRequestChanges(input)),
    linkMergedPullRequest: (input) =>
      mapTaskMutationProgressErrors(service.linkMergedPullRequest(input)),
    linkPullRequest: (input) => mapTaskServiceErrors(service.linkPullRequest(input)),
    listKanbanTasks: (input) => mapTaskServiceErrors(service.listKanbanTasks(input)),
    listTaskIds: (input) => mapTaskServiceErrors(service.listTaskIds(input)),
    searchTasks: (input) => mapTaskServiceErrors(service.searchTasks(input)),
    listTasks: (input) => mapTaskServiceErrors(service.listTasks(input)),
    getTaskStopImpact: (input) => mapTaskServiceErrors(service.getTaskStopImpact(input)),
    getTaskWorktreeCleanupImpact: (input) =>
      mapTaskServiceErrors(service.getTaskWorktreeCleanupImpact(input)),
    getTaskWorktreeOwners: (input) => mapTaskServiceErrors(service.getTaskWorktreeOwners(input)),
    removeTaskWorktree: (input) => mapTaskServiceErrors(service.removeTaskWorktree(input)),
    repoPullRequestSync: (input) => mapTaskServiceErrors(service.repoPullRequestSync(input)),
    repoPullRequestSyncDetailed: (input) =>
      mapTaskMutationProgressErrors(service.repoPullRequestSyncDetailed(input)),
    resetImplementation: (input) =>
      mapTaskMutationProgressErrors(service.resetImplementation(input)),
    resetTask: (input) => mapTaskMutationProgressErrors(service.resetTask(input)),
    workflowArtifactGet: (input) => mapTaskServiceErrors(service.workflowArtifactGet(input)),
    workflowArtifactSave: (input) =>
      mapTaskMutationProgressErrors(service.workflowArtifactSave(input)),
    applyTaskEvent: (input) => mapTaskServiceErrors(service.applyTaskEvent(input)),
    applyStartEvent: (input) => mapTaskServiceErrors(service.applyStartEvent(input)),
    applyAgentEvent: (input) => mapTaskServiceErrors(service.applyAgentEvent(input)),
    unlinkPullRequest: (input) => mapTaskServiceErrors(service.unlinkPullRequest(input)),
    updateTask: (input) => mapTaskMutationProgressErrors(service.updateTask(input)),
    upsertPullRequest: (input) => mapTaskServiceErrors(service.upsertPullRequest(input)),
  };
};

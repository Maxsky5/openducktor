import {
  type AgentSessionRecord,
  type ArtifactContentChunk,
  type ArtifactCreateRequest,
  type ArtifactDeleteRequest,
  type ArtifactDeleteResult,
  type ArtifactReadRequest,
  type ArtifactRenameRequest,
  type ArtifactReplaceRequest,
  type ArtifactSaveResult,
  type ArtifactScope,
  type BuildSessionBootstrap,
  buildSessionBootstrapSchema,
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
} from "@openducktor/contracts";
import { Effect } from "effect";
import { TaskPolicyError } from "../../domain/task/task-policy-error";
import {
  HostOperationError,
  type HostCommandErrorAggregate,
  type HostDependencyErrorAggregate,
  type HostInvariantErrorAggregate,
  type HostOperationErrorAggregate,
  type HostResourceErrorAggregate,
  type HostValidationErrorAggregate,
} from "../../effect/host-errors";
import { TaskAssetError } from "../../effect/task-asset-error";
import type { ArtifactImagePreviewPort } from "../../ports/artifact-image-preview-port";
import {
  GitProviderCapabilityError,
  GitProviderRepositoryError,
  GitProviderResolutionError,
} from "../../ports/git-provider-errors";
import type { GitPort, GitPortError } from "../../ports/git-port";
import type { RuntimeRegistryError, RuntimeRegistryPort } from "../../ports/runtime-registry-port";
import type { SettingsConfigError, SettingsConfigPort } from "../../ports/settings-config-port";
import type { SystemCommandPort } from "../../ports/system-command-port";
import type { TaskActivityGuardPort } from "../../ports/task-activity-guard-port";
import type {
  TaskReference,
  TaskQaOutcomeResult,
  TaskStoreError,
  TaskStorePort,
} from "../../ports/task-repository-ports";
import type { ToolDiscoveryError, ToolDiscoveryPort } from "../../ports/tool-discovery-port";
import type { WorktreeFileError, WorktreeFilePort } from "../../ports/worktree-file-port";
import type { WorktreeActionRunner } from "../actions/worktree-action-runner";
import type { GitProviderResolver } from "../git/git-provider-resolver";
import type { RuntimeDefinitionsService } from "../runtimes/runtime-definitions-service";
import type { TerminalService, TerminalServiceError } from "../terminals/terminal-service";
import type { BrowserOwnerCleanupPort } from "../browser/browser-owner-cleanup";
import type {
  WorkspaceSettingsError,
  WorkspaceSettingsService,
} from "../workspaces/workspace-settings-service";
import { failOperationAfterRollback } from "./support/task-worktree-rollback";
import {
  mapTaskServiceErrors,
  mapTaskCreationProgressErrors,
  mapTaskMutationProgressErrors,
} from "./task-error-mapping";
import { createTaskStopImpactUseCase } from "./use-cases/get-task-stop-impact";
import type {
  AgentSessionDeleteInput,
  AgentSessionUpdateModelInput,
  AgentSessionUpsertInput,
  BuildBlockedInput,
  BuildCompletedInput,
  BuildStartInput,
  CreateTaskUseCaseInput,
  DeleteTaskInput,
  DirectMergeInput,
  ListAgentSessionsForTasksInput,
  ListTasksInput,
  MarkdownArtifactInput,
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
import { createWorkflowArtifactUseCases } from "./use-cases/manage-workflow-artifacts";
import { createTaskPullRequestManagementUseCases } from "./use-cases/manage-pull-requests";
import { createTaskCrudUseCases } from "./use-cases/manage-tasks";
import { createTaskQueryUseCases } from "./use-cases/query-tasks";
import { createTaskImplementationResetUseCase } from "./use-cases/reset-implementation";
import { createTaskFullResetUseCase } from "./use-cases/reset-task";
import { createTaskReviewUseCases } from "./use-cases/review-task";
import { createTaskPullRequestSyncUseCases } from "./use-cases/sync-pull-requests";
import { createTaskBuildStateUseCases } from "./use-cases/update-build-state";
import {
  createTaskSessionLifecycleCoordinator,
  type TaskSessionLifecycleCoordinator,
} from "./worktrees/task-session-lifecycle-coordinator";
import type { TaskWorktreeService } from "./worktrees/task-worktree-service";
import {
  createTaskSessionStartPreparationService,
  type TaskSessionStartPreparationInput,
} from "./worktrees/task-session-start-preparation-service";

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
  readTaskArtifact(
    input: ArtifactReadRequest,
  ): Effect.Effect<ArtifactContentChunk, TaskServiceError>;
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
  listTasks(input: ListTasksInput): Effect.Effect<TaskCard[], TaskServiceError>;
  listKanbanTasks(input: RepoPathInput): Effect.Effect<TaskCard[], TaskServiceError>;
  /** The IDs of all tasks of a repository, also closed tasks that the Kanban board hides. */
  listTaskIds(input: RepoPathInput): Effect.Effect<string[], TaskServiceError>;
  getTaskStopImpact(input: TaskStopImpactRequest): Effect.Effect<TaskStopImpact, TaskServiceError>;
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
  closeTask(input: TaskIdInput): Effect.Effect<TaskCard, TaskServiceError>;
  resetImplementation(input: TaskIdInput): Effect.Effect<TaskCard, TaskServiceError>;
  resetTask(input: TaskIdInput): Effect.Effect<TaskCard, TaskServiceError>;
  updateTask(input: UpdateTaskInput): Effect.Effect<TaskCard, TaskServiceError>;
  transitionTask(input: TransitionTaskInput): Effect.Effect<TaskCard, TaskServiceError>;
  specGet(input: TaskIdInput): Effect.Effect<TaskMetadataArtifact, TaskServiceError>;
  setSpec(input: MarkdownArtifactInput): Effect.Effect<TaskMetadataArtifact, TaskServiceError>;
  saveSpecArtifact(
    input: MarkdownArtifactInput,
  ): Effect.Effect<TaskMetadataArtifact, TaskServiceError>;
  planGet(input: TaskIdInput): Effect.Effect<TaskMetadataArtifact, TaskServiceError>;
  setPlan(input: SetPlanInput): Effect.Effect<TaskSetPlanResult, TaskServiceError>;
  savePlanArtifact(
    input: MarkdownArtifactInput,
  ): Effect.Effect<TaskMetadataArtifact, TaskServiceError>;
  qaGetReport(input: TaskIdInput): Effect.Effect<TaskMetadataArtifact, TaskServiceError>;
  buildBlocked(input: BuildBlockedInput): Effect.Effect<TaskCard, TaskServiceError>;
  buildStart(input: BuildStartInput): Effect.Effect<BuildSessionBootstrap, TaskServiceError>;
  buildResumed(input: TaskIdInput): Effect.Effect<TaskCard, TaskServiceError>;
  buildCompleted(input: BuildCompletedInput): Effect.Effect<TaskCard, TaskServiceError>;
  qaApproved(input: MarkdownArtifactInput): Effect.Effect<TaskCard, TaskServiceError>;
  qaRejected(input: MarkdownArtifactInput): Effect.Effect<TaskCard, TaskServiceError>;
  humanRequestChanges(input: OptionalNoteInput): Effect.Effect<TaskCard, TaskServiceError>;
  humanApprove(input: TaskIdInput): Effect.Effect<TaskCard, TaskServiceError>;
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
export type TaskSetPlanResult = {
  artifact: TaskMetadataArtifact;
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
  | "qaApproved"
  | "qaRejected"
  | "resetImplementation"
  | "resetTask"
  | "setPlan"
  | "setSpec"
  | "updateTask"
> & {
  buildCompleted(
    input: BuildCompletedInput,
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
  qaApproved(input: MarkdownArtifactInput): Effect.Effect<TaskQaOutcomeResult, TaskServiceError>;
  qaRejected(input: MarkdownArtifactInput): Effect.Effect<TaskQaOutcomeResult, TaskServiceError>;
  setSpec(
    input: MarkdownArtifactInput,
  ): Effect.Effect<TaskMetadataArtifact, TaskServiceError | TaskMutationProgressFailure>;
  setPlan(
    input: SetPlanInput,
  ): Effect.Effect<TaskSetPlanResult, TaskServiceError | TaskMutationProgressFailure>;
  updateTask(
    input: UpdateTaskInput,
  ): Effect.Effect<TaskCard, TaskServiceError | TaskMutationProgressFailure>;
};
export type RepoPullRequestSyncResult =
  | { ran: true; changedTaskIds: string[] }
  | { ran: false; changedTaskIds: []; reason: RepoPullRequestSyncSkipReason; message: string };
export type RepoPullRequestSyncDetailedError = TaskServiceError | TaskMutationProgressFailure;
export type TaskTerminalCleanupPort = Pick<TerminalService, "acquireTaskCleanup">;
export type CreateTaskServiceInput = {
  artifactImagePreview?: ArtifactImagePreviewPort;
  publishCompletion?:
    | ((
        observation: import("@openducktor/contracts").TaskCompletionObservation,
      ) => Effect.Effect<void, import("../../effect/host-errors").HostError>)
    | undefined;
  terminalService?: TaskTerminalCleanupPort;
  browserTabs?: BrowserOwnerCleanupPort;
  worktreeActions?: WorktreeActionRunner;
  gitPort?: GitPort;
  gitProviderResolver?: GitProviderResolver;
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
  taskSessionLifecycleCoordinator?: TaskSessionLifecycleCoordinator;
};
export type TaskServiceUseCaseInput = Omit<
  CreateTaskServiceInput,
  "taskSessionLifecycleCoordinator"
> & {
  taskSessionLifecycleCoordinator: TaskSessionLifecycleCoordinator;
  completionState: ReturnType<typeof createTaskCompletionState>;
};
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
  const gitPort = input.gitPort;
  const useCaseInput: TaskServiceUseCaseInput = {
    ...input,
    taskSessionLifecycleCoordinator,
    completionState: createTaskCompletionState(input.publishCompletion),
  };
  const taskSessionStart = createTaskSessionStartPreparationService(useCaseInput);
  const service = {
    ...createArtifactUseCases(useCaseInput),
    ...createTaskQueryUseCases(useCaseInput),
    ...createTaskStopImpactUseCase(useCaseInput),
    ...createTaskApprovalContextUseCase(useCaseInput),
    ...createTaskPullRequestDetectionUseCase(useCaseInput),
    ...createTaskPullRequestManagementUseCases(useCaseInput),
    ...createTaskLinkMergedPullRequestUseCase(useCaseInput),
    ...createTaskDirectMergeUseCase(useCaseInput),
    ...createTaskCompleteDirectMergeUseCase(useCaseInput),
    ...createTaskCrudUseCases(useCaseInput),
    ...createTaskDeleteUseCase(useCaseInput),
    ...createTaskCloseUseCase(useCaseInput),
    ...createTaskImplementationResetUseCase(useCaseInput),
    ...createTaskFullResetUseCase(useCaseInput),
    ...createWorkflowArtifactUseCases(useCaseInput),
    buildStart: (startInput: BuildStartInput) =>
      Effect.scoped(
        Effect.gen(function* () {
          if (!gitPort) {
            return yield* Effect.fail(
              new HostOperationError({
                operation: "task.build_start",
                message: "Git port is required for build_start.",
              }),
            );
          }
          const canonicalRepoPath = yield* gitPort.canonicalizePath(startInput.repoPath);
          yield* taskSessionLifecycleCoordinator.acquireLifecycle(
            canonicalRepoPath,
            [startInput.taskId],
            "start build",
          );
          const preparationInput: TaskSessionStartPreparationInput = {
            canonicalRepoPath,
            taskId: startInput.taskId,
            role: "build",
            runtimeKind: startInput.runtimeKind,
          };
          const prepared = yield* taskSessionStart.prepare(preparationInput);
          let rollback = prepared.rollback;
          const completion = yield* Effect.gen(function* () {
            yield* taskSessionStart.complete(prepared, (transitionInput) =>
              input.taskStore.transitionTask(transitionInput),
            );
            // A committed build retains its worktree when cancellation arrives.
            rollback = () => Effect.void;
            return buildSessionBootstrapSchema.parse({
              runtimeKind: prepared.runtimeKind,
              workingDirectory: prepared.workingDirectory,
            });
          }).pipe(
            Effect.result,
            Effect.uninterruptible,
            Effect.onInterrupt(() => rollback().pipe(Effect.orDie)),
          );
          if (completion._tag === "Success") {
            return completion.success;
          }
          return yield* failOperationAfterRollback(rollback(), completion.failure, {
            operation: "task.build_start.finalize",
            details: { repoPath: canonicalRepoPath, taskId: startInput.taskId },
          });
        }),
      ),
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
    buildStart: (input) => mapTaskServiceErrors(service.buildStart(input)),
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
    humanApprove: (input) => mapTaskServiceErrors(service.humanApprove(input)),
    humanRequestChanges: (input) => mapTaskServiceErrors(service.humanRequestChanges(input)),
    linkMergedPullRequest: (input) =>
      mapTaskMutationProgressErrors(service.linkMergedPullRequest(input)),
    linkPullRequest: (input) => mapTaskServiceErrors(service.linkPullRequest(input)),
    listKanbanTasks: (input) => mapTaskServiceErrors(service.listKanbanTasks(input)),
    listTaskIds: (input) => mapTaskServiceErrors(service.listTaskIds(input)),
    listTasks: (input) => mapTaskServiceErrors(service.listTasks(input)),
    getTaskStopImpact: (input) => mapTaskServiceErrors(service.getTaskStopImpact(input)),
    planGet: (input) => mapTaskServiceErrors(service.planGet(input)),
    qaApproved: (input) => mapTaskServiceErrors(service.qaApproved(input)),
    qaGetReport: (input) => mapTaskServiceErrors(service.qaGetReport(input)),
    qaRejected: (input) => mapTaskServiceErrors(service.qaRejected(input)),
    repoPullRequestSync: (input) => mapTaskServiceErrors(service.repoPullRequestSync(input)),
    repoPullRequestSyncDetailed: (input) =>
      mapTaskMutationProgressErrors(service.repoPullRequestSyncDetailed(input)),
    resetImplementation: (input) =>
      mapTaskMutationProgressErrors(service.resetImplementation(input)),
    resetTask: (input) => mapTaskMutationProgressErrors(service.resetTask(input)),
    savePlanArtifact: (input) => mapTaskServiceErrors(service.savePlanArtifact(input)),
    saveSpecArtifact: (input) => mapTaskServiceErrors(service.saveSpecArtifact(input)),
    setPlan: (input) => mapTaskMutationProgressErrors(service.setPlan(input)),
    setSpec: (input) => mapTaskMutationProgressErrors(service.setSpec(input)),
    specGet: (input) => mapTaskServiceErrors(service.specGet(input)),
    transitionTask: (input) => mapTaskServiceErrors(service.transitionTask(input)),
    unlinkPullRequest: (input) => mapTaskServiceErrors(service.unlinkPullRequest(input)),
    updateTask: (input) => mapTaskMutationProgressErrors(service.updateTask(input)),
    upsertPullRequest: (input) => mapTaskServiceErrors(service.upsertPullRequest(input)),
  };
};

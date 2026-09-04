import type { TaskChangeSet } from "@openducktor/contracts";
import {
  type AgentSessionRecord,
  type BuildSessionBootstrap,
  buildSessionBootstrapSchema,
  type PullRequest,
  type TaskAgentSessions,
  type TaskApprovalContextLoadResult,
  type TaskCard,
  type TaskDirectMergeResult,
  type TaskMetadataDocument,
  type TaskMetadataPayload,
  type TaskPullRequestDetectResult,
  type TaskStopImpact,
  type TaskStopImpactRequest,
} from "@openducktor/contracts";
import { Effect } from "effect";
import { TaskPolicyError } from "../../domain/task/task-policy-error";
import type {
  HostCommandErrorAggregate,
  HostDependencyErrorAggregate,
  HostInvariantErrorAggregate,
  HostOperationErrorAggregate,
  HostResourceErrorAggregate,
  HostValidationErrorAggregate,
} from "../../effect/host-errors";
import {
  errorMessage,
  HostOperationError as HostOperationErrorValue,
  isHostError,
} from "../../effect/host-errors";
import { TaskAssetError } from "../../effect/task-asset-error";
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
import type { TaskStoreError, TaskStorePort } from "../../ports/task-repository-ports";
import type { ToolDiscoveryError, ToolDiscoveryPort } from "../../ports/tool-discovery-port";
import type { WorktreeFileError, WorktreeFilePort } from "../../ports/worktree-file-port";
import type { DevServerService, DevServerServiceError } from "../dev-servers/dev-server-service";
import type { GitProviderResolver } from "../git/git-provider-resolver";
import type { RuntimeDefinitionsService } from "../runtimes/runtime-definitions-service";
import type { TerminalService, TerminalServiceError } from "../terminals/terminal-service";
import type {
  WorkspaceSettingsError,
  WorkspaceSettingsService,
} from "../workspaces/workspace-settings-service";
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
import { TaskMutationProgressFailure } from "./task-mutation-progress-failure";
import { createTaskCloseUseCase } from "./use-cases/close-task";
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
import { createTaskPullRequestSyncUseCases } from "./use-cases/sync-pull-requests";
import { createTaskBuildStateUseCases } from "./use-cases/update-build-state";
import {
  createTaskSessionLifecycleCoordinator,
  type TaskSessionLifecycleCoordinator,
} from "./worktrees/task-session-lifecycle-coordinator";
import type { TaskWorktreeService } from "./worktrees/task-worktree-service";
import {
  createTaskSessionStartPreparationService,
  type PreparedTaskSessionStart,
  type TaskSessionStartPreparationInput,
} from "./worktrees/task-session-start-preparation-service";

export type TaskServiceError =
  | DevServerServiceError
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
  listTasks(input: ListTasksInput): Effect.Effect<TaskCard[], TaskServiceError>;
  listKanbanTasks(input: RepoPathInput): Effect.Effect<TaskCard[], TaskServiceError>;
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
  completeDirectMerge(input: TaskIdInput): Effect.Effect<TaskCard, TaskServiceError>;
  createTask(input: CreateTaskUseCaseInput): Effect.Effect<TaskCard, TaskServiceError>;
  deleteTask(input: DeleteTaskInput): Effect.Effect<TaskDeleteResult, TaskServiceError>;
  closeTask(input: TaskIdInput): Effect.Effect<TaskCard, TaskServiceError>;
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
  setPlan(input: SetPlanInput): Effect.Effect<TaskSetPlanResult, TaskServiceError>;
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
  ): Effect.Effect<RepoPullRequestSyncResult, RepoPullRequestSyncDetailedError>;
};
export type TaskDeleteResult = {
  ok: boolean;
  changes: TaskChangeSet;
};
export type TaskSetPlanResult = {
  document: TaskMetadataDocument;
  changes: TaskChangeSet;
};
export type TaskServiceWithMutationProgress = Omit<
  TaskService,
  | "buildCompleted"
  | "createTask"
  | "deleteTask"
  | "directMerge"
  | "linkMergedPullRequest"
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
  ): Effect.Effect<TaskCard, TaskServiceError | TaskMutationProgressFailure>;
  deleteTask(
    input: DeleteTaskInput,
  ): Effect.Effect<TaskDeleteResult, TaskServiceError | TaskMutationProgressFailure>;
  directMerge(
    input: DirectMergeInput,
  ): Effect.Effect<TaskDirectMergeResult, TaskServiceError | TaskMutationProgressFailure>;
  linkMergedPullRequest(
    input: PullRequestLinkMergedInput,
  ): Effect.Effect<TaskCard, TaskServiceError | TaskMutationProgressFailure>;
  resetImplementation(
    input: TaskIdInput,
  ): Effect.Effect<TaskCard, TaskServiceError | TaskMutationProgressFailure>;
  resetTask(
    input: TaskIdInput,
  ): Effect.Effect<TaskCard, TaskServiceError | TaskMutationProgressFailure>;
  setSpec(
    input: MarkdownDocumentInput,
  ): Effect.Effect<TaskMetadataDocument, TaskServiceError | TaskMutationProgressFailure>;
  setPlan(
    input: SetPlanInput,
  ): Effect.Effect<TaskSetPlanResult, TaskServiceError | TaskMutationProgressFailure>;
  updateTask(
    input: UpdateTaskInput,
  ): Effect.Effect<TaskCard, TaskServiceError | TaskMutationProgressFailure>;
};
export type RepoPullRequestSyncResult = {
  ran: boolean;
  changedTaskIds: string[];
};
export type RepoPullRequestSyncDetailedError = TaskServiceError | TaskMutationProgressFailure;
export type TaskTerminalCleanupPort = Pick<TerminalService, "acquireTaskCleanup">;
export type CreateTaskServiceInput = {
  devServerService?: DevServerService;
  terminalService?: TaskTerminalCleanupPort;
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
};
const isTaskServiceError = (cause: unknown): cause is TaskServiceError =>
  cause instanceof GitProviderCapabilityError ||
  cause instanceof GitProviderRepositoryError ||
  cause instanceof GitProviderResolutionError ||
  cause instanceof TaskAssetError ||
  cause instanceof TaskPolicyError ||
  isHostError(cause);

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

const mapRepoPullRequestSyncDetailedErrors = <A, E>(
  effect: Effect.Effect<A, E>,
): Effect.Effect<A, RepoPullRequestSyncDetailedError> =>
  effect.pipe(
    Effect.mapError((cause) =>
      cause instanceof TaskMutationProgressFailure ? cause : toTaskServiceError(cause),
    ),
  );

const mapTaskMutationProgressErrors = <A, E>(
  effect: Effect.Effect<A, E>,
): Effect.Effect<A, TaskServiceError | TaskMutationProgressFailure> =>
  effect.pipe(
    Effect.mapError((cause) =>
      cause instanceof TaskMutationProgressFailure ? cause : toTaskServiceError(cause),
    ),
  );

export const createTaskServiceWithMutationProgress = (
  input: CreateTaskServiceInput,
): TaskServiceWithMutationProgress => createTaskServiceImplementation(input);

const createTaskServiceImplementation = (
  input: CreateTaskServiceInput,
): TaskServiceWithMutationProgress => {
  const taskSessionLifecycleCoordinator =
    input.taskSessionLifecycleCoordinator ?? createTaskSessionLifecycleCoordinator();
  const gitPort = input.gitPort;
  const useCaseInput: TaskServiceUseCaseInput = {
    ...input,
    taskSessionLifecycleCoordinator,
  };
  const taskSessionStart = createTaskSessionStartPreparationService(useCaseInput);
  const service = {
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
    ...createTaskDocumentUseCases(useCaseInput),
    buildStart: (startInput: BuildStartInput) =>
      Effect.scoped(
        Effect.gen(function* () {
          if (!gitPort) {
            return yield* Effect.fail(
              new HostOperationErrorValue({
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
          let prepared: PreparedTaskSessionStart | null = null;
          let cleanup: PreparedTaskSessionStart["cleanup"] = () => Effect.succeed("");
          const completion = yield* Effect.either(
            Effect.gen(function* () {
              const preparationInput: TaskSessionStartPreparationInput = {
                canonicalRepoPath,
                taskId: startInput.taskId,
                role: "build",
                runtimeKind: startInput.runtimeKind,
              };
              prepared = yield* taskSessionStart.prepare(preparationInput);
              cleanup = prepared.cleanup;
              yield* taskSessionStart.complete(prepared, (transitionInput) =>
                input.taskStore.transitionTask(transitionInput),
              );
              return buildSessionBootstrapSchema.parse({
                runtimeKind: prepared.runtimeKind,
                workingDirectory: prepared.workingDirectory,
              });
            }).pipe(Effect.onInterrupt(() => cleanup().pipe(Effect.orDie, Effect.asVoid))),
          );
          if (completion._tag === "Right") {
            return completion.right;
          }
          const cleanupError = yield* cleanup();
          return yield* Effect.fail(
            new HostOperationErrorValue({
              operation: "task.build_start.finalize",
              message: `${errorMessage(completion.left)}${cleanupError}`,
              cause: completion.left,
              details: { repoPath: canonicalRepoPath, taskId: startInput.taskId },
            }),
          );
        }),
      ),
    ...createTaskBuildStateUseCases(useCaseInput),
    ...createTaskReviewUseCases(useCaseInput),
    ...createTaskPullRequestSyncUseCases(useCaseInput),
  };
  return {
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
    completeDirectMerge: (input) => mapTaskServiceErrors(service.completeDirectMerge(input)),
    createTask: (input) => mapTaskMutationProgressErrors(service.createTask(input)),
    closeTask: (input) => mapTaskServiceErrors(service.closeTask(input)),
    deleteTask: (input) => mapTaskMutationProgressErrors(service.deleteTask(input)),
    detectPullRequest: (input) => mapTaskServiceErrors(service.detectPullRequest(input)),
    directMerge: (input) => mapTaskMutationProgressErrors(service.directMerge(input)),
    getApprovalContext: (input) => mapTaskServiceErrors(service.getApprovalContext(input)),
    getTaskMetadata: (input) => mapTaskServiceErrors(service.getTaskMetadata(input)),
    humanApprove: (input) => mapTaskServiceErrors(service.humanApprove(input)),
    humanRequestChanges: (input) => mapTaskServiceErrors(service.humanRequestChanges(input)),
    linkMergedPullRequest: (input) =>
      mapTaskMutationProgressErrors(service.linkMergedPullRequest(input)),
    linkPullRequest: (input) => mapTaskServiceErrors(service.linkPullRequest(input)),
    listKanbanTasks: (input) => mapTaskServiceErrors(service.listKanbanTasks(input)),
    listTasks: (input) => mapTaskServiceErrors(service.listTasks(input)),
    getTaskStopImpact: (input) => mapTaskServiceErrors(service.getTaskStopImpact(input)),
    planGet: (input) => mapTaskServiceErrors(service.planGet(input)),
    qaApproved: (input) => mapTaskServiceErrors(service.qaApproved(input)),
    qaGetReport: (input) => mapTaskServiceErrors(service.qaGetReport(input)),
    qaRejected: (input) => mapTaskServiceErrors(service.qaRejected(input)),
    repoPullRequestSync: (input) => mapTaskServiceErrors(service.repoPullRequestSync(input)),
    repoPullRequestSyncDetailed: (input) =>
      mapRepoPullRequestSyncDetailedErrors(service.repoPullRequestSyncDetailed(input)),
    resetImplementation: (input) =>
      mapTaskMutationProgressErrors(service.resetImplementation(input)),
    resetTask: (input) => mapTaskMutationProgressErrors(service.resetTask(input)),
    savePlanDocument: (input) => mapTaskServiceErrors(service.savePlanDocument(input)),
    saveSpecDocument: (input) => mapTaskServiceErrors(service.saveSpecDocument(input)),
    setPlan: (input) => mapTaskMutationProgressErrors(service.setPlan(input)),
    setSpec: (input) => mapTaskMutationProgressErrors(service.setSpec(input)),
    specGet: (input) => mapTaskServiceErrors(service.specGet(input)),
    transitionTask: (input) => mapTaskServiceErrors(service.transitionTask(input)),
    unlinkPullRequest: (input) => mapTaskServiceErrors(service.unlinkPullRequest(input)),
    updateTask: (input) => mapTaskMutationProgressErrors(service.updateTask(input)),
    upsertPullRequest: (input) => mapTaskServiceErrors(service.upsertPullRequest(input)),
  };
};

export const createTaskService = (input: CreateTaskServiceInput): TaskService => {
  return withoutTaskMutationProgress(createTaskServiceWithMutationProgress(input));
};

const discardTaskMutationProgress = <A>(
  effect: Effect.Effect<A, TaskServiceError | TaskMutationProgressFailure>,
): Effect.Effect<A, TaskServiceError> =>
  effect.pipe(
    Effect.catchTag("TaskMutationProgressFailure", (progressFailure) =>
      Effect.fail(progressFailure.failure),
    ),
  );

const withoutTaskMutationProgress = (taskService: TaskServiceWithMutationProgress): TaskService => {
  return {
    ...taskService,
    buildCompleted: (input) => discardTaskMutationProgress(taskService.buildCompleted(input)),
    createTask: (input) => discardTaskMutationProgress(taskService.createTask(input)),
    deleteTask: (input) => discardTaskMutationProgress(taskService.deleteTask(input)),
    directMerge: (input) => discardTaskMutationProgress(taskService.directMerge(input)),
    linkMergedPullRequest: (input) =>
      discardTaskMutationProgress(taskService.linkMergedPullRequest(input)),
    resetImplementation: (input) =>
      discardTaskMutationProgress(taskService.resetImplementation(input)),
    resetTask: (input) => discardTaskMutationProgress(taskService.resetTask(input)),
    setPlan: (input) => discardTaskMutationProgress(taskService.setPlan(input)),
    setSpec: (input) => discardTaskMutationProgress(taskService.setSpec(input)),
    updateTask: (input) => discardTaskMutationProgress(taskService.updateTask(input)),
  };
};

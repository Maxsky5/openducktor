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
  type TaskSessionBootstrap,
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
import type { TerminalService, TerminalServiceError } from "../terminals/terminal-service";
import type {
  WorkspaceSettingsError,
  WorkspaceSettingsService,
} from "../workspaces/workspace-settings-service";
import { createTaskGithubDependencies } from "./support/required-task-dependencies";
import type {
  AgentSessionDeleteInput,
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
  TaskSessionBootstrapFinalizeInput,
  TaskSessionBootstrapPrepareInput,
  TaskSessionStartupLeaseFinalizeInput,
  TaskSessionStartupLeasePrepareInput,
  TransitionTaskInput,
  UpdateTaskInput,
} from "./task-inputs";
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
import { createTaskSessionBootstrapUseCase } from "./use-cases/task-session-bootstrap";
import { createTaskSessionStartupLeaseUseCase } from "./use-cases/task-session-startup-lease";
import { createTaskBuildStateUseCases } from "./use-cases/update-build-state";
import {
  createTaskSessionBootstrapCoordinator,
  type TaskSessionBootstrapCoordinator,
} from "./worktrees/task-session-bootstrap-coordinator";
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
  | TerminalServiceError
  | WorktreeFileError
  | WorkspaceSettingsError;

export type TaskService = {
  listTasks(input: ListTasksInput): Effect.Effect<TaskCard[], TaskServiceError>;
  getTaskMetadata(input: TaskIdInput): Effect.Effect<TaskMetadataPayload, TaskServiceError>;
  agentSessionsList(input: TaskIdInput): Effect.Effect<AgentSessionRecord[], TaskServiceError>;
  agentSessionsListForTasks(
    input: ListAgentSessionsForTasksInput,
  ): Effect.Effect<TaskAgentSessions[], TaskServiceError>;
  agentSessionUpsert(input: AgentSessionUpsertInput): Effect.Effect<boolean, TaskServiceError>;
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
  deleteTask(input: DeleteTaskInput): Effect.Effect<
    {
      ok: boolean;
    },
    TaskServiceError
  >;
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
  setPlan(input: SetPlanInput): Effect.Effect<TaskMetadataDocument, TaskServiceError>;
  savePlanDocument(
    input: MarkdownDocumentInput,
  ): Effect.Effect<TaskMetadataDocument, TaskServiceError>;
  qaGetReport(input: TaskIdInput): Effect.Effect<TaskMetadataDocument, TaskServiceError>;
  buildBlocked(input: BuildBlockedInput): Effect.Effect<TaskCard, TaskServiceError>;
  buildStart(input: BuildStartInput): Effect.Effect<BuildSessionBootstrap, TaskServiceError>;
  taskSessionBootstrapPrepare(
    input: TaskSessionBootstrapPrepareInput,
  ): Effect.Effect<TaskSessionBootstrap, TaskServiceError>;
  taskSessionBootstrapComplete(
    input: TaskSessionBootstrapFinalizeInput,
  ): Effect.Effect<boolean, TaskServiceError>;
  taskSessionBootstrapAbort(
    input: TaskSessionBootstrapFinalizeInput,
  ): Effect.Effect<boolean, TaskServiceError>;
  taskSessionStartupLeasePrepare(
    input: TaskSessionStartupLeasePrepareInput,
  ): Effect.Effect<string, TaskServiceError>;
  taskSessionStartupLeaseComplete(
    input: TaskSessionStartupLeaseFinalizeInput,
  ): Effect.Effect<boolean, TaskServiceError>;
  taskSessionStartupLeaseAbort(
    input: TaskSessionStartupLeaseFinalizeInput,
  ): Effect.Effect<boolean, TaskServiceError>;
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
};
export type RepoPullRequestSyncResult = {
  ran: boolean;
  changedTaskIds: string[];
};
export type TaskTerminalCleanupPort = Pick<TerminalService, "acquireTaskCleanup">;
export type CreateTaskServiceInput = {
  devServerService?: DevServerService;
  terminalService?: TaskTerminalCleanupPort;
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
  taskSessionBootstrapCoordinator?: TaskSessionBootstrapCoordinator;
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
  const githubDependencies = createTaskGithubDependencies(input);
  const taskSessionBootstrapCoordinator =
    input.taskSessionBootstrapCoordinator ?? createTaskSessionBootstrapCoordinator();
  const useCaseInput = { ...input, githubDependencies, taskSessionBootstrapCoordinator };
  const taskSessionBootstrap = createTaskSessionBootstrapUseCase(useCaseInput);
  const service = {
    ...createTaskQueryUseCases(useCaseInput),
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
    ...taskSessionBootstrap,
    ...createTaskSessionStartupLeaseUseCase(useCaseInput),
    buildStart: (startInput: BuildStartInput) =>
      Effect.gen(function* () {
        const bootstrap = yield* taskSessionBootstrap.taskSessionBootstrapPrepare({
          ...startInput,
          role: "build",
        });
        const completed = yield* Effect.either(
          taskSessionBootstrap.taskSessionBootstrapComplete({
            repoPath: startInput.repoPath,
            taskId: startInput.taskId,
            bootstrapId: bootstrap.bootstrapId,
          }),
        );
        if (completed._tag === "Left") {
          const abort = yield* Effect.either(
            taskSessionBootstrap.taskSessionBootstrapAbort({
              repoPath: startInput.repoPath,
              taskId: startInput.taskId,
              bootstrapId: bootstrap.bootstrapId,
            }),
          );
          return yield* Effect.fail(
            new HostOperationErrorValue({
              operation: "task.build_start.finalize",
              message: `${errorMessage(completed.left)}${abort._tag === "Left" ? `\nAlso failed to roll back: ${errorMessage(abort.left)}` : ""}`,
              cause: completed.left,
              details: { repoPath: startInput.repoPath, taskId: startInput.taskId },
            }),
          );
        }
        return buildSessionBootstrapSchema.parse({
          runtimeKind: bootstrap.runtimeKind,
          workingDirectory: bootstrap.workingDirectory,
        });
      }),
    ...createTaskBuildStateUseCases(useCaseInput),
    ...createTaskReviewUseCases(useCaseInput),
    ...createTaskPullRequestSyncUseCases(useCaseInput),
  };
  return {
    agentSessionDelete: (input) => mapTaskServiceErrors(service.agentSessionDelete(input)),
    agentSessionsList: (input) => mapTaskServiceErrors(service.agentSessionsList(input)),
    agentSessionsListForTasks: (input) =>
      mapTaskServiceErrors(service.agentSessionsListForTasks(input)),
    agentSessionUpsert: (input) => mapTaskServiceErrors(service.agentSessionUpsert(input)),
    buildBlocked: (input) => mapTaskServiceErrors(service.buildBlocked(input)),
    buildCompleted: (input) => mapTaskServiceErrors(service.buildCompleted(input)),
    buildResumed: (input) => mapTaskServiceErrors(service.buildResumed(input)),
    buildStart: (input) => mapTaskServiceErrors(service.buildStart(input)),
    taskSessionBootstrapPrepare: (input) =>
      mapTaskServiceErrors(service.taskSessionBootstrapPrepare(input)),
    taskSessionBootstrapComplete: (input) =>
      mapTaskServiceErrors(service.taskSessionBootstrapComplete(input)),
    taskSessionBootstrapAbort: (input) =>
      mapTaskServiceErrors(service.taskSessionBootstrapAbort(input)),
    taskSessionStartupLeasePrepare: (input) =>
      mapTaskServiceErrors(service.taskSessionStartupLeasePrepare(input)),
    taskSessionStartupLeaseComplete: (input) =>
      mapTaskServiceErrors(service.taskSessionStartupLeaseComplete(input)),
    taskSessionStartupLeaseAbort: (input) =>
      mapTaskServiceErrors(service.taskSessionStartupLeaseAbort(input)),
    completeDirectMerge: (input) => mapTaskServiceErrors(service.completeDirectMerge(input)),
    createTask: (input) => mapTaskServiceErrors(service.createTask(input)),
    closeTask: (input) => mapTaskServiceErrors(service.closeTask(input)),
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

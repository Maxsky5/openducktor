import type {
  AgentSessionRecord,
  GlobalGitConfig,
  RepoConfig,
  TaskCard,
} from "@openducktor/contracts";
import { pathStartsWith } from "@openducktor/path-support";
import type { TaskIdInput } from "../task-inputs";
import type { TaskWorkflow } from "@openducktor/workflows";
import type { TaskWorkflowResolver } from "../../../ports/task-workflow-port";
import { Effect } from "effect";
import { TaskPolicyError } from "../../../domain/task";
import { errorMessage, HostOperationError, HostValidationError } from "../../../effect/host-errors";
import type { SettingsConfigError, SettingsConfigPort } from "../../../ports/settings-config-port";
import type {
  TaskRecord,
  TaskStoreError,
  TaskStorePort,
} from "../../../ports/task-repository-ports";
import { taskWorktreeIdError } from "../worktrees/task-worktree-id";
import {
  decideTaskTransition,
  decideEffectTransition,
  startWorktreeSessionHint,
  type HostEffect,
} from "./task-workflow-events";

/** Decides a named event for a task and commits its transition. A repeat returns the task. */
export const applyTaskEvent = (
  taskStore: Pick<TaskStorePort, "transitionTask">,
  taskWorkflows: TaskWorkflowResolver,
  input: TaskIdInput,
  eventId: string,
): Effect.Effect<TaskCard, TaskPolicyError | TaskStoreError> =>
  Effect.gen(function* () {
    const updated = yield* taskStore.transitionTask({
      ...input,
      decide: (task) => decideTaskTransition(taskWorkflows.forTask(task), eventId, task),
    });
    return enrichTask(taskWorkflows.forTask(updated), updated);
  });

/** Decides the event of a host effect for a task and commits its transition. */
export const applyEffect = (
  taskStore: Pick<TaskStorePort, "transitionTask">,
  taskWorkflows: TaskWorkflowResolver,
  input: TaskIdInput,
  effect: HostEffect,
): Effect.Effect<TaskCard, TaskPolicyError | TaskStoreError> =>
  Effect.gen(function* () {
    const updated = yield* taskStore.transitionTask({
      ...input,
      decide: (task) => decideEffectTransition(taskWorkflows.forTask(task), effect, task),
    });
    return enrichTask(taskWorkflows.forTask(updated), updated);
  });

/** Adds the workflow projection to stored tasks. */
export const enrichTasks = (
  taskWorkflows: TaskWorkflowResolver,
  tasks: readonly TaskRecord[],
): TaskCard[] => tasks.map((task) => enrichTask(taskWorkflows.forTask(task), task));
export const enrichTask = (workflow: TaskWorkflow, task: TaskRecord): TaskCard => ({
  ...task,
  ...workflow.project(task),
});
export const validateAgentSessionWorkingDirectory = (
  settingsConfig: SettingsConfigPort,
  workspace: RepoConfig,
  session: AgentSessionRecord,
) =>
  Effect.gen(function* () {
    const { repoPath, workspaceId } = workspace;
    const canonicalRepoPath = yield* canonicalizeRequiredPath(
      settingsConfig,
      repoPath,
      "Repository path for agent session validation must exist and be accessible",
    );
    const canonicalWorkingDirectory = yield* canonicalizeRequiredPath(
      settingsConfig,
      session.workingDirectory,
      "Agent session workingDirectory must exist and be accessible",
    );
    if (pathStartsWith(canonicalWorkingDirectory, canonicalRepoPath)) {
      return;
    }
    const canonicalEffectiveWorktreeBase = yield* tryCanonicalizePath(
      settingsConfig,
      workspace.worktreeBasePath === undefined
        ? settingsConfig.defaultWorktreeBasePath(workspaceId)
        : settingsConfig.resolveConfiguredPath(workspace.worktreeBasePath),
    );
    if (
      canonicalEffectiveWorktreeBase &&
      pathStartsWith(canonicalWorkingDirectory, canonicalEffectiveWorktreeBase)
    ) {
      return;
    }
    const canonicalRepoDefaultWorktreeBase = yield* tryCanonicalizePath(
      settingsConfig,
      settingsConfig.defaultRepoWorktreeBasePath(canonicalRepoPath),
    );
    if (
      canonicalRepoDefaultWorktreeBase &&
      pathStartsWith(canonicalWorkingDirectory, canonicalRepoDefaultWorktreeBase)
    ) {
      return;
    }
    return yield* Effect.fail(
      new HostValidationError({
        field: "workingDirectory",
        message: `Agent session workingDirectory must stay inside repository ${repoPath} or its effective worktree base. Received: ${session.workingDirectory}`,
        details: { repoPath, workingDirectory: session.workingDirectory },
      }),
    );
  });
export const loadDefaultMergeMethod = (
  settingsConfig: SettingsConfigPort,
): Effect.Effect<
  GlobalGitConfig["defaultMergeMethod"],
  SettingsConfigError | HostValidationError
> => loadGlobalGitConfig(settingsConfig).pipe(Effect.map((git) => git.defaultMergeMethod));
/** The global setting that a task close follows when the task has no override. */
export const loadRemoveWorktreeOnClose = (
  settingsConfig: SettingsConfigPort,
): Effect.Effect<boolean, SettingsConfigError | HostValidationError> =>
  loadGlobalGitConfig(settingsConfig).pipe(Effect.map((git) => git.removeWorktreeOnClose));
export const buildCompletionWorktreePath = (
  settingsConfig: SettingsConfigPort,
  workflow: TaskWorkflow,
  repoConfig: RepoConfig,
  taskId: string,
) =>
  Effect.gen(function* () {
    const idError = taskWorktreeIdError(taskId);
    if (idError) return yield* idError;
    const basePath =
      repoConfig.worktreeBasePath === undefined
        ? settingsConfig.defaultWorktreeBasePath(repoConfig.workspaceId)
        : settingsConfig.resolveConfiguredPath(repoConfig.worktreeBasePath);
    const worktreePath = settingsConfig.join(basePath, taskId);
    if (!(yield* settingsConfig.pathExists(worktreePath))) {
      return yield* Effect.fail(
        new HostValidationError({
          field: "taskId",
          message: `Worktree cleanup scripts require a task worktree for task ${taskId}. ${startWorktreeSessionHint(workflow)}`,
          details: { taskId, worktreePath },
        }),
      );
    }
    const canonicalRepoPath = yield* settingsConfig.canonicalizePath(repoConfig.repoPath);
    const canonicalWorktreePath = yield* settingsConfig.canonicalizePath(worktreePath);
    if (canonicalRepoPath === canonicalWorktreePath) {
      return yield* Effect.fail(
        new HostValidationError({
          field: "taskId",
          message: `The worktree path of task ${taskId} is the repository root. Change the worktree base path in the repository settings.`,
          details: { taskId, worktreePath },
        }),
      );
    }
    return worktreePath;
  });
export const blockBuildCompletionTask = (
  taskStore: Pick<TaskStorePort, "transitionTask">,
  taskWorkflows: TaskWorkflowResolver,
  input: TaskIdInput,
) => {
  const { workspaceId, repoPath, taskId } = input;
  return Effect.gen(function* () {
    yield* taskStore.transitionTask({
      workspaceId,
      repoPath,
      taskId,
      decide: (task) => decideEffectTransition(taskWorkflows.forTask(task), "build.blocked", task),
    });
  }).pipe(
    Effect.mapError((error) => {
      if (error instanceof TaskPolicyError) {
        return error;
      }

      return new HostOperationError({
        operation: "task.build_completed.block_task",
        message: errorMessage(error),
        cause: error,
        details: { repoPath, taskId },
      });
    }),
  );
};

const tryCanonicalizePath = (
  settingsConfig: SettingsConfigPort,
  rawPath: string | null | undefined,
) =>
  Effect.gen(function* () {
    const trimmed = rawPath?.trim();
    if (!trimmed) {
      return undefined;
    }
    const result = yield* Effect.result(settingsConfig.canonicalizePath(trimmed));
    return result._tag === "Success" ? result.success : undefined;
  });
const canonicalizeRequiredPath = (
  settingsConfig: SettingsConfigPort,
  rawPath: string,
  errorMessage: string,
) =>
  Effect.gen(function* () {
    const trimmed = rawPath.trim();
    return yield* settingsConfig.canonicalizePath(trimmed).pipe(
      Effect.mapError(
        (error) =>
          new HostValidationError({
            field: "path",
            message: `${errorMessage}: ${trimmed}`,
            cause: error,
            details: { path: trimmed },
          }),
      ),
    );
  });

const loadGlobalGitConfig = (
  settingsConfig: SettingsConfigPort,
): Effect.Effect<GlobalGitConfig, SettingsConfigError | HostValidationError> =>
  Effect.gen(function* () {
    const config = yield* settingsConfig.readGlobalConfig();
    return config.git;
  });

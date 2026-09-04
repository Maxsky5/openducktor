import type { AgentRole, RuntimeKind, TaskCard, TaskStatus } from "@openducktor/contracts";
import { Effect } from "effect";
import { normalizePathForComparison } from "../../../domain/path-comparison";
import { buildBranchName } from "../../../domain/task";
import { errorMessage, HostOperationError, HostValidationError } from "../../../effect/host-errors";
import {
  requireBuildStartDependencies,
  requireDependencies,
} from "../support/required-task-dependencies";
import { validateTaskSessionWorkflowAvailable } from "../support/task-session-workflow-validation";
import { validateTaskTransitionEffect } from "../support/task-validation-effects";
import { resolveRuntimeDescriptorForTaskSession } from "../support/task-worktree-cleanup";
import {
  prepareNewTaskWorktree,
  type PreparedTaskWorktree,
  validateExistingGitTaskWorktree,
} from "../support/task-worktree-start";
import type { TaskStorePort } from "../../../ports/task-repository-ports";
import type { CreateTaskServiceInput, TaskServiceError } from "../task-service";

export type PreparedTaskSessionStart = {
  canonicalRepoPath: string;
  cleanup: PreparedTaskWorktree["cleanup"];
  preparedStatus: TaskStatus;
  role: AgentRole;
  runtimeKind: RuntimeKind;
  task: TaskCard;
  workingDirectory: string;
};

export type TaskSessionStartPreparationInput = {
  repoPath: string;
  taskId: string;
  role: AgentRole;
  runtimeKind: string;
  targetWorkingDirectory?: string;
};

export type TaskSessionStartPreparationService = ReturnType<
  typeof createTaskSessionStartPreparationService
>;

export const createTaskSessionStartPreparationService = ({
  gitPort,
  taskStore,
  settingsConfig,
  systemCommands,
  workspaceSettingsService,
  runtimeDefinitionsService,
  runtimeRegistry,
  worktreeFiles,
  taskSessionLifecycleCoordinator,
}: CreateTaskServiceInput) => {
  if (!taskSessionLifecycleCoordinator) {
    throw new Error("Task lifecycle coordinator is required.");
  }
  const coordinator = taskSessionLifecycleCoordinator;

  return {
    prepare(
      input: TaskSessionStartPreparationInput,
      canonicalInputRepoPath: string,
    ): Effect.Effect<PreparedTaskSessionStart, TaskServiceError> {
      return Effect.gen(function* () {
        const { runtimeKind, taskId, role } = input;
        const dependencies = yield* requireDependencies(() =>
          requireBuildStartDependencies(
            gitPort,
            runtimeDefinitionsService,
            runtimeRegistry,
            settingsConfig,
            systemCommands,
            worktreeFiles,
            workspaceSettingsService,
          ),
        );
        const descriptor = yield* resolveRuntimeDescriptorForTaskSession(
          dependencies.runtimeDefinitionsService,
          runtimeKind,
          role,
        );
        const repoConfig =
          yield* dependencies.workspaceSettingsService.getRepoConfigByRepoPath(
            canonicalInputRepoPath,
          );
        const canonicalRepoPath = yield* dependencies.gitPort.canonicalizePath(repoConfig.repoPath);
        if (
          normalizePathForComparison(canonicalRepoPath) !==
          normalizePathForComparison(canonicalInputRepoPath)
        ) {
          return yield* Effect.fail(
            new HostValidationError({
              field: "repoPath",
              message: `Repository config resolved to a different repository: ${canonicalRepoPath}`,
              details: { repoPath: canonicalInputRepoPath, configuredRepoPath: canonicalRepoPath },
            }),
          );
        }
        if (!(yield* dependencies.gitPort.isGitRepository(canonicalRepoPath))) {
          return yield* Effect.fail(
            new HostValidationError({
              field: "repoPath",
              message: `Not a git repository: ${canonicalRepoPath}`,
              details: { repoPath: canonicalRepoPath, taskId, role },
            }),
          );
        }
        const worktreeBase = repoConfig.worktreeBasePath
          ? dependencies.settingsConfig.resolveConfiguredPath(repoConfig.worktreeBasePath)
          : dependencies.settingsConfig.defaultWorktreeBasePath(repoConfig.workspaceId);
        const worktreePath = dependencies.settingsConfig.join(worktreeBase, taskId);
        let targetsCanonicalWorktree = !input.targetWorkingDirectory;
        if (input.targetWorkingDirectory) {
          targetsCanonicalWorktree =
            normalizePathForComparison(input.targetWorkingDirectory) ===
            normalizePathForComparison(worktreePath);
          if (!targetsCanonicalWorktree) {
            const [targetExists, worktreeExists] = yield* Effect.all([
              dependencies.settingsConfig.pathExists(input.targetWorkingDirectory),
              dependencies.settingsConfig.pathExists(worktreePath),
            ]);
            if (targetExists && worktreeExists) {
              const [canonicalTargetPath, canonicalWorktreePath] = yield* Effect.all([
                dependencies.gitPort.canonicalizePath(input.targetWorkingDirectory),
                dependencies.gitPort.canonicalizePath(worktreePath),
              ]);
              targetsCanonicalWorktree =
                normalizePathForComparison(canonicalTargetPath) ===
                normalizePathForComparison(canonicalWorktreePath);
            }
          }
        }
        if (!targetsCanonicalWorktree) {
          return yield* Effect.fail(
            new HostValidationError({
              field: "targetWorkingDirectory",
              message: `Fresh ${role} sessions must use canonical task worktree ${worktreePath}.`,
              details: {
                taskId,
                role,
                expected: worktreePath,
                actual: input.targetWorkingDirectory,
              },
            }),
          );
        }

        let cleanup: PreparedTaskWorktree["cleanup"] = () => Effect.succeed("");
        const cleanupFailedPreparation = () => cleanup();
        const prepared = yield* Effect.either(
          Effect.gen(function* () {
            const task = yield* taskStore.getTask({ repoPath: canonicalRepoPath, taskId });
            if (role === "build") {
              yield* validateTaskTransitionEffect(task, [task], task.status, "in_progress");
            } else {
              yield* validateTaskSessionWorkflowAvailable(task, role, canonicalRepoPath);
            }
            const branch = buildBranchName(repoConfig.branchPrefix, taskId, task.title);
            yield* Effect.scoped(
              Effect.gen(function* () {
                yield* coordinator.acquireWorktreeLifecycle([worktreePath]);
                const exists = yield* dependencies.settingsConfig.pathExists(worktreePath);
                if (exists) {
                  if (!(yield* dependencies.gitPort.isGitRepository(worktreePath))) {
                    return yield* Effect.fail(
                      new HostValidationError({
                        field: "taskId",
                        message: `Canonical task worktree path exists but is not a Git worktree: ${worktreePath}`,
                        details: { repoPath: canonicalRepoPath, taskId, role, worktreePath },
                      }),
                    );
                  }
                  yield* validateExistingGitTaskWorktree(
                    dependencies,
                    canonicalRepoPath,
                    worktreePath,
                    taskId,
                    branch,
                  );
                } else {
                  const newWorktree = yield* prepareNewTaskWorktree(
                    dependencies,
                    repoConfig,
                    task,
                    canonicalRepoPath,
                    worktreeBase,
                    worktreePath,
                    branch,
                  );
                  cleanup = () =>
                    Effect.scoped(
                      coordinator
                        .acquireWorktreeLifecycle([worktreePath])
                        .pipe(Effect.zipRight(newWorktree.cleanup())),
                    );
                }
              }),
            );
            yield* dependencies.runtimeRegistry
              .ensureWorkspaceRuntime({
                runtimeKind: descriptor.kind,
                repoPath: canonicalRepoPath,
                workingDirectory: canonicalRepoPath,
                descriptor,
              })
              .pipe(
                Effect.mapError(
                  (cause) =>
                    new HostOperationError({
                      operation: "task.session_start.ensure_runtime",
                      message: `${runtimeKind} ${role} runtime failed to start for task ${taskId}`,
                      cause,
                      details: { repoPath: canonicalRepoPath, taskId, role, runtimeKind },
                    }),
                ),
              );
            return {
              canonicalRepoPath,
              cleanup,
              preparedStatus: task.status,
              role,
              runtimeKind: descriptor.kind,
              task,
              workingDirectory: worktreePath,
            } satisfies PreparedTaskSessionStart;
          }).pipe(
            Effect.onInterrupt(() => cleanupFailedPreparation().pipe(Effect.orDie, Effect.asVoid)),
          ),
        );
        if (prepared._tag === "Right") {
          return prepared.right;
        }
        const cleanupError = yield* cleanupFailedPreparation();
        return yield* Effect.fail(
          new HostOperationError({
            operation: "task.session_start.prepare",
            message: `${errorMessage(prepared.left)}${cleanupError}`,
            cause: prepared.left,
            details: { repoPath: canonicalRepoPath, taskId, role, worktreePath },
          }),
        );
      });
    },
    complete(
      prepared: PreparedTaskSessionStart,
      transitionTask: (
        input: Parameters<TaskStorePort["transitionTask"]>[0],
      ) => Effect.Effect<unknown, TaskServiceError>,
    ) {
      return Effect.gen(function* () {
        const task = yield* taskStore.getTask({
          repoPath: prepared.canonicalRepoPath,
          taskId: prepared.task.id,
        });
        if (prepared.role !== "build") {
          yield* validateTaskSessionWorkflowAvailable(
            task,
            prepared.role,
            prepared.canonicalRepoPath,
          );
          return;
        }
        if (task.status !== prepared.preparedStatus) {
          return yield* Effect.fail(
            new HostOperationError({
              operation: "task.session_start.complete",
              message: `Task ${task.id} changed from ${prepared.preparedStatus} to ${task.status} while Builder startup was in progress.`,
              details: { repoPath: prepared.canonicalRepoPath, taskId: task.id },
            }),
          );
        }
        yield* validateTaskTransitionEffect(task, [task], task.status, "in_progress");
        yield* transitionTask({
          repoPath: prepared.canonicalRepoPath,
          taskId: task.id,
          status: "in_progress",
        });
      });
    },
  };
};

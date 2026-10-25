import { resolveTaskSessionStartTarget } from "./task-session-start-target";
import type { RuntimeKind } from "@openducktor/contracts";
import { Effect } from "effect";
import { normalizePathForComparison } from "../../../domain/path-comparison";
import { buildBranchName } from "../../../domain/task";
import { HostOperationError, HostValidationError } from "../../../effect/host-errors";
import type { GitPort } from "../../../ports/git-port";
import type { RuntimeRegistryPort } from "../../../ports/runtime-registry-port";
import type { SettingsConfigPort } from "../../../ports/settings-config-port";
import type { TaskStorePort, TaskRecord } from "../../../ports/task-repository-ports";
import type { TaskWorkflowResolver } from "../../../ports/task-workflow-port";
import type { WorktreeFilePort } from "../../../ports/worktree-file-port";
import type { WorktreeActionRunner } from "../../actions/worktree-action-runner";
import type { RuntimeDefinitionsService } from "../../runtimes/runtime-definitions-service";
import type { WorkspaceSettingsService } from "../../workspaces/workspace-settings-service";
import {
  requireBuildStartDependencies,
  requireDependencies,
} from "../support/required-task-dependencies";
import { validateTaskSessionWorkflowAvailable } from "../support/task-session-workflow-validation";
import { requireTaskEvent, requireWorkflowRole } from "../support/task-workflow-events";
import { resolveRuntimeDescriptorForTaskSession } from "../support/task-worktree-cleanup";
import { failOperationAfterRollback } from "../support/task-worktree-rollback";
import {
  prepareNewTaskWorktree,
  type PreparedTaskWorktree,
  validateExistingGitTaskWorktree,
} from "../support/task-worktree-start";
import type { TaskServiceError } from "../task-service";
import type { TaskSessionLifecycleCoordinator } from "./task-session-lifecycle-coordinator";

export type PreparedTaskSessionStart = {
  canonicalRepoPath: string;
  rollback: PreparedTaskWorktree["rollback"];
  preparedStatus: string;
  role: string;
  runtimeKind: RuntimeKind;
  task: TaskRecord;
  workingDirectory: string;
};

export type TaskSessionStartPreparationInput = {
  canonicalRepoPath: string;
  taskId: string;
  role: string;
  runtimeKind: string;
  targetWorkingDirectory?: string;
};

export type TaskSessionStartPreparationService = ReturnType<
  typeof createTaskSessionStartPreparationService
>;

export type TaskSessionStartPreparationDependencies = {
  gitPort?: GitPort;
  taskStore: TaskStorePort;
  taskWorkflows: TaskWorkflowResolver;
  settingsConfig?: SettingsConfigPort;
  worktreeActions?: WorktreeActionRunner;
  workspaceSettingsService?: WorkspaceSettingsService;
  runtimeDefinitionsService?: RuntimeDefinitionsService;
  runtimeRegistry?: RuntimeRegistryPort;
  worktreeFiles?: WorktreeFilePort;
  taskSessionLifecycleCoordinator: TaskSessionLifecycleCoordinator;
};

export const createTaskSessionStartPreparationService = ({
  gitPort,
  taskStore,
  taskWorkflows,
  settingsConfig,
  worktreeActions,
  workspaceSettingsService,
  runtimeDefinitionsService,
  runtimeRegistry,
  worktreeFiles,
  taskSessionLifecycleCoordinator,
}: TaskSessionStartPreparationDependencies) => {
  return {
    validateTarget(input: TaskSessionStartPreparationInput): Effect.Effect<void, TaskServiceError> {
      return Effect.gen(function* () {
        const dependencies = yield* requireDependencies(() =>
          requireBuildStartDependencies(
            gitPort,
            runtimeDefinitionsService,
            runtimeRegistry,
            settingsConfig,
            worktreeActions,
            worktreeFiles,
            workspaceSettingsService,
          ),
        );
        const repoConfig = yield* dependencies.workspaceSettingsService.getRepoConfigByRepoPath(
          input.canonicalRepoPath,
        );
        const targetInput: Parameters<typeof resolveTaskSessionStartTarget>[0] = {
          settingsConfig: dependencies.settingsConfig,
          gitPort: dependencies.gitPort,
          repoConfig,
          taskId: input.taskId,
          role: input.role,
        };
        if (input.targetWorkingDirectory)
          targetInput.targetWorkingDirectory = input.targetWorkingDirectory;
        yield* resolveTaskSessionStartTarget(targetInput);
      });
    },
    prepare(
      input: TaskSessionStartPreparationInput,
    ): Effect.Effect<PreparedTaskSessionStart, TaskServiceError> {
      return Effect.gen(function* () {
        const { canonicalRepoPath: canonicalInputRepoPath, runtimeKind, taskId, role } = input;
        const dependencies = yield* requireDependencies(() =>
          requireBuildStartDependencies(
            gitPort,
            runtimeDefinitionsService,
            runtimeRegistry,
            settingsConfig,
            worktreeActions,
            worktreeFiles,
            workspaceSettingsService,
          ),
        );
        const descriptor = yield* resolveRuntimeDescriptorForTaskSession(
          dependencies.runtimeDefinitionsService,
          runtimeKind,
          yield* requireWorkflowRole(taskWorkflows.forRepo(canonicalInputRepoPath), role),
        );
        // Fail before worktree setup when the shared runtime of this kind cannot accept work.
        yield* dependencies.runtimeRegistry.requireReady(descriptor.kind);
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
        const targetInput: Parameters<typeof resolveTaskSessionStartTarget>[0] = {
          settingsConfig: dependencies.settingsConfig,
          gitPort: dependencies.gitPort,
          repoConfig,
          taskId,
          role,
        };
        if (input.targetWorkingDirectory)
          targetInput.targetWorkingDirectory = input.targetWorkingDirectory;
        const { worktreeBase, worktreePath } = yield* resolveTaskSessionStartTarget(targetInput);

        let rollback: PreparedTaskWorktree["rollback"] = () => Effect.void;
        const prepared = yield* Effect.result(
          Effect.gen(function* () {
            const task = yield* taskStore.getTask({ repoPath: canonicalRepoPath, taskId });
            const workflow = taskWorkflows.forRepo(canonicalRepoPath);
            yield* validateTaskSessionWorkflowAvailable(workflow, task, role, canonicalRepoPath);
            const startEvent = workflow.roleStartEvent(role);
            if (startEvent !== undefined) yield* requireTaskEvent(workflow, startEvent, task);
            yield* Effect.scoped(
              Effect.gen(function* () {
                yield* taskSessionLifecycleCoordinator.acquireWorktreeLifecycle([worktreePath]);
                const exists = yield* dependencies.settingsConfig.pathExists(worktreePath);
                if (exists) {
                  yield* validateExistingGitTaskWorktree(
                    dependencies,
                    canonicalRepoPath,
                    worktreePath,
                    taskId,
                  );
                } else {
                  const branch = buildBranchName(repoConfig.branchPrefix, taskId, task.title);
                  const newWorktree = yield* prepareNewTaskWorktree(
                    dependencies,
                    repoConfig,
                    task,
                    canonicalRepoPath,
                    worktreeBase,
                    worktreePath,
                    branch,
                  );
                  rollback = () =>
                    Effect.scoped(
                      taskSessionLifecycleCoordinator
                        .acquireWorktreeLifecycle([worktreePath])
                        .pipe(Effect.andThen(newWorktree.rollback())),
                    );
                }
              }),
            );
            return {
              canonicalRepoPath,
              rollback,
              preparedStatus: task.status,
              role,
              runtimeKind: descriptor.kind,
              task,
              workingDirectory: worktreePath,
            } satisfies PreparedTaskSessionStart;
          }).pipe(Effect.onInterrupt(() => rollback().pipe(Effect.orDie))),
        );
        if (prepared._tag === "Success") {
          return prepared.success;
        }
        return yield* failOperationAfterRollback(rollback(), prepared.failure, {
          operation: "task.session_start.prepare",
          details: { repoPath: canonicalRepoPath, taskId, role, worktreePath },
        });
      });
    },
    complete(
      prepared: PreparedTaskSessionStart,
      /** Commits the start event inside the task mutation that publishes it. */
      applyStartEvent: (input: {
        repoPath: string;
        taskId: string;
        eventId: string;
      }) => Effect.Effect<unknown, TaskServiceError>,
    ) {
      return Effect.gen(function* () {
        const task = yield* taskStore.getTask({
          repoPath: prepared.canonicalRepoPath,
          taskId: prepared.task.id,
        });
        const workflow = taskWorkflows.forRepo(prepared.canonicalRepoPath);
        const startEvent = workflow.roleStartEvent(prepared.role);
        if (startEvent === undefined) {
          yield* validateTaskSessionWorkflowAvailable(
            workflow,
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
              message: `Task ${task.id} changed from ${prepared.preparedStatus} to ${task.status} while ${workflow.role(prepared.role).label} startup was in progress.`,
              details: { repoPath: prepared.canonicalRepoPath, taskId: task.id },
            }),
          );
        }
        const decision = yield* requireTaskEvent(workflow, startEvent, task);
        if (decision.kind === "transition") {
          yield* applyStartEvent({
            repoPath: prepared.canonicalRepoPath,
            taskId: task.id,
            eventId: startEvent,
          });
        }
      });
    },
  };
};

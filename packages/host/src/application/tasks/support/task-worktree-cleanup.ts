import { backgroundStep } from "../../operation-progress/background-operation-progress";
import { getScopedRepoConfig } from "../../workspaces/scoped-repo-config";
import type { TaskWorkflowRole } from "@openducktor/workflows";
import { Effect } from "effect";
import { canonicalPathsEqual } from "../../../domain/path-comparison";
import { HostDependencyError, HostValidationError } from "../../../effect/host-errors";
import type { GitPort } from "../../../ports/git-port";
import type { SettingsConfigPort } from "../../../ports/settings-config-port";
import type { SystemCommandPort } from "../../../ports/system-command-port";
import type { TaskActivityGuardPort } from "../../../ports/task-activity-guard-port";
import type { TaskStorePort } from "../../../ports/task-repository-ports";
import type { WorktreeFilePort } from "../../../ports/worktree-file-port";
import { requireWorktreeFiles } from "../../git/git-service-inputs";
import type { RuntimeDefinitionsService } from "../../runtimes/runtime-definitions-service";
import type { WorkspaceSettingsService } from "../../workspaces/workspace-settings-service";
import type { TaskTerminalCleanupPort } from "../task-service";
import type { TaskSessionLifecycleCoordinator } from "../worktrees/task-session-lifecycle-coordinator";
import type { TaskWorktreeService } from "../worktrees/task-worktree-service";
import { loadRemoveWorktreeOnClose } from "./task-workflow-helpers";
import { createTaskCleanupProgressState } from "./task-cleanup-progress";
import { removeTaskWorktree, runTaskRuntimeCleanup } from "./task-cleanup-support";
import type { TaskWorktreeOwnerReader } from "../../../ports/task-worktree-owner-port";
import { acquireRemovableWorktrees } from "./task-worktree-owner-guard";

const canonicalPathPlatform = process.platform === "win32" ? "windows" : "posix";
export const findLatestCleanupTarget = (
  dependencies: {
    gitPort: GitPort;
    settingsConfig: SettingsConfigPort;
    taskWorktreeService: TaskWorktreeService;
  },
  taskStore: TaskStorePort,
  repoPath: string,
  taskId: string,
  preferredSourceBranch: string,
  workspaceId: string,
) =>
  Effect.gen(function* () {
    const taskWorktree = yield* dependencies.taskWorktreeService.getTaskWorktree({
      workspaceId,
      repoPath,
      taskId,
    });
    const metadata = yield* taskStore.getTaskMetadata({ workspaceId, repoPath, taskId });
    // Every agent session of the task runs in a task worktree, so each one is a candidate.
    const sessions = [...metadata.agentSessions].sort((left, right) => {
      const startedAtComparison = Date.parse(right.startedAt) - Date.parse(left.startedAt);
      return startedAtComparison === 0
        ? right.workingDirectory.localeCompare(left.workingDirectory)
        : startedAtComparison;
    });
    const candidates = taskWorktree ? [taskWorktree, ...sessions] : sessions;
    for (const candidate of candidates) {
      const workingDirectory = candidate.workingDirectory.trim();
      if (
        !workingDirectory ||
        canonicalPathsEqual(workingDirectory, repoPath, canonicalPathPlatform)
      ) {
        continue;
      }
      if (!(yield* dependencies.settingsConfig.pathExists(workingDirectory))) {
        return workingDirectory;
      }
      const currentBranch = yield* dependencies.gitPort.getCurrentBranch(workingDirectory);
      const branchName = currentBranch.name?.trim();
      if (!branchName) {
        continue;
      }
      if (branchName !== preferredSourceBranch.trim()) {
        continue;
      }
      return workingDirectory;
    }
    return undefined;
  });
type MergedTaskCleanupServices = {
  gitPort: GitPort;
  settingsConfig: SettingsConfigPort;
  systemCommands: SystemCommandPort | undefined;
  taskActivityGuard?: TaskActivityGuardPort | undefined;
  taskSessionLifecycleCoordinator: TaskSessionLifecycleCoordinator;
  taskWorktreeService: TaskWorktreeService;
  terminalService: TaskTerminalCleanupPort;
  workspaceSettingsService: WorkspaceSettingsService;
  worktreeFiles?: WorktreeFilePort;
  worktreeOwners: TaskWorktreeOwnerReader | undefined;
};
/**
 * A live session keeps its working directory, so a later runtime read of a removed worktree
 * reports a fault that blocks task cleanup. Close Task, Reset Task, and Delete release the task
 * sessions before they remove the worktree. A merged task does the same.
 */
export const releaseMergedTaskSessions = (
  dependencies: {
    gitPort: GitPort;
    taskActivityGuard?: TaskActivityGuardPort | undefined;
  },
  taskStore: Pick<TaskStorePort, "getTaskMetadata">,
  repoPath: string,
  taskId: string,
  workspaceId: string,
) =>
  Effect.gen(function* () {
    const metadata = yield* taskStore.getTaskMetadata({ workspaceId, repoPath, taskId });
    // Every session of the task, also of a role that the task version no longer binds.
    const workflowSessions = metadata.agentSessions;
    if (workflowSessions.length === 0) {
      return;
    }
    if (!dependencies.taskActivityGuard) {
      return yield* new HostDependencyError({
        dependency: "taskActivityGuard",
        operation: "merged task cleanup",
        message:
          "Merged task cleanup requires runtime session activity checks for tasks with workflow role sessions.",
        details: { repoPath, taskId },
      });
    }
    yield* backgroundStep(
      { id: "sessions", label: "Stop task sessions" },
      dependencies.taskActivityGuard.cleanupTaskSessions({
        workspaceId,
        repoPath: yield* dependencies.gitPort.canonicalizePath(repoPath),
        taskSessions: [{ taskId, sessions: workflowSessions }],
      }),
    );
  });
/**
 * Stops task terminals and releases saved sessions when a merge close runs without Git cleanup.
 */
export const cleanupKeptTaskWorktree = (
  dependencies: Parameters<typeof releaseMergedTaskSessions>[0] & {
    terminalService: TaskTerminalCleanupPort;
  },
  taskStore: Pick<TaskStorePort, "getTaskMetadata">,
  repoPath: string,
  taskId: string,
  workspaceId: string,
  progress = createTaskCleanupProgressState(),
) =>
  Effect.gen(function* () {
    yield* runTaskRuntimeCleanup({
      workspaceId,
      progress,
      repoPath,
      taskIds: [taskId],
      terminalService: dependencies.terminalService,
    });
    yield* releaseMergedTaskSessions(dependencies, taskStore, repoPath, taskId, workspaceId);
  });

/**
 * The cleanup of a pull request sync that closes a merged task. No user confirms it, so it follows
 * the task value, else the global setting. It removes only the task worktree that has the source
 * branch checked out, and that branch. A dirty worktree fails the close. A confirmed merge close
 * uses `cleanupConfirmedMergeClose` instead.
 */
export const cleanupMergedTaskState = (
  dependencies: MergedTaskCleanupServices,
  taskStore: TaskStorePort,
  repoPath: string,
  taskId: string,
  sourceBranch: string,
  targetBranch: string,
  removeWorktreeOnClose: boolean | null,
  workspaceId: string,
) =>
  Effect.gen(function* () {
    const removeWorktree =
      removeWorktreeOnClose ?? (yield* loadRemoveWorktreeOnClose(dependencies.settingsConfig));
    if (!removeWorktree) {
      return yield* cleanupKeptTaskWorktree(dependencies, taskStore, repoPath, taskId, workspaceId);
    }
    const cleanupTarget = yield* findLatestCleanupTarget(
      dependencies,
      taskStore,
      repoPath,
      taskId,
      sourceBranch,
      workspaceId,
    );
    // Runtime reads of the worktree wait until the cleanup ends, so none restores a released
    // session. No user confirms this close, so the owner check also blocks on native history.
    const [checkedTarget] = yield* acquireRemovableWorktrees(
      {
        lifecycle: dependencies.taskSessionLifecycleCoordinator,
        worktreeOwners: dependencies.worktreeOwners,
      },
      {
        workspaceId,
        repoPath,
        taskId,
        operationLabel: "close",
        lockedPaths: cleanupTarget ? [cleanupTarget] : [],
        confirmed: false,
      },
    );
    yield* runTaskRuntimeCleanup({
      workspaceId,
      progress: createTaskCleanupProgressState(),
      repoPath,
      taskIds: [taskId],
      terminalService: dependencies.terminalService,
    });
    yield* releaseMergedTaskSessions(dependencies, taskStore, repoPath, taskId, workspaceId);
    if (checkedTarget && (yield* dependencies.settingsConfig.pathExists(checkedTarget))) {
      const worktreeFiles = yield* requireWorktreeFiles(dependencies.worktreeFiles);
      const canonicalCleanupTarget = yield* dependencies.gitPort.canonicalizePath(checkedTarget);
      const canonicalRepoPath = yield* dependencies.gitPort.canonicalizePath(repoPath);
      if (!canonicalPathsEqual(canonicalCleanupTarget, canonicalRepoPath, canonicalPathPlatform)) {
        const repoConfig = yield* getScopedRepoConfig(dependencies.workspaceSettingsService, {
          workspaceId,
          repoPath,
        });
        yield* removeTaskWorktree(
          {
            beforeWorktreeRemoval: {
              commands: repoConfig.hooks.beforeWorktreeRemoval,
              systemCommands: dependencies.systemCommands,
            },
            gitPort: dependencies.gitPort,
            settingsConfig: dependencies.settingsConfig,
            worktreeFiles,
          },
          {
            force: false,
            missingOutsideManagedRootPathPolicy: "fail",
            repoPath,
            worktreePath: checkedTarget,
          },
        );
      }
    }
    const sourceBranchExists = (yield* dependencies.gitPort.listBranches(repoPath)).some(
      (branch) => !branch.isRemote && branch.name === sourceBranch,
    );
    if (!sourceBranchExists) {
      return;
    }
    const forceDelete = !(yield* dependencies.gitPort.isAncestor(
      repoPath,
      sourceBranch,
      targetBranch,
    ));
    yield* dependencies.gitPort.deleteLocalBranch(repoPath, sourceBranch, forceDelete);
  });
export const resolveRuntimeDescriptorForTaskSession = (
  runtimeDefinitionsService: RuntimeDefinitionsService,
  runtimeKind: string,
  workflowRole: TaskWorkflowRole,
) =>
  Effect.gen(function* () {
    const role = workflowRole.id;
    const descriptor = runtimeDefinitionsService
      .listRuntimeDefinitions()
      .find((definition) => definition.kind === runtimeKind);
    if (!descriptor) {
      return yield* Effect.fail(
        new HostValidationError({
          field: "runtimeKind",
          message: `Unsupported runtime kind: ${runtimeKind}`,
          details: { runtimeKind, role },
        }),
      );
    }
    if (!descriptor.capabilities.workflow.supportsOdtWorkflowTools) {
      return yield* Effect.fail(
        new HostValidationError({
          field: "runtimeKind",
          message: `${runtimeKind} runtime does not support OpenDucktor workflow tools.`,
          details: { runtimeKind, role },
        }),
      );
    }
    const requiredScopes = workflowRole.runtimeScopes;
    const supportedScopes = descriptor.capabilities.workflow.supportedScopes;
    const missingScopes = requiredScopes.filter((scope) => !supportedScopes.includes(scope));
    if (missingScopes.length > 0) {
      return yield* Effect.fail(
        new HostValidationError({
          field: "runtimeKind",
          message: `${runtimeKind} runtime is missing required workflow scopes for ${role}: ${missingScopes.join(", ")}`,
          details: { runtimeKind, role, missingScopes },
        }),
      );
    }
    return descriptor;
  });

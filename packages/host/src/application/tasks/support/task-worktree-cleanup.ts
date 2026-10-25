import type {
  AgentRole,
  AgentSessionRecord,
  DirectMergeRecord,
  GitTargetBranch,
  TaskCard,
} from "@openducktor/contracts";
import { runtimeRequiredScopesByRole } from "@openducktor/contracts";
import { Effect } from "effect";
import { canonicalPathsEqual } from "../../../domain/path-comparison";
import { canonicalTargetBranch, checkoutBranch } from "../../../domain/task";
import { HostDependencyError, HostValidationError } from "../../../effect/host-errors";
import type { GitPort, GitPortError } from "../../../ports/git-port";
import type { SettingsConfigPort } from "../../../ports/settings-config-port";
import type { TaskActivityGuardPort } from "../../../ports/task-activity-guard-port";
import type { TaskStorePort } from "../../../ports/task-repository-ports";
import type { WorktreeFilePort } from "../../../ports/worktree-file-port";
import { requireWorktreeFiles } from "../../git/git-service-inputs";
import { removeWorktreeAndFilesystemPath } from "../../git/worktree-removal";
import type { RuntimeDefinitionsService } from "../../runtimes/runtime-definitions-service";
import type {
  WorkspaceSettingsError,
  WorkspaceSettingsService,
} from "../../workspaces/workspace-settings-service";
import type { TaskTerminalCleanupPort } from "../task-service";
import type { TaskSessionLifecycleCoordinator } from "../worktrees/task-session-lifecycle-coordinator";
import type {
  TaskWorktreeService,
  TaskWorktreeServiceError,
} from "../worktrees/task-worktree-service";
import type { requireBuildStartDependencies } from "./required-task-dependencies";
import { createTaskCleanupProgressState } from "./task-cleanup-progress";
import { runTaskRuntimeCleanup, selectWorkflowCleanupSessionRecords } from "./task-cleanup-support";

type TaskWorktreeCleanupError =
  | GitPortError
  | HostValidationError
  | TaskWorktreeServiceError
  | WorkspaceSettingsError;
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
) =>
  Effect.gen(function* () {
    const candidates: Array<{
      workingDirectory: string;
      startedAt: string;
    }> = [];
    const taskWorktree = yield* dependencies.taskWorktreeService.getTaskWorktree({
      repoPath,
      taskId,
    });
    if (taskWorktree) {
      candidates.push({
        workingDirectory: taskWorktree.workingDirectory,
        startedAt: "\uffff",
      });
    }
    const metadata = yield* taskStore.getTaskMetadata({ repoPath, taskId });
    candidates.push(
      ...metadata.agentSessions
        .filter((session) => session.role.trim() === "build")
        .map((session) => ({
          workingDirectory: session.workingDirectory,
          startedAt: session.startedAt,
        })),
    );
    candidates.sort((left, right) => {
      const startedAtComparison = right.startedAt.localeCompare(left.startedAt);
      return startedAtComparison === 0
        ? right.workingDirectory.localeCompare(left.workingDirectory)
        : startedAtComparison;
    });
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
  taskActivityGuard?: TaskActivityGuardPort | undefined;
  taskSessionLifecycleCoordinator: TaskSessionLifecycleCoordinator;
  taskWorktreeService: TaskWorktreeService;
  terminalService: TaskTerminalCleanupPort;
  worktreeFiles?: WorktreeFilePort;
};
/**
 * A live session keeps its working directory, so a later runtime read of a removed worktree
 * reports a fault that blocks task cleanup. Close Task, Reset Task, and Delete release the task
 * sessions before they remove the worktree. A merged task does the same.
 */
const releaseMergedTaskSessions = (
  taskActivityGuard: TaskActivityGuardPort | undefined,
  repoPath: string,
  taskId: string,
  sessions: AgentSessionRecord[],
) =>
  Effect.gen(function* () {
    const workflowSessions = selectWorkflowCleanupSessionRecords(sessions);
    if (workflowSessions.length === 0) {
      return;
    }
    if (!taskActivityGuard) {
      return yield* new HostDependencyError({
        dependency: "taskActivityGuard",
        operation: "merged task cleanup",
        message:
          "Merged task cleanup requires runtime session activity checks for tasks with spec, planner, build, or QA sessions.",
        details: { repoPath, taskId },
      });
    }
    yield* taskActivityGuard.cleanupTaskSessions({
      repoPath,
      taskSessions: [{ taskId, sessions: workflowSessions }],
    });
  });
export const cleanupMergedTaskState = (
  dependencies: MergedTaskCleanupServices,
  taskStore: TaskStorePort,
  repoPath: string,
  taskId: string,
  sourceBranch: string,
  targetBranch: string,
  onDeleting?: (branch: { name: string; oid: string }) => void,
) =>
  Effect.gen(function* () {
    yield* runTaskRuntimeCleanup({
      progress: createTaskCleanupProgressState(),
      repoPath,
      taskIds: [taskId],
      terminalService: dependencies.terminalService,
    });
    const cleanupTarget = yield* findLatestCleanupTarget(
      dependencies,
      taskStore,
      repoPath,
      taskId,
      sourceBranch,
    );
    // Runtime reads of the worktree wait until the cleanup ends, so none restores a released session.
    if (cleanupTarget) {
      yield* dependencies.taskSessionLifecycleCoordinator.acquireWorktreeLifecycle([cleanupTarget]);
    }
    const canonicalRepoPath = yield* dependencies.gitPort.canonicalizePath(repoPath);
    const metadata = yield* taskStore.getTaskMetadata({ repoPath, taskId });
    yield* releaseMergedTaskSessions(
      dependencies.taskActivityGuard,
      canonicalRepoPath,
      taskId,
      metadata.agentSessions,
    );
    if (cleanupTarget && (yield* dependencies.settingsConfig.pathExists(cleanupTarget))) {
      const worktreeFiles = yield* requireWorktreeFiles(dependencies.worktreeFiles);
      const canonicalCleanupTarget = yield* dependencies.gitPort.canonicalizePath(cleanupTarget);
      if (!canonicalPathsEqual(canonicalCleanupTarget, canonicalRepoPath, canonicalPathPlatform)) {
        yield* removeWorktreeAndFilesystemPath(
          {
            gitPort: dependencies.gitPort,
            settingsConfig: dependencies.settingsConfig,
            worktreeFiles,
          },
          {
            force: false,
            missingOutsideManagedRootPathPolicy: "fail",
            repoPath,
            worktreePath: cleanupTarget,
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
    yield* dependencies.gitPort.deleteLocalBranch(repoPath, sourceBranch, forceDelete, onDeleting);
  });
export const cleanupDirectMergeTaskState = (
  dependencies: MergedTaskCleanupServices,
  taskStore: TaskStorePort,
  repoPath: string,
  taskId: string,
  directMerge: DirectMergeRecord,
  onDeleting?: (branch: { name: string; oid: string }) => void,
) =>
  cleanupMergedTaskState(
    dependencies,
    taskStore,
    repoPath,
    taskId,
    directMerge.sourceBranch.trim(),
    checkoutBranch(directMerge.targetBranch),
    onDeleting,
  );
export const effectiveTargetBranchForTask = (
  workspaceSettingsService: WorkspaceSettingsService,
  task: TaskCard,
  repoPath: string,
) =>
  Effect.gen(function* () {
    if (task.targetBranchError) {
      return yield* Effect.fail(
        new HostValidationError({
          field: "targetBranch",
          message: task.targetBranchError,
          details: { repoPath, taskId: task.id },
        }),
      );
    }
    if (task.targetBranch) {
      return task.targetBranch;
    }
    const repoConfig = yield* workspaceSettingsService.getRepoConfigByRepoPath(repoPath);
    return repoConfig.defaultTargetBranch;
  });
export const resolveBuildStartPoint = (
  dependencies: Pick<ReturnType<typeof requireBuildStartDependencies>, "gitPort">,
  repoPath: string,
  targetBranch: GitTargetBranch,
  allowLocalBranchFallback: boolean,
): Effect.Effect<
  {
    reference: string;
    upstreamRemote: string | null;
  },
  GitPortError | HostValidationError
> =>
  Effect.gen(function* () {
    const configuredTargetBranch = yield* Effect.try({
      try: () => canonicalTargetBranch(targetBranch),
      catch: (cause) =>
        new HostValidationError({
          message: cause instanceof Error ? cause.message : String(cause),
          cause,
        }),
    });
    if (yield* dependencies.gitPort.referenceExists(repoPath, configuredTargetBranch)) {
      return {
        reference: configuredTargetBranch,
        upstreamRemote: targetBranch.remote?.trim() || null,
      };
    }
    if (allowLocalBranchFallback && targetBranch.remote?.trim() === "origin") {
      const localBranch = checkoutBranch(targetBranch);
      if (yield* dependencies.gitPort.referenceExists(repoPath, localBranch)) {
        return { reference: localBranch, upstreamRemote: null };
      }
    }
    return yield* Effect.fail(
      new HostValidationError({
        field: "targetBranch",
        message: `Target branch ${configuredTargetBranch} does not exist in this repository. Choose an existing target branch, or fetch this branch first.`,
        details: { repoPath, targetBranch: configuredTargetBranch },
      }),
    );
  });
export const resolveRuntimeDescriptorForTaskSession = (
  runtimeDefinitionsService: RuntimeDefinitionsService,
  runtimeKind: string,
  role: AgentRole,
) =>
  Effect.gen(function* () {
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
    const requiredScopes = runtimeRequiredScopesByRole[role];
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
export const loadTaskBranchCleanup = (
  dependencies: {
    gitPort: GitPort;
    taskWorktreeService: TaskWorktreeService;
    workspaceSettingsService: WorkspaceSettingsService;
  },
  task: TaskCard,
  repoPath: string,
  taskId: string,
  operationLabel: string,
): Effect.Effect<
  {
    sourceBranch: string;
    targetBranch: string;
  },
  TaskWorktreeCleanupError
> =>
  Effect.gen(function* () {
    const taskWorktree = yield* dependencies.taskWorktreeService.getTaskWorktree({
      repoPath,
      taskId,
    });
    if (!taskWorktree) {
      return yield* Effect.fail(
        new HostValidationError({
          field: "taskId",
          message: `${operationLabel} requires a task worktree for task ${taskId}. Start Builder first.`,
          details: { repoPath, taskId },
        }),
      );
    }
    const currentBranch = yield* dependencies.gitPort.getCurrentBranch(
      taskWorktree.workingDirectory,
    );
    if (currentBranch.detached) {
      return yield* Effect.fail(
        new HostValidationError({
          field: "workingDirectory",
          message: `${operationLabel} requires a task branch, but the task worktree is detached.`,
          details: { workingDirectory: taskWorktree.workingDirectory },
        }),
      );
    }
    const sourceBranch = currentBranch.name?.trim();
    if (!sourceBranch) {
      return yield* Effect.fail(
        new HostValidationError({
          field: "workingDirectory",
          message: `${operationLabel} requires a task branch name.`,
          details: { workingDirectory: taskWorktree.workingDirectory },
        }),
      );
    }
    const targetBranch = yield* effectiveTargetBranchForTask(
      dependencies.workspaceSettingsService,
      task,
      repoPath,
    );
    const checkoutTarget = yield* Effect.try({
      try: () => checkoutBranch(targetBranch),
      catch: (cause) =>
        new HostValidationError({
          message: cause instanceof Error ? cause.message : String(cause),
          cause,
        }),
    });
    return { sourceBranch, targetBranch: checkoutTarget };
  });
export const canSkipRelinkedPullRequestCleanup = (message: string): boolean =>
  message.includes("requires a task worktree for task") ||
  message.includes("the task worktree is detached") ||
  message.includes("requires a task branch name");

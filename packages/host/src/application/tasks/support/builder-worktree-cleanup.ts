import type {
  AgentRole,
  DirectMergeRecord,
  GitTargetBranch,
  TaskCard,
} from "@openducktor/contracts";
import { runtimeRequiredScopesByRole } from "@openducktor/contracts";
import { Effect } from "effect";
import { normalizePathForComparison } from "../../../domain/path-comparison";
import { canonicalTargetBranch, checkoutBranch } from "../../../domain/task";
import { errorMessage, HostValidationError } from "../../../effect/host-errors";
import type { GitPort, GitPortError } from "../../../ports/git-port";
import type { SettingsConfigPort } from "../../../ports/settings-config-port";
import type { TaskStorePort } from "../../../ports/task-repository-ports";
import type { DevServerService } from "../../dev-servers/dev-server-service";
import { removeWorktreeAndFilesystemPath } from "../../git/worktree-removal";
import type { RuntimeDefinitionsService } from "../../runtimes/runtime-definitions-service";
import type {
  WorkspaceSettingsError,
  WorkspaceSettingsService,
} from "../../workspaces/workspace-settings-service";
import type { TaskTerminalCleanupPort } from "../task-service";
import type {
  TaskWorktreeService,
  TaskWorktreeServiceError,
} from "../worktrees/task-worktree-service";
import type { requireBuildStartDependencies } from "./required-task-dependencies";

type BuildWorktreeCleanupError =
  | GitPortError
  | HostValidationError
  | TaskWorktreeServiceError
  | WorkspaceSettingsError;
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
      if (!workingDirectory) {
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
export const cleanupMergedBuilderState = (
  dependencies: {
    devServerService: DevServerService;
    gitPort: GitPort;
    settingsConfig: SettingsConfigPort;
    taskWorktreeService: TaskWorktreeService;
    terminalService: TaskTerminalCleanupPort;
  },
  taskStore: TaskStorePort,
  repoPath: string,
  taskId: string,
  sourceBranch: string,
  targetBranch: string,
) =>
  Effect.scoped(
    Effect.gen(function* () {
      yield* dependencies.terminalService.acquireTaskCleanup({ repoPath, taskIds: [taskId] });
      yield* dependencies.devServerService.stop({ repoPath, taskId });
      const cleanupTarget = yield* findLatestCleanupTarget(
        dependencies,
        taskStore,
        repoPath,
        taskId,
        sourceBranch,
      );
      if (
        cleanupTarget &&
        normalizePathForComparison(cleanupTarget) !== normalizePathForComparison(repoPath) &&
        (yield* dependencies.settingsConfig.pathExists(cleanupTarget))
      ) {
        yield* dependencies.gitPort.removeWorktree(repoPath, cleanupTarget, false);
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
    }),
  );
export const cleanupDirectMergeBuilderState = (
  dependencies: {
    devServerService: DevServerService;
    gitPort: GitPort;
    settingsConfig: SettingsConfigPort;
    taskWorktreeService: TaskWorktreeService;
    terminalService: TaskTerminalCleanupPort;
  },
  taskStore: TaskStorePort,
  repoPath: string,
  taskId: string,
  directMerge: DirectMergeRecord,
) =>
  cleanupMergedBuilderState(
    dependencies,
    taskStore,
    repoPath,
    taskId,
    directMerge.sourceBranch.trim(),
    checkoutBranch(directMerge.targetBranch),
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
        message: `Configured target branch is unavailable for build worktree creation: ${configuredTargetBranch}`,
        details: { repoPath, targetBranch: configuredTargetBranch },
      }),
    );
  });
export const rollbackFailedBuildWorktree = (
  dependencies: ReturnType<typeof requireBuildStartDependencies>,
  repoPath: string,
  worktreePath: string,
  branch: string,
  createdTrackingRef: string | null,
) =>
  Effect.gen(function* () {
    const cleanupErrors: string[] = [];
    if (createdTrackingRef) {
      const deleteReferenceResult = yield* Effect.either(
        dependencies.gitPort.deleteReference(repoPath, createdTrackingRef),
      );
      if (deleteReferenceResult._tag === "Left") {
        cleanupErrors.push(
          `Also failed to delete created upstream tracking ref ${createdTrackingRef}: ${errorMessage(deleteReferenceResult.left)}`,
        );
      }
    }
    const removeWorktreeResult = yield* Effect.either(
      removeWorktreeAndFilesystemPath(
        {
          gitPort: dependencies.gitPort,
          settingsConfig: dependencies.settingsConfig,
          worktreeFiles: dependencies.worktreeFiles,
        },
        {
          repoPath,
          worktreePath,
          force: true,
          missingOutsideManagedRootPathPolicy: "fail",
        },
      ),
    );
    if (removeWorktreeResult._tag === "Left") {
      cleanupErrors.push(
        `Also failed to remove worktree ${worktreePath}: ${errorMessage(removeWorktreeResult.left)}`,
      );
    }
    const deleteBranchResult = yield* Effect.either(
      dependencies.gitPort.deleteLocalBranch(repoPath, branch, true),
    );
    if (deleteBranchResult._tag === "Left") {
      cleanupErrors.push(
        `Also failed to delete branch ${branch}: ${errorMessage(deleteBranchResult.left)}`,
      );
    }
    return cleanupErrors.length === 0 ? "" : `\n${cleanupErrors.join("\n")}`;
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
export const loadBuilderBranchCleanup = (
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
  BuildWorktreeCleanupError
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
          message: `${operationLabel} requires a builder worktree for task ${taskId}. Start Builder first.`,
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
          message: `${operationLabel} requires a builder branch, but the builder worktree is detached.`,
          details: { workingDirectory: taskWorktree.workingDirectory },
        }),
      );
    }
    const sourceBranch = currentBranch.name?.trim();
    if (!sourceBranch) {
      return yield* Effect.fail(
        new HostValidationError({
          field: "workingDirectory",
          message: `${operationLabel} requires a builder branch name.`,
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
  message.includes("requires a builder worktree for task") ||
  message.includes("the builder worktree is detached") ||
  message.includes("requires a builder branch name");

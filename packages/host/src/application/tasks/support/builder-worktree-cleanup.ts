import type { DirectMergeRecord, GitTargetBranch, TaskCard } from "@openducktor/contracts";
import { canonicalTargetBranch, checkoutBranch } from "../../../domain/task";
import type { GitPort } from "../../../ports/git-port";
import type { SettingsConfigPort } from "../../../ports/settings-config-port";
import type { TaskStorePort } from "../../../ports/task-repository-ports";
import type { DevServerService } from "../../dev-servers/dev-server-service";
import { removeWorktreeAndFilesystemPath } from "../../git/worktree-removal";
import type { RuntimeDefinitionsService } from "../../runtimes/runtime-definitions-service";
import type { WorkspaceSettingsService } from "../../workspaces/workspace-settings-service";
import type { TaskWorktreeService } from "../worktrees/task-worktree-service";
import type { requireBuildStartDependencies } from "./required-task-dependencies";

export const normalizePathForComparison = (value: string): string => {
  const absolute = value.trim().replace(/\\/g, "/");
  const segments: string[] = [];
  for (const segment of absolute.split("/")) {
    if (!segment || segment === ".") {
      continue;
    }
    if (segment === "..") {
      segments.pop();
      continue;
    }
    segments.push(segment);
  }

  return absolute.startsWith("/") ? `/${segments.join("/")}` : segments.join("/");
};

export const findLatestCleanupTarget = async (
  dependencies: {
    gitPort: GitPort;
    settingsConfig: SettingsConfigPort;
    taskWorktreeService: TaskWorktreeService;
  },
  taskStore: TaskStorePort,
  repoPath: string,
  taskId: string,
  preferredSourceBranch: string,
): Promise<string | undefined> => {
  const candidates: Array<{
    workingDirectory: string;
    startedAt: string;
    externalSessionId: string;
  }> = [];
  const taskWorktree = await dependencies.taskWorktreeService.getTaskWorktree({ repoPath, taskId });
  if (taskWorktree) {
    candidates.push({
      workingDirectory: taskWorktree.workingDirectory,
      startedAt: "\uffff",
      externalSessionId: "task-worktree",
    });
  }

  const tasks = await taskStore.listTasks({ repoPath });
  const task = tasks.find((entry) => entry.id === taskId);
  if (!task) {
    throw new Error(`Task not found: ${taskId}`);
  }
  candidates.push(
    ...(task.agentSessions ?? [])
      .filter((session) => session.role.trim() === "build")
      .map((session) => ({
        workingDirectory: session.workingDirectory,
        startedAt: session.startedAt,
        externalSessionId: session.externalSessionId,
      })),
  );
  candidates.sort((left, right) => {
    const startedAtComparison = right.startedAt.localeCompare(left.startedAt);
    return startedAtComparison === 0
      ? right.externalSessionId.localeCompare(left.externalSessionId)
      : startedAtComparison;
  });

  for (const candidate of candidates) {
    const workingDirectory = candidate.workingDirectory.trim();
    if (!workingDirectory) {
      continue;
    }
    if (!(await dependencies.settingsConfig.pathExists(workingDirectory))) {
      return workingDirectory;
    }
    const currentBranch = await dependencies.gitPort.getCurrentBranch(workingDirectory);
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
};

export const cleanupMergedBuilderState = async (
  dependencies: {
    devServerService: DevServerService;
    gitPort: GitPort;
    settingsConfig: SettingsConfigPort;
    taskWorktreeService: TaskWorktreeService;
  },
  taskStore: TaskStorePort,
  repoPath: string,
  taskId: string,
  sourceBranch: string,
  targetBranch: string,
): Promise<void> => {
  await dependencies.devServerService.stop({ repoPath, taskId });

  const cleanupTarget = await findLatestCleanupTarget(
    dependencies,
    taskStore,
    repoPath,
    taskId,
    sourceBranch,
  );
  if (
    cleanupTarget &&
    normalizePathForComparison(cleanupTarget) !== normalizePathForComparison(repoPath) &&
    (await dependencies.settingsConfig.pathExists(cleanupTarget))
  ) {
    await dependencies.gitPort.removeWorktree(repoPath, cleanupTarget, false);
  }

  const sourceBranchExists = (await dependencies.gitPort.listBranches(repoPath)).some(
    (branch) => !branch.isRemote && branch.name === sourceBranch,
  );
  if (!sourceBranchExists) {
    return;
  }

  const forceDelete = !(await dependencies.gitPort.isAncestor(
    repoPath,
    sourceBranch,
    targetBranch,
  ));
  await dependencies.gitPort.deleteLocalBranch(repoPath, sourceBranch, forceDelete);
};

export const cleanupDirectMergeBuilderState = async (
  dependencies: {
    devServerService: DevServerService;
    gitPort: GitPort;
    settingsConfig: SettingsConfigPort;
    taskWorktreeService: TaskWorktreeService;
  },
  taskStore: TaskStorePort,
  repoPath: string,
  taskId: string,
  directMerge: DirectMergeRecord,
): Promise<void> =>
  cleanupMergedBuilderState(
    dependencies,
    taskStore,
    repoPath,
    taskId,
    directMerge.sourceBranch.trim(),
    checkoutBranch(directMerge.targetBranch),
  );

export const effectiveTargetBranchForTask = async (
  workspaceSettingsService: WorkspaceSettingsService,
  task: TaskCard,
  repoPath: string,
): Promise<GitTargetBranch> => {
  if (task.targetBranchError) {
    throw new Error(task.targetBranchError);
  }
  if (task.targetBranch) {
    return task.targetBranch;
  }

  const repoConfig = await workspaceSettingsService.getRepoConfigByRepoPath(repoPath);
  return repoConfig.defaultTargetBranch;
};

export const resolveBuildStartPoint = async (
  dependencies: ReturnType<typeof requireBuildStartDependencies>,
  repoPath: string,
  targetBranch: GitTargetBranch,
  allowLocalBranchFallback: boolean,
): Promise<{ reference: string; upstreamRemote: string | null }> => {
  const configuredTargetBranch = canonicalTargetBranch(targetBranch);
  if (await dependencies.gitPort.referenceExists(repoPath, configuredTargetBranch)) {
    return {
      reference: configuredTargetBranch,
      upstreamRemote: targetBranch.remote?.trim() || null,
    };
  }

  if (allowLocalBranchFallback && targetBranch.remote?.trim() === "origin") {
    const localBranch = checkoutBranch(targetBranch);
    if (await dependencies.gitPort.referenceExists(repoPath, localBranch)) {
      return { reference: localBranch, upstreamRemote: null };
    }
  }

  throw new Error(
    `Configured target branch is unavailable for build worktree creation: ${configuredTargetBranch}`,
  );
};

export const rollbackFailedBuildWorktree = async (
  dependencies: ReturnType<typeof requireBuildStartDependencies>,
  repoPath: string,
  worktreePath: string,
  branch: string,
  createdTrackingRef: string | null,
): Promise<string> => {
  const cleanupErrors: string[] = [];
  if (createdTrackingRef) {
    try {
      await dependencies.gitPort.deleteReference(repoPath, createdTrackingRef);
    } catch (error) {
      cleanupErrors.push(
        `Also failed to delete created upstream tracking ref ${createdTrackingRef}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  try {
    await removeWorktreeAndFilesystemPath(
      {
        gitPort: dependencies.gitPort,
        settingsConfig: dependencies.settingsConfig,
        worktreeFiles: dependencies.worktreeFiles,
      },
      {
        repoPath,
        worktreePath,
        force: true,
      },
    );
  } catch (error) {
    cleanupErrors.push(
      `Also failed to remove worktree ${worktreePath}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }

  try {
    await dependencies.gitPort.deleteLocalBranch(repoPath, branch, true);
  } catch (error) {
    cleanupErrors.push(
      `Also failed to delete branch ${branch}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }

  return cleanupErrors.length === 0 ? "" : `\n${cleanupErrors.join("\n")}`;
};

export const resolveRuntimeDescriptorForBuild = (
  runtimeDefinitionsService: RuntimeDefinitionsService,
  runtimeKind: string,
) => {
  const descriptor = runtimeDefinitionsService
    .listRuntimeDefinitions()
    .find((definition) => definition.kind === runtimeKind);
  if (!descriptor) {
    throw new Error(`Unsupported runtime kind: ${runtimeKind}`);
  }
  if (!descriptor.capabilities.workflow.supportsOdtWorkflowTools) {
    throw new Error(`${runtimeKind} runtime does not support OpenDucktor workflow tools.`);
  }

  const scopes = descriptor.capabilities.workflow.supportedScopes;
  const requiredScopes = ["workspace", "task", "build"] as const;
  const missingScopes = requiredScopes.filter((scope) => !scopes.includes(scope));
  if (missingScopes.length > 0) {
    throw new Error(
      `${runtimeKind} runtime is missing required workflow scopes: ${missingScopes.join(", ")}`,
    );
  }

  return descriptor;
};

export const loadBuilderBranchCleanup = async (
  dependencies: {
    gitPort: GitPort;
    taskWorktreeService: TaskWorktreeService;
    workspaceSettingsService: WorkspaceSettingsService;
  },
  task: TaskCard,
  repoPath: string,
  taskId: string,
  operationLabel: string,
): Promise<{ sourceBranch: string; targetBranch: string }> => {
  const taskWorktree = await dependencies.taskWorktreeService.getTaskWorktree({ repoPath, taskId });
  if (!taskWorktree) {
    throw new Error(
      `${operationLabel} requires a builder worktree for task ${taskId}. Start Builder first.`,
    );
  }

  const currentBranch = await dependencies.gitPort.getCurrentBranch(taskWorktree.workingDirectory);
  if (currentBranch.detached) {
    throw new Error(
      `${operationLabel} requires a builder branch, but the builder worktree is detached.`,
    );
  }
  const sourceBranch = currentBranch.name?.trim();
  if (!sourceBranch) {
    throw new Error(`${operationLabel} requires a builder branch name.`);
  }

  const targetBranch = await effectiveTargetBranchForTask(
    dependencies.workspaceSettingsService,
    task,
    repoPath,
  );
  return { sourceBranch, targetBranch: checkoutBranch(targetBranch) };
};

export const canSkipRelinkedPullRequestCleanup = (message: string): boolean =>
  message.includes("requires a builder worktree for task") ||
  message.includes("the builder worktree is detached") ||
  message.includes("requires a builder branch name");

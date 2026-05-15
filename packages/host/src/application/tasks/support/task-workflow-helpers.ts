import {
  type AgentSessionRecord,
  globalConfigSchema,
  type QaReportVerdict,
  type RepoConfig,
  type TaskCard,
} from "@openducktor/contracts";
import {
  deriveAgentWorkflows,
  deriveAvailableActions,
  validateTransition,
} from "../../../domain/task";
import type { SettingsConfigPort } from "../../../ports/settings-config-port";
import type { TaskStorePort } from "../../../ports/task-repository-ports";
import type { WorkspaceSettingsService } from "../../workspaces/workspace-settings-service";

export const enrichTasks = (tasks: TaskCard[]): TaskCard[] =>
  tasks.map((task) => ({
    ...task,
    availableActions: deriveAvailableActions(task, tasks),
    agentWorkflows: deriveAgentWorkflows(task),
  }));

export const enrichTask = (task: TaskCard, allTasks: TaskCard[]): TaskCard => ({
  ...task,
  availableActions: deriveAvailableActions(task, allTasks),
  agentWorkflows: deriveAgentWorkflows(task),
});

export const normalizeComparablePath = (value: string): string =>
  value.replace(/\\/g, "/").replace(/\/+$/g, "");

export const pathStartsWith = (child: string, parent: string): boolean => {
  const normalizedChild = normalizeComparablePath(child);
  const normalizedParent = normalizeComparablePath(parent);
  return normalizedChild === normalizedParent || normalizedChild.startsWith(`${normalizedParent}/`);
};

export const tryCanonicalizePath = async (
  settingsConfig: SettingsConfigPort,
  rawPath: string | null | undefined,
): Promise<string | undefined> => {
  const trimmed = rawPath?.trim();
  if (!trimmed) {
    return undefined;
  }

  try {
    return await settingsConfig.canonicalizePath(trimmed);
  } catch {
    return undefined;
  }
};

export const canonicalizeRequiredPath = async (
  settingsConfig: SettingsConfigPort,
  rawPath: string,
  errorMessage: string,
): Promise<string> => {
  const trimmed = rawPath.trim();
  try {
    return await settingsConfig.canonicalizePath(trimmed);
  } catch (error) {
    throw new Error(`${errorMessage}: ${trimmed}`, { cause: error });
  }
};

export const validateAgentSessionWorkingDirectory = async (
  settingsConfig: SettingsConfigPort,
  workspaceSettingsService: WorkspaceSettingsService,
  repoPath: string,
  session: AgentSessionRecord,
): Promise<void> => {
  const canonicalRepoPath = await canonicalizeRequiredPath(
    settingsConfig,
    repoPath,
    "Repository path for agent session validation must exist and be accessible",
  );
  const canonicalWorkingDirectory = await canonicalizeRequiredPath(
    settingsConfig,
    session.workingDirectory,
    "Agent session workingDirectory must exist and be accessible",
  );

  if (pathStartsWith(canonicalWorkingDirectory, canonicalRepoPath)) {
    return;
  }

  const workspaces = await workspaceSettingsService.listWorkspaces();
  const workspace = workspaces.find((entry) => entry.repoPath === canonicalRepoPath);
  const canonicalEffectiveWorktreeBase = await tryCanonicalizePath(
    settingsConfig,
    workspace?.effectiveWorktreeBasePath ?? null,
  );
  if (
    canonicalEffectiveWorktreeBase &&
    pathStartsWith(canonicalWorkingDirectory, canonicalEffectiveWorktreeBase)
  ) {
    return;
  }

  const canonicalRepoDefaultWorktreeBase = await tryCanonicalizePath(
    settingsConfig,
    settingsConfig.defaultRepoWorktreeBasePath(canonicalRepoPath),
  );
  if (
    canonicalRepoDefaultWorktreeBase &&
    pathStartsWith(canonicalWorkingDirectory, canonicalRepoDefaultWorktreeBase)
  ) {
    return;
  }

  throw new Error(
    `Agent session workingDirectory must stay inside repository ${repoPath} or its effective worktree base. Received: ${session.workingDirectory}`,
  );
};

export const loadDefaultMergeMethod = async (
  settingsConfig: SettingsConfigPort,
): Promise<ReturnType<typeof globalConfigSchema.parse>["git"]["defaultMergeMethod"]> => {
  const payload = await settingsConfig.readConfig();
  const config = globalConfigSchema.parse(payload ?? { version: 2 });
  return config.git.defaultMergeMethod;
};

export const taskListWithCurrent = async (
  taskStore: TaskStorePort,
  repoPath: string,
  taskId: string,
): Promise<{ current: TaskCard; currentTasks: TaskCard[] }> => {
  const currentTasks = await taskStore.listTasks({ repoPath });
  const current = currentTasks.find((task) => task.id === taskId);
  if (!current) {
    throw new Error(`Task not found: ${taskId}`);
  }

  return { current, currentTasks };
};

export const recordQaOutcome = async (
  taskStore: TaskStorePort,
  input: {
    repoPath: string;
    taskId: string;
    markdown: string;
    verdict: QaReportVerdict;
    targetStatus: "human_review" | "in_progress";
  },
): Promise<TaskCard> => {
  const { repoPath, taskId, markdown, verdict, targetStatus } = input;
  const { current, currentTasks } = await taskListWithCurrent(taskStore, repoPath, taskId);
  if (current.status !== "ai_review" && current.status !== "human_review") {
    throw new Error(
      `QA outcomes are only allowed from ai_review or human_review (current: ${current.status}).`,
    );
  }
  validateTransition(current, currentTasks, current.status, targetStatus);

  const updated = await taskStore.recordQaOutcome({
    repoPath,
    taskId,
    status: targetStatus,
    markdown,
    verdict,
  });
  const nextTasks = currentTasks.map((task) => (task.id === taskId ? updated : task));

  return enrichTask(updated, nextTasks);
};

export const buildCompletionWorktreePath = async (
  settingsConfig: SettingsConfigPort,
  repoConfig: RepoConfig,
  taskId: string,
): Promise<string> => {
  const basePath =
    repoConfig.worktreeBasePath === undefined
      ? settingsConfig.defaultWorktreeBasePath(repoConfig.workspaceId)
      : settingsConfig.resolveConfiguredPath(repoConfig.worktreeBasePath);
  const worktreePath = settingsConfig.join(basePath, taskId);

  if (!(await settingsConfig.pathExists(worktreePath))) {
    throw new Error(
      `Worktree cleanup scripts require a builder worktree for task ${taskId}. Start Builder first.`,
    );
  }

  const canonicalRepoPath = await settingsConfig.canonicalizePath(repoConfig.repoPath);
  const canonicalWorktreePath = await settingsConfig.canonicalizePath(worktreePath);
  if (canonicalRepoPath === canonicalWorktreePath) {
    throw new Error(
      `Worktree cleanup scripts require a builder worktree for task ${taskId}. Start Builder first.`,
    );
  }

  return worktreePath;
};

export const blockBuildCompletionTask = async (
  taskStore: TaskStorePort,
  repoPath: string,
  taskId: string,
  current: TaskCard,
  currentTasks: TaskCard[],
): Promise<void> => {
  validateTransition(current, currentTasks, current.status, "blocked");
  await taskStore.transitionTask({ repoPath, taskId, status: "blocked" });
};

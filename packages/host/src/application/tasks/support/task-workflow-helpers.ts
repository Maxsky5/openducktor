import {
  type AgentSessionRecord,
  globalConfigSchema,
  type QaReportVerdict,
  type RepoConfig,
  type TaskCard,
} from "@openducktor/contracts";
import { Effect } from "effect";
import {
  deriveAgentWorkflows,
  deriveAvailableActions,
  validateTransition,
} from "../../../domain/task";
import { errorMessage, HostOperationError, HostValidationError } from "../../../effect/host-errors";
import type { SettingsConfigError, SettingsConfigPort } from "../../../ports/settings-config-port";
import type { TaskStoreError, TaskStorePort } from "../../../ports/task-repository-ports";
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
export const tryCanonicalizePath = (
  settingsConfig: SettingsConfigPort,
  rawPath: string | null | undefined,
) =>
  Effect.gen(function* () {
    const trimmed = rawPath?.trim();
    if (!trimmed) {
      return undefined;
    }
    const result = yield* Effect.either(settingsConfig.canonicalizePath(trimmed));
    return result._tag === "Right" ? result.right : undefined;
  });
export const canonicalizeRequiredPath = (
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
export const validateAgentSessionWorkingDirectory = (
  settingsConfig: SettingsConfigPort,
  workspaceSettingsService: WorkspaceSettingsService,
  repoPath: string,
  session: AgentSessionRecord,
) =>
  Effect.gen(function* () {
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
    const workspaces = yield* workspaceSettingsService.listWorkspaces();
    const workspace = workspaces.find((entry) => entry.repoPath === canonicalRepoPath);
    const canonicalEffectiveWorktreeBase = yield* tryCanonicalizePath(
      settingsConfig,
      workspace?.effectiveWorktreeBasePath ?? null,
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
  ReturnType<typeof globalConfigSchema.parse>["git"]["defaultMergeMethod"],
  SettingsConfigError | HostValidationError
> =>
  Effect.gen(function* () {
    const payload = yield* settingsConfig.readConfig();
    const config = yield* Effect.try({
      try: () => globalConfigSchema.parse(payload ?? { version: 2 }),
      catch: (cause) =>
        new HostValidationError({
          message: cause instanceof Error ? cause.message : String(cause),
          cause,
        }),
    });
    return config.git.defaultMergeMethod;
  });
export const taskListWithCurrent = (
  taskStore: TaskStorePort,
  repoPath: string,
  taskId: string,
): Effect.Effect<
  {
    current: TaskCard;
    currentTasks: TaskCard[];
  },
  TaskStoreError | HostValidationError
> =>
  Effect.gen(function* () {
    const currentTasks = yield* taskStore.listTasks({ repoPath });
    const current = currentTasks.find((task) => task.id === taskId);
    if (!current) {
      return yield* Effect.fail(
        new HostValidationError({
          field: "taskId",
          message: `Task not found: ${taskId}`,
          details: { repoPath, taskId },
        }),
      );
    }
    return { current, currentTasks };
  });
export const recordQaOutcome = (
  taskStore: TaskStorePort,
  input: {
    repoPath: string;
    taskId: string;
    markdown: string;
    verdict: QaReportVerdict;
    targetStatus: "human_review" | "in_progress";
  },
) =>
  Effect.gen(function* () {
    const { repoPath, taskId, markdown, verdict, targetStatus } = input;
    const { current, currentTasks } = yield* taskListWithCurrent(taskStore, repoPath, taskId);
    if (current.status !== "ai_review" && current.status !== "human_review") {
      return yield* Effect.fail(
        new HostValidationError({
          field: "taskId",
          message: `QA outcomes are only allowed from ai_review or human_review (current: ${current.status}).`,
          details: { repoPath, taskId, status: current.status },
        }),
      );
    }
    yield* Effect.try({
      try: () => validateTransition(current, currentTasks, current.status, targetStatus),
      catch: (cause) =>
        new HostValidationError({
          message: cause instanceof Error ? cause.message : String(cause),
          cause,
        }),
    });
    const updated = yield* taskStore.recordQaOutcome({
      repoPath,
      taskId,
      status: targetStatus,
      markdown,
      verdict,
    });
    const nextTasks = currentTasks.map((task) => (task.id === taskId ? updated : task));
    return enrichTask(updated, nextTasks);
  });
export const buildCompletionWorktreePath = (
  settingsConfig: SettingsConfigPort,
  repoConfig: RepoConfig,
  taskId: string,
) =>
  Effect.gen(function* () {
    const basePath =
      repoConfig.worktreeBasePath === undefined
        ? settingsConfig.defaultWorktreeBasePath(repoConfig.workspaceId)
        : settingsConfig.resolveConfiguredPath(repoConfig.worktreeBasePath);
    const worktreePath = settingsConfig.join(basePath, taskId);
    if (!(yield* settingsConfig.pathExists(worktreePath))) {
      return yield* Effect.fail(
        new HostValidationError({
          field: "taskId",
          message: `Worktree cleanup scripts require a builder worktree for task ${taskId}. Start Builder first.`,
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
          message: `Worktree cleanup scripts require a builder worktree for task ${taskId}. Start Builder first.`,
          details: { taskId, worktreePath },
        }),
      );
    }
    return worktreePath;
  });
export const blockBuildCompletionTask = (
  taskStore: TaskStorePort,
  repoPath: string,
  taskId: string,
  current: TaskCard,
  currentTasks: TaskCard[],
) =>
  Effect.gen(function* () {
    yield* Effect.try({
      try: () => validateTransition(current, currentTasks, current.status, "blocked"),
      catch: (cause) =>
        new HostValidationError({
          message: cause instanceof Error ? cause.message : String(cause),
          cause,
        }),
    });
    yield* taskStore.transitionTask({ repoPath, taskId, status: "blocked" });
  }).pipe(
    Effect.mapError(
      (error) =>
        new HostOperationError({
          operation: "task.build_completed.block_task",
          message: errorMessage(error),
          cause: error,
          details: { repoPath, taskId },
        }),
    ),
  );

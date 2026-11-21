import type {
  AgentSessionRecord,
  GlobalGitConfig,
  RepoConfig,
  TaskCard,
} from "@openducktor/contracts";
import { pathStartsWith } from "@openducktor/path-support";
import type { TaskIdInput } from "../task-inputs";
import { availableTaskActions, type TaskWorkflow } from "@openducktor/workflows";
import type { TaskWorkflowResolver } from "../../../ports/task-workflow-port";
import { Effect } from "effect";
import { HostValidationError } from "../../../effect/host-errors";
import type { SettingsConfigError, SettingsConfigPort } from "../../../ports/settings-config-port";
import type {
  DecideTaskTransition,
  TaskRecord,
  TaskStorePort,
} from "../../../ports/task-repository-ports";
import { blockUnpublishedDirectMerge } from "./direct-merge-block";
import { managedWorktreeRoots } from "../../git/managed-worktree-roots";

/**
 * Commits the transition of a workflow event. Every workflow event commits here, so a local direct
 * merge that waits for its publication blocks each of them.
 */
export const commitWorkflowEvent = <E>(
  taskStore: Pick<TaskStorePort, "getTaskDelivery" | "transitionTask">,
  input: TaskIdInput,
  decide: DecideTaskTransition<E>,
) =>
  Effect.gen(function* () {
    const { directMerge } = yield* taskStore.getTaskDelivery(input);
    return yield* taskStore.transitionTask({
      workspaceId: input.workspaceId,
      repoPath: input.repoPath,
      taskId: input.taskId,
      decide: blockUnpublishedDirectMerge(directMerge, input.repoPath, decide),
    });
  });

export const enrichTasks = (
  taskWorkflows: TaskWorkflowResolver,
  tasks: readonly TaskRecord[],
): TaskCard[] => tasks.map((task) => enrichTask(taskWorkflows.forTask(task), task));
export const enrichTask = (workflow: TaskWorkflow, task: TaskRecord): TaskCard => {
  const projection = workflow.project(task);
  const { workflowId: _workflowId, workflowVersion: _workflowVersion, ...data } = task;
  return {
    ...data,
    ...projection,
    availableActions: availableTaskActions(workflow, task, projection.availableActions),
  };
};
export const validateAgentSessionWorkingDirectory = (
  settingsConfig: SettingsConfigPort,
  workspace: RepoConfig,
  session: AgentSessionRecord,
) =>
  Effect.gen(function* () {
    const { repoPath } = workspace;
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
    for (const root of managedWorktreeRoots(settingsConfig, workspace, canonicalRepoPath)) {
      const canonicalRoot = yield* tryCanonicalizePath(settingsConfig, root);
      if (canonicalRoot && pathStartsWith(canonicalWorkingDirectory, canonicalRoot)) return;
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

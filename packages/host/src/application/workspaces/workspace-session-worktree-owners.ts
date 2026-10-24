import type {
  RepoConfig,
  WorkspaceSession,
  WorkspaceSessionArchivePreview,
} from "@openducktor/contracts";
import { Effect } from "effect";
import { normalizePathForComparison } from "../../domain/path-comparison";
import { runtimeTitle } from "../../domain/workspace-sessions/workspace-session-title";
import { type HostError, HostOperationError, HostValidationError } from "../../effect/host-errors";
import type { ClaudeSessionMetadataPort } from "../../ports/claude-session-metadata-port";
import type { TaskOwnershipReader, TaskStoreError } from "../../ports/task-repository-ports";
import type {
  WorkspaceSessionStorePort,
  WorkspaceSessionStoreScope,
} from "../../ports/workspace-session-store-port";
import { managedWorktreeBaseForRepoConfig } from "../tasks/support/task-cleanup-support";
import type { WorkspaceSessionTargetDependencies } from "./workspace-session-target";

type WorktreeOwnerDependencies = Pick<
  WorkspaceSessionTargetDependencies,
  "settingsConfig" | "worktreeFiles"
> & {
  store: Pick<WorkspaceSessionStorePort, "listForWorktreeOwnership">;
  claudeSessionMetadata: ClaudeSessionMetadataPort;
  taskOwnership: TaskOwnershipReader;
};

/** The chats and tasks that need a worktree. */
export type WorktreeOwners = Pick<WorkspaceSessionArchivePreview, "sharedWith" | "taskOwners">;

/** Archive removal stops when a task or another saved chat still needs the worktree. */
export const requireNoWorktreeOwners = (
  dependencies: WorktreeOwnerDependencies,
  scope: WorkspaceSessionStoreScope,
  source: WorkspaceSession,
): Effect.Effect<void, HostError | TaskStoreError> =>
  Effect.gen(function* () {
    const { sharedWith, taskOwners } = yield* readWorktreeOwners(dependencies, scope, source);
    const reasons: string[] = [];
    if (taskOwners.length > 0)
      reasons.push(
        `tasks need it: ${taskOwners.map((task) => `${task.title} (${task.taskId})`).join(", ")}`,
      );
    if (sharedWith.length > 0)
      reasons.push(
        `saved chats need it for files or history: ${sharedWith.map((owner) => owner.title).join(", ")}`,
      );
    if (reasons.length === 0) return;
    return yield* new HostValidationError({
      field: "removeWorktree",
      message: `Cannot remove this worktree while ${reasons.join(" and ")}. Turn off worktree removal to archive this chat.`,
    });
  });

/**
 * Reads the chats and open tasks that need the worktree of the source chat, in every configured
 * workspace. A closed workspace still counts, because its records can return when it reopens.
 */
export const readWorktreeOwners = (
  dependencies: WorktreeOwnerDependencies,
  scope: WorkspaceSessionStoreScope,
  source: WorkspaceSession,
): Effect.Effect<WorktreeOwners, HostError | TaskStoreError> =>
  Effect.gen(function* () {
    const resolvePath = cachedRemovalPath(dependencies);
    const sourcePath = yield* resolvePath(source.executionTarget.workingDirectory);
    const config = yield* dependencies.settingsConfig.readConfig();
    const byId = new Map<string, OwnerWorkspace>([[scope.workspaceId, { scope, config: null }]]);
    for (const [workspaceId, workspace] of Object.entries(config?.workspaces ?? {})) {
      byId.set(workspaceId, {
        scope: byId.get(workspaceId)?.scope ?? { workspaceId, repoPath: workspace.repoPath },
        config: workspace,
      });
    }
    const workspaces = [...byId.values()];
    for (const { scope: candidate, config: candidateConfig } of workspaces) {
      if (candidate.workspaceId === scope.workspaceId || !candidateConfig) continue;
      if ((yield* resolvePath(candidateConfig.repoPath)) !== sourcePath) continue;
      return yield* new HostValidationError({
        field: "removeWorktree",
        message: `Cannot remove this worktree because workspace ${candidateConfig.workspaceName} uses it as its repository checkout. Turn off worktree removal to archive this chat.`,
      });
    }
    const context = { scope, source, sourcePath, workspaces, resolvePath };
    return yield* Effect.all(
      {
        sharedWith: readChatOwners(dependencies, context),
        taskOwners: readTaskOwners(dependencies, context),
      },
      { concurrency: 2 },
    );
  });

/** Reads the saved chats that need the worktree of the source chat for files or history. */
const readChatOwners = (
  dependencies: WorktreeOwnerDependencies,
  { scope, source, sourcePath, workspaces, resolvePath }: OwnerReadContext,
): Effect.Effect<WorkspaceSessionArchivePreview["sharedWith"], HostError | TaskStoreError> =>
  Effect.gen(function* () {
    const owners: WorkspaceSessionArchivePreview["sharedWith"] = [];
    for (const { scope: candidate } of workspaces) {
      const sessions = yield* dependencies.store.listForWorktreeOwnership(candidate);
      const needed = yield* Effect.forEach(
        sessions,
        (session) =>
          Effect.gen(function* () {
            if (candidate.workspaceId === scope.workspaceId && session.id === source.id)
              return false;
            const executionPath = yield* resolvePath(session.executionTarget.workingDirectory);
            // Archived chats can restore their own execution folder through the normal restore path.
            if (executionPath === sourcePath) return session.archivedAt === null;
            if (session.runtimeKind !== "claude" || session.externalSessionId === null)
              return false;
            const historyDirectory = yield* dependencies.claudeSessionMetadata
              .readWorkingDirectory(session.externalSessionId)
              .pipe(
                Effect.mapError(
                  (cause) =>
                    new HostOperationError({
                      operation: "workspaceSession.archive.historyDependency",
                      message: `Cannot check history for saved chat '${runtimeTitle(session) ?? "Untitled session"}' (${session.id}). ${cause.message}`,
                      cause,
                      details: { workspaceId: candidate.workspaceId, sessionId: session.id },
                    }),
                ),
              );
            if (historyDirectory === null) return false;
            return (yield* resolvePath(historyDirectory)) === sourcePath;
          }),
        { concurrency: PATH_READ_CONCURRENCY },
      );
      sessions.forEach((session, index) => {
        if (!needed[index]) return;
        owners.push({
          workspaceId: candidate.workspaceId,
          sessionId: session.id,
          title: runtimeTitle(session) ?? "Untitled session",
        });
      });
    }
    return owners;
  });

/**
 * Reads the open tasks that need the worktree of the source chat. A task needs it when it is the
 * task worktree or a task session works there. Closed tasks keep old session paths after cleanup,
 * so they never reserve a directory.
 */
const readTaskOwners = (
  dependencies: WorktreeOwnerDependencies,
  { sourcePath, workspaces, resolvePath }: OwnerReadContext,
): Effect.Effect<WorkspaceSessionArchivePreview["taskOwners"], HostError | TaskStoreError> =>
  Effect.gen(function* () {
    const { settingsConfig, taskOwnership } = dependencies;
    const taskOwners: WorkspaceSessionArchivePreview["taskOwners"] = [];
    for (const { scope, config } of workspaces) {
      // A task worktree path needs the workspace settings. Without them, no task can own it.
      if (!config) continue;
      const tasks = yield* taskOwnership.listOpenTasksForWorktreeOwnership(scope);
      if (tasks.length === 0) continue;
      const worktreeBase = managedWorktreeBaseForRepoConfig(settingsConfig, config);
      const needed = yield* Effect.forEach(
        tasks,
        (task) =>
          Effect.gen(function* () {
            const paths = [
              settingsConfig.join(worktreeBase, task.taskId),
              ...task.sessionDirectories,
            ];
            for (const path of paths) {
              if ((yield* resolvePath(path)) === sourcePath) return true;
            }
            return false;
          }),
        { concurrency: PATH_READ_CONCURRENCY },
      );
      tasks.forEach((task, index) => {
        if (!needed[index]) return;
        taskOwners.push({ workspaceId: scope.workspaceId, taskId: task.taskId, title: task.title });
      });
    }
    return taskOwners;
  });

const PATH_READ_CONCURRENCY = 8;

type OwnerWorkspace = { scope: WorkspaceSessionStoreScope; config: RepoConfig | null };

type OwnerReadContext = {
  scope: WorkspaceSessionStoreScope;
  source: WorkspaceSession;
  sourcePath: string;
  workspaces: OwnerWorkspace[];
  resolvePath: (path: string) => Effect.Effect<string, HostError>;
};

/** Sessions of one task or one worktree share directories, so one owner read resolves each once. */
const cachedRemovalPath = (dependencies: Pick<WorktreeOwnerDependencies, "worktreeFiles">) => {
  const resolved = new Map<string, string>();
  return (path: string) => {
    const known = resolved.get(path);
    if (known !== undefined) return Effect.succeed(known);
    return removalPath(dependencies, path).pipe(
      Effect.tap((value) => Effect.sync(() => resolved.set(path, value))),
    );
  };
};

const removalPath = (
  dependencies: Pick<WorktreeOwnerDependencies, "worktreeFiles">,
  path: string,
) =>
  dependencies.worktreeFiles
    .resolveWorktreeRemovalPath(path)
    .pipe(Effect.map(normalizePathForComparison));

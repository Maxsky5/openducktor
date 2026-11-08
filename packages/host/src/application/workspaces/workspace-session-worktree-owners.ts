import type {
  RepoConfig,
  WorkspaceSession,
  WorkspaceSessionArchivePreview,
  TaskWorktreeOwners,
  WorktreeOwners,
} from "@openducktor/contracts";
import { describeWorktreeOwners } from "@openducktor/core";
import { Effect } from "effect";
import { normalizePathForComparison } from "../../domain/path-comparison";
import { runtimeTitle } from "../../domain/workspace-sessions/workspace-session-title";
import { type HostError, HostOperationError, HostValidationError } from "../../effect/host-errors";
import type { ClaudeSessionMetadataPort } from "../../ports/claude-session-metadata-port";
import type { TaskOwnershipReader, TaskStoreError } from "../../ports/task-repository-ports";
import type {
  WorkspaceSessionStorePort,
  WorkspaceSessionStoreScope,
  WorktreeOwnershipChat,
} from "../../ports/workspace-session-store-port";
import type { HistoryOwnerRead } from "../../ports/task-worktree-owner-port";
import { managedWorktreeBaseForRepoConfig } from "../tasks/support/task-cleanup-support";
import type { WorkspaceSessionTargetDependencies } from "./workspace-session-target";

export type WorktreeOwnerDependencies = Pick<
  WorkspaceSessionTargetDependencies,
  "settingsConfig" | "worktreeFiles"
> & {
  store: Pick<WorkspaceSessionStorePort, "listForWorktreeOwnership">;
  claudeSessionMetadata: ClaudeSessionMetadataPort;
  taskOwnership: Pick<TaskOwnershipReader, "listOpenTasksForWorktreeOwnership">;
};

/** The chat or the tasks that remove the worktrees. They are never their own owners. */
type OwnerReadSource =
  | { kind: "chat"; sessionId: string }
  | { kind: "tasks"; taskIds: readonly string[] };

/**
 * Archive removal stops when another workspace, a task, or another saved chat still needs the
 * worktree. A Claude chat whose native history uses it also stops it, because archive asks for no
 * confirmation of these chats.
 */
export const requireNoWorktreeOwners = (
  dependencies: WorktreeOwnerDependencies,
  scope: WorkspaceSessionStoreScope,
  source: WorkspaceSession,
): Effect.Effect<void, HostError | TaskStoreError> =>
  Effect.gen(function* () {
    const { owners } = yield* readWorktreePathOwners(
      dependencies,
      scope,
      [source.executionTarget.workingDirectory],
      { source: { kind: "chat", sessionId: source.id }, history: "required" },
    );
    const lines = describeWorktreeOwners(owners);
    if (lines.length === 0) return;
    return yield* new HostValidationError({
      field: "removeWorktree",
      message: `Cannot remove this worktree. ${lines.map((line) => line.text).join(" ")} Turn off worktree removal to archive this session.`,
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
): Effect.Effect<
  Pick<WorkspaceSessionArchivePreview, "sharedWith" | "taskOwners">,
  HostError | TaskStoreError
> =>
  Effect.gen(function* () {
    const { owners } = yield* readWorktreePathOwners(
      dependencies,
      scope,
      [source.executionTarget.workingDirectory],
      { source: { kind: "chat", sessionId: source.id }, history: "required" },
    );
    const [checkoutWorkspace] = owners.checkoutWorkspaces;
    if (checkoutWorkspace !== undefined) {
      return yield* new HostValidationError({
        field: "removeWorktree",
        message: `Cannot remove this worktree because workspace ${checkoutWorkspace} uses it as its repository checkout. Turn off worktree removal to archive this session.`,
      });
    }
    return { sharedWith: [...owners.chats, ...owners.historyChats], taskOwners: owners.tasks };
  });

/**
 * Reads the owners of the source worktrees in every configured workspace: other workspaces that use
 * one as their repository checkout, open tasks, saved chats that work in one, and saved Claude chats
 * whose native history uses one. Paths match after alias resolution, so a symlink path and its real
 * path are the same worktree.
 */
export const readWorktreePathOwners = (
  dependencies: WorktreeOwnerDependencies,
  scope: WorkspaceSessionStoreScope,
  worktreePaths: readonly string[],
  options: { source: OwnerReadSource; history: HistoryOwnerRead },
): Effect.Effect<TaskWorktreeOwners, HostError | TaskStoreError> =>
  Effect.gen(function* () {
    const resolvePath = cachedRemovalPath(dependencies);
    const sourcePaths = new Set(yield* Effect.forEach(worktreePaths, resolvePath));
    const config = yield* dependencies.settingsConfig.readConfig();
    const byId = new Map<string, OwnerWorkspace>([[scope.workspaceId, { scope, config: null }]]);
    for (const [workspaceId, workspace] of Object.entries(config.workspaces)) {
      byId.set(workspaceId, {
        scope: byId.get(workspaceId)?.scope ?? { workspaceId, repoPath: workspace.repoPath },
        config: workspace,
      });
    }
    const workspaces = [...byId.values()];
    const checkoutWorkspaces: string[] = [];
    for (const { scope: candidate, config: candidateConfig } of workspaces) {
      if (candidate.workspaceId === scope.workspaceId || !candidateConfig) continue;
      if (sourcePaths.has(yield* resolvePath(candidateConfig.repoPath)))
        checkoutWorkspaces.push(candidateConfig.workspaceName);
    }
    const context = { ...options, scope, sourcePaths, workspaces, resolvePath };
    const [{ chats, historyChats, historyReadErrors }, tasks] = yield* Effect.all(
      [readChatOwners(dependencies, context), readTaskOwners(dependencies, context)],
      { concurrency: 2 },
    );
    return { owners: { checkoutWorkspaces, tasks, chats, historyChats }, historyReadErrors };
  });

type ChatCandidate = {
  workspaceName: string;
  session: WorktreeOwnershipChat;
  executionPath: string;
};

const chatOwner = ({ session }: ChatCandidate) => ({
  workspaceId: session.workspaceId,
  sessionId: session.id,
  title: runtimeTitle(session) ?? "Untitled session",
});

/**
 * Reads the saved chats that need a source worktree: a chat that is not archived and works there,
 * or a Claude chat whose native history uses it. One batch reads the native metadata of every
 * other Claude chat.
 */
const readChatOwners = (
  dependencies: WorktreeOwnerDependencies,
  { scope, source, history, sourcePaths, workspaces, resolvePath }: OwnerReadContext,
): Effect.Effect<
  Pick<WorktreeOwners, "chats" | "historyChats"> & { historyReadErrors: string[] },
  HostError | TaskStoreError
> =>
  Effect.gen(function* () {
    const sessions = yield* dependencies.store.listForWorktreeOwnership({
      workspaces: workspaces.map((workspace) => workspace.scope),
    });
    const names = new Map(
      workspaces.map(({ scope: candidate, config }) => [
        candidate.workspaceId,
        config?.workspaceName ?? candidate.workspaceId,
      ]),
    );
    const candidates: ChatCandidate[] = yield* Effect.forEach(
      sessions.filter(
        (session) =>
          source.kind !== "chat" ||
          session.workspaceId !== scope.workspaceId ||
          session.id !== source.sessionId,
      ),
      (session) =>
        resolvePath(session.workingDirectory).pipe(
          Effect.map((executionPath) => ({
            workspaceName: names.get(session.workspaceId) ?? session.workspaceId,
            session,
            executionPath,
          })),
        ),
      { concurrency: PATH_READ_CONCURRENCY },
    );
    const worksThere = (candidate: ChatCandidate) =>
      candidate.session.archivedAt === null && sourcePaths.has(candidate.executionPath);
    const chats = candidates.filter(worksThere).map(chatOwner);
    const claudeChats =
      history === "none"
        ? []
        : candidates.flatMap((candidate) => {
            const { runtimeKind, externalSessionId } = candidate.session;
            if (worksThere(candidate) || runtimeKind !== "claude" || externalSessionId === null)
              return [];
            return [{ ...candidate, externalSessionId }];
          });
    if (claudeChats.length === 0) return { chats, historyChats: [], historyReadErrors: [] };
    const batch = yield* dependencies.claudeSessionMetadata
      .readWorkingDirectories(claudeChats.map(({ externalSessionId }) => externalSessionId))
      .pipe(
        Effect.mapError(
          (cause) =>
            new HostOperationError({
              operation: "worktreeOwners.historyDependency",
              message: `Cannot check the native history of saved Claude sessions. ${cause.message}`,
              cause,
            }),
        ),
        Effect.result,
      );
    if (batch._tag === "Failure") {
      // A confirmation only warns about history, also when no history can be read.
      if (history === "required") return yield* batch.failure;
      return { chats, historyChats: [], historyReadErrors: [batch.failure.message] };
    }
    const reads = batch.success;
    const failures = claudeChats.flatMap((candidate) => {
      const read = reads.get(candidate.externalSessionId);
      if (read?.kind !== "failed") return [];
      return [
        new HostOperationError({
          operation: "worktreeOwners.historyDependency",
          message: `Cannot check the native history of saved session “${chatOwner(candidate).title}” in workspace ${candidate.workspaceName}. ${read.error.message}`,
          cause: read.error,
          details: { workspaceId: candidate.session.workspaceId, sessionId: candidate.session.id },
        }),
      ];
    });
    const [firstFailure] = failures;
    if (history === "required" && firstFailure) return yield* firstFailure;
    const historyChats = yield* Effect.filter(
      claudeChats,
      (candidate) =>
        Effect.gen(function* () {
          const read = reads.get(candidate.externalSessionId);
          if (read?.kind !== "read" || read.directory === null) return false;
          const historyPath = yield* resolvePath(read.directory);
          // Restore recreates the execution folder of an archived chat, but no other folder.
          if (candidate.session.archivedAt !== null && historyPath === candidate.executionPath)
            return false;
          return sourcePaths.has(historyPath);
        }),
      { concurrency: PATH_READ_CONCURRENCY },
    );
    return {
      chats,
      historyChats: historyChats.map(chatOwner),
      historyReadErrors: failures.map((failure) => failure.message),
    };
  });

/**
 * Reads the open tasks that need a source worktree. A task needs it when it is the task worktree or
 * a task session works there. Closed tasks keep old session paths after cleanup, so they never
 * reserve a directory.
 */
const readTaskOwners = (
  dependencies: WorktreeOwnerDependencies,
  { scope: sourceScope, source, sourcePaths, workspaces, resolvePath }: OwnerReadContext,
): Effect.Effect<WorktreeOwners["tasks"], HostError | TaskStoreError> =>
  Effect.gen(function* () {
    const { settingsConfig, taskOwnership } = dependencies;
    // A task worktree path needs the workspace settings. Without them, no task can own it.
    const configured = workspaces.flatMap(({ scope, config }) =>
      config ? [{ scope, config }] : [],
    );
    if (configured.length === 0) return [];
    const tasks = yield* taskOwnership.listOpenTasksForWorktreeOwnership({
      workspaces: configured.map(({ scope }) => scope),
    });
    const configs = new Map(configured.map(({ scope, config }) => [scope.workspaceId, config]));
    const needed = yield* Effect.forEach(
      tasks,
      (task) =>
        Effect.gen(function* () {
          if (
            source.kind === "tasks" &&
            task.workspaceId === sourceScope.workspaceId &&
            source.taskIds.includes(task.taskId)
          )
            return false;
          // The read returns tasks of the requested workspaces only, so each one has settings.
          const config = configs.get(task.workspaceId)!;
          const paths = [
            settingsConfig.join(
              managedWorktreeBaseForRepoConfig(settingsConfig, config),
              task.taskId,
            ),
            ...task.sessionDirectories,
          ];
          for (const path of paths) {
            if (sourcePaths.has(yield* resolvePath(path))) return true;
          }
          return false;
        }),
      { concurrency: PATH_READ_CONCURRENCY },
    );
    return tasks
      .filter((_, index) => needed[index])
      .map((task) => ({ workspaceId: task.workspaceId, taskId: task.taskId, title: task.title }));
  });

const PATH_READ_CONCURRENCY = 8;

type OwnerWorkspace = { scope: WorkspaceSessionStoreScope; config: RepoConfig | null };

type OwnerReadContext = {
  scope: WorkspaceSessionStoreScope;
  source: OwnerReadSource;
  history: HistoryOwnerRead;
  sourcePaths: ReadonlySet<string>;
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

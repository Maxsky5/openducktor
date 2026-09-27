import type { TerminalContext, TerminalCreateRequest } from "@openducktor/contracts";
import { Effect } from "effect";
import { HostResourceError } from "../../effect/host-errors";
import type { FilesystemPort } from "../../ports/filesystem-port";
import type { GitPort } from "../../ports/git-port";
import type { WorkspaceSessionStorePort } from "../../ports/workspace-session-store-port";
import type { TaskWorktreeService } from "../tasks/worktrees/task-worktree-service";
import type { WorkspaceSettingsService } from "../workspaces/workspace-settings-model";
import { validateWorkspaceSessionTarget } from "../workspaces/workspace-session-target";
import { isTaskTerminalContext, isWorkspaceSessionTerminalContext } from "./terminal-context";
import { TerminalServiceError } from "./terminal-service-error";

type TerminalTarget = { context: TerminalContext; workingDir: string };

export type TerminalTargetServices = {
  filesystem: FilesystemPort;
  taskWorktrees: Pick<TaskWorktreeService, "getTaskWorktree">;
  workspaceSessions: {
    settings: Pick<WorkspaceSettingsService, "getRepoConfig">;
    store: Pick<WorkspaceSessionStorePort, "get">;
    git: GitPort;
  };
};

export const createTerminalTargetResolver = ({
  filesystem,
  taskWorktrees,
  workspaceSessions,
}: TerminalTargetServices) => {
  const canonicalizeRepositoryPath = (
    repoPath: string,
    operation: "create" | "list" | "close_by_task",
  ): Effect.Effect<string, TerminalServiceError> =>
    filesystem.canonicalize(repoPath).pipe(
      Effect.mapError(
        (cause) =>
          new TerminalServiceError({
            code: "working_directory_inaccessible",
            operation,
            message: `Cannot resolve terminal repository path: ${repoPath}`,
            workingDir: repoPath,
            cause,
          }),
      ),
    );

  const resolveTask = (
    context: Extract<TerminalContext, { taskId: string }>,
    workingDir: string,
  ): Effect.Effect<TerminalTarget, TerminalServiceError> =>
    Effect.gen(function* () {
      const repoPath = yield* canonicalizeRepositoryPath(context.repoPath, "create");
      const worktree = yield* taskWorktrees
        .getTaskWorktree({
          repoPath,
          taskId: context.taskId,
        })
        .pipe(
          Effect.mapError(
            (cause) =>
              new TerminalServiceError({
                code: "task_worktree_unavailable",
                operation: "create",
                message: `Cannot find task ${context.taskId}'s worktree: ${cause.message}`,
                cause,
              }),
          ),
        );
      if (!worktree) {
        return yield* new TerminalServiceError({
          code: "task_worktree_unavailable",
          operation: "create",
          message: `Task ${context.taskId} has no worktree. Create or restore its worktree before opening a terminal.`,
        });
      }
      const savedWorkingDir = yield* filesystem.canonicalize(worktree.workingDirectory).pipe(
        Effect.mapError(
          (cause) =>
            new TerminalServiceError({
              code: "task_worktree_unavailable",
              operation: "create",
              message: `Cannot use task ${context.taskId}'s worktree: ${cause.message}`,
              cause,
            }),
        ),
      );
      const requestedWorkingDir = yield* filesystem.canonicalize(workingDir).pipe(
        Effect.mapError(
          (cause) =>
            new TerminalServiceError({
              code: "invalid_working_directory",
              operation: "create",
              message: `Cannot resolve requested terminal directory: ${cause.message}`,
              workingDir,
              cause,
            }),
        ),
      );
      if (requestedWorkingDir !== savedWorkingDir) {
        return yield* new TerminalServiceError({
          code: "invalid_working_directory",
          operation: "create",
          message: `Terminal directory does not match task ${context.taskId}'s worktree: ${worktree.workingDirectory}. Reopen the task and retry.`,
          workingDir,
        });
      }
      return { context: { repoPath, taskId: context.taskId }, workingDir: savedWorkingDir };
    });

  const resolveWorkspaceSession = (
    context: Extract<TerminalContext, { kind: "workspace_session" }>,
    workingDir: string,
  ): Effect.Effect<TerminalTarget, TerminalServiceError> =>
    Effect.gen(function* () {
      const { settings, store, git } = workspaceSessions;
      const config = yield* settings.getRepoConfig(context.workspaceId).pipe(
        Effect.mapError(
          (cause) =>
            new TerminalServiceError({
              code: "workspace_session_unavailable",
              operation: "create",
              message: `Cannot read Workspace ${context.workspaceId}: ${cause.message}`,
              cause,
            }),
        ),
      );
      const repoPath = yield* git.canonicalizePath(config.repoPath).pipe(
        Effect.mapError(
          (cause) =>
            new TerminalServiceError({
              code: "workspace_session_unavailable",
              operation: "create",
              message: `Cannot resolve Workspace repository: ${cause.message}`,
              cause,
            }),
        ),
      );
      const requestedRepoPath = yield* git.canonicalizePath(context.repoPath).pipe(
        Effect.mapError(
          (cause) =>
            new TerminalServiceError({
              code: "workspace_session_unavailable",
              operation: "create",
              message: `Cannot resolve requested repository: ${cause.message}`,
              cause,
            }),
        ),
      );
      if (requestedRepoPath !== repoPath) {
        return yield* new TerminalServiceError({
          code: "workspace_session_unavailable",
          operation: "create",
          message: "Workspace repository changed. Reopen this chat and retry the terminal.",
        });
      }
      const session = yield* store
        .get({ workspaceId: context.workspaceId, sessionId: context.sessionId, repoPath })
        .pipe(
          Effect.mapError(
            (cause) =>
              new TerminalServiceError({
                code: "workspace_session_unavailable",
                operation: "create",
                message:
                  cause instanceof HostResourceError
                    ? `Workspace Session ${context.sessionId} no longer exists. Select an active chat.`
                    : `Cannot read Workspace Session ${context.sessionId}: ${cause.message}`,
                cause,
              }),
          ),
        );
      if (session.archivedAt !== null) {
        return yield* new TerminalServiceError({
          code: "workspace_session_unavailable",
          operation: "create",
          message: "This chat is archived. Restore it before opening a terminal.",
        });
      }
      const target = session.executionTarget;
      if (target.kind === "local_worktree" && target.worktreeState === "removed") {
        return yield* new TerminalServiceError({
          code: "workspace_session_unavailable",
          operation: "create",
          message:
            "This chat's worktree was removed. Restore the worktree before opening a terminal.",
        });
      }
      yield* validateWorkspaceSessionTarget({ git }, repoPath, target).pipe(
        Effect.mapError(
          (cause) =>
            new TerminalServiceError({
              code: "workspace_session_unavailable",
              operation: "create",
              message: `Cannot use this chat's saved directory: ${cause.message}`,
              cause,
            }),
        ),
      );
      const requestedWorkingDir = yield* git.canonicalizePath(workingDir).pipe(
        Effect.mapError(
          (cause) =>
            new TerminalServiceError({
              code: "invalid_working_directory",
              operation: "create",
              message: `Cannot resolve requested terminal directory: ${cause.message}`,
              workingDir,
              cause,
            }),
        ),
      );
      const savedWorkingDir = yield* git.canonicalizePath(target.workingDirectory).pipe(
        Effect.mapError(
          (cause) =>
            new TerminalServiceError({
              code: "workspace_session_unavailable",
              operation: "create",
              message: `Cannot resolve this chat's saved directory: ${cause.message}`,
              cause,
            }),
        ),
      );
      if (requestedWorkingDir !== savedWorkingDir) {
        return yield* new TerminalServiceError({
          code: "invalid_working_directory",
          operation: "create",
          message: `Terminal directory does not match this chat's saved directory: ${target.workingDirectory}. Reopen the chat and retry.`,
          workingDir,
        });
      }
      return { context: { ...context, repoPath }, workingDir: savedWorkingDir };
    });

  return {
    canonicalizeRepositoryPath,
    resolve(input: TerminalCreateRequest): Effect.Effect<TerminalTarget, TerminalServiceError> {
      const { context, workingDir } = input;
      if (isTaskTerminalContext(context)) return resolveTask(context, workingDir);
      if (isWorkspaceSessionTerminalContext(context))
        return resolveWorkspaceSession(context, workingDir);
      return Effect.succeed({ context, workingDir });
    },
  };
};

import type { RepoConfig, WorkspaceCatalog, WorkspaceRemovalResult } from "@openducktor/contracts";
import { Effect } from "effect";
import { normalizePathForComparison } from "../../domain/path-comparison";
import {
  HostOperationError,
  type HostOperationErrorAggregate,
  HostValidationError,
  type HostValidationErrorAggregate,
} from "../../effect/host-errors";
import type { GitPort, GitPortError } from "../../ports/git-port";
import type { SettingsConfigPort, SettingsConfigError } from "../../ports/settings-config-port";
import type { TaskStoreError, TaskStorePort } from "../../ports/task-repository-ports";
import type { WorktreeFileError, WorktreeFilePort } from "../../ports/worktree-file-port";
import type { AgentSessionLiveStateService } from "../agent-sessions/agent-session-live-state-service";
import type { DevServerService } from "../dev-servers/dev-server-service-types";
import { removeWorktreeAndFilesystemPath } from "../git/worktree-removal";
import { managedWorktreeBaseForRepoConfig } from "../tasks/support/task-cleanup-support";
import type { TerminalService } from "../terminals/terminal-service";
import type { WorkspaceSettingsError, WorkspaceSettingsService } from "./workspace-settings-model";

export type WorkspaceLifecycleError =
  | GitPortError
  | HostOperationErrorAggregate
  | HostValidationErrorAggregate
  | SettingsConfigError
  | TaskStoreError
  | WorktreeFileError
  | WorkspaceSettingsError;

export type WorkspaceActivityBlocker = {
  kind: "agent-session" | "dev-server" | "terminal";
  label: string;
};

export type WorkspaceActivityPort = {
  inspect(repoPath: string): Effect.Effect<WorkspaceActivityBlocker[], HostOperationErrorAggregate>;
};

export type WorkspaceStoragePort = {
  removeWorkspaceData(workspaceId: string): Effect.Effect<void, unknown>;
};

export type WorkspaceLifecycleService = {
  closeWorkspace(input: {
    workspaceId: string;
    expectedRepoPath: string;
  }): Effect.Effect<WorkspaceCatalog, WorkspaceLifecycleError>;
  removeWorkspace(input: {
    workspaceId: string;
    expectedRepoPath: string;
    removeTaskWorktrees: boolean;
  }): Effect.Effect<
    { catalog: WorkspaceCatalog; result: WorkspaceRemovalResult },
    WorkspaceLifecycleError
  >;
};

type CreateWorkspaceLifecycleServiceInput = {
  activity: WorkspaceActivityPort;
  gitPort: Pick<GitPort, "canonicalizePath" | "isRegisteredWorktree" | "removeWorktree">;
  settingsConfig: SettingsConfigPort;
  storage: WorkspaceStoragePort;
  taskStore: Pick<TaskStorePort, "listTasks" | "listAgentSessionsForTasks">;
  workspaceSettingsService: WorkspaceSettingsService;
  worktreeFiles: Pick<
    WorktreeFilePort,
    "pathIsWithinRoot" | "removePathIfPresent" | "resolvePathWithinRoot" | "resolveWorktreePath"
  >;
};

const blockingActivityMessage = (blockers: WorkspaceActivityBlocker[]): string =>
  `Stop the running work before closing or removing this workspace: ${blockers
    .map((blocker) => blocker.label)
    .join("; ")}.`;

const unwrapUnknownError = (cause: unknown): Error =>
  cause instanceof Error ? cause : new Error(String(cause));

const toHostOperationError = (operation: string, message: string, cause: unknown) =>
  new HostOperationError({
    operation,
    message,
    cause: unwrapUnknownError(cause),
  });

export const createWorkspaceActivityInspector = ({
  agentSessionLiveStateService,
  devServerService,
  terminalService,
}: {
  agentSessionLiveStateService: Pick<AgentSessionLiveStateService, "list">;
  devServerService: Pick<DevServerService, "inspectWorkspaceActivity">;
  terminalService: Pick<TerminalService, "inspectWorkspaceActivity">;
}): WorkspaceActivityPort => ({
  inspect: (repoPath) =>
    Effect.gen(function* () {
      const blockers: WorkspaceActivityBlocker[] = [];
      const sessions = yield* agentSessionLiveStateService
        .list({ repoPath })
        .pipe(
          Effect.mapError((cause) =>
            toHostOperationError(
              "workspace.inspectAgentSessions",
              `Failed to inspect agent sessions for ${repoPath}. Stop the running work and retry.`,
              cause,
            ),
          ),
        );
      for (const session of sessions) {
        if (session.activity !== "idle") {
          blockers.push({
            kind: "agent-session",
            label: `agent session ${session.ref.externalSessionId} is ${session.activity}`,
          });
        }
      }

      const devServerActivity = yield* devServerService
        .inspectWorkspaceActivity({ repoPath })
        .pipe(
          Effect.mapError((cause) =>
            toHostOperationError(
              "workspace.inspectDevServers",
              `Failed to inspect dev servers for ${repoPath}. Stop the running work and retry.`,
              cause,
            ),
          ),
        );
      for (const taskId of devServerActivity.activeTaskIds) {
        blockers.push({
          kind: "dev-server",
          label: `dev server for task ${taskId} is running`,
        });
      }

      const terminalActivity = yield* terminalService
        .inspectWorkspaceActivity(repoPath)
        .pipe(
          Effect.mapError((cause) =>
            toHostOperationError(
              "workspace.inspectTerminals",
              `Failed to inspect terminals for ${repoPath}. Close the affected terminals and retry.`,
              cause,
            ),
          ),
        );
      for (const terminalId of terminalActivity.activeTerminalIds) {
        blockers.push({
          kind: "terminal",
          label: `terminal ${terminalId} is running a command`,
        });
      }
      for (const terminalId of terminalActivity.unknownTerminalIds) {
        blockers.push({
          kind: "terminal",
          label: `terminal ${terminalId} activity cannot be verified`,
        });
      }

      return blockers;
    }),
});

export const createWorkspaceLifecycleService = ({
  activity,
  gitPort,
  settingsConfig,
  storage,
  taskStore,
  workspaceSettingsService,
  worktreeFiles,
}: CreateWorkspaceLifecycleServiceInput): WorkspaceLifecycleService => {
  const requireTarget = (workspaceId: string, expectedRepoPath: string) =>
    Effect.gen(function* () {
      const repoConfig = yield* workspaceSettingsService.getRepoConfig(workspaceId);
      if (repoConfig.repoPath !== expectedRepoPath) {
        return yield* Effect.fail(
          new HostValidationError({
            message: `Workspace ${workspaceId} changed since the dialog opened. Reload workspaces and retry.`,
            field: "repoPath",
            details: { expectedRepoPath, actualRepoPath: repoConfig.repoPath },
          }),
        );
      }
      return repoConfig;
    });

  const assertNoBlockingActivity = (repoPath: string) =>
    Effect.gen(function* () {
      const blockers = yield* activity.inspect(repoPath);
      if (blockers.length > 0) {
        return yield* Effect.fail(
          new HostValidationError({
            message: blockingActivityMessage(blockers),
            field: "workspaceId",
            details: { blockers, repoPath },
          }),
        );
      }
    });

  const collectTaskWorktreePaths = (repoConfig: RepoConfig) =>
    Effect.gen(function* () {
      const { repoPath, workspaceId } = repoConfig;
      const tasks = yield* taskStore.listTasks({ repoPath });
      if (tasks.length === 0) {
        return [];
      }
      const taskIds = tasks.map((task) => task.id);
      const sessionsByTask = yield* taskStore.listAgentSessionsForTasks({ repoPath, taskIds });
      const managedWorktreeBasePath = managedWorktreeBaseForRepoConfig(settingsConfig, repoConfig);
      const catalog = yield* workspaceSettingsService.getWorkspaceCatalog();
      const otherWorkspacePaths = new Set(
        [...catalog.openWorkspaces, ...catalog.closedWorkspaces]
          .filter((workspace) => workspace.workspaceId !== workspaceId)
          .map((workspace) => normalizePathForComparison(workspace.repoPath)),
      );

      const candidates = new Map<string, { path: string; taskId: string }>();
      for (const task of tasks) {
        const canonicalPath = settingsConfig.join(managedWorktreeBasePath, task.id);
        candidates.set(normalizePathForComparison(canonicalPath), {
          path: canonicalPath,
          taskId: task.id,
        });
      }
      for (const record of sessionsByTask) {
        for (const session of record.agentSessions) {
          const workingDirectory = session.workingDirectory.trim();
          if (!workingDirectory) {
            continue;
          }
          candidates.set(normalizePathForComparison(workingDirectory), {
            path: workingDirectory,
            taskId: record.taskId,
          });
        }
      }

      const repoPathComparison = normalizePathForComparison(repoPath);
      const seen = new Set<string>();
      const worktreePaths: string[] = [];
      for (const [candidateComparison, candidate] of candidates) {
        if (
          candidateComparison === repoPathComparison ||
          otherWorkspacePaths.has(candidateComparison)
        ) {
          continue;
        }
        if (!(yield* settingsConfig.pathExists(candidate.path))) {
          continue;
        }
        const canonicalPath = yield* gitPort.canonicalizePath(candidate.path);
        const canonicalComparison = normalizePathForComparison(canonicalPath);
        if (
          canonicalComparison === repoPathComparison ||
          otherWorkspacePaths.has(canonicalComparison)
        ) {
          continue;
        }
        if (seen.has(canonicalComparison)) {
          continue;
        }
        if (!(yield* gitPort.isRegisteredWorktree(repoPath, canonicalPath))) {
          return yield* Effect.fail(
            new HostValidationError({
              message: `Cannot establish that ${canonicalPath} is a task worktree of ${repoPath}. Remove it manually, or retry without removing task worktrees.`,
              field: "worktreePath",
              details: {
                repoPath,
                taskId: candidate.taskId,
                worktreePath: canonicalPath,
              },
            }),
          );
        }
        seen.add(canonicalComparison);
        worktreePaths.push(canonicalPath);
      }
      return worktreePaths;
    });

  const removeTaskWorktrees = (repoConfig: RepoConfig, workspaceId: string) =>
    Effect.gen(function* () {
      const worktreePaths = yield* collectTaskWorktreePaths(repoConfig);
      const managedWorktreeBasePath = managedWorktreeBaseForRepoConfig(settingsConfig, repoConfig);
      const removedWorktrees: string[] = [];
      for (const worktreePath of worktreePaths) {
        const result = yield* Effect.either(
          removeWorktreeAndFilesystemPath(
            { gitPort, settingsConfig, worktreeFiles },
            {
              force: true,
              managedWorktreeBasePath,
              missingOutsideManagedRootPathPolicy: "skip",
              repoPath: repoConfig.repoPath,
              worktreePath,
            },
          ),
        );
        if (result._tag === "Left") {
          return yield* Effect.fail(
            new HostOperationError({
              operation: "workspace.removeTaskWorktree",
              message: `Removed ${removedWorktrees.length} task worktree(s). Failed to remove ${worktreePath}: ${result.left.message}. The workspace, its task data, and the remaining worktrees stay registered. Fix the failing path and retry removal. Keep local branches and committed history.`,
              cause: unwrapUnknownError(result.left),
              details: {
                failedPath: worktreePath,
                phase: "worktrees",
                removedWorktrees,
                workspaceId,
              },
            }),
          );
        }
        removedWorktrees.push(worktreePath);
      }
      return removedWorktrees;
    });

  return {
    closeWorkspace(input) {
      return Effect.gen(function* () {
        const repoConfig = yield* requireTarget(input.workspaceId, input.expectedRepoPath);
        if (repoConfig.closed) {
          return yield* workspaceSettingsService.getWorkspaceCatalog();
        }
        yield* assertNoBlockingActivity(repoConfig.repoPath);
        return yield* workspaceSettingsService.closeWorkspace(
          input.workspaceId,
          input.expectedRepoPath,
        );
      });
    },
    removeWorkspace(input) {
      return Effect.gen(function* () {
        const repoConfig = yield* requireTarget(input.workspaceId, input.expectedRepoPath);
        yield* assertNoBlockingActivity(repoConfig.repoPath);

        const removedWorktrees = input.removeTaskWorktrees
          ? yield* removeTaskWorktrees(repoConfig, input.workspaceId)
          : [];

        const cleanupResult = yield* Effect.either(storage.removeWorkspaceData(input.workspaceId));
        if (cleanupResult._tag === "Left") {
          const cause = unwrapUnknownError(cleanupResult.left);
          return yield* Effect.fail(
            new HostOperationError({
              operation: "workspace.removeWorkspaceData",
              message: `Removed ${removedWorktrees.length} task worktree(s). Failed to remove the workspace task data: ${cause.message}. The workspace registration remains. Fix the failing data and retry removal.`,
              cause,
              details: {
                phase: "workspace_data",
                removedWorktrees,
                workspaceId: input.workspaceId,
              },
            }),
          );
        }

        const catalog = yield* workspaceSettingsService.removeWorkspaceRegistration(
          input.workspaceId,
          input.expectedRepoPath,
        );
        return { catalog, result: { removedWorktrees } };
      });
    },
  };
};

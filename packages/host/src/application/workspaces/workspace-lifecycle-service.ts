import type {
  RepoConfig,
  WorkspaceCatalog,
  WorkspaceRemovalPhase,
  WorkspaceRemovalResult,
} from "@openducktor/contracts";
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
import type { WorkspaceAdmissionService } from "./workspace-admission-service";
import type { WorkspaceSettingsError, WorkspaceSettingsService } from "./workspace-settings-model";
import {
  collectWorkspaceTaskWorktreePaths,
  type WorkspaceWorktreeInventoryError,
} from "./workspace-worktree-inventory";

export type WorkspaceLifecycleError =
  | GitPortError
  | HostOperationErrorAggregate
  | HostValidationErrorAggregate
  | SettingsConfigError
  | TaskStoreError
  | WorktreeFileError
  | WorkspaceSettingsError
  | WorkspaceWorktreeInventoryError;

export type WorkspaceActivityBlocker = {
  kind: "agent-session" | "dev-server" | "terminal";
  label: string;
};

export type WorkspaceActivityPort = {
  inspect(repoPath: string): Effect.Effect<WorkspaceActivityBlocker[], HostOperationErrorAggregate>;
};

export type WorkspaceStoragePort = {
  removeWorkspaceTaskAssets(workspaceId: string): Effect.Effect<void, unknown>;
  removeWorkspaceTaskStore(workspaceId: string): Effect.Effect<void, unknown>;
};

export type WorkspaceLifecycleService = {
  closeWorkspace(input: {
    workspaceId: string;
    expectedRepoPath: string;
  }): Effect.Effect<WorkspaceCatalog, WorkspaceLifecycleError>;
  reopenWorkspace(input: {
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
  admission: Pick<
    WorkspaceAdmissionService,
    | "blockWorkspace"
    | "forgetWorkspace"
    | "releaseReservation"
    | "reserveWorkspace"
    | "unblockWorkspace"
    | "withAdministrativeAccess"
  >;
  gitPort: Pick<
    GitPort,
    "canonicalizePath" | "isRegisteredWorktree" | "listWorktrees" | "removeWorktree"
  >;
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
  admission,
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

  const removeWorktree = (repoConfig: RepoConfig, worktreePath: string) =>
    removeWorktreeAndFilesystemPath(
      { gitPort, settingsConfig, worktreeFiles },
      {
        force: true,
        managedWorktreeBasePath: managedWorktreeBaseForRepoConfig(settingsConfig, repoConfig),
        missingOutsideManagedRootPathPolicy: "skip",
        repoPath: repoConfig.repoPath,
        worktreePath,
      },
    );

  const failRemovalPhase = (
    workspaceId: string,
    phase: WorkspaceRemovalPhase,
    removedWorktrees: string[],
    failedPath: string | undefined,
    message: string,
    cause: unknown,
  ) =>
    workspaceSettingsService
      .recordWorkspaceRemovalProgress({
        workspaceId,
        phase,
        removedWorktrees,
        lastFailure: message,
      })
      .pipe(
        Effect.catchAll((journalError) =>
          Effect.fail(
            new HostOperationError({
              operation: `workspace.removeWorkspace.${phase}`,
              message: `${message} The removal progress could not be saved: ${journalError.message}`,
              cause: unwrapUnknownError(journalError),
              details: { failedPath, phase, removedWorktrees, workspaceId },
            }),
          ),
        ),
        Effect.zipRight(
          Effect.fail(
            new HostOperationError({
              operation: `workspace.removeWorkspace.${phase}`,
              message,
              cause: unwrapUnknownError(cause),
              details: { failedPath, phase, removedWorktrees, workspaceId },
            }),
          ),
        ),
      );

  const persistProgress = (
    workspaceId: string,
    phase: WorkspaceRemovalPhase,
    removedWorktrees: string[],
    lastFailure: string | null,
  ) =>
    workspaceSettingsService.recordWorkspaceRemovalProgress({
      workspaceId,
      phase,
      removedWorktrees,
      lastFailure,
    });

  const executeRemoval = (
    input: {
      workspaceId: string;
      expectedRepoPath: string;
      removeTaskWorktrees: boolean;
    },
    repoConfig: RepoConfig,
  ) =>
    Effect.gen(function* () {
      if (!repoConfig.removal) {
        yield* assertNoBlockingActivity(repoConfig.repoPath);
      }
      const startedRecord = yield* workspaceSettingsService.beginWorkspaceRemoval({
        workspaceId: input.workspaceId,
        expectedRepoPath: input.expectedRepoPath,
        removeTaskWorktrees: input.removeTaskWorktrees,
      });
      const removeTaskWorktrees = startedRecord.removeTaskWorktrees;
      admission.blockWorkspace({
        reason: "removal",
        repoPath: repoConfig.repoPath,
        workspaceId: input.workspaceId,
      });

      const removedWorktrees = [...startedRecord.removedWorktrees];
      let phase = startedRecord.phase;

      if (phase === "worktrees" && removeTaskWorktrees) {
        const worktreePaths = yield* admission.withAdministrativeAccess(
          input.workspaceId,
          collectWorkspaceTaskWorktreePaths(
            { gitPort, settingsConfig, taskStore, workspaceSettingsService },
            repoConfig,
          ),
        );
        const removedComparisons = new Set(
          removedWorktrees.map((path) => normalizePathForComparison(path)),
        );
        for (const worktreePath of worktreePaths) {
          if (removedComparisons.has(normalizePathForComparison(worktreePath))) {
            continue;
          }
          const result = yield* Effect.either(removeWorktree(repoConfig, worktreePath));
          if (result._tag === "Left") {
            return yield* failRemovalPhase(
              input.workspaceId,
              "worktrees",
              removedWorktrees,
              worktreePath,
              `Removed ${removedWorktrees.length} task worktree(s). Failed to remove ${worktreePath}: ${result.left.message}. Retry removal to continue. Local branches and committed history stay.`,
              result.left,
            );
          }
          removedWorktrees.push(worktreePath);
          removedComparisons.add(normalizePathForComparison(worktreePath));
          yield* persistProgress(input.workspaceId, "worktrees", removedWorktrees, null);
        }
        phase = "attachments";
        yield* persistProgress(input.workspaceId, phase, removedWorktrees, null);
      }

      if (phase === "attachments") {
        const assetsResult = yield* Effect.either(
          storage.removeWorkspaceTaskAssets(input.workspaceId),
        );
        if (assetsResult._tag === "Left") {
          return yield* failRemovalPhase(
            input.workspaceId,
            "attachments",
            removedWorktrees,
            undefined,
            `Failed to remove workspace task attachments: ${unwrapUnknownError(assetsResult.left).message}. Retry removal to continue.`,
            assetsResult.left,
          );
        }
        phase = "task_store";
        yield* persistProgress(input.workspaceId, phase, removedWorktrees, null);
      }

      if (phase === "task_store") {
        const storeResult = yield* Effect.either(
          storage.removeWorkspaceTaskStore(input.workspaceId),
        );
        if (storeResult._tag === "Left") {
          return yield* failRemovalPhase(
            input.workspaceId,
            "task_store",
            removedWorktrees,
            undefined,
            `Failed to remove the workspace task store: ${unwrapUnknownError(storeResult.left).message}. The workspace stays frozen. Retry removal to continue.`,
            storeResult.left,
          );
        }
      }

      const catalog = yield* workspaceSettingsService.removeWorkspaceRegistration(
        input.workspaceId,
        input.expectedRepoPath,
      );
      admission.forgetWorkspace(input.workspaceId);
      return { catalog, result: { removedWorktrees } };
    });

  const runUnderReservation = <A, E, R>(
    input: {
      operation: "close" | "reopen" | "remove";
      repoPath: string;
      workspaceId: string;
    },
    use: () => Effect.Effect<A, E, R>,
  ) =>
    Effect.acquireUseRelease(admission.reserveWorkspace(input), use, () =>
      Effect.sync(() => admission.releaseReservation(input.workspaceId)),
    );

  return {
    closeWorkspace(input) {
      return Effect.gen(function* () {
        const repoConfig = yield* requireTarget(input.workspaceId, input.expectedRepoPath);
        if (repoConfig.closed) {
          return yield* workspaceSettingsService.getWorkspaceCatalog();
        }
        return yield* runUnderReservation(
          {
            operation: "close",
            repoPath: repoConfig.repoPath,
            workspaceId: input.workspaceId,
          },
          () =>
            Effect.gen(function* () {
              yield* assertNoBlockingActivity(repoConfig.repoPath);
              const catalog = yield* workspaceSettingsService.closeWorkspace(
                input.workspaceId,
                input.expectedRepoPath,
              );
              admission.blockWorkspace({
                reason: "closed",
                repoPath: repoConfig.repoPath,
                workspaceId: input.workspaceId,
              });
              return catalog;
            }),
        );
      });
    },
    reopenWorkspace(input) {
      return Effect.gen(function* () {
        const repoConfig = yield* requireTarget(input.workspaceId, input.expectedRepoPath);
        return yield* runUnderReservation(
          {
            operation: "reopen",
            repoPath: repoConfig.repoPath,
            workspaceId: input.workspaceId,
          },
          () =>
            Effect.gen(function* () {
              const catalog = yield* workspaceSettingsService.reopenWorkspace(
                input.workspaceId,
                input.expectedRepoPath,
              );
              admission.unblockWorkspace(input.workspaceId);
              return catalog;
            }),
        );
      });
    },
    removeWorkspace(input) {
      return Effect.gen(function* () {
        const repoConfig = yield* requireTarget(input.workspaceId, input.expectedRepoPath);
        return yield* runUnderReservation(
          {
            operation: "remove",
            repoPath: repoConfig.repoPath,
            workspaceId: input.workspaceId,
          },
          () => executeRemoval(input, repoConfig),
        );
      });
    },
  };
};

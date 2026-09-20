import { withOtherInstallationSessionOwners } from "../../adapters/sqlite/sqlite-other-installation-session-owners";
import { resolveOpenDucktorBaseDir } from "../../config/openducktor-config-dir";
import { Effect } from "effect";
import { rm } from "node:fs/promises";
import path from "node:path";
import { createNodeTaskAssetFilePort } from "../../adapters/node/filesystem-task-asset-file-port";
import { createSqliteTaskAssetRegistry } from "../../adapters/sqlite/sqlite-task-asset-registry";
import { createSqliteTaskRepository } from "../../adapters/sqlite/sqlite-task-repository";
import { createSqliteWorkspaceSessionStore } from "../../adapters/sqlite/sqlite-workspace-session-store";
import type { WorkspaceSessionStorePort } from "../../ports/workspace-session-store-port";
import { createSqliteTaskRepositoryContextManager } from "../../adapters/sqlite/sqlite-task-repository-context";
import { createTaskAssetAwareTaskStore } from "../../application/task-assets/task-asset-aware-task-store";
import {
  createTaskAssetReadService,
  type TaskAssetReadService,
} from "../../application/task-assets/task-asset-read-service";
import { createTaskAssetRecoveryService } from "../../application/task-assets/task-asset-recovery-service";
import {
  createTaskAssetStagingService,
  type TaskAssetStagingService,
} from "../../application/task-assets/task-asset-staging-service";
import type { WorkspaceSettingsService } from "../../application/workspaces/workspace-settings-model";
import type { OpenDucktorConfigDir } from "../../config/openducktor-config-dir";
import type { TaskAssetError } from "../../effect/task-asset-error";
import {
  HostOperationError,
  type HostOperationErrorAggregate,
  type HostValidationErrorAggregate,
} from "../../effect/host-errors";
import type { TaskStoreError, TaskStorePort } from "../../ports/task-repository-ports";
import type { HostShutdownStep } from "../host-lifecycle";

export type NodeTaskAssetServices = {
  workspaceSessionStore: WorkspaceSessionStorePort;
  startupSweep: () => Effect.Effect<void, TaskStoreError>;
  taskAssetReadService: TaskAssetReadService;
  taskAssetStagingService: TaskAssetStagingService;
  taskStoreConnectionShutdownStep: HostShutdownStep;
  taskAssetStagingShutdownStep: HostShutdownStep;
  taskStore: TaskStorePort;
  removeWorkspaceTaskAssets: (workspaceId: string) => Effect.Effect<void, TaskAssetError>;
  removeWorkspaceTaskStore: (
    workspaceId: string,
  ) => Effect.Effect<void, HostOperationErrorAggregate>;
};

export const createNodeTaskAssetServices = ({
  configDir,
  assertWorkspaceAdmitted,
  configuredTaskStore,
  isWorkspaceBlocked,
  onBackgroundFailure,
  processEnv,
  workspaceSettingsService,
}: {
  configDir: OpenDucktorConfigDir;
  assertWorkspaceAdmitted?: (input: {
    operation: string;
    repoPath: string;
    workspaceId: string;
  }) => Effect.Effect<void, HostOperationErrorAggregate | HostValidationErrorAggregate>;
  configuredTaskStore?: TaskStorePort | undefined;
  isWorkspaceBlocked?: (workspaceId: string) => boolean;
  onBackgroundFailure: (failure: HostOperationErrorAggregate) => Effect.Effect<void, never>;
  processEnv: NodeJS.ProcessEnv;
  workspaceSettingsService: WorkspaceSettingsService;
}): NodeTaskAssetServices => {
  const resolveWorkspaceIdForRepoPath = (repoPath: string) =>
    workspaceSettingsService
      .getRepoConfigByRepoPath(repoPath)
      .pipe(Effect.map((repoConfig) => repoConfig.workspaceId));
  const filePort = createNodeTaskAssetFilePort({
    configDir: configDir.root,
    configDirScope: configDir.scope,
    reportProbeFailure: ({ cause, owner }) =>
      Effect.runPromise(
        onBackgroundFailure(
          new HostOperationError({
            operation: "taskAssets.probeOwner",
            message: `Could not verify task asset owner '${owner.instanceId}' process ${owner.processId}. OpenDucktor kept its staged files.`,
            cause,
            details: {
              instanceId: owner.instanceId,
              processId: owner.processId,
            },
          }),
        ),
      ),
  });
  const taskAssetStagingService = createTaskAssetStagingService(filePort);
  const contextManagerInput: Parameters<typeof createSqliteTaskRepositoryContextManager>[0] = {
    configDir: configDir.root,
    onBackgroundFailure,
    processEnv,
    resolveWorkspaceIdForRepoPath,
  };
  if (assertWorkspaceAdmitted) {
    contextManagerInput.assertWorkspaceAdmitted = assertWorkspaceAdmitted;
  }
  const contextManager = createSqliteTaskRepositoryContextManager(contextManagerInput);
  const registry = createSqliteTaskAssetRegistry({
    contextProvider: contextManager.withDatabase,
  });
  const inner =
    configuredTaskStore ??
    createSqliteTaskRepository({
      contextProvider: contextManager.withDatabase,
    });
  const taskAssetReadService = createTaskAssetReadService({
    filePort,
    registry,
    resolveRepoPath: (workspaceId) =>
      workspaceSettingsService
        .getRepoConfig(workspaceId)
        .pipe(Effect.map((repoConfig) => repoConfig.repoPath)),
  });
  const recoveryServiceInput: Parameters<typeof createTaskAssetRecoveryService>[0] = {
    filePort,
    registry,
    resolveRepoPath: (workspaceId) =>
      workspaceSettingsService
        .getRepoConfig(workspaceId)
        .pipe(Effect.map((repoConfig) => repoConfig.repoPath)),
    taskStore: inner,
  };
  if (isWorkspaceBlocked) {
    recoveryServiceInput.isWorkspaceBlocked = isWorkspaceBlocked;
  }
  const taskAssetRecoveryService = createTaskAssetRecoveryService(recoveryServiceInput);
  const taskStoreRoot = path.join(configDir.root, "task-stores");

  return {
    workspaceSessionStore: withOtherInstallationSessionOwners(
      createSqliteWorkspaceSessionStore(contextManager.withDatabase),
      configDir.scope === "test"
        ? []
        : [
            resolveOpenDucktorBaseDir("production", {}),
            resolveOpenDucktorBaseDir("dev", {}),
          ].filter((root) => path.resolve(root) !== path.resolve(configDir.root)),
    ),
    startupSweep: () =>
      taskAssetRecoveryService
        .startupSweep()
        .pipe(Effect.zipRight(taskAssetStagingService.startupSweep()), Effect.asVoid),
    taskAssetReadService,
    taskAssetStagingService,
    taskAssetStagingShutdownStep: {
      label: "task asset staging",
      run: () =>
        taskAssetStagingService.shutdownCleanup().pipe(
          Effect.mapError(
            (cause) =>
              new HostOperationError({
                operation: "host.dispose.task_assets",
                message: cause.message,
                cause,
              }),
          ),
        ),
    },
    taskStoreConnectionShutdownStep: {
      label: "SQLite task store connections",
      run: contextManager.dispose,
    },
    taskStore: createTaskAssetAwareTaskStore({
      inner,
      registry,
      filePort,
      staging: taskAssetStagingService,
      persistence: configuredTaskStore ? null : registry,
      resolveWorkspaceIdForRepoPath,
    }),
    removeWorkspaceTaskAssets: (workspaceId) => filePort.removeWorkspaceData({ workspaceId }),
    removeWorkspaceTaskStore: (workspaceId) =>
      Effect.gen(function* () {
        yield* contextManager.closeWorkspace(workspaceId);
        yield* Effect.tryPromise({
          try: () => rm(path.join(taskStoreRoot, workspaceId), { force: true, recursive: true }),
          catch: (cause) =>
            new HostOperationError({
              operation: "workspace.removeTaskStoreDirectory",
              message: `Failed to remove the task store directory for workspace ${workspaceId}.`,
              cause,
            }),
        });
      }),
  };
};

import { getScopedRepoConfig } from "../../application/tasks/support/scoped-repo-config";
import { Effect } from "effect";
import { createNodeTaskAssetFilePort } from "../../adapters/node/filesystem-task-asset-file-port";
import { createSqliteTaskAssetRegistry } from "../../adapters/sqlite/sqlite-task-asset-registry";
import { createSqliteTaskRepository } from "../../adapters/sqlite/sqlite-task-repository";
import { createSqliteIssueImportStore } from "../../adapters/sqlite/sqlite-issue-import-store";
import { createSqliteWorkspaceSessionStore } from "../../adapters/sqlite/sqlite-workspace-session-store";
import type { WorkspaceSessionStorePort } from "../../ports/workspace-session-store-port";
import type {
  SqliteHostDatabaseManager,
  SqliteTaskRepositoryContextProvider,
  SqliteWorkspacesReadProvider,
  WorkspaceDatabaseScope,
} from "../../adapters/sqlite/sqlite-task-repository-context";
import { createSqliteTaskOwnershipReader } from "../../adapters/sqlite/sqlite-workspace-ownership-reads";
import type { WorkspaceAdmissionService } from "../../application/workspaces/workspace-admission-service";
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
  HostValidationError,
  type HostOperationErrorAggregate,
} from "../../effect/host-errors";
import type {
  TaskOwnershipReader,
  TaskStoreError,
  TaskStorePort,
} from "../../ports/task-repository-ports";
import type { IssueImportStorePort } from "../../ports/issue-import-store-port";
import type { HostShutdownStep } from "../host-lifecycle";

const issueImportUnavailable = () =>
  Effect.fail(
    new HostValidationError({
      field: "taskStore",
      message:
        "Issue import requires the default SQLite Task store. Restart without a custom Task store.",
    }),
  );

const unsupportedIssueImportStore: IssueImportStorePort = {
  getSourceIssue: issueImportUnavailable,
  findLinkedTaskIds: issueImportUnavailable,
  findSourceScopes: issueImportUnavailable,
  replaceSourceScope: issueImportUnavailable,
  createImportedTask: issueImportUnavailable,
};

export type NodeTaskAssetServices = {
  workspaceSessionStore: WorkspaceSessionStorePort;
  taskOwnership: TaskOwnershipReader;
  startupSweep: () => Effect.Effect<void, TaskStoreError>;
  taskAssetReadService: TaskAssetReadService;
  taskAssetStagingService: TaskAssetStagingService;
  taskStoreConnectionShutdownStep: HostShutdownStep;
  taskAssetStagingShutdownStep: HostShutdownStep;
  taskStore: TaskStorePort;
  issueImportStore: IssueImportStorePort;
  removeWorkspaceTaskAssets: (workspaceId: string) => Effect.Effect<void, TaskAssetError>;
};

export const createNodeTaskAssetServices = ({
  configDir,
  contextManager,
  resolveTaskStoreAccess,
  configuredTaskStore,
  isWorkspaceBlocked,
  onBackgroundFailure,
  workspaceSettingsService,
}: {
  configDir: OpenDucktorConfigDir;
  contextManager: SqliteHostDatabaseManager;
  /** Decides the lifecycle access of each operation. The store checks it in the transaction. */
  resolveTaskStoreAccess: WorkspaceAdmissionService["resolveTaskStoreAccess"];
  configuredTaskStore?: TaskStorePort | undefined;
  isWorkspaceBlocked?: (workspaceId: string) => boolean;
  onBackgroundFailure: (failure: HostOperationErrorAggregate) => Effect.Effect<void, never>;
  workspaceSettingsService: WorkspaceSettingsService;
}): NodeTaskAssetServices => {
  const admit = (scope: WorkspaceDatabaseScope, operation: string) =>
    resolveTaskStoreAccess({
      access: scope.access ?? "open",
      operation,
      repoPath: scope.repoPath,
      workspaceId: scope.workspaceId,
    }).pipe(Effect.map((access) => ({ ...scope, access })));
  const contextProvider: SqliteTaskRepositoryContextProvider = (scope, operation, use) =>
    admit(scope, operation).pipe(
      Effect.flatMap((admitted) => contextManager.withDatabase(admitted, operation, use)),
    );
  const workspacesProvider: SqliteWorkspacesReadProvider = (scopes, operation, use) =>
    Effect.forEach(scopes, (scope) => admit(scope, operation)).pipe(
      Effect.flatMap((admitted) => contextManager.readWorkspaces(admitted, operation, use)),
    );
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
  const registry = createSqliteTaskAssetRegistry({
    contextProvider,
  });
  const inner =
    configuredTaskStore ??
    createSqliteTaskRepository({
      contextProvider,
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

  return {
    workspaceSessionStore: createSqliteWorkspaceSessionStore({
      contextProvider,
      workspacesProvider,
    }),
    taskOwnership: createSqliteTaskOwnershipReader(workspacesProvider),
    startupSweep: () =>
      taskAssetRecoveryService
        .startupSweep()
        .pipe(Effect.andThen(taskAssetStagingService.startupSweep()), Effect.asVoid),
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
      label: "host database connection",
      run: contextManager.dispose,
    },
    taskStore: createTaskAssetAwareTaskStore({
      inner,
      registry,
      filePort,
      staging: taskAssetStagingService,
      persistence: configuredTaskStore ? null : registry,
      resolveWorkspaceId: (scope) =>
        Effect.gen(function* () {
          const config = yield* getScopedRepoConfig(workspaceSettingsService, {
            workspaceId: scope.workspaceId,
            repoPath: scope.repoPath,
          });
          return config.workspaceId;
        }),
    }),
    issueImportStore: configuredTaskStore
      ? unsupportedIssueImportStore
      : createSqliteIssueImportStore({ contextProvider }),
    removeWorkspaceTaskAssets: (workspaceId) => filePort.removeWorkspaceData({ workspaceId }),
  };
};

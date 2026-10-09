import { createEffectHostCommandRouter } from "../../interface/router/host-command-router";
import { createRuntimeAdmissionGate } from "@openducktor/runtime-orchestration";
import { createNodeAgentRuntimeQueryCommandHandlers } from "./node-agent-runtime-query-command-handlers";
import { createNodeNotificationServices } from "./node-notification-services";
import { createNotificationCommandHandlers } from "../../interface/commands/notification-command-handlers";
import { createWorkspaceSessionImportCommandHandlers } from "../../interface/commands/workspace-session-import-command-handlers";
import { createNodeImageCommandHandlers } from "./node-image-command-handlers";
import { createNodeGitProviderCommandHandlers } from "./node-git-provider-command-handlers";
import { createNodeWorkspaceProviderSetup } from "./node-workspace-provider-setup";
import { Effect } from "effect";
import { HostOperationError } from "../../effect/host-errors";
import {
  createMcpHostBridgeServer,
  resolveMcpBridgeDiscoveryPath,
} from "../../adapters/mcp/mcp-host-bridge-server";
import { createRuntimeTaskActivityGuard } from "../../application/tasks/runtime-task-activity-guard";
import { createLocalAttachmentService } from "../../application/attachments/local-attachment-service";
import { createDevServerService } from "../../application/dev-servers/dev-server-service";
import { createSystemDiagnosticsService } from "../../application/diagnostics/system-diagnostics-service";
import { createFilesystemService } from "../../application/filesystem/filesystem-service";
import { createWorkspaceFilesService } from "../../application/filesystem/workspace-files-service";
import { createWorkspaceActivityInspector } from "../../application/workspaces/workspace-activity-inspector";
import { createWorkspaceLifecycleService } from "../../application/workspaces/workspace-lifecycle-service";
import { createGitService } from "../../application/git/git-service";
import { createOdtMcpBridgeService } from "../../application/mcp/odt-mcp-bridge-service";
import { createPullRequestReviewService } from "../../application/pull-requests/pull-request-review-service";
import { createRuntimeAdmissionPort } from "../../application/runtimes/host-runtime-ports";
import { createTaskSessionStopService } from "../../application/tasks/task-session-stop-service";
import { createOpenInToolsService } from "../../application/system/open-in-tools-service";
import { createTaskSessionLifecycleCoordinator } from "../../application/tasks/worktrees/task-session-lifecycle-coordinator";
import { createTaskWorktreeService } from "../../application/tasks/worktrees/task-worktree-service";
import { createTerminalService } from "../../application/terminals/terminal-service";
import { createWorkspaceSessionCommandHandlers } from "../../interface/commands/workspace-session-command-handlers";
import type { GitProviderResolver } from "../../application/git/git-provider-resolver";
import type { AzureDevOpsConnectionPort } from "../../ports/azure-devops-connection-port";
import type { AzureAreaPathsPort } from "../../ports/azure-area-paths-port";
import { createTerminalLaunchEnvironment } from "../../infrastructure/terminals/terminal-launch-environment";
import { createAgentSessionLiveCommandHandlers } from "../../interface/commands/agent-session-live-command-handlers";
import { createDevServerCommandHandlers } from "../../interface/commands/dev-server-command-handlers";
import { createFilesystemCommandHandlers } from "../../interface/commands/filesystem-command-handlers";
import { createGitCommandHandlers } from "../../interface/commands/git-command-handlers";
import { createLocalAttachmentCommandHandlers } from "../../interface/commands/local-attachment-command-handlers";
import { createOpenInToolsCommandHandlers } from "../../interface/commands/open-in-tools-command-handlers";
import { createPullRequestReviewCommandHandlers } from "../../interface/commands/pull-request-review-command-handlers";
import { createRuntimeDefinitionsCommandHandlers } from "../../interface/commands/runtime-definitions-command-handlers";
import { createRuntimeCommandHandlers } from "../../interface/commands/runtime-command-handlers";
import { createSystemDiagnosticsCommandHandlers } from "../../interface/commands/system-diagnostics-command-handlers";
import { createSystemPlatformCommandHandlers } from "../../interface/commands/system-platform-command-handlers";
import { createTaskAssetCommandHandlers } from "../../interface/commands/task-asset-command-handlers";
import { createTaskCommandHandlers } from "../../interface/commands/task-command-handlers";
import { createTaskWorktreeCommandHandlers } from "../../interface/commands/task-worktree-command-handlers";
import { createTerminalCommandHandlers } from "../../interface/commands/terminal-command-handlers";
import { createWorkspaceFilesCommandHandlers } from "../../interface/commands/workspace-files-command-handlers";
import { createWorkspaceLifecycleCommandHandlers } from "../../interface/commands/workspace-lifecycle-command-handlers";
import { createWorkspaceSettingsCommandHandlers } from "../../interface/commands/workspace-settings-command-handlers";
import { createHostRuntimeDefinitionsService } from "./create-host-runtime-definitions-service";
import type {
  CreateNodeHostCommandRouterInput,
  EffectNodeHostCommandRouter,
} from "./node-host-command-router-types";
import type { NodeHostDefaultPorts } from "./node-host-default-ports";
import { createNodeAgentSessionLiveState } from "./node-agent-session-live-state";
import { createLiveSessionFaultLogger, defaultLifecycleLogger } from "./node-host-lifecycle-logger";
import { createNodeRuntimeExecutableCommandHandlers } from "./node-runtime-executable-command-handlers";
import { createNodeHostRouterLifecycle } from "./node-host-router-lifecycle";
import { createNodeHostRuntimeComposition } from "./node-host-runtime-composition";
import { createNodeTaskAssetServices } from "./node-task-asset-services";
import { createNodeTaskSessionServices } from "./node-task-session-services";
import { createNodeWorkspaceSessionPersistence } from "./node-workspace-session-persistence";
import { createNodeWorkspaceSessionServices } from "./node-workspace-session-services";
import { createMcpBridgeStatusPublisher } from "./runtime-lifecycle-publisher";
import { createModelCatalogPreviewComposition as previewModels } from "./model-catalog-preview-composition";
export type { CreateNodeHostCommandRouterInput, EffectNodeHostCommandRouter };
export const assembleNodeEffectHostCommandRouter = (
  input: CreateNodeHostCommandRouterInput,
  defaultPorts: NodeHostDefaultPorts,
  gitProviderResolver: GitProviderResolver,
  azureDevOpsConnection: AzureDevOpsConnectionPort | undefined,
  azureAreaPaths: AzureAreaPathsPort,
): EffectNodeHostCommandRouter => {
  const {
    clientVersion,
    eventBus,
    lifecycleLogger = defaultLifecycleLogger,
    mcpHostBridge,
    onBackgroundFailure,
    runtimeStarter: configuredRuntimeStarter,
    taskStore: configuredTaskStore,
    taskEventPublicationReporter,
  } = input;
  const {
    devServerProcesses,
    filesystem,
    git,
    localAttachments,
    openInTools,
    configDir,
    runtimeHealth,
    settingsConfig: baseSettingsConfig,
    systemCommands,
    terminalPty,
    toolDiscovery,
    userEnvironment,
    readEnv,
    startupEnv,
    worktreeFiles,
  } = defaultPorts;
  const notificationComposition = createNodeNotificationServices(baseSettingsConfig, eventBus);
  const { settingsConfig } = notificationComposition;
  const setup = createNodeWorkspaceProviderSetup({ ...defaultPorts, settingsConfig }, input);
  const { workspaceSettingsService, workspaceProviderSetup, workspaceAdmissionService } = setup;
  const assets = createNodeTaskAssetServices({
    configDir,
    assertWorkspaceAdmitted: workspaceAdmissionService.assertTaskStoreAccess,
    configuredTaskStore,
    isWorkspaceBlocked: workspaceAdmissionService.isWorkspaceBlocked,
    onBackgroundFailure,
    processEnv: startupEnv,
    workspaceSettingsService,
  });
  const { startupSweep, taskAssetReadService, taskAssetStagingService, taskStore } = assets;
  const workspaceSessions = createNodeWorkspaceSessionPersistence({
    taskStore,
    store: assets.workspaceSessionStore,
    settings: workspaceSettingsService,
    git,
    eventBus,
    faultLog: createLiveSessionFaultLogger(lifecycleLogger),
    updateRuntimeSessionTitle: (input) => agentSessionLiveStateService.updateSessionTitle(input),
  });
  // Services admit runtime work before the orchestrator exists, so the gate comes first.
  const runtimeAdmissionGate = createRuntimeAdmissionGate();
  const runtimeAdmission = createRuntimeAdmissionPort(runtimeAdmissionGate);
  const { liveSessionAdapterRegistry, liveState: agentSessionLiveStateService } =
    createNodeAgentSessionLiveState({
      runtimeAdmission,
      observeNotificationInput: notificationComposition.acceptLive,
      persistence: workspaceSessions.persistence,
      withProcessStartAdmission: workspaceAdmissionService.withProcessStartAdmission,
      store: assets.workspaceSessionStore,
      taskStore,
      settings: workspaceSettingsService,
      eventBus,
      lifecycleLogger,
    });
  const filesystemService = createFilesystemService(filesystem);
  const workspaceFilesService = createWorkspaceFilesService(filesystem, git);
  const gitService = createGitService({ gitPort: git, settingsConfig, worktreeFiles });
  const localAttachmentService = createLocalAttachmentService(localAttachments);
  const openInToolsService = createOpenInToolsService(openInTools);
  const runtimeDefinitionsService = createHostRuntimeDefinitionsService();
  const systemDiagnosticsService = createSystemDiagnosticsService({
    systemCommands,
    toolDiscovery,
    repoStoreDiagnostics: taskStore,
    userEnvironment,
  });
  const workingDirectoryDependencies = {
    gitPort: git,
    settingsConfig,
    workspaceSettingsService,
  };
  // The runtimes read the bridge at use time through `resolveBridge`. The default bridge needs
  // services that this function creates after the runtimes, so it gets its value further down.
  let resolvedMcpHostBridge = mcpHostBridge;
  const taskSessionLifecycleCoordinator = createTaskSessionLifecycleCoordinator();
  const {
    hostInstanceId,
    hostRuntimeService,
    registry: runtimeRegistry,
  } = createNodeHostRuntimeComposition({
    clientVersion,
    configuredRuntimeStarter,
    defaultPorts,
    eventBus,
    lifecycleLogger,
    liveState: agentSessionLiveStateService,
    onBackgroundFailure,
    resolveBridge: () => resolvedMcpHostBridge,
    runtimeAdmissionGate,
    runtimeDefinitionsService,
    settingsConfig,
    taskSessionLifecycleCoordinator,
    workingDirectoryDependencies,
    workspaceSettingsService,
  });
  const taskWorktreeService = createTaskWorktreeService({
    settingsConfig,
    workspaceSettingsService,
  });
  const terminalService = Effect.runSync(
    createTerminalService({
      withProcessStartAdmission: workspaceAdmissionService.withProcessStartAdmission,
      filesystem,
      git,
      taskWorktrees: taskWorktreeService,
      workspaceSessions: {
        settings: workspaceSettingsService,
        store: assets.workspaceSessionStore,
      },
      ptyPort: terminalPty,
      resolveLaunchEnvironment: createTerminalLaunchEnvironment({ readEnv }),
    }),
  );
  const devServerService = createDevServerService({
    withProcessStartAdmission: workspaceAdmissionService.withProcessStartAdmission,
    processPort: devServerProcesses,
    terminalSources: terminalService,
    taskWorktreeService,
    workspaceSessions: {
      store: assets.workspaceSessionStore,
      settings: workspaceSettingsService,
      git,
      operationGate: workspaceSessions.operationGate,
    },
    workspaceSettingsService,
    eventBus,
  });
  const workspaceLifecycleService = createWorkspaceLifecycleService({
    activity: createWorkspaceActivityInspector({
      agentSessionLiveStateService,
      devServerService,
      terminalService,
    }),
    admission: workspaceAdmissionService,
    gitPort: git,
    settingsConfig,
    storage: {
      removeWorkspaceTaskAssets: assets.removeWorkspaceTaskAssets,
      removeWorkspaceTaskStore: assets.removeWorkspaceTaskStore,
      removeWorkspaceCredentials: (repoConfig) => {
        if (!azureDevOpsConnection) {
          const provider = repoConfig.git.provider;
          if (provider?.id !== "azure_devops") return Effect.void;
          return Effect.fail(
            new HostOperationError({
              operation: "workspace.removeWorkspace.credentials",
              message:
                "Azure DevOps credential cleanup is unavailable. Retry workspace removal after restarting the host.",
            }),
          );
        }
        return azureDevOpsConnection.removeWorkspaceCredentials(repoConfig).pipe(
          Effect.mapError(
            (cause) =>
              new HostOperationError({
                operation: "workspace.removeWorkspace.credentials",
                message: `Failed to remove Azure DevOps credentials: ${cause.message}. The workspace remains registered. Retry removal to continue.`,
                cause,
              }),
          ),
        );
      },
    },
    taskSessionLifecycleCoordinator,
    taskStore,
    workspaceSettingsService,
    worktreeFiles,
  });
  const taskActivityGuard = createRuntimeTaskActivityGuard({
    runtimeRegistry,
    sessionService: agentSessionLiveStateService,
    settingsConfig,
  });
  const { taskEventStream, taskService, taskSyncService, agentSessionCommandService } =
    createNodeTaskSessionServices({
      taskServiceInput: {
        devServerService,
        terminalService,
        gitPort: git,
        gitProviderResolver,
        taskStore,
        taskActivityGuard,
        settingsConfig,
        systemCommands,
        toolDiscovery,
        taskWorktreeService,
        workspaceSettingsService,
        runtimeDefinitionsService,
        runtimeRegistry,
        worktreeFiles,
        taskSessionLifecycleCoordinator,
      },
      eventServiceInput: {
        acceptNotificationInput: notificationComposition.acceptTask,
        lifecycleLogger,
        onBackgroundFailure,
        taskEventPublicationReporter,
        workspaceSettingsService,
      },
      canonicalizeRepoPath: (repoPath) => git.canonicalizePath(repoPath),
      agentSessionLiveStateService,
      repositoryPolicy: workspaceSessions.persistence,
    });
  const notificationService = notificationComposition.attach({
    tasks: taskService,
    live: agentSessionLiveStateService,
    workspaceSessions: assets.workspaceSessionStore,
  });
  const odtMcpBridgeService = createOdtMcpBridgeService({
    taskAssetReadService,
    taskService,
    workspaceSettingsService,
  });
  const pullRequestReviewService = createPullRequestReviewService({
    resolver: gitProviderResolver,
    taskReader: taskStore,
    workspaceSettingsService,
  });
  resolvedMcpHostBridge ??= createMcpHostBridgeServer({
    bridgeService: odtMcpBridgeService,
    discoveryPath: resolveMcpBridgeDiscoveryPath(input.mcpBridgeDiscoveryMode, startupEnv),
    workspaceSettingsService,
    onStatusChanged: eventBus ? createMcpBridgeStatusPublisher(eventBus, hostInstanceId) : () => {},
  });
  const taskSessionStopService = createTaskSessionStopService({
    gitPort: git,
    runtimeDefinitionsService,
    runtimeRegistry,
    taskReader: taskStore,
  });
  const mcpBridge = resolvedMcpHostBridge;
  const { workspaceSessionService, workspaceSessionImports, unsubscribeImportCatalogs } =
    createNodeWorkspaceSessionServices({
      devServerService,
      terminalService,
      lifecycle: taskSessionLifecycleCoordinator,
      operationGate: workspaceSessions.operationGate,
      sessionTitleGate: workspaceSessions.sessionTitleGate,
      isCodexTitleSyncPending: workspaceSessions.isCodexTitleSyncPending,
      markCodexTitleSyncPending: workspaceSessions.markCodexTitleSyncPending,
      store: assets.workspaceSessionStore,
      settings: workspaceSettingsService,
      runtime: runtimeRegistry,
      live: agentSessionLiveStateService,
      git,
      settingsConfig,
      worktreeFiles,
      systemCommands,
      registry: liveSessionAdapterRegistry,
      publishUpdated: workspaceSessions.publishUpdated,
      runtimeAdmission,
      eventBus,
    });
  const hostRouterLifecycle = createNodeHostRouterLifecycle({
    initializeAdmission: workspaceAdmissionService.initialize,
    shutdownWorkspaceImports: workspaceSessionImports.shutdown,
    shutdownWorkspaceSessionPersistence: workspaceSessions.persistence.shutdown,
    unsubscribeImportCatalogs,
    notifications: notificationService,
    assets,
    azureDevOpsConnection,
    workspaceProviderSetup,
    devServerService,
    imageWorkers: defaultPorts.imageWorkers,
    shutdownWorkspaceFiles: () =>
      workspaceFilesService.dispose().pipe(Effect.andThen(git.releaseReadCaptures())),
    lifecycleLogger,
    mcpHostBridge: mcpBridge,
    runtimeRegistry,
    initializeRuntimes: hostRuntimeService.initialize,
    startupSweep,
    taskAssetStagingService,
    taskSyncService,
    terminalService,
  });
  const handlers = {
    ...setup.handlers,
    ...createNotificationCommandHandlers(notificationService),
    ...createAgentSessionLiveCommandHandlers(agentSessionCommandService, localAttachmentService),
    ...createNodeAgentRuntimeQueryCommandHandlers(
      {
        ...workingDirectoryDependencies,
        adapterRegistry: liveSessionAdapterRegistry,
        runtimeRegistry,
        taskReader: taskStore,
        worktreeReads: taskSessionLifecycleCoordinator,
        worktreeFiles,
      },
      previewModels(defaultPorts, git, runtimeDefinitionsService, clientVersion),
    ),
    ...createDevServerCommandHandlers(devServerService),
    ...createFilesystemCommandHandlers(filesystemService),
    ...createWorkspaceFilesCommandHandlers(workspaceFilesService),
    ...createGitCommandHandlers(gitService),
    ...createNodeGitProviderCommandHandlers({
      resolver: gitProviderResolver,
      issueImportStore: assets.issueImportStore,
      taskSyncService,
      workspaceSettingsService,
      azureDevOpsConnection,
      azureAreaPaths,
    }),
    ...createLocalAttachmentCommandHandlers(localAttachmentService),
    ...createNodeImageCommandHandlers(
      liveSessionAdapterRegistry,
      defaultPorts.generatedImageFiles,
      runtimeDefinitionsService,
      { ...workingDirectoryDependencies, worktreeFiles },
    ),
    ...createOpenInToolsCommandHandlers(openInToolsService),
    ...createPullRequestReviewCommandHandlers(pullRequestReviewService),
    ...createRuntimeDefinitionsCommandHandlers(runtimeDefinitionsService),
    ...createNodeRuntimeExecutableCommandHandlers({
      runtimeDefinitionsService,
      runtimeHealth,
      toolDiscovery,
    }),
    ...createRuntimeCommandHandlers(taskSessionStopService, hostRuntimeService, () =>
      mcpBridge.status(),
    ),
    ...createSystemDiagnosticsCommandHandlers(systemDiagnosticsService),
    ...createSystemPlatformCommandHandlers(),
    ...createTaskAssetCommandHandlers(taskAssetStagingService),
    ...createTaskCommandHandlers(taskService),
    ...createTaskWorktreeCommandHandlers(taskWorktreeService),
    ...createTerminalCommandHandlers(terminalService),
    ...createWorkspaceSettingsCommandHandlers(workspaceSettingsService, hostRuntimeService),
    ...createWorkspaceSessionImportCommandHandlers(workspaceSessionImports),
    ...createWorkspaceSessionCommandHandlers(
      workspaceSessionService,
      workspaceSessions.publishUpdated,
    ),
    ...createWorkspaceLifecycleCommandHandlers(workspaceSettingsService, workspaceLifecycleService),
  };
  return Object.assign(createEffectHostCommandRouter({ ...hostRouterLifecycle, handlers }), {
    taskAssetReadService,
    taskEventStream,
    notificationStream: notificationService.stream,
    terminalService,
  });
};

import { createWorkspaceSessionImportCommandHandlers } from "../../interface/commands/workspace-session-import-command-handlers";
import { createRuntimeLifecyclePublisher } from "./runtime-lifecycle-publisher";
import { createNodeImageCommandHandlers } from "./node-image-command-handlers";
import { createNodeGitProviderCommandHandlers } from "./node-git-provider-command-handlers";
import { resolveCodexEffectivePolicy } from "@openducktor/contracts";
import { isAzureDevOpsRepository } from "@openducktor/core";
import { Effect } from "effect";
import { HostOperationError } from "../../effect/host-errors";
import { createCodexLiveSessionAdapterPreparer } from "../../adapters/agent-sessions/codex-live-session-adapter";
import { createCodexWorkspaceRuntimeStarter } from "../../adapters/codex/codex-workspace-runtime-starter";
import {
  createMcpHostBridgeServer,
  resolveMcpBridgeDiscoveryPath,
} from "../../adapters/mcp/mcp-host-bridge-server";
import { createRuntimeRegistry } from "../../adapters/runtimes/runtime-registry";
import { createRuntimeSessionOperations } from "../../adapters/runtimes/runtime-session-operations";
import { createRuntimeTaskActivityGuard } from "../../application/tasks/runtime-task-activity-guard";
import { createRuntimeWorkspaceStarterDispatcher } from "../../adapters/runtimes/runtime-workspace-starter-dispatcher";
import { createLocalAttachmentService } from "../../application/attachments/local-attachment-service";
import { createDevServerService } from "../../application/dev-servers/dev-server-service";
import { createSystemDiagnosticsService } from "../../application/diagnostics/system-diagnostics-service";
import { createFilesystemService } from "../../application/filesystem/filesystem-service";
import { createWorkspaceFilesService } from "../../application/filesystem/workspace-files-service";
import {
  createWorkspaceActivityInspector,
  createWorkspaceLifecycleService,
} from "../../application/workspaces/workspace-lifecycle-service";
import { createGitService } from "../../application/git/git-service";
import { createOdtMcpBridgeService } from "../../application/mcp/odt-mcp-bridge-service";
import { createPullRequestReviewService } from "../../application/pull-requests/pull-request-review-service";
import { createRuntimeOrchestratorService } from "../../application/runtimes/runtime-orchestrator-service";
import { readSavedRuntimeExecutablePath } from "../../application/runtimes/saved-runtime-executable";
import { createOpenInToolsService } from "../../application/system/open-in-tools-service";
import { createTaskSessionLifecycleCoordinator } from "../../application/tasks/worktrees/task-session-lifecycle-coordinator";
import { createTaskWorktreeService } from "../../application/tasks/worktrees/task-worktree-service";
import { createTerminalService } from "../../application/terminals/terminal-service";
import { loadGlobalConfig } from "../../application/workspaces/workspace-settings-model";
import { createWorkspaceAdmissionService } from "../../application/workspaces/workspace-admission-service";
import { createWorkspaceSettingsService } from "../../application/workspaces/workspace-settings-service";
import { createWorkspaceSessionCommandHandlers } from "../../interface/commands/workspace-session-command-handlers";
import type { GitProviderResolver } from "../../application/git/git-provider-resolver";
import type { AzureDevOpsConnectionPort } from "../../ports/azure-devops-connection-port";
import type { AzureAreaPathsPort } from "../../ports/azure-area-paths-port";
import { createTerminalLaunchEnvironment } from "../../infrastructure/terminals/terminal-launch-environment";
import { createAgentSessionLiveCommandHandlers } from "../../interface/commands/agent-session-live-command-handlers";
import { createAgentRuntimeQueryCommandHandlers } from "../../interface/commands/agent-runtime-query-command-handlers";
import { createAgentRuntimeQueryService } from "../../application/runtimes/agent-runtime-query-service";
import { createDevServerCommandHandlers } from "../../interface/commands/dev-server-command-handlers";
import { createFilesystemCommandHandlers } from "../../interface/commands/filesystem-command-handlers";
import { createGitCommandHandlers } from "../../interface/commands/git-command-handlers";
import { createLocalAttachmentCommandHandlers } from "../../interface/commands/local-attachment-command-handlers";
import { createOpenInToolsCommandHandlers } from "../../interface/commands/open-in-tools-command-handlers";
import { createPullRequestReviewCommandHandlers } from "../../interface/commands/pull-request-review-command-handlers";
import { createRuntimeDefinitionsCommandHandlers } from "../../interface/commands/runtime-definitions-command-handlers";
import { createRuntimeOrchestratorCommandHandlers } from "../../interface/commands/runtime-orchestrator-command-handlers";
import { createSystemDiagnosticsCommandHandlers } from "../../interface/commands/system-diagnostics-command-handlers";
import { createSystemPlatformCommandHandlers } from "../../interface/commands/system-platform-command-handlers";
import { createTaskAssetCommandHandlers } from "../../interface/commands/task-asset-command-handlers";
import { createTaskCommandHandlers } from "../../interface/commands/task-command-handlers";
import { createTaskWorktreeCommandHandlers } from "../../interface/commands/task-worktree-command-handlers";
import { createTerminalCommandHandlers } from "../../interface/commands/terminal-command-handlers";
import { createWorkspaceFilesCommandHandlers } from "../../interface/commands/workspace-files-command-handlers";
import { createWorkspaceLifecycleCommandHandlers } from "../../interface/commands/workspace-lifecycle-command-handlers";
import { createWorkspaceSettingsCommandHandlers } from "../../interface/commands/workspace-settings-command-handlers";
import { createEffectHostCommandRouter } from "../../interface/router/host-command-router";
import { createClaudeRuntimeComposition } from "./claude-runtime-composition";
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
import { createNodeTaskAssetServices } from "./node-task-asset-services";
import { createNodeTaskSessionServices } from "./node-task-session-services";
import { createNodeWorkspaceSessionPersistence } from "./node-workspace-session-persistence";
import { createNodeWorkspaceSessionServices } from "./node-workspace-session-services";
import { createOpenCodeRuntimeComposition } from "./opencode-runtime-composition";
import { createRuntimeActiveSessionResolver } from "./runtime-active-session-resolver";
import {
  resolveClaudeWorkspaceRuntimeMcpBridgeConnection,
  resolveWorkspaceRuntimeMcpBridgeConnection,
} from "./workspace-runtime-mcp-bridge-connection";
import { guardRuntimeStart } from "./user-path-start-guard";

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
    runtimeRegistry,
    taskStore: configuredTaskStore,
    taskEventPublicationReporter,
  } = input;
  const {
    codexAppServer: effectiveCodexAppServer,
    codexTransportRegistry: effectiveCodexTransportRegistry,
    devServerProcesses,
    filesystem,
    git,
    localAttachments,
    openInTools,
    configDir,
    processEnvironment,
    runtimeDistribution,
    runtimeExecutableProbes,
    runtimeHealth,
    settingsConfig,
    systemCommands,
    terminalPty,
    toolDiscovery,
    worktreeFiles,
  } = defaultPorts;
  const { environment: processEnv, error: processEnvironmentError } = processEnvironment;
  const workspaceSettingsService = createWorkspaceSettingsService(settingsConfig);
  const workspaceAdmissionService = createWorkspaceAdmissionService({
    workspaceSettingsService,
  });
  const assets = createNodeTaskAssetServices({
    configDir,
    assertWorkspaceAdmitted: workspaceAdmissionService.assertTaskStoreAccess,
    configuredTaskStore,
    isWorkspaceBlocked: workspaceAdmissionService.isWorkspaceBlocked,
    onBackgroundFailure,
    processEnv,
    workspaceSettingsService,
  });
  const { startupSweep, taskAssetReadService, taskAssetStagingService, taskStore } = assets;
  // The live state service and the persistence depend on each other, so the title
  // callback resolves the service at call time.
  const workspaceSessions = createNodeWorkspaceSessionPersistence({
    store: assets.workspaceSessionStore,
    settings: workspaceSettingsService,
    git,
    eventBus,
    faultLog: createLiveSessionFaultLogger(lifecycleLogger),
    updateRuntimeSessionTitle: (input) => agentSessionLiveStateService.updateSessionTitle(input),
  });
  const { liveSessionAdapterRegistry, liveState: agentSessionLiveStateService } =
    createNodeAgentSessionLiveState({
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
    pathError: processEnvironmentError?.message ?? null,
    runtimeDefinitionsService,
    runtimeHealth,
    settingsConfig,
    systemCommands,
    toolDiscovery,
    repoStoreDiagnostics: taskStore,
  });
  const workingDirectoryDependencies = {
    settingsConfig,
    workspaceSettingsService,
  };
  let resolvedMcpHostBridge = mcpHostBridge;
  const resolveRuntimeMcpBridge = (kind: "codex" | "opencode", repoPath: string) =>
    resolveWorkspaceRuntimeMcpBridgeConnection(resolvedMcpHostBridge, kind, repoPath);
  const claudeRuntime = createClaudeRuntimeComposition({
    liveSessionLifecycle: agentSessionLiveStateService,
    onBackgroundFailure,
    processEnv,
    runtimeExecutableProbe: runtimeExecutableProbes.claude,
    runtimeDistribution,
    settingsConfig,
    toolDiscovery,
    workingDirectoryDependencies,
    resolveMcpBridgeConnection: (repoPath) =>
      resolveClaudeWorkspaceRuntimeMcpBridgeConnection(resolvedMcpHostBridge, repoPath),
  });
  const codexWorkspaceRuntimeStarterInput: Parameters<
    typeof createCodexWorkspaceRuntimeStarter
  >[0] = {
    toolDiscovery,
    settingsConfig,
    codexAppServer: effectiveCodexTransportRegistry,
    liveSessionLifecycle: agentSessionLiveStateService,
    prepareLiveSessionAdapter: createCodexLiveSessionAdapterPreparer({
      prepareImageGenerations: defaultPorts.imageWorkers.prepareHistory,
      liveSessionLifecycle: agentSessionLiveStateService,
      codexAppServer: effectiveCodexAppServer,
      onBackgroundFailure,
      resolveRuntimePolicy: (scope) =>
        loadGlobalConfig(settingsConfig).pipe(
          Effect.map(({ agentRuntimes: { codex } }) =>
            resolveCodexEffectivePolicy(codex, scope.kind === "workflow" ? scope.role : null),
          ),
        ),
    }),
    processEnv,
    runtimeDistribution,
    resolveMcpBridgeConnection: (runtimeInput) =>
      resolveRuntimeMcpBridge("codex", runtimeInput.repoPath),
  };
  if (clientVersion) {
    codexWorkspaceRuntimeStarterInput.clientVersion = clientVersion;
  }
  const taskSessionLifecycleCoordinator = createTaskSessionLifecycleCoordinator();
  const workspaceStarter = createRuntimeWorkspaceStarterDispatcher({
    claude: claudeRuntime.workspaceStarter,
    codex: createCodexWorkspaceRuntimeStarter(codexWorkspaceRuntimeStarterInput),
    opencode: createOpenCodeRuntimeComposition({
      toolDiscovery,
      settingsConfig,
      processEnv,
      runtimeDistribution,
      liveSessionLifecycle: agentSessionLiveStateService,
      taskSessionLifecycleCoordinator,
      resolveMcpBridgeConnection: (runtimeInput) =>
        resolveRuntimeMcpBridge("opencode", runtimeInput.repoPath),
    }),
  });
  const runtimeRegistryInput: Parameters<typeof createRuntimeRegistry>[0] = {
    workspaceStarter,
    hasActiveRuntimeSessions: createRuntimeActiveSessionResolver(agentSessionLiveStateService),
    resolveRuntimeExecutablePath: (runtimeInput) =>
      readSavedRuntimeExecutablePath({
        kind: runtimeInput.descriptor.kind,
        settingsConfig,
      }),
    sessionOperations: createRuntimeSessionOperations({
      codexAppServer: effectiveCodexAppServer,
      claudeAgentSdk: claudeRuntime.sessionOperations,
    }),
  };
  if (eventBus) {
    runtimeRegistryInput.onRuntimeChanged = createRuntimeLifecyclePublisher(
      eventBus,
      onBackgroundFailure,
    );
  }
  const effectiveRuntimeRegistry = guardRuntimeStart(
    runtimeRegistry ?? createRuntimeRegistry(runtimeRegistryInput),
    processEnvironment,
  );
  const taskWorktreeService = createTaskWorktreeService({
    settingsConfig,
    workspaceSettingsService,
  });
  const terminalService = Effect.runSync(
    createTerminalService({
      withProcessStartAdmission: workspaceAdmissionService.withProcessStartAdmission,
      filesystem,
      ptyPort: terminalPty,
      resolveLaunchEnvironment: createTerminalLaunchEnvironment({ processEnv }),
    }),
  );
  const devServerServiceInput: Parameters<typeof createDevServerService>[0] = {
    withProcessStartAdmission: workspaceAdmissionService.withProcessStartAdmission,
    processPort: devServerProcesses,
    taskWorktreeService,
    workspaceSettingsService,
  };
  if (eventBus) {
    devServerServiceInput.eventBus = eventBus;
  }
  const devServerService = createDevServerService(devServerServiceInput);
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
        const provider = repoConfig.git.provider;
        if (
          provider?.id !== "azure_devops" ||
          !provider.repository ||
          !isAzureDevOpsRepository(provider.repository)
        ) {
          return Effect.void;
        }
        if (!azureDevOpsConnection) {
          return Effect.fail(
            new HostOperationError({
              operation: "workspace.removeWorkspace.credentials",
              message:
                "Azure DevOps credential cleanup is unavailable. Retry workspace removal after restarting the host.",
            }),
          );
        }
        return azureDevOpsConnection.disconnect(repoConfig, provider.repository).pipe(
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
    runtimeRegistry: effectiveRuntimeRegistry,
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
        runtimeRegistry: effectiveRuntimeRegistry,
        worktreeFiles,
        taskSessionLifecycleCoordinator,
      },
      eventServiceInput: {
        lifecycleLogger,
        onBackgroundFailure,
        taskEventPublicationReporter,
        workspaceSettingsService,
      },
      canonicalizeRepoPath: (repoPath) => git.canonicalizePath(repoPath),
      agentSessionLiveStateService,
      repositoryPolicy: workspaceSessions.persistence,
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
    discoveryPath: resolveMcpBridgeDiscoveryPath(input.mcpBridgeDiscoveryMode, processEnv),
    workspaceSettingsService,
  });
  const runtimeOrchestratorWithEffectiveRegistry = createRuntimeOrchestratorService({
    withProcessStartAdmission: workspaceAdmissionService.withProcessStartAdmission,
    gitPort: git,
    runtimeDefinitionsService,
    runtimeRegistry: effectiveRuntimeRegistry,
    taskReader: taskStore,
    logger: lifecycleLogger,
  });
  const { workspaceSessionService, workspaceSessionImports, unsubscribeImportCatalogs } =
    createNodeWorkspaceSessionServices({
      lifecycle: taskSessionLifecycleCoordinator,
      operationGate: workspaceSessions.operationGate,
      sessionTitleGate: workspaceSessions.sessionTitleGate,
      store: assets.workspaceSessionStore,
      settings: workspaceSettingsService,
      runtime: runtimeOrchestratorWithEffectiveRegistry,
      live: agentSessionLiveStateService,
      git,
      settingsConfig,
      worktreeFiles,
      systemCommands,
      registry: liveSessionAdapterRegistry,
      publishUpdated: workspaceSessions.publishUpdated,
      eventBus,
    });
  const hostRouterLifecycle = createNodeHostRouterLifecycle({
    assets,
    azureDevOpsConnection,
    devServerService,
    imageWorkers: defaultPorts.imageWorkers,
    lifecycleLogger,
    mcpHostBridge: resolvedMcpHostBridge,
    runtimeRegistry: effectiveRuntimeRegistry,
    startupSweep,
    taskAssetStagingService,
    taskSyncService,
    terminalService,
  });
  const router = createEffectHostCommandRouter({
    initialize: () =>
      workspaceAdmissionService
        .initialize()
        .pipe(Effect.zipRight(hostRouterLifecycle.initialize())),
    dispose: () =>
      Effect.sync(() => unsubscribeImportCatalogs?.()).pipe(
        Effect.zipRight(workspaceSessionImports.shutdown()),
        Effect.zipRight(hostRouterLifecycle.dispose()),
      ),
    handlers: {
      ...createAgentSessionLiveCommandHandlers(agentSessionCommandService, localAttachmentService),
      ...createAgentRuntimeQueryCommandHandlers(
        createAgentRuntimeQueryService({
          ...workingDirectoryDependencies,
          adapterRegistry: liveSessionAdapterRegistry,
          runtimeRegistry: effectiveRuntimeRegistry,
          gitPort: git,
          taskReader: taskStore,
          worktreeReads: taskSessionLifecycleCoordinator,
          worktreeFiles,
        }),
      ),
      ...createDevServerCommandHandlers(devServerService),
      ...createFilesystemCommandHandlers(filesystemService),
      ...createWorkspaceFilesCommandHandlers(workspaceFilesService),
      ...createGitCommandHandlers(gitService),
      ...createNodeGitProviderCommandHandlers({
        resolver: gitProviderResolver,
        issueImportStore: assets.issueImportStore,
        workspaceSettingsService,
        azureDevOpsConnection,
        azureAreaPaths,
      }),
      ...createLocalAttachmentCommandHandlers(localAttachmentService),
      ...createNodeImageCommandHandlers(
        liveSessionAdapterRegistry,
        defaultPorts.generatedImageFiles,
        runtimeDefinitionsService,
      ),
      ...createOpenInToolsCommandHandlers(openInToolsService),
      ...createPullRequestReviewCommandHandlers(pullRequestReviewService),
      ...createRuntimeDefinitionsCommandHandlers(runtimeDefinitionsService),
      ...createNodeRuntimeExecutableCommandHandlers({
        runtimeDefinitionsService,
        runtimeHealth,
        toolDiscovery,
      }),
      ...createRuntimeOrchestratorCommandHandlers(runtimeOrchestratorWithEffectiveRegistry),
      ...createSystemDiagnosticsCommandHandlers(systemDiagnosticsService),
      ...createSystemPlatformCommandHandlers(),
      ...createTaskAssetCommandHandlers(taskAssetStagingService),
      ...createTaskCommandHandlers(taskService),
      ...createTaskWorktreeCommandHandlers(taskWorktreeService),
      ...createTerminalCommandHandlers(terminalService),
      ...createWorkspaceSettingsCommandHandlers(workspaceSettingsService),
      ...createWorkspaceSessionImportCommandHandlers(workspaceSessionImports),
      ...createWorkspaceSessionCommandHandlers(
        workspaceSessionService,
        workspaceSessions.publishUpdated,
      ),
      ...createWorkspaceLifecycleCommandHandlers(
        workspaceSettingsService,
        workspaceLifecycleService,
      ),
    },
  });
  return Object.assign(router, {
    taskAssetReadService,
    taskEventStream,
    terminalService,
  });
};

import {
  createLiveSessionPublisher,
  createRuntimeLifecyclePublisher,
} from "./runtime-lifecycle-publisher";
import { createNodeImageCommandHandlers } from "./node-image-command-handlers";
import { resolveCodexEffectivePolicy } from "@openducktor/contracts";
import { Effect } from "effect";
import { HostValidationError } from "../../effect/host-errors";
import { createCodexLiveSessionAdapterPreparer } from "../../adapters/agent-sessions/codex-live-session-adapter";
import { createLiveSessionAdapterRegistry } from "../../adapters/agent-sessions/live-session-adapter-registry";
import { createCodexWorkspaceRuntimeStarter } from "../../adapters/codex/codex-workspace-runtime-starter";
import {
  createMcpHostBridgeServer,
  resolveMcpBridgeDiscoveryPath,
} from "../../adapters/mcp/mcp-host-bridge-server";
import { createRuntimeRegistry } from "../../adapters/runtimes/runtime-registry";
import { createRuntimeSessionOperations } from "../../adapters/runtimes/runtime-session-operations";
import { createRuntimeTaskActivityGuard } from "../../application/tasks/runtime-task-activity-guard";
import { createRuntimeWorkspaceStarterDispatcher } from "../../adapters/runtimes/runtime-workspace-starter-dispatcher";
import { createAgentSessionLiveStateService } from "../../application/agent-sessions/agent-session-live-state-service";
import { createLocalAttachmentService } from "../../application/attachments/local-attachment-service";
import { createDevServerService } from "../../application/dev-servers/dev-server-service";
import { createSystemDiagnosticsService } from "../../application/diagnostics/system-diagnostics-service";
import { createFilesystemService } from "../../application/filesystem/filesystem-service";
import {
  createWorkspaceFilesService,
  withWorkspaceFilesAdmission,
} from "../../application/filesystem/workspace-files-service";
import { createWorkspaceActivityInspector } from "../../application/workspaces/workspace-activity-inspector";
import { createWorkspaceLifecycleService } from "../../application/workspaces/workspace-lifecycle-service";
import { createGitService } from "../../application/git/git-service";
import { withGitWorkspaceAdmission } from "../../application/git/git-workspace-admission";
import { withTaskAssetWorkspaceAdmission } from "../../application/task-assets/task-asset-admission";
import { createGitProviderService } from "../../application/git/git-provider-service";
import { createOdtMcpBridgeService } from "../../application/mcp/odt-mcp-bridge-service";
import { createPullRequestReviewService } from "../../application/pull-requests/pull-request-review-service";
import { createRuntimeDefinitionsService } from "../../application/runtimes/runtime-definitions-service";
import { createRuntimeOrchestratorService } from "../../application/runtimes/runtime-orchestrator-service";
import { readSavedRuntimeExecutablePath } from "../../application/runtimes/saved-runtime-executable";
import { createOpenInToolsService } from "../../application/system/open-in-tools-service";
import { createTaskSessionLifecycleCoordinator } from "../../application/tasks/worktrees/task-session-lifecycle-coordinator";
import { createTaskWorktreeService } from "../../application/tasks/worktrees/task-worktree-service";
import { createTerminalService } from "../../application/terminals/terminal-service";
import { loadGlobalConfig } from "../../application/workspaces/workspace-settings-model";
import { createWorkspaceAdmissionService } from "../../application/workspaces/workspace-admission-service";
import { createWorkspaceSettingsService } from "../../application/workspaces/workspace-settings-service";
import { createWorkspaceSessionService } from "../../application/workspaces/workspace-session-service";
import { createWorkspaceSessionCommandHandlers } from "../../interface/commands/workspace-session-command-handlers";
import type { GitProviderResolver } from "../../application/git/git-provider-resolver";
import { createTerminalLaunchEnvironment } from "../../infrastructure/terminals/terminal-launch-environment";
import { createAgentSessionLiveCommandHandlers } from "../../interface/commands/agent-session-live-command-handlers";
import { createAgentRuntimeQueryCommandHandlers } from "../../interface/commands/agent-runtime-query-command-handlers";
import { createAgentRuntimeQueryService } from "../../application/runtimes/agent-runtime-query-service";
import { createDevServerCommandHandlers } from "../../interface/commands/dev-server-command-handlers";
import { createFilesystemCommandHandlers } from "../../interface/commands/filesystem-command-handlers";
import { createGitCommandHandlers } from "../../interface/commands/git-command-handlers";
import { createGitProviderCommandHandlers } from "../../interface/commands/git-provider-command-handlers";
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
import type {
  CreateNodeHostCommandRouterInput,
  EffectNodeHostCommandRouter,
} from "./node-host-command-router-types";
import { createNodeHostDefaultPorts } from "./node-host-default-ports";
import { createLiveSessionFaultLogger, defaultLifecycleLogger } from "./node-host-lifecycle-logger";
import { createNodeRuntimeExecutableCommandHandlers } from "./node-runtime-executable-command-handlers";
import { createNodeHostRouterLifecycle } from "./node-host-router-lifecycle";
import { createNodeTaskAssetServices } from "./node-task-asset-services";
import { createNodeTaskSessionServices } from "./node-task-session-services";
import { createNodeWorkspaceSessionPersistence } from "./node-workspace-session-persistence";
import { createOpenCodeRuntimeComposition } from "./opencode-runtime-composition";
import { createRuntimeActiveSessionResolver } from "./runtime-active-session-resolver";
import {
  resolveClaudeWorkspaceRuntimeMcpBridgeConnection,
  resolveWorkspaceRuntimeMcpBridgeConnection,
} from "./workspace-runtime-mcp-bridge-connection";

export type { CreateNodeHostCommandRouterInput, EffectNodeHostCommandRouter };
export const assembleNodeEffectHostCommandRouter = (
  input: CreateNodeHostCommandRouterInput,
  defaultPorts: ReturnType<typeof createNodeHostDefaultPorts>,
  gitProviderResolver: GitProviderResolver,
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
    processEnv,
    runtimeDistribution,
    runtimeExecutableProbes,
    runtimeHealth,
    settingsConfig,
    systemCommands,
    terminalPty,
    toolDiscovery,
    worktreeFiles,
    workspaceHostOwnership,
    workspaceOwnershipLock,
  } = defaultPorts;
  const workspaceSettingsService = createWorkspaceSettingsService(
    settingsConfig,
    workspaceOwnershipLock,
  );
  const ownedWorkspaceSettingsService = createWorkspaceSettingsService(
    settingsConfig,
    workspaceOwnershipLock,
    "already-held",
  );
  const workspaceAdmissionService = createWorkspaceAdmissionService({
    gitPort: git,
    hostOwnership: workspaceHostOwnership,
    settingsConfig,
    workspaceSettingsService,
  });
  const assets = createNodeTaskAssetServices({
    assertWorkspaceAdmitted: workspaceAdmissionService.assertTaskStoreAccess,
    configuredTaskStore,
    isWorkspaceRemovalPending: workspaceAdmissionService.isWorkspaceRemovalPending,
    onBackgroundFailure,
    processEnv,
    settingsConfig,
    withAdministrativeAccess: workspaceAdmissionService.withAdministrativeAccess,
    workspaceSettingsService,
  });
  const { startupSweep, taskAssetReadService, taskAssetStagingService, taskStore } = assets;
  const admittedTaskAssetStagingService = withTaskAssetWorkspaceAdmission({
    admission: workspaceAdmissionService,
    resolveRepoPath: (workspaceId) =>
      workspaceSettingsService
        .getRepoConfig(workspaceId)
        .pipe(Effect.map((repoConfig) => repoConfig.repoPath)),
    service: taskAssetStagingService,
  });
  const workspaceSessions = createNodeWorkspaceSessionPersistence({
    store: assets.workspaceSessionStore,
    settings: workspaceSettingsService,
    git,
    eventBus,
    withWorkStartLease: workspaceAdmissionService.withWorkStartLease,
  });
  const liveSessionAdapterRegistry = createLiveSessionAdapterRegistry();
  const agentSessionLiveStateService = createAgentSessionLiveStateService({
    adapterRegistry: liveSessionAdapterRegistry,
    withWorkStartLease: workspaceAdmissionService.withWorkStartLease,
    persistence: workspaceSessions.persistence,
    faultLog: createLiveSessionFaultLogger(lifecycleLogger),
    publish: createLiveSessionPublisher(eventBus),
  });
  const filesystemService = createFilesystemService(filesystem);
  const workspaceFilesService = withWorkspaceFilesAdmission(
    createWorkspaceFilesService(filesystem, git),
    {
      resolveRepoPath: (workspaceId) =>
        workspaceSettingsService.getRepoConfig(workspaceId).pipe(
          Effect.map((repoConfig) => repoConfig.repoPath),
          Effect.mapError(
            (cause) =>
              new HostValidationError({
                message: cause.message,
                field: "workspaceId",
                cause,
              }),
          ),
        ),
      withWorkStartLease: workspaceAdmissionService.withWorkStartLease,
    },
  );
  const gitService = withGitWorkspaceAdmission(
    createGitService({ gitPort: git, settingsConfig, worktreeFiles }),
    workspaceAdmissionService,
  );
  const gitProviderService = createGitProviderService({
    resolver: gitProviderResolver,
    workspaceSettingsService,
  });
  const localAttachmentService = createLocalAttachmentService(localAttachments);
  const openInToolsService = createOpenInToolsService(openInTools);
  const runtimeDefinitionsService = createRuntimeDefinitionsService();
  const systemDiagnosticsService = createSystemDiagnosticsService({
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
  const effectiveRuntimeRegistry = runtimeRegistry ?? createRuntimeRegistry(runtimeRegistryInput);
  const taskWorktreeService = createTaskWorktreeService({
    settingsConfig,
    workspaceSettingsService,
  });
  const terminalService = Effect.runSync(
    createTerminalService({
      assertWorkspaceAdmitsWork: workspaceAdmissionService.assertWorkspaceAdmitsWork,
      resolveWorkspaceRepoPath: workspaceAdmissionService.resolveWorkspaceRepoPath,
      withWorkStartLease: workspaceAdmissionService.withWorkStartLease,
      filesystem,
      ptyPort: terminalPty,
      resolveLaunchEnvironment: createTerminalLaunchEnvironment({ processEnv }),
    }),
  );
  const devServerServiceInput: Parameters<typeof createDevServerService>[0] = {
    withWorkStartLease: workspaceAdmissionService.withWorkStartLease,
    processPort: devServerProcesses,
    taskWorktreeService,
    workspaceSettingsService,
  };
  if (eventBus) {
    devServerServiceInput.eventBus = eventBus;
  }
  const devServerService = createDevServerService(devServerServiceInput);
  const runtimeOrchestratorWithEffectiveRegistry = createRuntimeOrchestratorService({
    withWorkStartLease: workspaceAdmissionService.withWorkStartLease,
    gitPort: git,
    runtimeDefinitionsService,
    runtimeRegistry: effectiveRuntimeRegistry,
    taskReader: taskStore,
    logger: lifecycleLogger,
  });
  const workspaceLifecycleService = createWorkspaceLifecycleService({
    activity: createWorkspaceActivityInspector({
      agentSessionLiveStateService,
      devServerService,
      runtimeRegistry: effectiveRuntimeRegistry,
      terminalService,
    }),
    admission: workspaceAdmissionService,
    gitPort: git,
    hostOwnership: workspaceHostOwnership,
    ownershipLock: workspaceOwnershipLock,
    runtimeOrchestrator: runtimeOrchestratorWithEffectiveRegistry,
    settingsConfig,
    storage: {
      assertPermanentRemovalSupported: assets.assertPermanentRemovalSupported,
      workspaceTaskStoreExists: assets.workspaceTaskStoreExists,
      removeWorkspaceTaskAssets: assets.removeWorkspaceTaskAssets,
      removeWorkspaceTaskStore: assets.removeWorkspaceTaskStore,
    },
    taskStore,
    workspaceSessionStore: assets.workspaceSessionStore,
    workspaceSettingsService: ownedWorkspaceSettingsService,
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
        assertWorkspaceAdmitsWork: workspaceAdmissionService.assertWorkspaceAdmitsWork,
        withWorkStartLease: workspaceAdmissionService.withWorkStartLease,
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
  const workspaceSessionService = createWorkspaceSessionService({
    operationGate: workspaceSessions.operationGate,
    store: assets.workspaceSessionStore,
    settings: workspaceSettingsService,
    runtime: runtimeOrchestratorWithEffectiveRegistry,
    live: agentSessionLiveStateService,
    git,
    settingsConfig,
    worktreeFiles,
    systemCommands,
    withWorkStartLease: workspaceAdmissionService.withWorkStartLease,
  });
  const hostRouterLifecycle = createNodeHostRouterLifecycle({
    assets,
    devServerService,
    imageWorkers: defaultPorts.imageWorkers,
    lifecycleLogger,
    mcpHostBridge: resolvedMcpHostBridge,
    runtimeRegistry: effectiveRuntimeRegistry,
    startupSweep,
    taskAssetStagingService,
    taskSyncService,
    terminalService,
    workspaceHostOwnership,
  });
  const router = createEffectHostCommandRouter({
    initialize: () =>
      workspaceAdmissionService
        .initialize()
        .pipe(Effect.zipRight(hostRouterLifecycle.initialize())),
    dispose: hostRouterLifecycle.dispose,
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
      ...createGitProviderCommandHandlers({
        service: gitProviderService,
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
      ...createTaskAssetCommandHandlers(admittedTaskAssetStagingService),
      ...createTaskCommandHandlers(taskService),
      ...createTaskWorktreeCommandHandlers(taskWorktreeService),
      ...createTerminalCommandHandlers(terminalService),
      ...createWorkspaceSettingsCommandHandlers(workspaceSettingsService),
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

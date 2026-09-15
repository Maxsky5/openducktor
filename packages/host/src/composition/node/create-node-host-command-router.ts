import {
  createLiveSessionPublisher,
  createRuntimeLifecyclePublisher,
} from "./runtime-lifecycle-publisher";
import { createNodeImageCommandHandlers } from "./node-image-command-handlers";
import { resolveCodexEffectivePolicy } from "@openducktor/contracts";
import { Effect } from "effect";
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
import { createWorkspaceFilesService } from "../../application/filesystem/workspace-files-service";
import { createGitService } from "../../application/git/git-service";
import { createGitProviderService } from "../../application/git/git-provider-service";
import { createOdtMcpBridgeService } from "../../application/mcp/odt-mcp-bridge-service";
import { createPullRequestReviewService } from "../../application/pull-requests/pull-request-review-service";
import { createRuntimeDefinitionsService } from "../../application/runtimes/runtime-definitions-service";
import { createRuntimeOrchestratorService } from "../../application/runtimes/runtime-orchestrator-service";
import { readSavedRuntimeExecutablePath } from "../../application/runtimes/saved-runtime-executable";
import { createOpenInToolsService } from "../../application/system/open-in-tools-service";
import type { TaskSyncLoopHandle } from "../../application/tasks/sync/task-sync-service";
import { createTaskSessionLifecycleCoordinator } from "../../application/tasks/worktrees/task-session-lifecycle-coordinator";
import { createTaskWorktreeService } from "../../application/tasks/worktrees/task-worktree-service";
import { createTerminalService } from "../../application/terminals/terminal-service";
import { loadGlobalConfig } from "../../application/workspaces/workspace-settings-model";
import { createWorkspaceSettingsService } from "../../application/workspaces/workspace-settings-service";
import { createWorkspaceSessionService } from "../../application/workspaces/workspace-session-service";
import { createWorkspaceSessionCommandHandlers } from "../../interface/commands/workspace-session-command-handlers";
import type { GitProviderResolver } from "../../application/git/git-provider-resolver";
import { HostOperationError } from "../../effect/host-errors";
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
import { createWorkspaceSettingsCommandHandlers } from "../../interface/commands/workspace-settings-command-handlers";
import { createEffectHostCommandRouter } from "../../interface/router/host-command-router";
import {
  createStopDevServersStep,
  createStopMcpHostBridgeStep,
  createStopRuntimesStep,
  createStopTerminalsStep,
  runShutdownSteps,
  writeHostLifecycleLog,
} from "../host-lifecycle";
import { createClaudeRuntimeComposition } from "./claude-runtime-composition";
import type {
  CreateNodeHostCommandRouterInput,
  EffectNodeHostCommandRouter,
} from "./node-host-command-router-types";
import type { NodeHostDefaultPorts } from "./node-host-default-ports";
import { createLiveSessionFaultLogger, defaultLifecycleLogger } from "./node-host-lifecycle-logger";
import { createNodeRuntimeExecutableCommandHandlers } from "./node-runtime-executable-command-handlers";
import { createNodeTaskAssetServices } from "./node-task-asset-services";
import { createNodeTaskSessionServices } from "./node-task-session-services";
import { createNodeWorkspaceSessionPersistence } from "./node-workspace-session-persistence";
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
    configDirScope,
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
  const assets = createNodeTaskAssetServices({
    configDirScope,
    configuredTaskStore,
    onBackgroundFailure,
    processEnv,
    workspaceSettingsService,
  });
  const { startupSweep, taskAssetReadService, taskAssetStagingService, taskStore } = assets;
  const workspaceSessions = createNodeWorkspaceSessionPersistence({
    store: assets.workspaceSessionStore,
    settings: workspaceSettingsService,
    git,
    eventBus,
  });
  const liveSessionAdapterRegistry = createLiveSessionAdapterRegistry();
  const agentSessionLiveStateService = createAgentSessionLiveStateService({
    adapterRegistry: liveSessionAdapterRegistry,
    persistence: workspaceSessions.persistence,
    faultLog: createLiveSessionFaultLogger(lifecycleLogger),
    publish: createLiveSessionPublisher(eventBus),
  });
  const filesystemService = createFilesystemService(filesystem);
  const workspaceFilesService = createWorkspaceFilesService(filesystem, git);
  const gitService = createGitService({ gitPort: git, settingsConfig, worktreeFiles });
  const gitProviderService = createGitProviderService({
    resolver: gitProviderResolver,
    workspaceSettingsService,
  });
  const localAttachmentService = createLocalAttachmentService(localAttachments);
  const openInToolsService = createOpenInToolsService(openInTools);
  const runtimeDefinitionsService = createRuntimeDefinitionsService();
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
      filesystem,
      ptyPort: terminalPty,
      resolveLaunchEnvironment: createTerminalLaunchEnvironment({ processEnv }),
    }),
  );
  const devServerServiceInput: Parameters<typeof createDevServerService>[0] = {
    processPort: devServerProcesses,
    taskWorktreeService,
    workspaceSettingsService,
  };
  if (eventBus) {
    devServerServiceInput.eventBus = eventBus;
  }
  const devServerService = createDevServerService(devServerServiceInput);
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
    gitPort: git,
    runtimeDefinitionsService,
    runtimeRegistry: effectiveRuntimeRegistry,
    taskReader: taskStore,
    logger: lifecycleLogger,
  });
  let pullRequestSyncLoop: TaskSyncLoopHandle | null = null;
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
  });
  let taskAssetStagingSwept = false;
  const stopPullRequestSyncLoop = () =>
    Effect.gen(function* () {
      if (!pullRequestSyncLoop) {
        yield* writeHostLifecycleLog(
          lifecycleLogger,
          "info",
          "No pull request sync loop is running",
        );
        return;
      }
      yield* pullRequestSyncLoop.stop();
      pullRequestSyncLoop = null;
      yield* writeHostLifecycleLog(lifecycleLogger, "info", "Pull request sync loop stopped");
    });
  const router = createEffectHostCommandRouter({
    initialize: () =>
      Effect.gen(function* () {
        if (!taskAssetStagingSwept) {
          yield* startupSweep();
          taskAssetStagingSwept = true;
        }
        if (resolvedMcpHostBridge) {
          yield* resolvedMcpHostBridge.ensureExternalDiscoveryReady().pipe(
            Effect.mapError(
              (cause) =>
                new HostOperationError({
                  operation: "mcp-host-bridge.ensure-external-discovery",
                  message: cause.message,
                  cause,
                }),
            ),
          );
        }
        if (taskSyncService && pullRequestSyncLoop === null) {
          pullRequestSyncLoop = yield* taskSyncService.startPullRequestSyncLoop();
        }
      }),
    dispose: () =>
      Effect.gen(function* () {
        const loggingFailures: HostOperationError[] = [];
        const startLogResult = yield* Effect.either(
          writeHostLifecycleLog(lifecycleLogger, "info", "Shutting down OpenDucktor host services"),
        );
        if (startLogResult._tag === "Left") {
          loggingFailures.push(startLogResult.left);
        }
        const shutdownResult = yield* Effect.either(
          runShutdownSteps(
            [
              { label: "pull request sync loop", run: stopPullRequestSyncLoop },
              { label: "image workers", run: () => defaultPorts.imageWorkers.shutdown },
              createStopTerminalsStep(terminalService),
              createStopDevServersStep(devServerService, lifecycleLogger),
              createStopRuntimesStep(effectiveRuntimeRegistry, lifecycleLogger),
              createStopMcpHostBridgeStep(resolvedMcpHostBridge, lifecycleLogger),
              assets.taskAssetStagingShutdownStep,
              assets.taskStoreConnectionShutdownStep,
            ],
            lifecycleLogger,
          ),
        );
        if (shutdownResult._tag === "Right") {
          const completeLogResult = yield* Effect.either(
            writeHostLifecycleLog(lifecycleLogger, "info", "OpenDucktor host services stopped"),
          );
          if (completeLogResult._tag === "Left") {
            loggingFailures.push(completeLogResult.left);
          }
        }
        if (shutdownResult._tag === "Left" && loggingFailures.length > 0) {
          return yield* Effect.fail(
            new HostOperationError({
              operation: "host.dispose",
              message: `${shutdownResult.left.message}\nLifecycle logging: ${loggingFailures
                .map((failure) => failure.message)
                .join("\n")}`,
              cause: shutdownResult.left,
              details: {
                shutdownFailure: shutdownResult.left,
                loggingFailures,
              },
            }),
          );
        }
        if (shutdownResult._tag === "Left") {
          return yield* Effect.fail(shutdownResult.left);
        }
        const [loggingFailure] = loggingFailures;
        if (loggingFailures.length === 1 && loggingFailure) {
          return yield* Effect.fail(loggingFailure);
        }
        if (loggingFailures.length > 1) {
          return yield* Effect.fail(
            new HostOperationError({
              operation: "host.dispose",
              message: loggingFailures.map((failure) => failure.message).join("\n"),
              cause: loggingFailures[0],
              details: { loggingFailures },
            }),
          );
        }
      }),
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
      ...createTaskAssetCommandHandlers(taskAssetStagingService),
      ...createTaskCommandHandlers(taskService),
      ...createTaskWorktreeCommandHandlers(taskWorktreeService),
      ...createTerminalCommandHandlers(terminalService),
      ...createWorkspaceSettingsCommandHandlers(workspaceSettingsService),
      ...createWorkspaceSessionCommandHandlers(
        workspaceSessionService,
        workspaceSessions.publishUpdated,
      ),
    },
  });
  return Object.assign(router, {
    taskAssetReadService,
    taskEventStream,
    terminalService,
  });
};

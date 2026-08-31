import { resolveCodexEffectivePolicy } from "@openducktor/contracts";
import { Effect } from "effect";
import { createCodexLiveSessionAdapterPreparer } from "../../adapters/agent-sessions/codex-live-session-adapter";
import { createLiveSessionAdapterRegistry } from "../../adapters/agent-sessions/live-session-adapter-registry";
import { createOpenCodeLiveSessionAdapterPreparer } from "../../adapters/agent-sessions/opencode-live-session-adapter";
import { createCodexWorkspaceRuntimeStarter } from "../../adapters/codex/codex-workspace-runtime-starter";
import {
  createMcpHostBridgeServer,
  resolveMcpBridgeDiscoveryPath,
} from "../../adapters/mcp/mcp-host-bridge-server";
import { createOpenCodeWorkspaceRuntimeStarter } from "../../adapters/opencode/opencode-workspace-runtime-starter";
import { createRuntimeRegistry } from "../../adapters/runtimes/runtime-registry";
import { createRuntimeSessionOperations } from "../../adapters/runtimes/runtime-session-operations";
import { createRuntimeTaskActivityGuard } from "../../adapters/runtimes/runtime-task-activity-guard";
import { createRuntimeWorkspaceStarterDispatcher } from "../../adapters/runtimes/runtime-workspace-starter-dispatcher";
import { createAgentSessionLiveStateService } from "../../application/agent-sessions/agent-session-live-state-service";
import { createLocalAttachmentService } from "../../application/attachments/local-attachment-service";
import { createDevServerService } from "../../application/dev-servers/dev-server-service";
import { createSystemDiagnosticsService } from "../../application/diagnostics/system-diagnostics-service";
import { createFilesystemService } from "../../application/filesystem/filesystem-service";
import { createWorkspaceFilesService } from "../../application/filesystem/workspace-files-service";
import { createGitService } from "../../application/git/git-service";
import { createGithubRepositoryDetectionService } from "../../application/git/github-repository-detection-service";
import { createOdtMcpBridgeService } from "../../application/mcp/odt-mcp-bridge-service";
import { createPullRequestReviewService } from "../../application/pull-requests/pull-request-review-service";
import { createCodexAppServerService } from "../../application/runtimes/codex-app-server-service";
import { createRuntimeDefinitionsService } from "../../application/runtimes/runtime-definitions-service";
import { createRuntimeOrchestratorService } from "../../application/runtimes/runtime-orchestrator-service";
import { readSavedRuntimeExecutablePath } from "../../application/runtimes/saved-runtime-executable";
import { createOpenInToolsService } from "../../application/system/open-in-tools-service";
import type { TaskSyncLoopHandle } from "../../application/tasks/sync/task-sync-service";
import { createTaskServiceWithMutationProgress } from "../../application/tasks/task-service";
import { createTaskWorktreeService } from "../../application/tasks/worktrees/task-worktree-service";
import { createTerminalService } from "../../application/terminals/terminal-service";
import { loadGlobalConfig } from "../../application/workspaces/workspace-settings-model";
import { createWorkspaceSettingsService } from "../../application/workspaces/workspace-settings-service";
import { HostOperationError, HostResourceError } from "../../effect/host-errors";
import { createTerminalLaunchEnvironment } from "../../infrastructure/terminals/terminal-launch-environment";
import { createAgentSessionLiveCommandHandlers } from "../../interface/commands/agent-session-live-command-handlers";
import { createClaudeRuntimeCommandHandlers } from "../../interface/commands/claude-runtime-command-handlers";
import { createCodexAppServerCommandHandlers } from "../../interface/commands/codex-app-server-command-handlers";
import { createDevServerCommandHandlers } from "../../interface/commands/dev-server-command-handlers";
import { createFilesystemCommandHandlers } from "../../interface/commands/filesystem-command-handlers";
import { createGitCommandHandlers } from "../../interface/commands/git-command-handlers";
import { createGithubRepositoryDetectionCommandHandlers } from "../../interface/commands/github-repository-detection-command-handlers";
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
import {
  createEffectHostCommandRouter,
  type HostCommandRouter,
  toPromiseHostCommandRouter,
} from "../../interface/router/host-command-router";
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
import { createNodeHostDefaultPorts } from "./node-host-default-ports";
import { createLiveSessionFaultLogger, defaultLifecycleLogger } from "./node-host-lifecycle-logger";
import { createNodeGitProviderResolver } from "./git-provider-composition";
import { createNodeRuntimeExecutableCommandHandlers } from "./node-runtime-executable-command-handlers";
import { createNodeTaskAssetServices } from "./node-task-asset-services";
import { createNodeTaskEventServices } from "./node-task-event-services";
import { createRuntimeActiveSessionResolver } from "./runtime-active-session-resolver";
import { resolveWorkspaceRuntimeMcpBridgeConnection } from "./workspace-runtime-mcp-bridge-connection";

export type { CreateNodeHostCommandRouterInput, EffectNodeHostCommandRouter };

export const createNodeEffectHostCommandRouter = (
  input: CreateNodeHostCommandRouterInput,
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
  } = createNodeHostDefaultPorts(input);
  const codexAppServerService = createCodexAppServerService(effectiveCodexAppServer);
  const liveSessionAdapterRegistry = createLiveSessionAdapterRegistry();
  const agentSessionLiveStateService = createAgentSessionLiveStateService({
    adapterRegistry: liveSessionAdapterRegistry,
    faultLog: createLiveSessionFaultLogger(lifecycleLogger),
    publish: (envelope) => {
      if (!eventBus) {
        throw new HostResourceError({
          resource: "host-event-bus",
          operation: "agent-session-live.publish",
          message: "Live agent-session events require a configured host event bus.",
        });
      }
      eventBus.publish({
        channel: "openducktor://agent-session-live-event",
        payload: envelope,
      });
    },
  });
  const filesystemService = createFilesystemService(filesystem);
  const workspaceFilesService = createWorkspaceFilesService(filesystem, git);
  const gitService = createGitService({ gitPort: git, settingsConfig, worktreeFiles });
  const githubRepositoryDetectionService = createGithubRepositoryDetectionService(git);
  const localAttachmentService = createLocalAttachmentService(localAttachments);
  const openInToolsService = createOpenInToolsService(openInTools);
  const runtimeDefinitionsService = createRuntimeDefinitionsService();
  const workspaceSettingsService = createWorkspaceSettingsService(settingsConfig);
  const taskAssetServiceInput: Parameters<typeof createNodeTaskAssetServices>[0] = {
    onBackgroundFailure,
    processEnv,
    workspaceSettingsService,
  };
  if (configuredTaskStore) {
    taskAssetServiceInput.configuredTaskStore = configuredTaskStore;
  }
  const assets = createNodeTaskAssetServices(taskAssetServiceInput);
  const { startupSweep, taskAssetReadService, taskAssetStagingService, taskStore } = assets;
  const systemDiagnosticsService = createSystemDiagnosticsService({
    runtimeDefinitionsService,
    runtimeHealth,
    settingsConfig,
    systemCommands,
    toolDiscovery,
    repoStoreDiagnostics: taskStore,
  });
  const claudeWorkingDirectoryDependencies = { settingsConfig, workspaceSettingsService };
  let resolvedMcpHostBridge = mcpHostBridge;
  const claudeRuntime = createClaudeRuntimeComposition({
    liveSessionLifecycle: agentSessionLiveStateService,
    onBackgroundFailure,
    processEnv,
    runtimeExecutableProbe: runtimeExecutableProbes.claude,
    runtimeDistribution,
    settingsConfig,
    toolDiscovery,
    workingDirectoryDependencies: claudeWorkingDirectoryDependencies,
    resolveMcpBridgeConnection: (repoPath) =>
      resolvedMcpHostBridge
        ? resolvedMcpHostBridge.ensureConnection({ repoPath }).pipe(
            Effect.mapError(
              (cause) =>
                new HostOperationError({
                  operation: "claude-agent-sdk.resolve-mcp-bridge",
                  message: cause.message,
                  cause,
                }),
            ),
          )
        : Effect.fail(
            new HostOperationError({
              operation: "claude-agent-sdk.resolve-mcp-bridge",
              message: "Claude Agent SDK requires an initialized MCP host bridge.",
            }),
          ),
  });
  const codexWorkspaceRuntimeStarterInput: Parameters<
    typeof createCodexWorkspaceRuntimeStarter
  >[0] = {
    toolDiscovery,
    settingsConfig,
    codexAppServer: effectiveCodexTransportRegistry,
    liveSessionLifecycle: agentSessionLiveStateService,
    prepareLiveSessionAdapter: createCodexLiveSessionAdapterPreparer({
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
      resolveWorkspaceRuntimeMcpBridgeConnection(
        resolvedMcpHostBridge,
        "codex",
        runtimeInput.repoPath,
      ),
  };
  if (clientVersion) {
    codexWorkspaceRuntimeStarterInput.clientVersion = clientVersion;
  }
  const workspaceStarter = createRuntimeWorkspaceStarterDispatcher({
    claude: claudeRuntime.workspaceStarter,
    codex: createCodexWorkspaceRuntimeStarter(codexWorkspaceRuntimeStarterInput),
    opencode: createOpenCodeWorkspaceRuntimeStarter({
      toolDiscovery,
      settingsConfig,
      processEnv,
      runtimeDistribution,
      liveSessionLifecycle: agentSessionLiveStateService,
      prepareLiveSessionAdapter: createOpenCodeLiveSessionAdapterPreparer({
        liveSessionLifecycle: agentSessionLiveStateService,
      }),
      resolveMcpBridgeConnection: (runtimeInput) =>
        resolveWorkspaceRuntimeMcpBridgeConnection(
          resolvedMcpHostBridge,
          "opencode",
          runtimeInput.repoPath,
        ),
    }),
  });
  const effectiveRuntimeRegistry =
    runtimeRegistry ??
    createRuntimeRegistry({
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
    });
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
  });
  const baseTaskService = createTaskServiceWithMutationProgress({
    devServerService,
    terminalService,
    gitPort: git,
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
  });
  const { taskEventStream, taskService, taskSyncService } = createNodeTaskEventServices({
    baseTaskService,
    lifecycleLogger,
    onBackgroundFailure,
    taskEventPublicationReporter,
    workspaceSettingsService,
  });
  const odtMcpBridgeService = createOdtMcpBridgeService({
    taskAssetReadService,
    taskService,
    workspaceSettingsService,
  });
  const gitProviderResolver = createNodeGitProviderResolver({
    gitPort: git,
    systemCommands,
    toolDiscovery,
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
              createStopTerminalsStep(terminalService),
              createStopDevServersStep(devServerService, lifecycleLogger),
              createStopRuntimesStep(effectiveRuntimeRegistry, lifecycleLogger),
              createStopMcpHostBridgeStep(resolvedMcpHostBridge, lifecycleLogger),
              {
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
      ...createAgentSessionLiveCommandHandlers(
        agentSessionLiveStateService,
        localAttachmentService,
      ),
      ...createClaudeRuntimeCommandHandlers(
        claudeRuntime.agentSdkService,
        effectiveRuntimeRegistry,
        claudeWorkingDirectoryDependencies,
      ),
      ...createDevServerCommandHandlers(devServerService),
      ...createCodexAppServerCommandHandlers(codexAppServerService, {
        logger: lifecycleLogger,
        onBackgroundFailure,
      }),
      ...createFilesystemCommandHandlers(filesystemService),
      ...createWorkspaceFilesCommandHandlers(workspaceFilesService),
      ...createGitCommandHandlers(gitService),
      ...createGithubRepositoryDetectionCommandHandlers(githubRepositoryDetectionService),
      ...createLocalAttachmentCommandHandlers(localAttachmentService),
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
    },
  });
  return Object.assign(router, { taskAssetReadService, taskEventStream, terminalService });
};

export const createNodeHostCommandRouter = (
  input: CreateNodeHostCommandRouterInput,
): HostCommandRouter => toPromiseHostCommandRouter(createNodeEffectHostCommandRouter(input));

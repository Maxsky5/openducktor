import { Effect } from "effect";
import { createCodexWorkspaceRuntimeStarter } from "../../adapters/codex/codex-workspace-runtime-starter";
import {
  createMcpHostBridgeServer,
  type McpHostBridgeServer,
  resolveMcpBridgeDiscoveryPath,
} from "../../adapters/mcp/mcp-host-bridge-server";
import { createOpenCodeWorkspaceRuntimeStarter } from "../../adapters/opencode/opencode-workspace-runtime-starter";
import { createRuntimeRegistry } from "../../adapters/runtimes/runtime-registry";
import { createRuntimeTaskActivityGuard } from "../../adapters/runtimes/runtime-task-activity-guard";
import { createSqliteTaskRepository } from "../../adapters/sqlite/sqlite-task-repository";
import { createLocalAttachmentService } from "../../application/attachments/local-attachment-service";
import { createDevServerService } from "../../application/dev-servers/dev-server-service";
import { createSystemDiagnosticsService } from "../../application/diagnostics/system-diagnostics-service";
import { createFilesystemService } from "../../application/filesystem/filesystem-service";
import { createGitService } from "../../application/git/git-service";
import { createGithubRepositoryDetectionService } from "../../application/git/github-repository-detection-service";
import { createOdtMcpBridgeService } from "../../application/mcp/odt-mcp-bridge-service";
import {
  type CodexAppServerService,
  createCodexAppServerService,
} from "../../application/runtimes/codex-app-server-service";
import { createRuntimeDefinitionsService } from "../../application/runtimes/runtime-definitions-service";
import { createRuntimeOrchestratorService } from "../../application/runtimes/runtime-orchestrator-service";
import { createOpenInToolsService } from "../../application/system/open-in-tools-service";
import {
  createTaskSyncService,
  type TaskSyncLoopHandle,
} from "../../application/tasks/sync/task-sync-service";
import { createTaskService } from "../../application/tasks/task-service";
import { createTaskWorktreeService } from "../../application/tasks/worktrees/task-worktree-service";
import { createWorkspaceSettingsService } from "../../application/workspaces/workspace-settings-service";
import { HostOperationError, HostResourceError } from "../../effect/host-errors";
import type { HostEventBusPort } from "../../events/host-event-bus";
import { createCodexAppServerCommandHandlers } from "../../interface/commands/codex-app-server-command-handlers";
import { createDevServerCommandHandlers } from "../../interface/commands/dev-server-command-handlers";
import { createFilesystemCommandHandlers } from "../../interface/commands/filesystem-command-handlers";
import { createGitCommandHandlers } from "../../interface/commands/git-command-handlers";
import { createGithubRepositoryDetectionCommandHandlers } from "../../interface/commands/github-repository-detection-command-handlers";
import { createLocalAttachmentCommandHandlers } from "../../interface/commands/local-attachment-command-handlers";
import { createOpenInToolsCommandHandlers } from "../../interface/commands/open-in-tools-command-handlers";
import { createRuntimeDefinitionsCommandHandlers } from "../../interface/commands/runtime-definitions-command-handlers";
import { createRuntimeOrchestratorCommandHandlers } from "../../interface/commands/runtime-orchestrator-command-handlers";
import { createSystemDiagnosticsCommandHandlers } from "../../interface/commands/system-diagnostics-command-handlers";
import { createSystemPlatformCommandHandlers } from "../../interface/commands/system-platform-command-handlers";
import { createTaskCommandHandlers } from "../../interface/commands/task-command-handlers";
import { createTaskWorktreeCommandHandlers } from "../../interface/commands/task-worktree-command-handlers";
import { createWorkspaceSettingsCommandHandlers } from "../../interface/commands/workspace-settings-command-handlers";
import {
  createEffectHostCommandRouter,
  type EffectHostCommandRouter,
  type HostCommandRouter,
  toPromiseHostCommandRouter,
} from "../../interface/router/host-command-router";
import type {
  RuntimeRegistryPort,
  RuntimeWorkspaceStarterPort,
} from "../../ports/runtime-registry-port";
import type { TaskStorePort } from "../../ports/task-repository-ports";
import {
  createStopDevServersStep,
  createStopMcpHostBridgeStep,
  createStopRuntimesStep,
  type HostLifecycleLogger,
  runShutdownSteps,
} from "../host-lifecycle";
import {
  type CreateNodeHostDefaultPortsInput,
  createNodeHostDefaultPorts,
} from "./node-host-default-ports";

export type CreateNodeHostCommandRouterInput = CreateNodeHostDefaultPortsInput & {
  clientVersion?: string;
  eventBus?: HostEventBusPort;
  lifecycleLogger?: HostLifecycleLogger;
  mcpHostBridge?: McpHostBridgeServer;
  runtimeRegistry?: RuntimeRegistryPort;
  taskStore?: TaskStorePort;
};

export const createNodeEffectHostCommandRouter = (
  input: CreateNodeHostCommandRouterInput,
): EffectHostCommandRouter => {
  const {
    clientVersion,
    eventBus,
    lifecycleLogger = console,
    mcpHostBridge,
    runtimeRegistry,
    taskStore: configuredTaskStore,
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
    runtimeHealth,
    settingsConfig,
    systemCommands,
    toolDiscovery,
    worktreeFiles,
  } = createNodeHostDefaultPorts(input);
  const codexAppServerService: CodexAppServerService =
    createCodexAppServerService(effectiveCodexAppServer);
  const filesystemService = createFilesystemService(filesystem);
  const gitService = createGitService({ gitPort: git, settingsConfig, worktreeFiles });
  const githubRepositoryDetectionService = createGithubRepositoryDetectionService(git);
  const localAttachmentService = createLocalAttachmentService(localAttachments);
  const openInToolsService = createOpenInToolsService(openInTools);
  const runtimeDefinitionsService = createRuntimeDefinitionsService();
  const workspaceSettingsService = createWorkspaceSettingsService(settingsConfig);
  const taskStore: TaskStorePort =
    configuredTaskStore ??
    createSqliteTaskRepository({
      processEnv,
      resolveWorkspaceIdForRepoPath: (repoPath) =>
        workspaceSettingsService
          .getRepoConfigByRepoPath(repoPath)
          .pipe(Effect.map((repoConfig) => repoConfig.workspaceId)),
    });
  const systemDiagnosticsService = createSystemDiagnosticsService({
    runtimeDefinitionsService,
    runtimeHealth,
    settingsConfig,
    systemCommands,
    toolDiscovery,
    repoStoreDiagnostics: taskStore,
  });
  let resolvedMcpHostBridge = mcpHostBridge;
  const workspaceStarter: RuntimeWorkspaceStarterPort = {
    startWorkspaceRuntime(input) {
      if (input.runtimeKind === "codex") {
        return createCodexWorkspaceRuntimeStarter({
          toolDiscovery,
          codexAppServer: effectiveCodexTransportRegistry,
          processEnv,
          runtimeDistribution,
          ...(clientVersion ? { clientVersion } : {}),
          ...(eventBus
            ? {
                eventEmitter: (event) =>
                  eventBus.publish("openducktor://codex-app-server-event", event),
              }
            : {}),
          resolveMcpBridgeConnection: () =>
            resolvedMcpHostBridge
              ? resolvedMcpHostBridge.ensureConnection({ repoPath: input.repoPath }).pipe(
                  Effect.mapError(
                    (cause) =>
                      new HostOperationError({
                        operation: "codex-workspace-runtime.resolve-mcp-bridge",
                        message: cause.message,
                        cause,
                      }),
                  ),
                )
              : Effect.fail(
                  new HostResourceError({
                    message: "Codex workspace startup requires an initialized MCP host bridge.",
                    resource: "mcp-host-bridge",
                    operation: "codex-workspace-runtime.start",
                  }),
                ),
        }).startWorkspaceRuntime(input);
      }

      return createOpenCodeWorkspaceRuntimeStarter({
        toolDiscovery,
        processEnv,
        runtimeDistribution,
        resolveMcpBridgeConnection: (runtimeInput) =>
          resolvedMcpHostBridge
            ? resolvedMcpHostBridge.ensureConnection({ repoPath: runtimeInput.repoPath }).pipe(
                Effect.mapError(
                  (cause) =>
                    new HostOperationError({
                      operation: "opencode-workspace-runtime.resolve-mcp-bridge",
                      message: cause.message,
                      cause,
                    }),
                ),
              )
            : Effect.fail(
                new HostResourceError({
                  message: "OpenCode workspace startup requires an initialized MCP host bridge.",
                  resource: "mcp-host-bridge",
                  operation: "opencode-workspace-runtime.start",
                }),
              ),
      }).startWorkspaceRuntime(input);
    },
  };
  const effectiveRuntimeRegistry =
    runtimeRegistry ??
    createRuntimeRegistry({
      workspaceStarter,
      codexAppServer: effectiveCodexAppServer,
    });
  const taskWorktreeService = createTaskWorktreeService({
    settingsConfig,
    workspaceSettingsService,
  });
  const devServerService = createDevServerService({
    ...(eventBus ? { eventBus } : {}),
    processPort: devServerProcesses,
    taskWorktreeService,
    workspaceSettingsService,
  });
  const taskActivityGuard = createRuntimeTaskActivityGuard({
    runtimeRegistry: effectiveRuntimeRegistry,
  });
  const taskService = createTaskService({
    devServerService,
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
  const taskSyncService = eventBus
    ? createTaskSyncService({
        eventBus,
        logger: lifecycleLogger,
        taskService,
        workspaceSettingsService,
      })
    : null;
  const odtMcpBridgeService = createOdtMcpBridgeService({
    taskService,
    ...(taskSyncService ? { taskSyncService } : {}),
    workspaceSettingsService,
  });
  resolvedMcpHostBridge ??= createMcpHostBridgeServer({
    bridgeService: odtMcpBridgeService,
    discoveryPath: resolveMcpBridgeDiscoveryPath(processEnv),
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

  const stopPullRequestSyncLoop = () =>
    Effect.gen(function* () {
      if (!pullRequestSyncLoop) {
        lifecycleLogger.info("No pull request sync loop is running");
        return;
      }

      yield* pullRequestSyncLoop.stop();
      pullRequestSyncLoop = null;
      lifecycleLogger.info("Pull request sync loop stopped");
    });

  return createEffectHostCommandRouter({
    initialize: () =>
      Effect.gen(function* () {
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
        lifecycleLogger.info("Shutting down OpenDucktor host services");
        yield* runShutdownSteps(
          [
            { label: "pull request sync loop", run: stopPullRequestSyncLoop },
            createStopDevServersStep(devServerService, lifecycleLogger),
            createStopRuntimesStep(effectiveRuntimeRegistry, lifecycleLogger),
            createStopMcpHostBridgeStep(resolvedMcpHostBridge, lifecycleLogger),
          ],
          lifecycleLogger,
        );
        lifecycleLogger.info("OpenDucktor host services stopped");
      }),
    handlers: {
      ...createDevServerCommandHandlers(devServerService),
      ...createCodexAppServerCommandHandlers(codexAppServerService, {
        logger: lifecycleLogger,
      }),
      ...createFilesystemCommandHandlers(filesystemService),
      ...createGitCommandHandlers(gitService),
      ...createGithubRepositoryDetectionCommandHandlers(githubRepositoryDetectionService),
      ...createLocalAttachmentCommandHandlers(localAttachmentService),
      ...createOpenInToolsCommandHandlers(openInToolsService),
      ...createRuntimeDefinitionsCommandHandlers(runtimeDefinitionsService),
      ...createRuntimeOrchestratorCommandHandlers(runtimeOrchestratorWithEffectiveRegistry),
      ...createSystemDiagnosticsCommandHandlers(systemDiagnosticsService),
      ...createSystemPlatformCommandHandlers(),
      ...createTaskCommandHandlers(taskService),
      ...createTaskWorktreeCommandHandlers(taskWorktreeService),
      ...createWorkspaceSettingsCommandHandlers(workspaceSettingsService),
    },
  });
};

export const createNodeHostCommandRouter = (
  input: CreateNodeHostCommandRouterInput,
): HostCommandRouter => toPromiseHostCommandRouter(createNodeEffectHostCommandRouter(input));

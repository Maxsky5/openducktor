import { createCodexAppServerCommandHandlers } from "../application/codex-app-server-command-handlers";
import {
  type CodexAppServerService,
  createCodexAppServerService,
} from "../application/codex-app-server-service";
import { createDevServerCommandHandlers } from "../application/dev-server-command-handlers";
import { createDevServerService } from "../application/dev-server-service";
import { createFilesystemCommandHandlers } from "../application/filesystem-command-handlers";
import { createFilesystemService } from "../application/filesystem-service";
import { createGitCommandHandlers } from "../application/git-command-handlers";
import { createGitService } from "../application/git-service";
import { createGithubRepositoryDetectionCommandHandlers } from "../application/github-repository-detection-command-handlers";
import { createGithubRepositoryDetectionService } from "../application/github-repository-detection-service";
import {
  createHostCommandRouter,
  type HostCommandRouter,
} from "../application/host-command-router";
import { createLocalAttachmentCommandHandlers } from "../application/local-attachment-command-handlers";
import { createLocalAttachmentService } from "../application/local-attachment-service";
import { createOdtMcpBridgeService } from "../application/odt-mcp-bridge-service";
import { createOpenInToolsCommandHandlers } from "../application/open-in-tools-command-handlers";
import { createOpenInToolsService } from "../application/open-in-tools-service";
import { createRuntimeDefinitionsCommandHandlers } from "../application/runtime-definitions-command-handlers";
import { createRuntimeDefinitionsService } from "../application/runtime-definitions-service";
import { createRuntimeOrchestratorCommandHandlers } from "../application/runtime-orchestrator-command-handlers";
import { createRuntimeOrchestratorService } from "../application/runtime-orchestrator-service";
import { createSystemDiagnosticsCommandHandlers } from "../application/system-diagnostics-command-handlers";
import { createSystemDiagnosticsService } from "../application/system-diagnostics-service";
import { createTaskCommandHandlers } from "../application/task-command-handlers";
import { createTaskService } from "../application/task-service";
import { createTaskSyncService } from "../application/task-sync-service";
import { createTaskWorktreeCommandHandlers } from "../application/task-worktree-command-handlers";
import { createTaskWorktreeService } from "../application/task-worktree-service";
import { createWorkspaceSettingsCommandHandlers } from "../application/workspace-settings-command-handlers";
import { createWorkspaceSettingsService } from "../application/workspace-settings-service";
import type { HostEventBusPort } from "../events/host-event-bus";
import type { CodexAppServerPort } from "../ports/codex-app-server-port";
import type { DevServerProcessPort } from "../ports/dev-server-process-port";
import type { FilesystemPort } from "../ports/filesystem-port";
import type { GitPort } from "../ports/git-port";
import type { LocalAttachmentPort } from "../ports/local-attachment-port";
import type { OpenInToolsPort } from "../ports/open-in-tools-port";
import type { RuntimeHealthPort } from "../ports/runtime-health-port";
import type {
  RuntimeRegistryPort,
  RuntimeWorkspaceStarterPort,
} from "../ports/runtime-registry-port";
import type { SettingsConfigPort } from "../ports/settings-config-port";
import type { SystemCommandPort } from "../ports/system-command-port";
import type { TaskStorePort } from "../ports/task-store-port";
import type { WorktreeFilePort } from "../ports/worktree-file-port";
import { createInMemoryCodexAppServerPort } from "./in-memory-codex-app-server-port";
import { createInMemoryRuntimeRegistryPort } from "./in-memory-runtime-registry-port";
import {
  createNodeBeadsTaskStorePort,
  type NodeBeadsTaskStorePort,
} from "./node-beads-task-store-port";
import {
  type CodexAppServerTransportRegistry,
  createNodeCodexWorkspaceStarterPort,
} from "./node-codex-workspace-starter-port";
import { createNodeDevServerProcessPort } from "./node-dev-server-process-port";
import { createNodeFilesystemPort } from "./node-filesystem-port";
import { createNodeGitPort } from "./node-git-port";
import { createNodeLocalAttachmentPort } from "./node-local-attachment-port";
import { createNodeMcpHostBridgePort, type McpHostBridgePort } from "./node-mcp-host-bridge-port";
import { createNodeOpenInToolsPort } from "./node-open-in-tools-port";
import { createNodeOpenCodeWorkspaceStarterPort } from "./node-opencode-workspace-starter-port";
import { createNodeProcessEnvironment } from "./node-process-environment";
import { createNodeRuntimeHealthPort } from "./node-runtime-health-port";
import { createNodeSettingsConfigPort } from "./node-settings-config-port";
import { createNodeSystemCommandPort } from "./node-system-command-port";
import { createNodeWorktreeFilePort } from "./node-worktree-file-port";
import { createRuntimeTaskActivityGuardPort } from "./runtime-task-activity-guard-port";

export type HostLifecycleLogger = {
  info(message: string): void;
  error(message: string): void;
};

export type CreateNodeHostCommandRouterInput = {
  codexAppServer?: CodexAppServerPort;
  codexAppServerTransportRegistry?: CodexAppServerTransportRegistry;
  devServerProcesses?: DevServerProcessPort;
  eventBus?: HostEventBusPort;
  filesystem?: FilesystemPort;
  git?: GitPort;
  localAttachments?: LocalAttachmentPort;
  lifecycleLogger?: HostLifecycleLogger;
  openInTools?: OpenInToolsPort;
  mcpHostBridge?: McpHostBridgePort;
  processEnv?: NodeJS.ProcessEnv;
  runtimeHealth?: RuntimeHealthPort;
  runtimeRegistry?: RuntimeRegistryPort;
  settingsConfig?: SettingsConfigPort;
  systemCommands?: SystemCommandPort;
  taskStore?: TaskStorePort;
  worktreeFiles?: WorktreeFilePort;
};

const isCodexAppServerTransportRegistry = (
  value: CodexAppServerPort,
): value is CodexAppServerPort & CodexAppServerTransportRegistry =>
  "registerTransport" in value &&
  typeof value.registerTransport === "function" &&
  "unregisterTransport" in value &&
  typeof value.unregisterTransport === "function";

const runShutdownSteps = async (
  steps: Array<{ label: string; run: () => Promise<void> }>,
  logger: HostLifecycleLogger,
): Promise<void> => {
  const errors: string[] = [];
  for (const step of steps) {
    try {
      await step.run();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error(`Failed to stop ${step.label}: ${message}`);
      errors.push(`${step.label}: ${message}`);
    }
  }
  if (errors.length > 0) {
    throw new Error(errors.join("\n"));
  }
};

const formatRuntimeTaskLabel = (taskId: string | null): string => taskId ?? "workspace";

export const createNodeHostCommandRouter = ({
  codexAppServer,
  codexAppServerTransportRegistry,
  devServerProcesses: configuredDevServerProcesses,
  eventBus,
  filesystem = createNodeFilesystemPort(),
  git: configuredGit,
  localAttachments = createNodeLocalAttachmentPort(),
  lifecycleLogger = console,
  openInTools = createNodeOpenInToolsPort(),
  mcpHostBridge,
  processEnv = createNodeProcessEnvironment(),
  systemCommands: configuredSystemCommands,
  runtimeHealth: configuredRuntimeHealth,
  runtimeRegistry,
  settingsConfig = createNodeSettingsConfigPort(),
  worktreeFiles = createNodeWorktreeFilePort(),
  taskStore: configuredTaskStore,
}: CreateNodeHostCommandRouterInput = {}): HostCommandRouter => {
  const systemCommands =
    configuredSystemCommands ?? createNodeSystemCommandPort({ env: processEnv });
  const runtimeHealth =
    configuredRuntimeHealth ?? createNodeRuntimeHealthPort(systemCommands, processEnv);
  const devServerProcesses =
    configuredDevServerProcesses ?? createNodeDevServerProcessPort({ processEnv });
  const git = configuredGit ?? createNodeGitPort({ processEnv });
  const defaultCodexAppServer = createInMemoryCodexAppServerPort();
  const effectiveCodexAppServer = codexAppServer ?? defaultCodexAppServer;
  const effectiveCodexTransportRegistry =
    codexAppServerTransportRegistry ??
    (isCodexAppServerTransportRegistry(effectiveCodexAppServer)
      ? effectiveCodexAppServer
      : defaultCodexAppServer);
  const codexAppServerService: CodexAppServerService =
    createCodexAppServerService(effectiveCodexAppServer);
  const filesystemService = createFilesystemService(filesystem);
  const gitService = createGitService({ gitPort: git, settingsConfig, worktreeFiles });
  const githubRepositoryDetectionService = createGithubRepositoryDetectionService(git);
  const localAttachmentService = createLocalAttachmentService(localAttachments);
  const openInToolsService = createOpenInToolsService(openInTools);
  const runtimeDefinitionsService = createRuntimeDefinitionsService();
  const workspaceSettingsService = createWorkspaceSettingsService(settingsConfig);
  let ownedTaskStore: NodeBeadsTaskStorePort | null = null;
  const taskStore: TaskStorePort =
    configuredTaskStore ??
    (() => {
      ownedTaskStore = createNodeBeadsTaskStorePort({
        processEnv,
        systemCommands,
        async resolveWorkspaceIdForRepoPath(repoPath) {
          const repoConfig = await workspaceSettingsService.getRepoConfigByRepoPath(repoPath);
          return repoConfig.workspaceId;
        },
      });
      return ownedTaskStore;
    })();
  const systemDiagnosticsService = createSystemDiagnosticsService({
    runtimeDefinitionsService,
    runtimeHealth,
    settingsConfig,
    systemCommands,
    taskStore,
  });
  let resolvedMcpHostBridge = mcpHostBridge;
  const workspaceStarter: RuntimeWorkspaceStarterPort = {
    async startWorkspaceRuntime(input) {
      if (input.runtimeKind === "codex") {
        return createNodeCodexWorkspaceStarterPort({
          systemCommands,
          codexAppServer: effectiveCodexTransportRegistry,
          processEnv,
          resolveMcpBridgeConnection: async () => {
            if (!resolvedMcpHostBridge) {
              throw new Error("Codex workspace startup requires an initialized MCP host bridge.");
            }
            return resolvedMcpHostBridge.ensureConnection({ repoPath: input.repoPath });
          },
        }).startWorkspaceRuntime(input);
      }

      return createNodeOpenCodeWorkspaceStarterPort({
        systemCommands,
        processEnv,
        resolveMcpBridgeConnection: async (runtimeInput) => {
          if (!resolvedMcpHostBridge) {
            throw new Error("OpenCode workspace startup requires an initialized MCP host bridge.");
          }
          return resolvedMcpHostBridge.ensureConnection({ repoPath: runtimeInput.repoPath });
        },
      }).startWorkspaceRuntime(input);
    },
  };
  const effectiveRuntimeRegistry =
    runtimeRegistry ??
    createInMemoryRuntimeRegistryPort({
      workspaceStarter,
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
  const taskActivityGuard = createRuntimeTaskActivityGuardPort({
    runtimeRegistry: effectiveRuntimeRegistry,
  });
  const taskService = createTaskService({
    devServerService,
    gitPort: git,
    taskStore,
    taskActivityGuard,
    settingsConfig,
    systemCommands,
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
  resolvedMcpHostBridge ??= createNodeMcpHostBridgePort({
    bridgeService: odtMcpBridgeService,
    workspaceSettingsService,
  });
  const runtimeOrchestratorWithEffectiveRegistry = createRuntimeOrchestratorService({
    gitPort: git,
    runtimeDefinitionsService,
    runtimeRegistry: effectiveRuntimeRegistry,
    taskStore,
    logger: lifecycleLogger,
  });

  const stopDevServers = async (): Promise<void> => {
    const result = await devServerService.stopAll();
    if (result.stoppedScripts.length === 0) {
      lifecycleLogger.info("No dev servers are running");
      return;
    }

    for (const script of result.stoppedScripts) {
      lifecycleLogger.info(
        `Stopped dev server ${script.name} (${script.scriptId}) for task ${script.taskId} with pid ${script.pid}`,
      );
    }
  };

  const stopRegisteredRuntimes = async (): Promise<void> => {
    if (effectiveRuntimeRegistry.stopAllRuntimes) {
      lifecycleLogger.info("Stopping registered agent runtimes");
      const stoppedRuntimes = await effectiveRuntimeRegistry.stopAllRuntimes();
      if (stoppedRuntimes.length === 0) {
        lifecycleLogger.info("No active agent runtimes are registered");
        return;
      }
      for (const runtime of stoppedRuntimes) {
        lifecycleLogger.info(
          `Stopped ${runtime.kind} runtime ${runtime.runtimeId} for task ${formatRuntimeTaskLabel(
            runtime.taskId,
          )} (${runtime.role})`,
        );
      }
      return;
    }

    const runtimes = await effectiveRuntimeRegistry.listRuntimes();
    if (runtimes.length === 0) {
      lifecycleLogger.info("No active agent runtimes are registered");
      return;
    }

    lifecycleLogger.info(`Stopping ${runtimes.length} active agent runtime(s)`);
    const errors: string[] = [];
    for (const runtime of runtimes) {
      try {
        lifecycleLogger.info(
          `Stopping ${runtime.kind} runtime ${runtime.runtimeId} for task ${formatRuntimeTaskLabel(
            runtime.taskId,
          )} (${runtime.role})`,
        );
        await effectiveRuntimeRegistry.stopRuntime(runtime.runtimeId);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        errors.push(`Failed stopping runtime ${runtime.runtimeId}: ${message}`);
      }
    }
    if (errors.length > 0) {
      throw new Error(errors.join("\n"));
    }
  };

  const stopSharedDoltServer = async (): Promise<void> => {
    if (!ownedTaskStore) {
      lifecycleLogger.info("No shared Dolt server owned by this OpenDucktor process");
      return;
    }

    const result = await ownedTaskStore.close();
    if (result.stoppedSharedDoltServers === 0) {
      lifecycleLogger.info("No shared Dolt server owned by this OpenDucktor process");
      return;
    }

    lifecycleLogger.info("Shared Dolt server stopped");
  };

  const stopMcpHostBridge = async (): Promise<void> => {
    const result = await resolvedMcpHostBridge?.close();
    if (!result?.closed) {
      lifecycleLogger.info("No MCP host bridge server is running");
      return;
    }

    lifecycleLogger.info(
      result.baseUrl ? `Stopped MCP host bridge at ${result.baseUrl}` : "Stopped MCP host bridge",
    );
  };

  const pullRequestSyncLoop = taskSyncService?.startPullRequestSyncLoop();

  const stopPullRequestSyncLoop = async (): Promise<void> => {
    if (!pullRequestSyncLoop) {
      lifecycleLogger.info("No pull request sync loop is running");
      return;
    }

    await pullRequestSyncLoop.stop();
    lifecycleLogger.info("Pull request sync loop stopped");
  };

  return createHostCommandRouter({
    dispose: async () => {
      lifecycleLogger.info("Shutting down OpenDucktor host services");
      await runShutdownSteps(
        [
          { label: "pull request sync loop", run: stopPullRequestSyncLoop },
          { label: "dev servers", run: stopDevServers },
          { label: "active agent runtimes", run: stopRegisteredRuntimes },
          { label: "MCP host bridge", run: stopMcpHostBridge },
          { label: "shared Dolt server", run: stopSharedDoltServer },
        ],
        lifecycleLogger,
      );
      lifecycleLogger.info("OpenDucktor host services stopped");
    },
    handlers: {
      ...createDevServerCommandHandlers(devServerService),
      ...createCodexAppServerCommandHandlers(codexAppServerService),
      ...createFilesystemCommandHandlers(filesystemService),
      ...createGitCommandHandlers(gitService),
      ...createGithubRepositoryDetectionCommandHandlers(githubRepositoryDetectionService),
      ...createLocalAttachmentCommandHandlers(localAttachmentService),
      ...createOpenInToolsCommandHandlers(openInToolsService),
      ...createRuntimeDefinitionsCommandHandlers(runtimeDefinitionsService),
      ...createRuntimeOrchestratorCommandHandlers(runtimeOrchestratorWithEffectiveRegistry),
      ...createSystemDiagnosticsCommandHandlers(systemDiagnosticsService),
      ...createTaskCommandHandlers(taskService),
      ...createTaskWorktreeCommandHandlers(taskWorktreeService),
      ...createWorkspaceSettingsCommandHandlers(workspaceSettingsService),
    },
  });
};

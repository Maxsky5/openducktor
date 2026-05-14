import { createLocalAttachmentAdapter } from "../../adapters/attachments/local-attachment-adapter";
import {
  type BeadsTaskRepository,
  createBeadsTaskRepository,
} from "../../adapters/beads/beads-task-repository";
import {
  type CodexAppServerTransportRegistry,
  createCodexAppServerTransportRegistry,
} from "../../adapters/codex/codex-app-server-transport-registry";
import { createCodexWorkspaceRuntimeStarter } from "../../adapters/codex/codex-workspace-runtime-starter";
import { createDevServerProcessAdapter } from "../../adapters/dev-servers/dev-server-process-adapter";
import { createFilesystemAdapter } from "../../adapters/filesystem/filesystem-adapter";
import { createWorktreeFileAdapter } from "../../adapters/filesystem/worktree-file-adapter";
import { createGitCliAdapter } from "../../adapters/git/git-cli-adapter";
import {
  createMcpHostBridgeServer,
  type McpHostBridgeServer,
} from "../../adapters/mcp/mcp-host-bridge-server";
import { createOpenInToolsAdapter } from "../../adapters/open-in-tools/open-in-tools-adapter";
import { createOpenCodeWorkspaceRuntimeStarter } from "../../adapters/opencode/opencode-workspace-runtime-starter";
import { createProcessEnvironment } from "../../adapters/process/process-environment";
import { createRuntimeHealthProbe } from "../../adapters/runtimes/runtime-health-probe";
import { createRuntimeRegistry } from "../../adapters/runtimes/runtime-registry";
import { createRuntimeTaskActivityGuard } from "../../adapters/runtimes/runtime-task-activity-guard";
import { createSettingsConfigAdapter } from "../../adapters/settings/settings-config-adapter";
import { createSystemCommandRunner } from "../../adapters/system/system-command-runner";
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
import { createTaskSyncService } from "../../application/tasks/sync/task-sync-service";
import { createTaskService } from "../../application/tasks/task-service";
import { createTaskWorktreeService } from "../../application/tasks/worktrees/task-worktree-service";
import { createWorkspaceSettingsService } from "../../application/workspaces/workspace-settings-service";
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
import { createTaskCommandHandlers } from "../../interface/commands/task-command-handlers";
import { createTaskWorktreeCommandHandlers } from "../../interface/commands/task-worktree-command-handlers";
import { createWorkspaceSettingsCommandHandlers } from "../../interface/commands/workspace-settings-command-handlers";
import {
  createHostCommandRouter,
  type HostCommandRouter,
} from "../../interface/router/host-command-router";
import type { CodexAppServerPort } from "../../ports/codex-app-server-port";
import type { DevServerProcessPort } from "../../ports/dev-server-process-port";
import type { FilesystemPort } from "../../ports/filesystem-port";
import type { GitPort } from "../../ports/git-port";
import type { LocalAttachmentPort } from "../../ports/local-attachment-port";
import type { OpenInToolsPort } from "../../ports/open-in-tools-port";
import type { RuntimeHealthPort } from "../../ports/runtime-health-port";
import type {
  RuntimeRegistryPort,
  RuntimeWorkspaceStarterPort,
} from "../../ports/runtime-registry-port";
import type { SettingsConfigPort } from "../../ports/settings-config-port";
import type { SystemCommandPort } from "../../ports/system-command-port";
import type { TaskStorePort } from "../../ports/task-repository-ports";
import type { WorktreeFilePort } from "../../ports/worktree-file-port";
import {
  createStopDevServersStep,
  createStopMcpHostBridgeStep,
  createStopRuntimesStep,
  createStopSharedDoltServerStep,
  type HostLifecycleLogger,
  runShutdownSteps,
} from "../host-lifecycle";

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
  mcpHostBridge?: McpHostBridgeServer;
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

export const createNodeHostCommandRouter = ({
  codexAppServer,
  codexAppServerTransportRegistry,
  devServerProcesses: configuredDevServerProcesses,
  eventBus,
  filesystem = createFilesystemAdapter(),
  git: configuredGit,
  localAttachments = createLocalAttachmentAdapter(),
  lifecycleLogger = console,
  openInTools = createOpenInToolsAdapter(),
  mcpHostBridge,
  processEnv = createProcessEnvironment(),
  systemCommands: configuredSystemCommands,
  runtimeHealth: configuredRuntimeHealth,
  runtimeRegistry,
  settingsConfig = createSettingsConfigAdapter(),
  worktreeFiles = createWorktreeFileAdapter(),
  taskStore: configuredTaskStore,
}: CreateNodeHostCommandRouterInput = {}): HostCommandRouter => {
  const systemCommands = configuredSystemCommands ?? createSystemCommandRunner({ env: processEnv });
  const runtimeHealth =
    configuredRuntimeHealth ?? createRuntimeHealthProbe(systemCommands, processEnv);
  const devServerProcesses =
    configuredDevServerProcesses ?? createDevServerProcessAdapter({ processEnv });
  const git = configuredGit ?? createGitCliAdapter({ processEnv });
  const defaultCodexAppServer = createCodexAppServerTransportRegistry();
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
  let ownedTaskStore: BeadsTaskRepository | null = null;
  const taskStore: TaskStorePort =
    configuredTaskStore ??
    (() => {
      ownedTaskStore = createBeadsTaskRepository({
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
    repoStoreDiagnostics: taskStore,
  });
  let resolvedMcpHostBridge = mcpHostBridge;
  const workspaceStarter: RuntimeWorkspaceStarterPort = {
    async startWorkspaceRuntime(input) {
      if (input.runtimeKind === "codex") {
        return createCodexWorkspaceRuntimeStarter({
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

      return createOpenCodeWorkspaceRuntimeStarter({
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
    createRuntimeRegistry({
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
    workspaceSettingsService,
  });
  const runtimeOrchestratorWithEffectiveRegistry = createRuntimeOrchestratorService({
    gitPort: git,
    runtimeDefinitionsService,
    runtimeRegistry: effectiveRuntimeRegistry,
    taskReader: taskStore,
    logger: lifecycleLogger,
  });

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
          createStopDevServersStep(devServerService, lifecycleLogger),
          createStopRuntimesStep(effectiveRuntimeRegistry, lifecycleLogger),
          createStopMcpHostBridgeStep(resolvedMcpHostBridge, lifecycleLogger),
          createStopSharedDoltServerStep(ownedTaskStore, lifecycleLogger),
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

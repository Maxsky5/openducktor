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
import { createNodeBeadsTaskStorePort } from "./node-beads-task-store-port";
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
import { createNodeRuntimeHealthPort } from "./node-runtime-health-port";
import { createNodeSettingsConfigPort } from "./node-settings-config-port";
import { createNodeSystemCommandPort } from "./node-system-command-port";
import { createNodeWorktreeFilePort } from "./node-worktree-file-port";
import { createRuntimeTaskActivityGuardPort } from "./runtime-task-activity-guard-port";

export type CreateNodeHostCommandRouterInput = {
  codexAppServer?: CodexAppServerPort;
  codexAppServerTransportRegistry?: CodexAppServerTransportRegistry;
  devServerProcesses?: DevServerProcessPort;
  eventBus?: HostEventBusPort;
  filesystem?: FilesystemPort;
  git?: GitPort;
  localAttachments?: LocalAttachmentPort;
  openInTools?: OpenInToolsPort;
  mcpHostBridge?: McpHostBridgePort;
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
  devServerProcesses = createNodeDevServerProcessPort(),
  eventBus,
  filesystem = createNodeFilesystemPort(),
  git = createNodeGitPort(),
  localAttachments = createNodeLocalAttachmentPort(),
  openInTools = createNodeOpenInToolsPort(),
  mcpHostBridge,
  systemCommands = createNodeSystemCommandPort(),
  runtimeHealth = createNodeRuntimeHealthPort(systemCommands),
  runtimeRegistry,
  settingsConfig = createNodeSettingsConfigPort(),
  worktreeFiles = createNodeWorktreeFilePort(),
  taskStore: configuredTaskStore,
}: CreateNodeHostCommandRouterInput = {}): HostCommandRouter => {
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
  const taskStore =
    configuredTaskStore ??
    createNodeBeadsTaskStorePort({
      async resolveWorkspaceIdForRepoPath(repoPath) {
        const repoConfig = await workspaceSettingsService.getRepoConfigByRepoPath(repoPath);
        return repoConfig.workspaceId;
      },
    });
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
  const odtMcpBridgeService = createOdtMcpBridgeService({
    taskService,
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
  });

  return createHostCommandRouter({
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

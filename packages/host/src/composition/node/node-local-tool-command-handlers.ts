import { createSystemDiagnosticsService } from "../../application/diagnostics/system-diagnostics-service";
import { createFilesystemService } from "../../application/filesystem/filesystem-service";
import { createGitService } from "../../application/git/git-service";
import type { RemoteFetchService } from "../../application/git/remote-fetch-service";
import { createOpenInToolsService } from "../../application/system/open-in-tools-service";
import { createFilesystemCommandHandlers } from "../../interface/commands/filesystem-command-handlers";
import { createGitCommandHandlers } from "../../interface/commands/git-command-handlers";
import { createOpenInToolsCommandHandlers } from "../../interface/commands/open-in-tools-command-handlers";
import { createSystemDiagnosticsCommandHandlers } from "../../interface/commands/system-diagnostics-command-handlers";
import { createSystemPlatformCommandHandlers } from "../../interface/commands/system-platform-command-handlers";
import { createWorkspaceProcessService } from "../../application/processes/workspace-process-service";
import type { WorkspaceSettingsService } from "../../application/workspaces/workspace-settings-model";
import { readManagedProcesses } from "../../infrastructure/process/managed-processes";
import { createWorkspaceProcessCommandHandlers } from "../../interface/commands/workspace-process-command-handlers";
import type { SettingsConfigPort } from "../../ports/settings-config-port";
import type { NodeHostDefaultPorts } from "./node-host-default-ports";
import type { NodeTaskAssetServices } from "./node-task-asset-services";
import { createOpenDucktorMcpLaunchPaths } from "../../adapters/mcp/openducktor-mcp-command";
import { resolveUsageLocations } from "../../adapters/usage/usage-locations";
import { createUsageReportService } from "../../application/usage/usage-report-service";
import { createUsageCommandHandlers } from "../../interface/commands/usage-command-handlers";
import { homedir } from "node:os";
import { hostTimeZone } from "../../domain/usage/usage-calendar";

/**
 * The commands of the local tools: the file system, Git, Open in, the system checks, the
 * Processes view, and Usage of the runtime history on this host.
 */
export const createNodeLocalToolCommandHandlers = ({
  filesystem,
  git,
  openInTools,
  processInspector,
  runtimeDistribution,
  shellProcessIds,
  systemCommands,
  toolDiscovery,
  userEnvironment,
  usageIndex,
  worktreeFiles,
  settingsConfig,
  assets,
  workspaceSettings,
  remoteFetch,
}: Pick<
  NodeHostDefaultPorts,
  | "filesystem"
  | "git"
  | "openInTools"
  | "processInspector"
  | "runtimeDistribution"
  | "shellProcessIds"
  | "systemCommands"
  | "toolDiscovery"
  | "userEnvironment"
  | "usageIndex"
  | "worktreeFiles"
> & {
  settingsConfig: SettingsConfigPort;
  assets: Pick<NodeTaskAssetServices, "taskStore" | "taskOwnership" | "workspaceSessionStore">;
  workspaceSettings: Pick<WorkspaceSettingsService, "getWorkspaceCatalog">;
  /** The fetch that merge detection also uses. */
  remoteFetch: RemoteFetchService;
}) => ({
  ...createFilesystemCommandHandlers(createFilesystemService(filesystem)),
  ...createGitCommandHandlers(
    createGitService({ gitPort: git, settingsConfig, worktreeFiles, remoteFetch }),
  ),
  ...createOpenInToolsCommandHandlers(createOpenInToolsService(openInTools)),
  ...createSystemDiagnosticsCommandHandlers(
    createSystemDiagnosticsService({
      systemCommands,
      toolDiscovery,
      repoStoreDiagnostics: assets.taskStore,
      userEnvironment,
    }),
  ),
  ...createSystemPlatformCommandHandlers(),
  ...createWorkspaceProcessCommandHandlers(
    createWorkspaceProcessService({
      git,
      settingsConfig,
      taskOwnership: assets.taskOwnership,
      workspaceSessions: assets.workspaceSessionStore,
      workspaceSettings,
      inspector: processInspector,
      pathPlatform: process.platform === "win32" ? "windows" : "posix",
      stopForcesExit: process.platform === "win32",
      // The host process and its shell never show in the view.
      hostProcessIds: () => [process.pid, ...shellProcessIds()],
      managedProcesses: readManagedProcesses,
      hostLaunchPaths: createOpenDucktorMcpLaunchPaths({ runtimeDistribution, toolDiscovery }),
    }),
  ),
  ...createUsageCommandHandlers(
    createUsageReportService({
      index: usageIndex,
      settingsConfig,
      taskOwnership: assets.taskOwnership,
      locations: () => resolveUsageLocations(userEnvironment.current().environment, homedir()),
      timeZone: hostTimeZone,
      now: Date.now,
    }),
  ),
});

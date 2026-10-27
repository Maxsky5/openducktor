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
import type { SettingsConfigPort } from "../../ports/settings-config-port";
import type { RepoStoreDiagnostics } from "../../ports/task-repository-ports";
import type { NodeHostDefaultPorts } from "./node-host-default-ports";

/** The commands of the local tools: the file system, Git, Open in, and the system checks. */
export const createNodeLocalToolCommandHandlers = ({
  filesystem,
  git,
  openInTools,
  systemCommands,
  toolDiscovery,
  userEnvironment,
  worktreeFiles,
  settingsConfig,
  repoStoreDiagnostics,
  remoteFetch,
}: Pick<
  NodeHostDefaultPorts,
  | "filesystem"
  | "git"
  | "openInTools"
  | "systemCommands"
  | "toolDiscovery"
  | "userEnvironment"
  | "worktreeFiles"
> & {
  settingsConfig: SettingsConfigPort;
  repoStoreDiagnostics: RepoStoreDiagnostics;
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
      repoStoreDiagnostics,
      userEnvironment,
    }),
  ),
  ...createSystemPlatformCommandHandlers(),
});

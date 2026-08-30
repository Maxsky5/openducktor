import type { Effect } from "effect";
import type { createAgentSessionLiveCommandHandlers } from "../commands/agent-session-live-command-handlers";
import type { createClaudeRuntimeCommandHandlers } from "../commands/claude-runtime-command-handlers";
import type { createCodexAppServerCommandHandlers } from "../commands/codex-app-server-command-handlers";
import type { createDevServerCommandHandlers } from "../commands/dev-server-command-handlers";
import type { createFilesystemCommandHandlers } from "../commands/filesystem-command-handlers";
import type { createGitCommandHandlers } from "../commands/git-command-handlers";
import type { createGithubRepositoryDetectionCommandHandlers } from "../commands/github-repository-detection-command-handlers";
import type { createLocalAttachmentCommandHandlers } from "../commands/local-attachment-command-handlers";
import type { createOpenInToolsCommandHandlers } from "../commands/open-in-tools-command-handlers";
import type { createPullRequestReviewCommandHandlers } from "../commands/pull-request-review-command-handlers";
import type { createRuntimeDefinitionsCommandHandlers } from "../commands/runtime-definitions-command-handlers";
import type { createRuntimeExecutableCommandHandlers } from "../commands/runtime-executable-command-handlers";
import type { createRuntimeOrchestratorCommandHandlers } from "../commands/runtime-orchestrator-command-handlers";
import type { createSystemDiagnosticsCommandHandlers } from "../commands/system-diagnostics-command-handlers";
import type { createSystemPlatformCommandHandlers } from "../commands/system-platform-command-handlers";
import type { createTaskAssetCommandHandlers } from "../commands/task-asset-command-handlers";
import type { createTaskCommandHandlers } from "../commands/task-command-handlers";
import type { createTaskWorktreeCommandHandlers } from "../commands/task-worktree-command-handlers";
import type { createTerminalCommandHandlers } from "../commands/terminal-command-handlers";
import type { createWorkspaceFilesCommandHandlers } from "../commands/workspace-files-command-handlers";
import type { createWorkspaceSettingsCommandHandlers } from "../commands/workspace-settings-command-handlers";
import type { HostCommandName } from "../commands/host-command-registry";

type AllHostCommandHandlers = ReturnType<typeof createAgentSessionLiveCommandHandlers> &
  ReturnType<typeof createClaudeRuntimeCommandHandlers> &
  ReturnType<typeof createCodexAppServerCommandHandlers> &
  ReturnType<typeof createDevServerCommandHandlers> &
  ReturnType<typeof createFilesystemCommandHandlers> &
  ReturnType<typeof createGitCommandHandlers> &
  ReturnType<typeof createGithubRepositoryDetectionCommandHandlers> &
  ReturnType<typeof createLocalAttachmentCommandHandlers> &
  ReturnType<typeof createOpenInToolsCommandHandlers> &
  ReturnType<typeof createPullRequestReviewCommandHandlers> &
  ReturnType<typeof createRuntimeDefinitionsCommandHandlers> &
  ReturnType<typeof createRuntimeExecutableCommandHandlers> &
  ReturnType<typeof createRuntimeOrchestratorCommandHandlers> &
  ReturnType<typeof createSystemDiagnosticsCommandHandlers> &
  ReturnType<typeof createSystemPlatformCommandHandlers> &
  ReturnType<typeof createTaskAssetCommandHandlers> &
  ReturnType<typeof createTaskCommandHandlers> &
  ReturnType<typeof createTaskWorktreeCommandHandlers> &
  ReturnType<typeof createTerminalCommandHandlers> &
  ReturnType<typeof createWorkspaceFilesCommandHandlers> &
  ReturnType<typeof createWorkspaceSettingsCommandHandlers>;

type CompleteHostCommandHandlers<Handlers> =
  Exclude<keyof Handlers, HostCommandName> extends never
    ? Exclude<HostCommandName, keyof Handlers> extends never
      ? Handlers
      : never
    : never;

type HostCommandHandlerResult<Handler> = Handler extends (
  ...args: never[]
) => Effect.Effect<infer Result, infer _Error, infer _Requirements>
  ? Result
  : never;

type HostCommandHandlers = CompleteHostCommandHandlers<AllHostCommandHandlers>;

export type HostCommandResultMap = {
  [Command in HostCommandName]: HostCommandHandlerResult<HostCommandHandlers[Command]>;
};

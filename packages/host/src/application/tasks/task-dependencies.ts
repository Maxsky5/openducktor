import type { TaskCompletionObservation } from "@openducktor/contracts";
import type { Effect } from "effect";
import type { HostError } from "../../effect/host-errors";
import type { GitPort } from "../../ports/git-port";
import type { RuntimeRegistryPort } from "../../ports/runtime-registry-port";
import type { SettingsConfigPort } from "../../ports/settings-config-port";
import type { SystemCommandPort } from "../../ports/system-command-port";
import type { TaskActivityGuardPort } from "../../ports/task-activity-guard-port";
import type { TaskStorePort } from "../../ports/task-repository-ports";
import type { TaskWorkflowResolver } from "../../ports/task-workflow-port";
import type { TaskWorktreeOwnerReader } from "../../ports/task-worktree-owner-port";
import type { ToolDiscoveryPort } from "../../ports/tool-discovery-port";
import type { WorktreeFilePort } from "../../ports/worktree-file-port";
import type { WorktreeActionRunner } from "../actions/worktree-action-runner";
import type { BrowserOwnerCleanupPort } from "../browser/browser-owner-cleanup";
import type { GitProviderResolver } from "../git/git-provider-resolver";
import type { RuntimeDefinitionsService } from "../runtimes/runtime-definitions-service";
import type { TerminalService } from "../terminals/terminal-service";
import type { WorkspaceSettingsService } from "../workspaces/workspace-settings-service";
import type { createTaskCompletionState } from "./task-completion-state";
import type { TaskSessionLifecycleCoordinator } from "./worktrees/task-session-lifecycle-coordinator";
import type { TaskWorktreeService } from "./worktrees/task-worktree-service";

/** The dependencies of the task service. Optional ports fail only the commands that need them. */
export type TaskTerminalCleanupPort = Pick<TerminalService, "acquireTaskCleanup">;
export type CreateTaskServiceInput = {
  publishCompletion?:
    | ((observation: TaskCompletionObservation) => Effect.Effect<void, HostError>)
    | undefined;
  terminalService?: TaskTerminalCleanupPort;
  browserTabs?: BrowserOwnerCleanupPort;
  worktreeActions?: WorktreeActionRunner;
  gitPort?: GitPort;
  gitProviderResolver?: GitProviderResolver;
  taskStore: TaskStorePort;
  taskWorkflows: TaskWorkflowResolver;
  taskActivityGuard?: TaskActivityGuardPort;
  settingsConfig?: SettingsConfigPort;
  systemCommands?: SystemCommandPort;
  toolDiscovery?: ToolDiscoveryPort;
  taskWorktreeService?: TaskWorktreeService;
  workspaceSettingsService?: WorkspaceSettingsService;
  runtimeDefinitionsService?: RuntimeDefinitionsService;
  runtimeRegistry?: RuntimeRegistryPort;
  worktreeFiles?: WorktreeFilePort;
  worktreeOwners?: TaskWorktreeOwnerReader;
  taskSessionLifecycleCoordinator?: TaskSessionLifecycleCoordinator;
};
export type TaskServiceUseCaseInput = Omit<
  CreateTaskServiceInput,
  "taskSessionLifecycleCoordinator"
> & {
  taskSessionLifecycleCoordinator: TaskSessionLifecycleCoordinator;
  completionState: ReturnType<typeof createTaskCompletionState>;
};

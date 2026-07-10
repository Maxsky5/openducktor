import type { DevServerGroupState } from "@openducktor/contracts";
import type { Effect } from "effect";
import type {
  HostDependencyError,
  HostInvariantError,
  HostOperationError,
  HostValidationError,
} from "../../effect/host-errors";
import type { HostEventBusPort } from "../../events/host-event-bus";
import type {
  DevServerProcessPort,
  DevServerProcessStartExitError,
} from "../../ports/dev-server-process-port";
import type {
  TaskWorktreeService,
  TaskWorktreeServiceError,
} from "../tasks/worktrees/task-worktree-service";
import type {
  WorkspaceSettingsError,
  WorkspaceSettingsService,
} from "../workspaces/workspace-settings-service";

export type DevServerServiceError =
  | DevServerProcessStartExitError
  | HostDependencyError
  | HostInvariantError
  | HostOperationError
  | HostValidationError
  | TaskWorktreeServiceError
  | WorkspaceSettingsError;

export type DevServerTaskInput = {
  repoPath: string;
  taskId: string;
};

export type DevServerService = {
  getState(input: DevServerTaskInput): Effect.Effect<DevServerGroupState, DevServerServiceError>;
  restart(input: DevServerTaskInput): Effect.Effect<DevServerGroupState, DevServerServiceError>;
  start(input: DevServerTaskInput): Effect.Effect<DevServerGroupState, DevServerServiceError>;
  stop(input: DevServerTaskInput): Effect.Effect<DevServerGroupState, DevServerServiceError>;
};

export type DisposableDevServerService = DevServerService & {
  stopAll(): Effect.Effect<DevServerStopAllResult, DevServerServiceError>;
};

export type StoppedDevServerScript = {
  command: string;
  name: string;
  pid: number;
  repoPath: string;
  scriptId: string;
  taskId: string;
};

export type FailedDevServerScriptStart = {
  command: string;
  message: string;
  name: string;
  scriptId: string;
};

export type DevServerStopAllResult = {
  stoppedScripts: StoppedDevServerScript[];
};

export type CreateDevServerServiceInput = {
  eventBus?: HostEventBusPort;
  processPort?: DevServerProcessPort;
  taskWorktreeService?: TaskWorktreeService;
  workspaceSettingsService: WorkspaceSettingsService;
};

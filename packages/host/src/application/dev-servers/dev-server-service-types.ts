import type {
  DevServerCommandInput,
  DevServerGroupState,
  DevServerOwner,
} from "@openducktor/contracts";
import type { Effect } from "effect";
import type {
  HostDependencyErrorAggregate,
  HostInvariantErrorAggregate,
  HostOperationErrorAggregate,
  HostValidationErrorAggregate,
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
import type { WithProcessStartAdmission } from "../workspaces/workspace-admission-service";
import type { WorkspaceSessionStorePort } from "../../ports/workspace-session-store-port";
import type { GitPort } from "../../ports/git-port";
import type { GitPortError } from "../../ports/git-port";
import type { TaskStoreError } from "../../ports/task-repository-ports";
import type { createWorkspaceSessionOperationGate } from "../workspaces/workspace-session-operation-gate";

export type DevServerServiceError =
  | DevServerProcessStartExitError
  | HostDependencyErrorAggregate
  | HostInvariantErrorAggregate
  | HostOperationErrorAggregate
  | HostValidationErrorAggregate
  | TaskWorktreeServiceError
  | TaskStoreError
  | GitPortError
  | WorkspaceSettingsError;

export type DevServerWorkspaceActivity = {
  activeOwners: DevServerOwner[];
};

export type DevServerService = {
  getState(input: DevServerCommandInput): Effect.Effect<DevServerGroupState, DevServerServiceError>;
  inspectWorkspaceActivity(input: {
    repoPath: string;
  }): Effect.Effect<DevServerWorkspaceActivity, DevServerServiceError>;
  restart(input: DevServerCommandInput): Effect.Effect<DevServerGroupState, DevServerServiceError>;
  start(input: DevServerCommandInput): Effect.Effect<DevServerGroupState, DevServerServiceError>;
  stop(input: DevServerCommandInput): Effect.Effect<DevServerGroupState, DevServerServiceError>;
  stopWorkspaceSession(
    input: DevServerCommandInput,
  ): Effect.Effect<DevServerGroupState, DevServerServiceError>;
};

export type DisposableDevServerService = DevServerService & {
  forgetWorkspaceSession(
    input: DevServerCommandInput & {
      owner: Extract<DevServerOwner, { kind: "workspace_session" }>;
    },
  ): Effect.Effect<void>;
  stopAll(): Effect.Effect<DevServerStopAllResult, DevServerServiceError>;
};

export type StoppedDevServerScript = {
  command: string;
  name: string;
  pid: number;
  repoPath: string;
  scriptId: string;
  owner: DevServerOwner;
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
  withProcessStartAdmission?: WithProcessStartAdmission;
  eventBus?: HostEventBusPort | undefined;
  processPort?: DevServerProcessPort;
  taskWorktreeService?: TaskWorktreeService;
  workspaceSessions?: {
    store: Pick<WorkspaceSessionStorePort, "get">;
    settings: Pick<WorkspaceSettingsService, "getRepoConfig">;
    git: Pick<
      GitPort,
      "canonicalizePath" | "isGitRepository" | "shareGitCommonDirectory" | "isRegisteredWorktree"
    >;
    operationGate: ReturnType<typeof createWorkspaceSessionOperationGate>;
  };
  workspaceSettingsService: WorkspaceSettingsService;
};

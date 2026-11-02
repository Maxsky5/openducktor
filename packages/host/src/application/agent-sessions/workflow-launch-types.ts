import type { resolveSessionMessageParts } from "../attachments/resolve-session-message-parts";
import type { GitProviderService } from "../git/git-provider-service";
import type { TaskService } from "../tasks/task-service";
import type { RuntimeDefinitionsService } from "../runtimes/runtime-definitions-service";
import type { TaskWorktreeService } from "../tasks/worktrees/task-worktree-service";
import type { WorkspaceSettingsService } from "../workspaces/workspace-settings-service";
import type { TaskWorkflowResolver } from "../../ports/task-workflow-port";
import type { TaskStorePort } from "../../ports/task-repository-ports";
import type { RuntimeRegistryPort } from "../../ports/runtime-registry-port";
import type { SettingsConfigPort } from "../../ports/settings-config-port";
import type { AgentRuntimeQueryPort } from "../../ports/agent-runtime-query-port";
import type { GitPort } from "../../ports/git-port";
import type { TaskSessionStartPreparationService } from "../tasks/worktrees/task-session-start-preparation-service";
import type { Effect } from "effect";
import type { SessionLaunchService } from "./session-launch-types";
import type {
  AgentSessionRecord,
  AgentSessionLiveReadResult,
  WorkflowLaunchDecision,
  WorkflowLaunchRequest,
  WorkflowLaunchResult,
} from "@openducktor/contracts";
import type { HostError } from "../../effect/host-errors";
import type { AgentSessionLiveStateService } from "./agent-session-live-state-service";
import type { TaskSessionOperations } from "./task-session-operations";
import type { SessionLaunchRuntimePort } from "../../ports/session-launch-runtime-port";
import type { AgentMessageDeliveryService } from "./agent-message-delivery-service";

export type WorkflowLaunchPreparationDependencies = {
  resolveParts: (
    parts: Parameters<typeof resolveSessionMessageParts>[0],
  ) => ReturnType<typeof resolveSessionMessageParts>;
  settings: Pick<WorkspaceSettingsService, "getRepoConfig">;
  settingsConfig: Pick<SettingsConfigPort, "readGlobalConfig">;
  tasks: Pick<
    TaskService,
    "agentSessionsList" | "agentSessionUpdateModel" | "humanRequestChanges" | "updateTask"
  >;
  taskReader: Pick<TaskStorePort, "getTask">;
  taskWorkflows: TaskWorkflowResolver;
  worktrees: Pick<TaskWorktreeService, "getTaskWorktree">;
  startPreparation: Pick<TaskSessionStartPreparationService, "validateTarget">;
  git: Pick<GitPort, "canonicalizePath">;
  definitions: RuntimeDefinitionsService;
  registry: Pick<RuntimeRegistryPort, "requireReady">;
  queries: Pick<AgentRuntimeQueryPort, "loadRuntimeCatalog">;
  provider: Pick<GitProviderService, "getContext">;
  runtime: Pick<SessionLaunchRuntimePort, "read">;
};

export type WorkflowLaunchDependencies = WorkflowLaunchPreparationDependencies & {
  sessions: Pick<TaskSessionOperations, "start" | "fork" | "resume" | "completeSavedStart">;
  messageDelivery: Pick<AgentMessageDeliveryService, "submit">;
  /** `sendUserMessage` must apply the normal workflow send policy. */
  runtime: SessionLaunchRuntimePort &
    Pick<AgentSessionLiveStateService, "publishTaskSessionRecords" | "updateSessionModel">;
};

/** Decides, when a waiting automatic launch gets its turn, whether it still starts. */
export type AutomaticWorkflowLaunchStartCheck = Effect.Effect<
  { start: true } | { start: false; reason: string },
  HostError
>;

/**
 * Only the host creates an automatic launch, so clients cannot send one. The shared Autopilot
 * action decides how it starts. At its turn, the launch runs `startCheck` before any other work
 * and settles as skipped when the check declines.
 */
export type AutomaticWorkflowLaunchRequest = Omit<WorkflowLaunchRequest, "policy"> & {
  policy: {
    kind: "automatic";
    actionId: string;
    startCheck: AutomaticWorkflowLaunchStartCheck;
  };
};

export type WorkflowLaunchAttemptRequest = WorkflowLaunchRequest | AutomaticWorkflowLaunchRequest;

export type WorkflowLaunchService = SessionLaunchService<
  WorkflowLaunchAttemptRequest,
  WorkflowLaunchResult
>;

/** A reuse decision carries the owned source record and its live state, read once. */
export type PreparedWorkflowDecision =
  | Exclude<WorkflowLaunchDecision, { startMode: "reuse" }>
  | (Extract<WorkflowLaunchDecision, { startMode: "reuse" }> & {
      source: AgentSessionRecord;
      live: AgentSessionLiveReadResult;
    });

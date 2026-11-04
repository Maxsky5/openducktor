import type { TaskWorkflowResolver } from "../../ports/task-workflow-port";
import type { BrowserService } from "../../application/browser/browser-service-types";
import type { Effect } from "effect";
import type { McpBridgeDiscoveryMode } from "../../adapters/mcp/mcp-bridge-discovery-file";
import type { GitProviderFetch } from "../../adapters/git-providers/git-provider-fetch";
import type { McpHostBridgeServer } from "../../adapters/mcp/mcp-host-bridge-server";
import type { TaskAssetReadService } from "../../application/task-assets/task-asset-read-service";
import type { TaskEventPublicationReporter } from "../../application/tasks/sync/task-sync-service";
import type { WorkspaceSettingsService } from "../../application/workspaces/workspace-settings-model";
import type { HostOperationErrorAggregate } from "../../effect/host-errors";
import type { HostEventBusPort } from "../../events/host-event-bus";
import type { EffectHostCommandRouter } from "../../interface/router/host-command-router";
import type { RuntimeStarterPort } from "../../ports/runtime-registry-port";
import type { TaskStorePort } from "../../ports/task-repository-ports";
import type { HostLifecycleLogger } from "../host-lifecycle";
import type { CreateNodeHostDefaultPortsInput } from "./node-host-default-ports";

export type CreateNodeHostCommandRouterInput = CreateNodeHostDefaultPortsInput & {
  /** The fetch of the Azure DevOps and GitLab REST adapters. */
  gitProviderFetch?: GitProviderFetch | undefined;
  clientVersion?: string;
  eventBus?: HostEventBusPort;
  lifecycleLogger?: HostLifecycleLogger;
  mcpBridgeDiscoveryMode: McpBridgeDiscoveryMode;
  mcpHostBridge?: McpHostBridgeServer;
  onBackgroundFailure(failure: HostOperationErrorAggregate): Effect.Effect<void, never>;
  /**
   * Reports the start and end of the one-time import of legacy data, so a shell can show progress.
   * `finished` also runs when the import fails.
   */
  onHostDatabaseImport?: (phase: "started" | "finished") => Effect.Effect<void, never>;
  taskEventPublicationReporter: TaskEventPublicationReporter;
  /** Replaces the native runtime starters, for example in tests. */
  runtimeStarter?: RuntimeStarterPort;
  taskStore?: TaskStorePort;
  /** Replaces the built-in task workflow, for example in tests. */
  taskWorkflows?: TaskWorkflowResolver;
};

export type EffectNodeHostCommandRouter = EffectHostCommandRouter & {
  readonly taskAssetReadService: TaskAssetReadService;
  readonly notificationStream: import("../../application/notifications/notification-stream").NotificationStream;
  readonly hostInstanceId: string;
  /** The remote control settings, which the shell's remote access keeps. */
  readonly hostSettings: Pick<
    WorkspaceSettingsService,
    "readRemoteAccessSettings" | "saveRemoteAccessSettings"
  >;
  readonly taskEventStream: import("../../events/task-event-stream").TaskEventStreamPort;
  readonly terminalService: import("../../application/terminals/terminal-service").TerminalService;
  readonly browserService: BrowserService;
};

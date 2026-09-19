import type { Effect } from "effect";
import type { McpBridgeDiscoveryMode } from "../../adapters/mcp/mcp-bridge-discovery-file";
import type { McpHostBridgeServer } from "../../adapters/mcp/mcp-host-bridge-server";
import type { TaskAssetReadService } from "../../application/task-assets/task-asset-read-service";
import type { TaskEventPublicationReporter } from "../../application/tasks/sync/task-sync-service";
import type { HostOperationErrorAggregate } from "../../effect/host-errors";
import type { HostEventBusPort } from "../../events/host-event-bus";
import type { EffectHostCommandRouter } from "../../interface/router/host-command-router";
import type { RuntimeRegistryPort } from "../../ports/runtime-registry-port";
import type { TaskStorePort } from "../../ports/task-repository-ports";
import type { HostLifecycleLogger } from "../host-lifecycle";
import type { CreateNodeHostDefaultPortsInput } from "./node-host-default-ports";

export type CreateNodeHostCommandRouterInput = CreateNodeHostDefaultPortsInput & {
  clientVersion?: string;
  eventBus?: HostEventBusPort;
  lifecycleLogger?: HostLifecycleLogger;
  mcpBridgeDiscoveryMode: McpBridgeDiscoveryMode;
  mcpHostBridge?: McpHostBridgeServer;
  onBackgroundFailure(failure: HostOperationErrorAggregate): Effect.Effect<void, never>;
  taskEventPublicationReporter: TaskEventPublicationReporter;
  runtimeRegistry?: RuntimeRegistryPort;
  taskStore?: TaskStorePort;
};

export type EffectNodeHostCommandRouter = EffectHostCommandRouter & {
  readonly taskAssetReadService: TaskAssetReadService;
  readonly taskEventStream: import("../../events/task-event-stream").TaskEventStreamPort;
  readonly terminalService: import("../../application/terminals/terminal-service").TerminalService;
};

import type { McpBridgeDiscoveryMode } from "../../adapters/mcp/mcp-bridge-discovery-file";
import {
  createMcpHostBridgeServer,
  type McpHostBridgeServer,
  resolveMcpBridgeDiscoveryPath,
} from "../../adapters/mcp/mcp-host-bridge-server";
import { createOdtMcpBridgeService } from "../../application/mcp/odt-mcp-bridge-service";
import type { WorkspaceSettingsService } from "../../application/workspaces/workspace-settings-service";
import type { HostEventBusPort } from "../../events/host-event-bus";
import { createMcpBridgeStatusPublisher } from "./runtime-lifecycle-publisher";

/** The MCP host bridge that serves the ODT tools of every workspace. */
export const createNodeMcpHostBridge = ({
  discoveryMode,
  eventBus,
  hostInstanceId,
  startupEnv,
  ...bridge
}: Parameters<typeof createOdtMcpBridgeService>[0] & {
  workspaceSettingsService: WorkspaceSettingsService;
  discoveryMode: McpBridgeDiscoveryMode;
  eventBus: HostEventBusPort | undefined;
  hostInstanceId: string;
  startupEnv: NodeJS.ProcessEnv;
}): McpHostBridgeServer =>
  createMcpHostBridgeServer({
    bridgeService: createOdtMcpBridgeService(bridge),
    discoveryPath: resolveMcpBridgeDiscoveryPath(discoveryMode, startupEnv),
    workspaceSettingsService: bridge.workspaceSettingsService,
    onStatusChanged: eventBus ? createMcpBridgeStatusPublisher(eventBus, hostInstanceId) : () => {},
  });

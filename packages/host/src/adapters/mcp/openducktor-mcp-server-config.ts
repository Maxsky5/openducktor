import { Effect } from "effect";
import { type HostError, HostResourceError, HostValidationError } from "../../effect/host-errors";
import type { ToolDiscoveryPort } from "../../ports/tool-discovery-port";
import type { HostRuntimeDistribution } from "../runtimes/runtime-distribution";
import type { McpHostBridgeServer } from "./mcp-host-bridge-server";
import { resolveOpenDucktorMcpCommand } from "./openducktor-mcp-command";
import {
  buildOpenDucktorMcpBridgeEnvironment,
  type OpenDucktorMcpBridgeEnvironment,
} from "./openducktor-mcp-environment";

/** Managed OpenDucktor MCP server launch values bound to one workspace. */
type OpenDucktorMcpServerConfig = {
  readonly command: readonly [string, ...string[]];
  readonly environment: OpenDucktorMcpBridgeEnvironment;
};

/** Resolves the managed MCP server for the workspace that owns `repoPath`. */
export type OpenDucktorMcpServerConfigResolver = (
  repoPath: string,
) => Effect.Effect<OpenDucktorMcpServerConfig, HostError>;

export const createOpenDucktorMcpServerConfigResolver = ({
  resolveBridge,
  runtimeDistribution,
  runtimeName,
  toolDiscovery,
}: {
  resolveBridge: () => McpHostBridgeServer | undefined;
  runtimeDistribution: HostRuntimeDistribution;
  runtimeName: string;
  toolDiscovery: ToolDiscoveryPort;
}): OpenDucktorMcpServerConfigResolver => {
  return (repoPath) =>
    Effect.gen(function* () {
      const bridge = resolveBridge();
      if (!bridge) {
        return yield* new HostResourceError({
          resource: "mcp-host-bridge",
          operation: "openducktorMcpServerConfig.resolve",
          message: `${runtimeName} workflow tools require the OpenDucktor MCP host bridge. Check the MCP bridge in Diagnostics.`,
        });
      }
      const connection = yield* bridge.ensureConnection({ repoPath });
      const [binary, ...args] = yield* resolveOpenDucktorMcpCommand({
        runtimeDistribution,
        toolDiscovery,
      });
      if (!binary) {
        return yield* new HostValidationError({
          field: "mcpCommand",
          message: "OpenDucktor MCP command cannot be empty.",
        });
      }
      const environment = yield* Effect.try({
        try: () => buildOpenDucktorMcpBridgeEnvironment(connection, runtimeName),
        catch: (cause) =>
          cause instanceof HostValidationError
            ? cause
            : new HostValidationError({ message: String(cause), cause }),
      });
      return { command: [binary, ...args], environment };
    });
};

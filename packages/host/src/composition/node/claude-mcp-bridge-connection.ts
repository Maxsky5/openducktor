import { Effect } from "effect";
import type { McpHostBridgeServer } from "../../adapters/mcp/mcp-host-bridge-server";
import { HostOperationError } from "../../effect/host-errors";

export const resolveClaudeMcpBridgeConnection = (
  bridge: McpHostBridgeServer | undefined,
  repoPath: string,
) =>
  bridge
    ? bridge.ensureConnection({ repoPath }).pipe(
        Effect.mapError(
          (cause) =>
            new HostOperationError({
              operation: "claude-agent-sdk.resolve-mcp-bridge",
              message: cause.message,
              cause,
            }),
        ),
      )
    : Effect.fail(
        new HostOperationError({
          operation: "claude-agent-sdk.resolve-mcp-bridge",
          message: "Claude Agent SDK requires an initialized MCP host bridge.",
        }),
      );

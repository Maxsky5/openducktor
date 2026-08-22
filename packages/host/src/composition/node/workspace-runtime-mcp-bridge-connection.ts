import { Effect } from "effect";
import type { McpHostBridgeServer } from "../../adapters/mcp/mcp-host-bridge-server";
import { HostOperationError, HostResourceError } from "../../effect/host-errors";

interface RuntimeLabelsContract extends Record<WorkspaceRuntimeKind, string> {}

type WorkspaceRuntimeKind = "codex" | "opencode";

const runtimeLabels: RuntimeLabelsContract = {
  codex: "Codex",
  opencode: "OpenCode",
};

export const resolveWorkspaceRuntimeMcpBridgeConnection = (
  bridge: McpHostBridgeServer | undefined,
  runtimeKind: WorkspaceRuntimeKind,
  repoPath: string,
) => {
  if (!bridge) {
    return Effect.fail(
      new HostResourceError({
        message: `${runtimeLabels[runtimeKind]} workspace startup requires an initialized MCP host bridge.`,
        resource: "mcp-host-bridge",
        operation: `${runtimeKind}-workspace-runtime.start`,
      }),
    );
  }

  return bridge.ensureConnection({ repoPath }).pipe(
    Effect.mapError(
      (cause) =>
        new HostOperationError({
          operation: `${runtimeKind}-workspace-runtime.resolve-mcp-bridge`,
          message: cause.message,
          cause,
        }),
    ),
  );
};

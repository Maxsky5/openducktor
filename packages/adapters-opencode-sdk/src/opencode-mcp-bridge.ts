import type { OpenCodeClient } from "@opencode/client";
import type { AgentSessionScope, ManagedMcpServerResolver } from "@openducktor/core";
import { operationError, type OperationIdentity } from "./opencode-client";

/** The workspace binding of the OpenDucktor MCP server of one directory. */
type McpOwner = {
  repoPath: string;
  workingDirectory: string;
  sessionScope?: AgentSessionScope | undefined;
};

/** How long the bridge can stay `pending` before the install fails. */
const MCP_CONNECT_TIMEOUT_MS = 30_000;

/**
 * The OpenDucktor MCP server of each directory of one OpenCode runtime. OpenCode keeps a server
 * that `mcp.add` installs only in the services of the location of its directory
 * (`packages/core/src/mcp/index.ts`). OpenCode shuts down an idle location and sends
 * `location.shutdown`, so the next use of the directory installs the server again.
 */
export const createOpenCodeMcpBridge = ({
  client,
  resolveMcpServerConfig,
  runtimeIdentity,
  isClosed,
}: {
  readonly client: () => OpenCodeClient;
  readonly resolveMcpServerConfig: ManagedMcpServerResolver;
  readonly runtimeIdentity: OperationIdentity;
  /** Tells if the runtime connection was released or closed. */
  readonly isClosed: () => boolean;
}) => {
  const owners = new Map<string, McpOwner>();
  const installations = new Map<string, Promise<void>>();
  /** The directories whose current location has the server. */
  const installed = new Set<string>();
  const changes = new Set<() => void>();
  let version = 0;

  const changed = () => {
    version++;
    for (const wake of changes) wake();
    changes.clear();
  };

  const waitForChange = (seen: number) =>
    seen !== version
      ? Promise.resolve()
      : new Promise<void>((resolve, reject) => {
          const timer = setTimeout(() => {
            changes.delete(wake);
            reject(
              operationError(
                runtimeIdentity,
                "connect the OpenDucktor MCP bridge",
                "runtime_unavailable",
                "The native MCP connection remained pending.",
                "Check the workspace MCP bridge command, then restart the selected runtime.",
              ),
            );
          }, MCP_CONNECT_TIMEOUT_MS);
          const wake = () => {
            clearTimeout(timer);
            resolve();
          };
          changes.add(wake);
        });

  const connect = async (identity: McpOwner, owner: McpOwner) => {
    const directory = identity.workingDirectory;
    const location = { directory };
    const requireCurrent = () => {
      if (owners.get(directory) !== owner || isClosed())
        throw operationError(
          identity,
          "bind the OpenDucktor MCP bridge",
          "runtime_unavailable",
          "The native MCP binding changed during setup. Restart OpenCode from Diagnostics.",
        );
    };
    const install = async () => {
      const existing = await client().mcp.list({ location });
      if (existing.data.some((server) => server.name === "openducktor"))
        throw operationError(
          identity,
          "install the OpenDucktor MCP bridge",
          "policy_failed",
          "The native configuration already contains an MCP server named 'openducktor'.",
          "Rename or remove the conflicting user MCP server, then restart the selected runtime.",
        );
      const config = await resolveMcpServerConfig(
        identity.repoPath,
        identity.sessionScope?.workspaceId,
      );
      requireCurrent();
      await client().experimental.mcp.add({
        server: "openducktor",
        location,
        config: {
          type: "local",
          command: [...config.command],
          environment: { ...config.environment },
          codemode: false,
        },
      });
      requireCurrent();
      installed.add(directory);
    };
    while (!isClosed()) {
      const seen = version;
      if (!installed.has(directory)) await install();
      const list = await client().mcp.list({ location });
      requireCurrent();
      const server = list.data.find((item) => item.name === "openducktor");
      if (!server) {
        // A location shutdown during the read dropped the server that the install added.
        if (!installed.has(directory)) continue;
        throw operationError(
          identity,
          "connect the OpenDucktor MCP bridge",
          "policy_failed",
          "The installed native MCP override is missing.",
          "Restart the selected runtime and retry.",
        );
      }
      if (server.status.status === "connected") return;
      if (server.status.status !== "pending")
        throw operationError(
          identity,
          "connect the OpenDucktor MCP bridge",
          "policy_failed",
          "error" in server.status
            ? server.status.error
            : `Native MCP status: ${server.status.status}.`,
          "Check the workspace MCP bridge command, then restart the selected runtime.",
        );
      await waitForChange(seen);
    }
    throw operationError(
      identity,
      "connect the OpenDucktor MCP bridge",
      "runtime_unavailable",
      "The owned runtime connection closed.",
    );
  };

  /** Installs and connects the server of the directory of `ref`. One install per directory runs. */
  const ensure = (ref: McpOwner): Promise<void> => {
    const directory = ref.workingDirectory;
    let owner = owners.get(directory);
    if (
      owner &&
      (owner.repoPath !== ref.repoPath ||
        owner.sessionScope?.workspaceId !== ref.sessionScope?.workspaceId)
    )
      return Promise.reject(
        operationError(
          ref,
          "bind the OpenDucktor MCP bridge",
          "identity_mismatch",
          `The directory belongs to repository '${owner.repoPath}'. Open it from its owning workspace, or restart OpenCode after its sessions end.`,
        ),
      );
    if (!owner) {
      owner = { ...ref };
      owners.set(directory, owner);
    }
    const running = installations.get(directory);
    if (running) return running;
    const installation = connect(ref, owner).finally(() => installations.delete(directory));
    installations.set(directory, installation);
    return installation;
  };

  return {
    ensure,
    /** Installs the server again when OpenCode shut down the location of an installed directory. */
    restore: (ref: McpOwner): Promise<void> =>
      owners.has(ref.workingDirectory) && !installed.has(ref.workingDirectory)
        ? ensure(ref)
        : Promise.resolve(),
    /** OpenCode reported an MCP status change, so a pending connection can read it again. */
    statusChanged: changed,
    /** OpenCode shut down the services of the location of `directory`, with their MCP servers. */
    locationShutdown: (directory: string): void => {
      installed.delete(directory);
      changed();
    },
    /** Ends every wait, because the runtime connection closed. */
    close: (): void => {
      owners.clear();
      changed();
    },
  };
};

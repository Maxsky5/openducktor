import type { OpenCodeRuntimeConnection } from "./types";
import {
  createOpenCodeClient,
  nativeRequest,
  readMigration,
  verifySession,
} from "./opencode-client";
import type { SessionRef } from "@openducktor/core";

/** Registry operations share the owned standalone connection. */
export const createOpenCodeRuntimeProbes = (connection: OpenCodeRuntimeConnection) => {
  const client = createOpenCodeClient(connection);
  const verify = (ref: SessionRef, operation: string) =>
    nativeRequest(ref, operation, async () => {
      await readMigration(client, ref, operation);
      return verifySession(await client.session.get({ sessionID: ref.externalSessionId }), ref);
    });
  return {
    async stopSession(ref: SessionRef) {
      await verify(ref, "interrupt the conversation");
      await nativeRequest(ref, "interrupt the conversation", () =>
        client.session.interrupt({ sessionID: ref.externalSessionId }),
      );
    },
    async probeSessionStatus(ref: SessionRef) {
      await verify(ref, "read live status");
      const active = await nativeRequest(ref, "read live status", () => client.session.active());
      return { supported: true, hasLiveSession: Boolean(active[ref.externalSessionId]) };
    },
    async probeMcpStatus(workingDirectory: string, serverName: string) {
      const servers = await nativeRequest(
        { repoPath: workingDirectory, workingDirectory },
        "read MCP status",
        () => client.mcp.list({ location: { directory: workingDirectory } }),
      );
      const server = servers.data.find((item) => item.name === serverName);
      return {
        supported: true,
        connected: server?.status.status === "connected",
        serverStatus: server?.status.status ?? null,
        toolIds: [],
        detail:
          server?.status.status === "connected"
            ? "OpenCode V2 reports the connection state but does not expose a public tool ID catalog."
            : server && "error" in server.status
              ? server.status.error
              : `MCP server '${serverName}' is ${server?.status.status ?? "missing"}.`,
        failureKind: server?.status.status === "connected" ? null : ("error" as const),
      };
    },
  };
};

import { ODT_MCP_SERVER_NAME } from "@openducktor/contracts";
import type { RuntimeRoute, WorkspaceRuntimeMcpObservation } from "@openducktor/contracts";
import { Effect } from "effect";
import { errorMessage, type HostError } from "../../effect/host-errors";
import type { RuntimeMcpStatusProbeResult } from "../../ports/runtime-registry-port";

/** Reads the status and tools of one MCP server in one bound OpenCode directory. */
export type OpenCodeMcpStatusProbe = (input: {
  runtimeRoute: RuntimeRoute;
  workingDirectory: string;
  serverName: string;
}) => Effect.Effect<
  Pick<RuntimeMcpStatusProbeResult, "connected" | "serverStatus" | "toolIds" | "detail">,
  HostError
>;

/**
 * Probes the OpenDucktor MCP server in each bound directory. A failed probe becomes a failed
 * observation of its directory, so it does not hide the other directories.
 */
export const readOpenCodeMcpConnections = ({
  probeMcpStatus,
  runtimeRoute,
  workingDirectories,
}: {
  probeMcpStatus: OpenCodeMcpStatusProbe;
  runtimeRoute: RuntimeRoute;
  workingDirectories: ReadonlyArray<string>;
}): Effect.Effect<WorkspaceRuntimeMcpObservation[]> =>
  Effect.forEach(
    workingDirectories,
    (workingDirectory) =>
      probeMcpStatus({
        runtimeRoute,
        workingDirectory,
        serverName: ODT_MCP_SERVER_NAME,
      }).pipe(
        Effect.map((result): WorkspaceRuntimeMcpObservation => ({
          workingDirectory,
          state: result.connected ? "connected" : "failed",
          serverStatus: result.serverStatus,
          toolIds: result.connected ? result.toolIds : [],
          detail: result.detail,
        })),
        Effect.catchAll((cause) =>
          Effect.succeed<WorkspaceRuntimeMcpObservation>({
            workingDirectory,
            state: "failed",
            serverStatus: null,
            toolIds: [],
            detail: errorMessage(cause),
          }),
        ),
      ),
    { concurrency: "unbounded" },
  );

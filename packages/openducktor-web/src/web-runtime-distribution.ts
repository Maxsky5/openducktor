import path from "node:path";
import {
  createArtifactRuntimeDistribution,
  createSourceRuntimeDistribution,
  type HostRuntimeDistribution,
} from "@openducktor/host";
import { Effect } from "effect";
import { errorMessage, runWebSyncBoundary, WebValidationError } from "./effect/web-errors";

export type ResolveWebRuntimeDistributionInput = {
  packageRoot: string;
  workspaceMode: boolean;
  workspaceRoot?: string;
};

export const WEB_PACKAGE_MCP_ENTRYPOINT = "openducktor-mcp.js";

export const resolveWebRuntimeDistributionEffect = ({
  packageRoot,
  workspaceMode,
  workspaceRoot,
}: ResolveWebRuntimeDistributionInput): Effect.Effect<
  HostRuntimeDistribution,
  WebValidationError
> =>
  Effect.gen(function* () {
    if (workspaceMode) {
      if (!workspaceRoot) {
        return yield* new WebValidationError({
          message: "OpenDucktor web workspace mode requires a workspace root.",
          field: "workspaceRoot",
        });
      }
      return yield* Effect.try({
        try: () => createSourceRuntimeDistribution(workspaceRoot),
        catch: (cause) =>
          new WebValidationError({
            field: "workspaceRoot",
            message: errorMessage(cause),
            cause,
            details: { workspaceRoot },
          }),
      });
    }

    const mcpEntrypoint = path.join(packageRoot, "dist", WEB_PACKAGE_MCP_ENTRYPOINT);
    return yield* Effect.try({
      try: () =>
        createArtifactRuntimeDistribution({
          mcpLauncher: {
            kind: "toolScript",
            scriptPath: mcpEntrypoint,
            toolId: "bun",
          },
        }),
      catch: (cause) =>
        new WebValidationError({
          field: "packageRoot",
          message: errorMessage(cause),
          cause,
          details: { mcpEntrypoint, packageRoot },
        }),
    });
  });

export const resolveWebRuntimeDistribution = (
  input: ResolveWebRuntimeDistributionInput,
): HostRuntimeDistribution => runWebSyncBoundary(resolveWebRuntimeDistributionEffect(input));

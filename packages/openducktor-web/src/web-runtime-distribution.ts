import path from "node:path";
import {
  createArtifactRuntimeDistribution,
  createSourceRuntimeDistribution,
  type HostRuntimeDistribution,
} from "@openducktor/host";

export type ResolveWebRuntimeDistributionInput = {
  bunExecutable?: string;
  packageRoot: string;
  workspaceMode: boolean;
  workspaceRoot?: string;
};

export const WEB_PACKAGE_MCP_ENTRYPOINT = "openducktor-mcp.js";

export const resolveWebRuntimeDistribution = ({
  bunExecutable = process.execPath,
  packageRoot,
  workspaceMode,
  workspaceRoot,
}: ResolveWebRuntimeDistributionInput): HostRuntimeDistribution => {
  if (workspaceMode) {
    if (!workspaceRoot) {
      throw new Error("OpenDucktor web workspace mode requires a workspace root.");
    }
    return createSourceRuntimeDistribution(workspaceRoot);
  }

  const mcpEntrypoint = path.join(packageRoot, "dist", WEB_PACKAGE_MCP_ENTRYPOINT);
  return createArtifactRuntimeDistribution({
    mcpLauncher: {
      kind: "bunScript",
      bunExecutablePath: bunExecutable,
      scriptPath: mcpEntrypoint,
    },
  });
};

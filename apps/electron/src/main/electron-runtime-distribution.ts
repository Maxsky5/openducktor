import { join } from "node:path";
import {
  createArtifactRuntimeDistribution,
  createSourceRuntimeDistribution,
  type HostRuntimeDistribution,
} from "@openducktor/host";

type ResolveElectronRuntimeDistributionInput = {
  isPackaged: boolean;
  platform: NodeJS.Platform;
  resourcesPath: string;
  workspaceRoot: string;
};

export const resolveElectronRuntimeDistribution = ({
  isPackaged,
  platform,
  resourcesPath,
  workspaceRoot,
}: ResolveElectronRuntimeDistributionInput): HostRuntimeDistribution => {
  if (!isPackaged) {
    return createSourceRuntimeDistribution(workspaceRoot);
  }

  const executableName = platform === "win32" ? "openducktor-mcp.exe" : "openducktor-mcp";
  return createArtifactRuntimeDistribution({
    bundledToolBinDirs: {},
    mcpLauncher: {
      kind: "executable",
      executablePath: join(resourcesPath, "bin", executableName),
    },
  });
};

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

export const resolveElectronMcpSidecarPath = ({
  platform,
  resourcesPath,
}: Pick<ResolveElectronRuntimeDistributionInput, "platform" | "resourcesPath">): string => {
  const executableName = platform === "win32" ? "openducktor-mcp.exe" : "openducktor-mcp";
  return join(resourcesPath, "bin", executableName);
};

export const resolveElectronBundledBinDir = (resourcesPath: string): string =>
  join(resourcesPath, "bin");

export const resolveElectronRuntimeDistribution = ({
  isPackaged,
  platform,
  resourcesPath,
  workspaceRoot,
}: ResolveElectronRuntimeDistributionInput): HostRuntimeDistribution => {
  if (!isPackaged) {
    return createSourceRuntimeDistribution(workspaceRoot);
  }

  const bundledBinDir = resolveElectronBundledBinDir(resourcesPath);
  return createArtifactRuntimeDistribution({
    bundledBinDir,
    mcpLauncher: {
      kind: "executable",
      executablePath: resolveElectronMcpSidecarPath({
        platform,
        resourcesPath,
      }),
    },
  });
};

import { join } from "node:path";

export const OPENDUCKTOR_MCP_SIDECAR_PATH_ENV = "OPENDUCKTOR_OPENDUCKTOR_MCP_PATH";
export const OPENDUCKTOR_BUNDLED_BIN_DIR_ENV = "OPENDUCKTOR_BUNDLED_BIN_DIR";

type ConfigureElectronProcessEnvironmentInput = {
  env: NodeJS.ProcessEnv;
  platform: NodeJS.Platform;
  isPackaged: boolean;
  resourcesPath: string;
};

export const resolveElectronMcpSidecarPath = ({
  platform,
  resourcesPath,
}: Pick<ConfigureElectronProcessEnvironmentInput, "platform" | "resourcesPath">): string => {
  const executableName = platform === "win32" ? "openducktor-mcp.exe" : "openducktor-mcp";
  return join(resourcesPath, "bin", executableName);
};

export const configureElectronProcessEnvironment = ({
  env,
  platform,
  isPackaged,
  resourcesPath,
}: ConfigureElectronProcessEnvironmentInput): void => {
  if (isPackaged && env[OPENDUCKTOR_BUNDLED_BIN_DIR_ENV] === undefined) {
    env[OPENDUCKTOR_BUNDLED_BIN_DIR_ENV] = join(resourcesPath, "bin");
  }
  if (isPackaged && env[OPENDUCKTOR_MCP_SIDECAR_PATH_ENV] === undefined) {
    env[OPENDUCKTOR_MCP_SIDECAR_PATH_ENV] = resolveElectronMcpSidecarPath({
      platform,
      resourcesPath,
    });
  }
};

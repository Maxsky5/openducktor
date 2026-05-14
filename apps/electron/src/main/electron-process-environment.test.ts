import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import {
  configureElectronProcessEnvironment,
  OPENDUCKTOR_MCP_SIDECAR_PATH_ENV,
  resolveElectronMcpSidecarPath,
} from "./electron-process-environment";

describe("configureElectronProcessEnvironment", () => {
  test("does not own CLI PATH construction", () => {
    const env: NodeJS.ProcessEnv = { PATH: "/usr/bin:/bin" };

    configureElectronProcessEnvironment({
      env,
      platform: "darwin",
      isPackaged: true,
      resourcesPath: "/Applications/OpenDucktor.app/Contents/Resources",
    });

    expect(env.PATH).toBe("/usr/bin:/bin");
  });

  test("does not point development hosts at packaged sidecar resources", () => {
    const env: NodeJS.ProcessEnv = { PATH: "/usr/bin:/bin" };

    configureElectronProcessEnvironment({
      env,
      platform: "darwin",
      isPackaged: false,
      resourcesPath: "/repo/apps/electron",
    });

    expect(env[OPENDUCKTOR_MCP_SIDECAR_PATH_ENV]).toBeUndefined();
  });

  test("points packaged hosts at the Electron resources MCP sidecar", () => {
    expect(
      resolveElectronMcpSidecarPath({
        platform: "darwin",
        resourcesPath: "/Applications/OpenDucktor.app/Contents/Resources",
      }),
    ).toBe(join("/Applications/OpenDucktor.app/Contents/Resources", "bin", "openducktor-mcp"));
  });

  test("uses the Windows sidecar executable name on Windows", () => {
    expect(
      resolveElectronMcpSidecarPath({
        platform: "win32",
        resourcesPath: "C:\\Program Files\\OpenDucktor\\resources",
      }),
    ).toBe(join("C:\\Program Files\\OpenDucktor\\resources", "bin", "openducktor-mcp.exe"));
  });
});

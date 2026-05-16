import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import {
  configureElectronProcessEnvironment,
  OPENDUCKTOR_BUNDLED_BIN_DIR_ENV,
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
    expect(env[OPENDUCKTOR_BUNDLED_BIN_DIR_ENV]).toBeUndefined();
  });

  test("points packaged hosts at the Electron resources MCP sidecar", () => {
    const env: NodeJS.ProcessEnv = {};
    configureElectronProcessEnvironment({
      env,
      platform: "darwin",
      isPackaged: true,
      resourcesPath: "/Applications/OpenDucktor.app/Contents/Resources",
    });

    expect(env[OPENDUCKTOR_BUNDLED_BIN_DIR_ENV]).toBe(
      join("/Applications/OpenDucktor.app/Contents/Resources", "bin"),
    );
    expect(env[OPENDUCKTOR_MCP_SIDECAR_PATH_ENV]).toBe(
      join("/Applications/OpenDucktor.app/Contents/Resources", "bin", "openducktor-mcp"),
    );
    expect(
      resolveElectronMcpSidecarPath({
        platform: "darwin",
        resourcesPath: "/Applications/OpenDucktor.app/Contents/Resources",
      }),
    ).toBe(join("/Applications/OpenDucktor.app/Contents/Resources", "bin", "openducktor-mcp"));
  });

  test("preserves explicit packaged environment overrides", () => {
    const env: NodeJS.ProcessEnv = {
      [OPENDUCKTOR_BUNDLED_BIN_DIR_ENV]: "/custom/bin",
      [OPENDUCKTOR_MCP_SIDECAR_PATH_ENV]: "/custom/openducktor-mcp",
    };

    configureElectronProcessEnvironment({
      env,
      platform: "linux",
      isPackaged: true,
      resourcesPath: "/opt/OpenDucktor/resources",
    });

    expect(env[OPENDUCKTOR_BUNDLED_BIN_DIR_ENV]).toBe("/custom/bin");
    expect(env[OPENDUCKTOR_MCP_SIDECAR_PATH_ENV]).toBe("/custom/openducktor-mcp");
  });

  test("uses the Windows sidecar executable name on Windows", () => {
    const env: NodeJS.ProcessEnv = {};
    configureElectronProcessEnvironment({
      env,
      platform: "win32",
      isPackaged: true,
      resourcesPath: "C:\\Program Files\\OpenDucktor\\resources",
    });

    expect(env[OPENDUCKTOR_BUNDLED_BIN_DIR_ENV]).toBe(
      join("C:\\Program Files\\OpenDucktor\\resources", "bin"),
    );
    expect(env[OPENDUCKTOR_MCP_SIDECAR_PATH_ENV]).toBe(
      join("C:\\Program Files\\OpenDucktor\\resources", "bin", "openducktor-mcp.exe"),
    );
    expect(
      resolveElectronMcpSidecarPath({
        platform: "win32",
        resourcesPath: "C:\\Program Files\\OpenDucktor\\resources",
      }),
    ).toBe(join("C:\\Program Files\\OpenDucktor\\resources", "bin", "openducktor-mcp.exe"));
  });
});

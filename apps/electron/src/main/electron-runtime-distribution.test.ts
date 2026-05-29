import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import {
  resolveElectronBundledBinDir,
  resolveElectronMcpSidecarPath,
  resolveElectronRuntimeDistribution,
} from "./electron-runtime-distribution";

describe("resolveElectronRuntimeDistribution", () => {
  test("uses the workspace source distribution in Electron dev mode", () => {
    expect(
      resolveElectronRuntimeDistribution({
        platform: "darwin",
        isPackaged: false,
        resourcesPath: "/repo/apps/electron",
        workspaceRoot: "/repo",
      }),
    ).toEqual({
      mode: "source",
      workspaceRoot: "/repo",
    });
  });

  test("uses the packaged Electron resources sidecar in artifact mode", () => {
    const resourcesPath = "/Applications/OpenDucktor.app/Contents/Resources";

    expect(
      resolveElectronRuntimeDistribution({
        platform: "darwin",
        isPackaged: true,
        resourcesPath,
        workspaceRoot: "/repo",
      }),
    ).toEqual({
      mode: "artifact",
      bundledBinDir: join(resourcesPath, "bin"),
      mcpLauncher: {
        kind: "executable",
        executablePath: join(resourcesPath, "bin", "openducktor-mcp"),
      },
    });
    expect(resolveElectronBundledBinDir(resourcesPath)).toBe(join(resourcesPath, "bin"));
    expect(resolveElectronMcpSidecarPath({ platform: "darwin", resourcesPath })).toBe(
      join(resourcesPath, "bin", "openducktor-mcp"),
    );
  });

  test("uses the Windows MCP executable name for packaged Electron artifacts", () => {
    const resourcesPath = "C:\\Program Files\\OpenDucktor\\resources";

    expect(resolveElectronMcpSidecarPath({ platform: "win32", resourcesPath })).toBe(
      join(resourcesPath, "bin", "openducktor-mcp.exe"),
    );
  });
});

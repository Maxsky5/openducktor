import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import {
  resolveElectronBundledBinDir,
  resolveElectronMcpSidecarPath,
  resolveElectronRuntimeDistribution,
} from "./electron-runtime-distribution";

describe("resolveElectronRuntimeDistribution", () => {
  test("resolves the packaged Electron bundled binary directory", () => {
    const resourcesPath = "/Applications/OpenDucktor.app/Contents/Resources";

    expect(resolveElectronBundledBinDir(resourcesPath)).toBe(join(resourcesPath, "bin"));
  });

  test("uses the workspace source distribution in Electron dev mode", () => {
    expect(
      resolveElectronRuntimeDistribution({
        platform: "darwin",
        isPackaged: false,
        resourcesPath: "/repo/apps/electron",
        workspaceRoot: "/repo",
      }),
    ).toMatchObject({
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
    ).toMatchObject({
      mode: "artifact",
      bundledBinDir: join(resourcesPath, "bin"),
      mcpLauncher: {
        kind: "executable",
        executablePath: join(resourcesPath, "bin", "openducktor-mcp"),
      },
    });
    expect(resolveElectronMcpSidecarPath({ platform: "darwin", resourcesPath })).toBe(
      join(resourcesPath, "bin", "openducktor-mcp"),
    );
  });

  test("uses the Linux MCP executable name for packaged Electron artifacts", () => {
    const resourcesPath = "/opt/OpenDucktor/resources";

    expect(
      resolveElectronRuntimeDistribution({
        platform: "linux",
        isPackaged: true,
        resourcesPath,
        workspaceRoot: "/repo",
      }),
    ).toMatchObject({
      mode: "artifact",
      bundledBinDir: join(resourcesPath, "bin"),
      mcpLauncher: {
        kind: "executable",
        executablePath: join(resourcesPath, "bin", "openducktor-mcp"),
      },
    });
  });

  test("uses the Windows MCP executable name for packaged Electron artifacts", () => {
    const resourcesPath = "C:\\Program Files\\OpenDucktor\\resources";

    expect(resolveElectronMcpSidecarPath({ platform: "win32", resourcesPath })).toBe(
      join(resourcesPath, "bin", "openducktor-mcp.exe"),
    );
  });
});

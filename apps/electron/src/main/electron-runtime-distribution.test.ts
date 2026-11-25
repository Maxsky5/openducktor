import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { resolveElectronRuntimeDistribution } from "./electron-runtime-distribution";

describe("resolveElectronRuntimeDistribution", () => {
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

  test.each([
    ["darwin", "/Applications/OpenDucktor.app/Contents/Resources", "openducktor-mcp"],
    ["linux", "/opt/OpenDucktor/resources", "openducktor-mcp"],
    ["win32", "C:\\Program Files\\OpenDucktor\\resources", "openducktor-mcp.exe"],
  ] as const)("uses the packaged MCP sidecar on %s", (platform, resourcesPath, executable) => {
    expect(
      resolveElectronRuntimeDistribution({
        platform,
        isPackaged: true,
        resourcesPath,
        workspaceRoot: "/repo",
      }),
    ).toMatchObject({
      mode: "artifact",
      mcpLauncher: {
        kind: "executable",
        executablePath: join(resourcesPath, "bin", executable),
      },
    });
  });
});

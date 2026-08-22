import { describe, expect, test } from "bun:test";
import path from "node:path";
import {
  MCP_BRIDGE_PRODUCTION_DISCOVERY_PATH_SEGMENTS,
  mcpBridgeDevelopmentDiscoveryPathSegments,
} from "@openducktor/contracts";
import { resolveElectronMcpBridgeDiscoveryMode } from "./electron-host";

describe("Electron host MCP discovery composition", () => {
  test("derives production discovery ownership from packaged launch context", () => {
    expect(resolveElectronMcpBridgeDiscoveryMode(true)).toBe("production");
  });

  test("derives development discovery ownership from source launch context", () => {
    expect(resolveElectronMcpBridgeDiscoveryMode(false)).toBe("development");
  });

  for (const scenario of [
    {
      descriptorSegments: MCP_BRIDGE_PRODUCTION_DISCOVERY_PATH_SEGMENTS,
      isPackaged: true,
      oppositeDescriptorSegments:
        mcpBridgeDevelopmentDiscoveryPathSegments("electron-0123456789ab"),
      title: "packaged Electron owns only production discovery",
    },
    {
      descriptorSegments: mcpBridgeDevelopmentDiscoveryPathSegments("electron-0123456789ab"),
      isPackaged: false,
      oppositeDescriptorSegments: MCP_BRIDGE_PRODUCTION_DISCOVERY_PATH_SEGMENTS,
      title: "source Electron owns only development discovery",
    },
  ] as const) {
    test(scenario.title, () => {
      const configDirectory = path.join("/tmp", "openducktor-electron-discovery");
      const runtimeDirectory = path.join(configDirectory, "runtime");
      const discoveryMode = resolveElectronMcpBridgeDiscoveryMode(scenario.isPackaged);
      const activeDescriptorPath = path.join(runtimeDirectory, ...scenario.descriptorSegments);
      const inactiveDescriptorPath = path.join(
        runtimeDirectory,
        ...scenario.oppositeDescriptorSegments,
      );

      expect(discoveryMode).toBe(scenario.isPackaged ? "production" : "development");
      expect(activeDescriptorPath).not.toBe(inactiveDescriptorPath);
      expect(activeDescriptorPath.startsWith(runtimeDirectory)).toBe(true);
      expect(inactiveDescriptorPath.startsWith(runtimeDirectory)).toBe(true);
    });
  }
});

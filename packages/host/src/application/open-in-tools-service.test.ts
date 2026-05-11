import type { SystemOpenInToolId, SystemOpenInToolInfo } from "@openducktor/contracts";
import type { OpenInToolsPort } from "../ports/open-in-tools-port";
import { createOpenInToolsService } from "./open-in-tools-service";

type FakeOpenInToolsPortInput = {
  canonicalPaths?: Record<string, string>;
  directories?: string[];
  discoveredTools?: SystemOpenInToolInfo[][];
};

const createFakeOpenInToolsPort = ({
  canonicalPaths = {},
  directories = [],
  discoveredTools = [],
}: FakeOpenInToolsPortInput = {}) => {
  const launches: Array<{ directoryPath: string; toolId: SystemOpenInToolId }> = [];
  let discoveryCount = 0;

  const port: OpenInToolsPort = {
    async canonicalizeDirectory(directoryPath) {
      const canonicalPath = canonicalPaths[directoryPath];
      if (!canonicalPath) {
        throw new Error(`missing directory fixture: ${directoryPath}`);
      }
      return canonicalPath;
    },
    async isDirectory(directoryPath) {
      return directories.includes(directoryPath);
    },
    async discoverOpenInTools() {
      const result = discoveredTools[discoveryCount] ?? [];
      discoveryCount += 1;
      return result;
    },
    async openDirectoryInTool(directoryPath, toolId) {
      launches.push({ directoryPath, toolId });
    },
  };

  return {
    get discoveryCount() {
      return discoveryCount;
    },
    launches,
    port,
  };
};

describe("createOpenInToolsService", () => {
  test("caches discovered tools until force refresh is requested", async () => {
    const fake = createFakeOpenInToolsPort({
      discoveredTools: [
        [{ toolId: "finder", iconDataUrl: null }],
        [{ toolId: "ghostty", iconDataUrl: null }],
      ],
    });
    const service = createOpenInToolsService(fake.port, { clock: () => 1000 });

    await expect(service.listOpenInTools({})).resolves.toEqual([
      { toolId: "finder", iconDataUrl: null },
    ]);
    await expect(service.listOpenInTools({})).resolves.toEqual([
      { toolId: "finder", iconDataUrl: null },
    ]);
    await expect(service.listOpenInTools({ forceRefresh: true })).resolves.toEqual([
      { toolId: "ghostty", iconDataUrl: null },
    ]);
    expect(fake.discoveryCount).toBe(2);
  });

  test("launches a validated canonical directory", async () => {
    const fake = createFakeOpenInToolsPort({
      canonicalPaths: { "/repo": "/canonical/repo" },
      directories: ["/canonical/repo"],
    });
    const service = createOpenInToolsService(fake.port);

    await expect(
      service.openDirectoryInTool({ directoryPath: "/repo", toolId: "vscode" }),
    ).resolves.toBeUndefined();

    expect(fake.launches).toEqual([{ directoryPath: "/canonical/repo", toolId: "vscode" }]);
  });

  test("rejects missing directories before launching", async () => {
    const fake = createFakeOpenInToolsPort();
    const service = createOpenInToolsService(fake.port);

    await expect(
      service.openDirectoryInTool({ directoryPath: "/missing", toolId: "finder" }),
    ).rejects.toThrow("Directory does not exist: /missing");
    expect(fake.launches).toEqual([]);
  });

  test("rejects non-directory paths before launching", async () => {
    const fake = createFakeOpenInToolsPort({
      canonicalPaths: { "/file.txt": "/canonical/file.txt" },
    });
    const service = createOpenInToolsService(fake.port);

    await expect(
      service.openDirectoryInTool({ directoryPath: "/file.txt", toolId: "finder" }),
    ).rejects.toThrow("Path is not a directory: /file.txt");
    expect(fake.launches).toEqual([]);
  });
});

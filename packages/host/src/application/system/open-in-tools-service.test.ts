import type { SystemOpenInToolId, SystemOpenInToolInfo } from "@openducktor/contracts";
import { Effect } from "effect";
import { HostOperationError } from "../../effect/host-errors";
import type { OpenInToolsPort } from "../../ports/open-in-tools-port";
import { createOpenInToolsService as createEffectOpenInToolsService } from "./open-in-tools-service";

const createOpenInToolsService = (...args: Parameters<typeof createEffectOpenInToolsService>) =>
  createEffectOpenInToolsService(...args);
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
  const launches: Array<{
    directoryPath: string;
    toolId: SystemOpenInToolId;
  }> = [];
  const externalUrls: string[] = [];
  let discoveryCount = 0;
  const port: OpenInToolsPort = {
    canonicalizeDirectory(directoryPath) {
      return Effect.tryPromise({
        try: async () => {
          const canonicalPath = canonicalPaths[directoryPath];
          if (!canonicalPath) {
            throw new Error(`missing directory fixture: ${directoryPath}`);
          }
          return canonicalPath;
        },
        catch: (cause) =>
          new HostOperationError({
            operation: "test.effect",
            message: cause instanceof Error ? cause.message : String(cause),
            cause: cause,
          }),
      });
    },
    isDirectory(directoryPath) {
      return Effect.tryPromise({
        try: async () => {
          return directories.includes(directoryPath);
        },
        catch: (cause) =>
          new HostOperationError({
            operation: "test.effect",
            message: cause instanceof Error ? cause.message : String(cause),
            cause: cause,
          }),
      });
    },
    discoverOpenInTools() {
      return Effect.tryPromise({
        try: async () => {
          const result = discoveredTools[discoveryCount] ?? [];
          discoveryCount += 1;
          return result;
        },
        catch: (cause) =>
          new HostOperationError({
            operation: "test.effect",
            message: cause instanceof Error ? cause.message : String(cause),
            cause: cause,
          }),
      });
    },
    openDirectoryInTool(directoryPath, toolId) {
      return Effect.tryPromise({
        try: async () => {
          launches.push({ directoryPath, toolId });
        },
        catch: (cause) =>
          new HostOperationError({
            operation: "test.effect",
            message: cause instanceof Error ? cause.message : String(cause),
            cause: cause,
          }),
      });
    },
    openExternalUrl(url) {
      return Effect.tryPromise({
        try: async () => {
          externalUrls.push(url);
        },
        catch: (cause) =>
          new HostOperationError({
            operation: "test.effect",
            message: cause instanceof Error ? cause.message : String(cause),
            cause: cause,
          }),
      });
    },
  };
  return {
    get discoveryCount() {
      return discoveryCount;
    },
    launches,
    externalUrls,
    port: port as OpenInToolsPort,
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
    await expect(Effect.runPromise(service.listOpenInTools({}))).resolves.toEqual([
      { toolId: "finder", iconDataUrl: null },
    ]);
    await expect(Effect.runPromise(service.listOpenInTools({}))).resolves.toEqual([
      { toolId: "finder", iconDataUrl: null },
    ]);
    await expect(
      Effect.runPromise(service.listOpenInTools({ forceRefresh: true })),
    ).resolves.toEqual([{ toolId: "ghostty", iconDataUrl: null }]);
    expect(fake.discoveryCount).toBe(2);
  });
  test("launches a validated canonical directory", async () => {
    const fake = createFakeOpenInToolsPort({
      canonicalPaths: { "/repo": "/canonical/repo" },
      directories: ["/canonical/repo"],
    });
    const service = createOpenInToolsService(fake.port);
    await expect(
      Effect.runPromise(service.openDirectoryInTool({ directoryPath: "/repo", toolId: "vscode" })),
    ).resolves.toBeUndefined();
    expect(fake.launches).toEqual([{ directoryPath: "/canonical/repo", toolId: "vscode" }]);
  });
  test("rejects missing directories before launching", async () => {
    const fake = createFakeOpenInToolsPort();
    const service = createOpenInToolsService(fake.port);
    await expect(
      Effect.runPromise(
        service.openDirectoryInTool({ directoryPath: "/missing", toolId: "finder" }),
      ),
    ).rejects.toThrow("Directory does not exist: /missing");
    expect(fake.launches).toEqual([]);
  });
  test("rejects non-directory paths before launching", async () => {
    const fake = createFakeOpenInToolsPort({
      canonicalPaths: { "/file.txt": "/canonical/file.txt" },
    });
    const service = createOpenInToolsService(fake.port);
    await expect(
      Effect.runPromise(
        service.openDirectoryInTool({ directoryPath: "/file.txt", toolId: "finder" }),
      ),
    ).rejects.toThrow("Path is not a directory: /file.txt");
    expect(fake.launches).toEqual([]);
  });
  test("opens validated external http URLs", async () => {
    const fake = createFakeOpenInToolsPort();
    const service = createOpenInToolsService(fake.port);
    await expect(
      Effect.runPromise(service.openExternalUrl({ url: " https://example.com/path?q=1 " })),
    ).resolves.toBeUndefined();
    expect(fake.externalUrls).toEqual(["https://example.com/path?q=1"]);
  });
  test("rejects non-http external URLs", async () => {
    const fake = createFakeOpenInToolsPort();
    const service = createOpenInToolsService(fake.port);
    await expect(
      Effect.runPromise(service.openExternalUrl({ url: "file:///tmp/report" })),
    ).rejects.toThrow("Only http and https URLs can be opened from OpenDucktor.");
    expect(fake.externalUrls).toEqual([]);
  });
});

import { describe, expect, test } from "bun:test";
import { spawn } from "node:child_process";
import { OPENCODE_RUNTIME_DESCRIPTOR } from "@openducktor/contracts";
import { Effect } from "effect";
import { HostOperationError } from "../../effect/host-errors";
import type { ToolDiscoveryPort } from "../../ports/tool-discovery-port";
import { createFixedRuntimeSettingsConfig } from "../../test-support/runtime-settings-config";
import { createFakeOpenCodeV2 } from "../../test-support/opencode-v2-standalone";
import { createOpenCodeModelCatalogPreview } from "./opencode-model-catalog-preview";

const discovery = (path: string): ToolDiscoveryPort => {
  const result = { displayLabel: "OpenCode", path, sourceCategory: "provided_path" as const };
  return {
    discoverTool: () => Effect.succeed(result),
    resolveTool: () => Effect.succeed(result),
    resolveToolPath: () => Effect.succeed(path),
    validateToolPath: () => Effect.succeed(result),
  };
};
describe("OpenCode V2 catalog preview", () => {
  test("passes the private authenticated connection and releases the preview process", async () => {
    const fixture = await createFakeOpenCodeV2();
    let child: ReturnType<typeof spawn> | undefined;
    const catalog = {
      runtime: OPENCODE_RUNTIME_DESCRIPTOR,
      models: [],
      defaultModelsByProvider: {},
    };
    try {
      const preview = createOpenCodeModelCatalogPreview({
        settingsConfig: createFixedRuntimeSettingsConfig("opencode", fixture.executablePath),
        toolDiscovery: discovery(fixture.executablePath),
        spawnProcess: (command, args, options) => {
          const running = spawn(command, args, options);
          child = running;
          return running;
        },
        readModelCatalog: async (repoPath, connection) => {
          expect(repoPath).toBe(fixture.directory);
          expect(connection.authentication.password.length).toBeGreaterThan(40);
          expect(connection.endpoint).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
          return catalog;
        },
      });
      expect(await Effect.runPromise(preview(fixture.directory))).toEqual(catalog);
      expect(child?.stdin?.writableEnded).toBe(true);
    } finally {
      child?.kill();
      await fixture.cleanup();
    }
  });
  test("preserves the read error when cleanup also fails", async () => {
    const fixture = await createFakeOpenCodeV2();
    let child: ReturnType<typeof spawn> | undefined;
    try {
      const preview = createOpenCodeModelCatalogPreview({
        settingsConfig: createFixedRuntimeSettingsConfig("opencode", fixture.executablePath),
        toolDiscovery: discovery(fixture.executablePath),
        spawnProcess: (command, args, options) => {
          const running = spawn(command, args, options);
          child = running;
          return running;
        },
        readModelCatalog: async () => {
          throw new Error("native catalog failed");
        },
        processTreeTerminator: () =>
          Effect.fail(
            new HostOperationError({ operation: "test.cleanup", message: "native cleanup failed" }),
          ),
      });
      await expect(Effect.runPromise(preview(fixture.directory))).rejects.toThrow(
        /native catalog failed[\s\S]*native cleanup failed/,
      );
    } finally {
      child?.kill();
      await fixture.cleanup();
    }
  });
});

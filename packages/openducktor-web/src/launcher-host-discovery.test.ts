import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createSourceRuntimeDistribution } from "@openducktor/host";
import { Effect } from "effect";
import { startWebLauncherHostBackendEffect } from "./launcher";
import type { WebLogger } from "./logger";
import type { TypescriptHostBackend } from "./typescript-host-backend";

const nativeResponse = await Bun.fetch("data:,");
const nativeResponseConstructor = nativeResponse.constructor as typeof Response;

const sourceRuntimeDistribution = createSourceRuntimeDistribution(
  path.resolve(import.meta.dir, "../../.."),
);
const testLogger: WebLogger = {
  error: () => Effect.void,
  info: () => Effect.void,
  success: () => Effect.void,
};

describe("web launcher MCP discovery composition", () => {
  for (const scenario of [
    {
      descriptorName: "mcp-bridge-dev.json",
      oppositeDescriptor: '{"hostUrl":"http://127.0.0.1:1","hostToken":"prod","pid":1}\n',
      oppositeDescriptorName: "mcp-bridge.json",
      title: "workspace launches own only development discovery",
      workspaceMode: true,
    },
    {
      descriptorName: "mcp-bridge.json",
      oppositeDescriptor: '{"hostUrl":"http://127.0.0.1:2","hostToken":"dev","pid":2}\n',
      oppositeDescriptorName: "mcp-bridge-dev.json",
      title: "installed launches own only production discovery",
      workspaceMode: false,
    },
  ] as const) {
    test(scenario.title, async () => {
      const previousResponse = globalThis.Response;
      const previousConfigDirectory = process.env.OPENDUCKTOR_CONFIG_DIR;
      const configDirectory = await mkdtemp(path.join(tmpdir(), "openducktor-web-discovery-"));
      const runtimeDirectory = path.join(configDirectory, "runtime");
      const descriptorPath = path.join(runtimeDirectory, scenario.descriptorName);
      const oppositeDescriptorPath = path.join(runtimeDirectory, scenario.oppositeDescriptorName);
      let backend: TypescriptHostBackend | null = null;

      try {
        (globalThis as typeof globalThis & { Response: typeof Response }).Response =
          nativeResponseConstructor;
        process.env.OPENDUCKTOR_CONFIG_DIR = configDirectory;
        await mkdir(runtimeDirectory, { recursive: true });
        await writeFile(oppositeDescriptorPath, scenario.oppositeDescriptor, "utf8");

        backend = await Effect.runPromise(
          startWebLauncherHostBackendEffect({
            appToken: "app-token",
            controlToken: "control-token",
            frontendOrigin: "http://127.0.0.1:1420",
            logger: testLogger,
            onBackgroundFailure: () => {},
            port: 0,
            runtimeDistribution: sourceRuntimeDistribution,
            workspaceMode: scenario.workspaceMode,
          }),
        );

        expect(JSON.parse(await readFile(descriptorPath, "utf8"))).toEqual({
          hostToken: expect.any(String),
          hostUrl: expect.stringMatching(/^http:\/\/127\.0\.0\.1:\d+$/),
          pid: process.pid,
        });
        await expect(readFile(oppositeDescriptorPath, "utf8")).resolves.toBe(
          scenario.oppositeDescriptor,
        );

        await backend.stop();

        await expect(readFile(descriptorPath, "utf8")).rejects.toMatchObject({ code: "ENOENT" });
        await expect(readFile(oppositeDescriptorPath, "utf8")).resolves.toBe(
          scenario.oppositeDescriptor,
        );
      } finally {
        await backend?.stop().catch(() => {});
        (globalThis as typeof globalThis & { Response: typeof Response }).Response =
          previousResponse;
        if (previousConfigDirectory === undefined) {
          delete process.env.OPENDUCKTOR_CONFIG_DIR;
        } else {
          process.env.OPENDUCKTOR_CONFIG_DIR = previousConfigDirectory;
        }
        await rm(configDirectory, { force: true, recursive: true });
      }
    }, 10_000);
  }
});

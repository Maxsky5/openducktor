import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createArtifactRuntimeDistribution, Effect, type TerminalPtyPort } from "@openducktor/host";
import {
  createElectronHostCommandRouter,
  resolveElectronMcpBridgeDiscoveryMode,
} from "./electron-host";

const testRuntimeDistribution = createArtifactRuntimeDistribution({
  mcpLauncher: {
    kind: "executable",
    executablePath: process.execPath,
  },
});
const testTerminalPty: TerminalPtyPort = {
  start: () => Effect.die("Terminal PTY is not expected in this composition test."),
};

describe("Electron host MCP discovery composition", () => {
  test("derives production discovery ownership from packaged launch context", () => {
    expect(resolveElectronMcpBridgeDiscoveryMode(true)).toBe("production");
  });

  test("derives development discovery ownership from source launch context", () => {
    expect(resolveElectronMcpBridgeDiscoveryMode(false)).toBe("development");
  });

  for (const scenario of [
    {
      descriptorName: "mcp-bridge.json",
      isPackaged: true,
      oppositeDescriptor: '{"hostUrl":"http://127.0.0.1:1","hostToken":"dev","pid":1}\n',
      oppositeDescriptorName: "mcp-bridge-dev.json",
      title: "packaged Electron owns only production discovery",
    },
    {
      descriptorName: "mcp-bridge-dev.json",
      isPackaged: false,
      oppositeDescriptor: '{"hostUrl":"http://127.0.0.1:2","hostToken":"prod","pid":2}\n',
      oppositeDescriptorName: "mcp-bridge.json",
      title: "source Electron owns only development discovery",
    },
  ] as const) {
    test(scenario.title, async () => {
      const configDirectory = await mkdtemp(path.join(tmpdir(), "openducktor-electron-discovery-"));
      const runtimeDirectory = path.join(configDirectory, "runtime");
      const descriptorPath = path.join(runtimeDirectory, scenario.descriptorName);
      const oppositeDescriptorPath = path.join(runtimeDirectory, scenario.oppositeDescriptorName);
      const router = createElectronHostCommandRouter({
        isPackaged: scenario.isPackaged,
        lifecycleLogger: {
          error: () => Effect.void,
          info: () => Effect.void,
        },
        onBackgroundFailure: () => Effect.void,
        processEnv: {
          OPENDUCKTOR_CONFIG_DIR: configDirectory,
          PATH: "/usr/bin:/bin",
        },
        runtimeDistribution: testRuntimeDistribution,
        terminalPty: testTerminalPty,
      });
      let disposed = false;

      try {
        await mkdir(runtimeDirectory, { recursive: true });
        await writeFile(oppositeDescriptorPath, scenario.oppositeDescriptor, "utf8");

        await router.initialize();

        expect(JSON.parse(await readFile(descriptorPath, "utf8"))).toEqual({
          hostToken: expect.any(String),
          hostUrl: expect.stringMatching(/^http:\/\/127\.0\.0\.1:\d+$/),
          pid: process.pid,
        });
        await expect(readFile(oppositeDescriptorPath, "utf8")).resolves.toBe(
          scenario.oppositeDescriptor,
        );

        await router.dispose();
        disposed = true;

        await expect(readFile(descriptorPath, "utf8")).rejects.toMatchObject({ code: "ENOENT" });
        await expect(readFile(oppositeDescriptorPath, "utf8")).resolves.toBe(
          scenario.oppositeDescriptor,
        );
      } finally {
        if (!disposed) {
          await router.dispose().catch(() => {});
        }
        await rm(configDirectory, { force: true, recursive: true });
      }
    });
  }
});

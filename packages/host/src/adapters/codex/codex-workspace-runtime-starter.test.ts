import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RUNTIME_DESCRIPTORS_BY_KIND } from "@openducktor/contracts";
import type { SystemCommandPort } from "../../ports/system-command-port";
import { createCodexAppServerTransportRegistry } from "./codex-app-server-transport-registry";
import {
  buildCodexMcpConfigArgs,
  createCodexWorkspaceRuntimeStarter,
} from "./codex-workspace-runtime-starter";

const createSystemCommands = (): SystemCommandPort => ({
  async requiredCommandError() {
    return null;
  },
  async versionCommand() {
    return "codex 1.0.0";
  },
  async runCommandAllowFailure() {
    return { ok: true, stdout: "", stderr: "" };
  },
});

const createFakeCodex = async (root: string): Promise<string> => {
  const executable = join(root, "codex");
  await writeFile(
    executable,
    `#!/usr/bin/env bun
import { createInterface } from "node:readline";
import { writeFileSync } from "node:fs";

const capturePath = process.env.CODEX_CAPTURE_PATH;
if (capturePath) {
  writeFileSync(capturePath, JSON.stringify({
    args: process.argv.slice(2),
    env: {
      ODT_WORKSPACE_ID: process.env.ODT_WORKSPACE_ID,
      ODT_HOST_URL: process.env.ODT_HOST_URL,
      ODT_HOST_TOKEN: process.env.ODT_HOST_TOKEN,
      ODT_FORBID_WORKSPACE_ID_INPUT: process.env.ODT_FORBID_WORKSPACE_ID_INPUT,
      ODT_ALLOWED_TOOLS: process.env.ODT_ALLOWED_TOOLS,
    },
  }));
}

if (!process.argv.includes("app-server")) {
  console.error("expected app-server command");
  process.exit(2);
}

const lines = createInterface({ input: process.stdin });
lines.on("line", (line) => {
  const message = JSON.parse(line);
  if (message.method === "initialize") {
    process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: message.id, result: { ok: true } }) + "\\n");
    return;
  }
  if (message.id !== undefined) {
    process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: message.id, result: { method: message.method, params: message.params ?? null } }) + "\\n");
  }
});
const stop = () => process.exit(0);
process.on("SIGTERM", stop);
process.on("SIGINT", stop);
`,
  );
  await chmod(executable, 0o755);
  return executable;
};

describe("createCodexWorkspaceRuntimeStarter", () => {
  test("builds Codex MCP config args for OpenDucktor tools", () => {
    expect(buildCodexMcpConfigArgs(["mcp-bin", "--stdio"])).toEqual([
      "--config",
      'mcp_servers.openducktor.command="mcp-bin"',
      "--config",
      'mcp_servers.openducktor.args=["--stdio"]',
      "--config",
      'mcp_servers.openducktor.env_vars=["ODT_WORKSPACE_ID", "ODT_HOST_URL", "ODT_HOST_TOKEN", "ODT_FORBID_WORKSPACE_ID_INPUT", "ODT_ALLOWED_TOOLS"]',
      "--config",
      "mcp_servers.openducktor.enabled=true",
    ]);
  });

  test("fails fast when the MCP bridge connection is not configured", async () => {
    const starter = createCodexWorkspaceRuntimeStarter({
      systemCommands: createSystemCommands(),
      codexAppServer: createCodexAppServerTransportRegistry(),
      mcpCommand: ["mcp-bin"],
    });

    await expect(
      starter.startWorkspaceRuntime({
        runtimeKind: "codex",
        repoPath: "/repo",
        workingDirectory: "/repo",
        descriptor: RUNTIME_DESCRIPTORS_BY_KIND.codex,
      }),
    ).rejects.toThrow("Codex workspace startup requires an MCP host bridge connection.");
  });

  test("starts a Codex app-server runtime, registers transport, and stops it", async () => {
    const root = await mkdtemp(join(tmpdir(), "odt-codex-starter-"));
    const originalCapturePath = process.env.CODEX_CAPTURE_PATH;
    try {
      const repo = join(root, "repo");
      await mkdir(repo);
      const capturePath = join(root, "capture.json");
      process.env.CODEX_CAPTURE_PATH = capturePath;
      const codexBinary = await createFakeCodex(root);
      const codexAppServer = createCodexAppServerTransportRegistry();
      const starter = createCodexWorkspaceRuntimeStarter({
        systemCommands: createSystemCommands(),
        codexAppServer,
        codexBinary,
        mcpCommand: ["mcp-bin", "--stdio"],
        resolveMcpBridgeConnection: async () => ({
          workspaceId: "repo",
          hostUrl: "http://127.0.0.1:14327",
          hostToken: "token-1",
        }),
        requestTimeoutMs: 2_000,
        now: () => new Date("2026-05-10T10:00:00.000Z"),
        runtimeId: () => "runtime-1",
      });

      const handle = await starter.startWorkspaceRuntime({
        runtimeKind: "codex",
        repoPath: repo,
        workingDirectory: repo,
        descriptor: RUNTIME_DESCRIPTORS_BY_KIND.codex,
      });

      expect(handle.runtime).toMatchObject({
        kind: "codex",
        runtimeId: "runtime-1",
        repoPath: repo,
        role: "workspace",
        workingDirectory: repo,
        runtimeRoute: {
          type: "stdio",
          identity: "runtime-1",
        },
        startedAt: "2026-05-10T10:00:00.000Z",
      });
      await expect(
        codexAppServer.request({
          runtimeId: "runtime-1",
          method: "thread/loaded/list",
          params: { cursor: null },
        }),
      ).resolves.toEqual({ method: "thread/loaded/list", params: { cursor: null } });
      const capture = JSON.parse(await readFile(capturePath, "utf8"));
      expect(capture.env).toMatchObject({
        ODT_WORKSPACE_ID: "repo",
        ODT_HOST_URL: "http://127.0.0.1:14327",
        ODT_HOST_TOKEN: "token-1",
        ODT_FORBID_WORKSPACE_ID_INPUT: "true",
      });
      expect(capture.env.ODT_ALLOWED_TOOLS).toContain("odt_read_task");
      expect(capture.args).toContain("app-server");

      await expect(handle.stop()).resolves.toBeUndefined();
      await expect(
        codexAppServer.request({ runtimeId: "runtime-1", method: "thread/loaded/list" }),
      ).rejects.toThrow("Codex app-server transport not found for runtime runtime-1");
    } finally {
      if (originalCapturePath === undefined) {
        delete process.env.CODEX_CAPTURE_PATH;
      } else {
        process.env.CODEX_CAPTURE_PATH = originalCapturePath;
      }
      await rm(root, { recursive: true, force: true });
    }
  });
});

import { chmod, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RUNTIME_DESCRIPTORS_BY_KIND } from "@openducktor/contracts";
import type { SystemCommandPort } from "../../ports/system-command-port";
import { removeTestDirectory } from "../../test-support/temp-directory";
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
  const scriptPath = join(root, "codex.mjs");
  const executable = join(root, process.platform === "win32" ? "codex.cmd" : "codex");
  const bunExecutable = process.execPath.replaceAll('"', '""');
  await writeFile(
    scriptPath,
    `import { createInterface } from "node:readline";
import { writeFileSync } from "node:fs";

const capturePath = process.env.CODEX_CAPTURE_PATH;
const capture = {
  args: process.argv.slice(2),
  env: {
    ODT_WORKSPACE_ID: process.env.ODT_WORKSPACE_ID,
    ODT_HOST_URL: process.env.ODT_HOST_URL,
    ODT_HOST_TOKEN: process.env.ODT_HOST_TOKEN,
    ODT_FORBID_WORKSPACE_ID_INPUT: process.env.ODT_FORBID_WORKSPACE_ID_INPUT,
    ODT_ALLOWED_TOOLS: process.env.ODT_ALLOWED_TOOLS,
  },
  initializeVersion: null,
};
if (capturePath) {
  writeFileSync(capturePath, JSON.stringify(capture));
}

if (!process.argv.includes("app-server")) {
  console.error("expected app-server command");
  process.exit(2);
}

const lines = createInterface({ input: process.stdin });
lines.on("line", (line) => {
  const message = JSON.parse(line);
  if (message.method === "initialize") {
    capture.initializeVersion = message.params.clientInfo.version;
    if (capturePath) {
      writeFileSync(capturePath, JSON.stringify(capture));
    }
    process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: message.id, result: { ok: true } }) + "\\n");
    return;
  }
  if (message.method === "initialized") {
    process.stdout.write(JSON.stringify({ jsonrpc: "2.0", method: "codex/app-server/ready", params: { threadId: "thread-1" } }) + "\\n");
    process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: 99, method: "item/tool/call", params: { threadId: "thread-1" } }) + "\\n");
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
  if (process.platform === "win32") {
    await writeFile(executable, `@echo off\r\n"${bunExecutable}" "%~dp0codex.mjs" %*\r\n`);
  } else {
    await writeFile(executable, `#!/bin/sh\nexec bun "$(dirname "$0")/codex.mjs" "$@"\n`);
  }
  await chmod(executable, 0o755);
  return executable;
};

const waitForEvents = async (events: unknown[], count: number): Promise<void> => {
  const deadline = Date.now() + 1_000;
  while (Date.now() < deadline) {
    if (events.length >= count) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`Timed out waiting for ${count} Codex app-server event(s).`);
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
        clientVersion: "0.3.1-test",
        resolveMcpBridgeConnection: async () => ({
          workspaceId: "repo",
          hostUrl: "http://127.0.0.1:14327",
          hostToken: "token-1",
        }),
        requestTimeoutMs: 4_000,
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
      expect(capture.initializeVersion).toBe("0.3.1-test");
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
      await removeTestDirectory(root);
    }
  });

  test("emits Codex app-server stream events instead of leaving them for drain polling", async () => {
    const root = await mkdtemp(join(tmpdir(), "odt-codex-starter-events-"));
    try {
      const repo = join(root, "repo");
      await mkdir(repo);
      const codexBinary = await createFakeCodex(root);
      const codexAppServer = createCodexAppServerTransportRegistry();
      const events: unknown[] = [];
      const starter = createCodexWorkspaceRuntimeStarter({
        systemCommands: createSystemCommands(),
        codexAppServer,
        codexBinary,
        mcpCommand: ["mcp-bin", "--stdio"],
        eventEmitter: (event) => events.push(event),
        resolveMcpBridgeConnection: async () => ({
          workspaceId: "repo",
          hostUrl: "http://127.0.0.1:14327",
          hostToken: "token-1",
        }),
        requestTimeoutMs: 4_000,
        runtimeId: () => "runtime-events",
      });

      const handle = await starter.startWorkspaceRuntime({
        runtimeKind: "codex",
        repoPath: repo,
        workingDirectory: repo,
        descriptor: RUNTIME_DESCRIPTORS_BY_KIND.codex,
      });

      await waitForEvents(events, 2);
      expect(events).toEqual([
        {
          runtimeId: "runtime-events",
          kind: "notification",
          message: {
            jsonrpc: "2.0",
            method: "codex/app-server/ready",
            params: { threadId: "thread-1" },
          },
        },
        {
          runtimeId: "runtime-events",
          kind: "server_request",
          message: {
            jsonrpc: "2.0",
            id: 99,
            method: "item/tool/call",
            params: { threadId: "thread-1" },
          },
        },
      ]);
      await expect(codexAppServer.drainNotifications("runtime-events")).resolves.toEqual([]);
      await expect(codexAppServer.drainServerRequests("runtime-events")).resolves.toEqual([]);

      await handle.stop();
    } finally {
      await removeTestDirectory(root);
    }
  });
});

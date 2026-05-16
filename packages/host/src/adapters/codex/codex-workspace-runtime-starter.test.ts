import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RUNTIME_DESCRIPTORS_BY_KIND } from "@openducktor/contracts";
import { Effect } from "effect";
import { HostOperationError } from "../../effect/host-errors";
import type { SystemCommandPort } from "../../ports/system-command-port";
import { writeFakeRuntimeCommand } from "../../test-support/fake-runtime-command";
import { removeTestDirectory } from "../../test-support/temp-directory";
import { createSystemCommandRunner } from "../system/system-command-runner";
import { createCodexAppServerTransportRegistry as createEffectCodexAppServerTransportRegistry } from "./codex-app-server-transport-registry";
import {
  buildCodexMcpConfigArgs,
  createCodexWorkspaceRuntimeStarter as createEffectCodexWorkspaceRuntimeStarter,
} from "./codex-workspace-runtime-starter";

const createCodexWorkspaceRuntimeStarter = (
  ...args: Parameters<typeof createEffectCodexWorkspaceRuntimeStarter>
) => createEffectCodexWorkspaceRuntimeStarter(...args);
const createCodexAppServerTransportRegistry = (
  ...args: Parameters<typeof createEffectCodexAppServerTransportRegistry>
) => createEffectCodexAppServerTransportRegistry(...args);
const createSystemCommands = (): SystemCommandPort => ({
  resolveCommandPath(command) {
    return Effect.succeed(command);
  },
  requiredCommandError() {
    return Effect.succeed(null);
  },
  versionCommand() {
    return Effect.succeed("codex 1.0.0");
  },
  runCommandAllowFailure() {
    return Effect.succeed({ ok: true, stdout: "", stderr: "" });
  },
});
const createFakeCodex = async (
  root: string,
  {
    childPidPath,
    emitStreamEvents = false,
  }: { childPidPath?: string; emitStreamEvents?: boolean } = {},
): Promise<string> => {
  const scriptPath = join(root, "codex.mjs");
  await writeFile(
    scriptPath,
    `import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { writeFileSync } from "node:fs";

const capturePath = process.env.CODEX_CAPTURE_PATH;
const childPidPath = ${JSON.stringify(childPidPath ?? null)};
const emitStreamEvents = ${JSON.stringify(emitStreamEvents)};
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
if (childPidPath) {
  const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000);"], {
    stdio: "ignore",
  });
  writeFileSync(childPidPath, String(child.pid));
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
    if (emitStreamEvents) {
      process.stdout.write(JSON.stringify({ jsonrpc: "2.0", method: "codex/app-server/ready", params: { threadId: "thread-1" } }) + "\\n");
      process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: 99, method: "item/tool/call", params: { threadId: "thread-1" } }) + "\\n");
    }
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
  return writeFakeRuntimeCommand(root, "codex", "codex.mjs");
};
const waitForEvents = async (events: unknown[], count: number): Promise<void> => {
  const deadline = Date.now() + 1000;
  while (Date.now() < deadline) {
    if (events.length >= count) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`Timed out waiting for ${count} Codex app-server event(s).`);
};

const waitFor = async (predicate: () => boolean, timeoutMs = 1_000): Promise<void> => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("Timed out waiting for condition.");
};

const processIsAlive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
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
      Effect.runPromise(
        starter.startWorkspaceRuntime({
          runtimeKind: "codex",
          repoPath: "/repo",
          workingDirectory: "/repo",
          descriptor: RUNTIME_DESCRIPTORS_BY_KIND.codex,
        }),
      ),
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
      const promiseCodexAppServer = codexAppServer;
      const starter = createCodexWorkspaceRuntimeStarter({
        systemCommands: createSystemCommands(),
        codexAppServer,
        codexBinary,
        mcpCommand: ["mcp-bin", "--stdio"],
        clientVersion: "0.3.1-test",
        resolveMcpBridgeConnection: () =>
          Effect.tryPromise({
            try: async () => {
              return {
                workspaceId: "repo",
                hostUrl: "http://127.0.0.1:14327",
                hostToken: "token-1",
              };
            },
            catch: (cause) =>
              new HostOperationError({
                operation: "test.effect",
                message: cause instanceof Error ? cause.message : String(cause),
                cause: cause,
              }),
          }),
        requestTimeoutMs: 4000,
        now: () => new Date("2026-05-10T10:00:00.000Z"),
        runtimeId: () => "runtime-1",
      });
      const handle = await Effect.runPromise(
        starter.startWorkspaceRuntime({
          runtimeKind: "codex",
          repoPath: repo,
          workingDirectory: repo,
          descriptor: RUNTIME_DESCRIPTORS_BY_KIND.codex,
        }),
      );
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
        Effect.runPromise(
          promiseCodexAppServer.request({
            runtimeId: "runtime-1",
            method: "thread/loaded/list",
            params: { cursor: null },
          }),
        ),
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
      await expect(Effect.runPromise(handle.stop())).resolves.toBeUndefined();
      await expect(
        Effect.runPromise(
          promiseCodexAppServer.request({ runtimeId: "runtime-1", method: "thread/loaded/list" }),
        ),
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
  test("stops the Codex app-server process tree including descendants", async () => {
    const root = await mkdtemp(join(tmpdir(), "odt-codex-starter-tree-"));
    let childPid: number | null = null;
    try {
      const repo = join(root, "repo");
      const childPidPath = join(root, "child.pid");
      await mkdir(repo);
      const codexBinary = await createFakeCodex(root, { childPidPath });
      const codexAppServer = createCodexAppServerTransportRegistry();
      const starter = createCodexWorkspaceRuntimeStarter({
        systemCommands: createSystemCommands(),
        codexAppServer,
        codexBinary,
        mcpCommand: ["mcp-bin", "--stdio"],
        resolveMcpBridgeConnection: () =>
          Effect.succeed({
            workspaceId: "repo",
            hostUrl: "http://127.0.0.1:14327",
            hostToken: "token-1",
          }),
        requestTimeoutMs: 4_000,
        runtimeId: () => "runtime-tree",
      });

      const handle = await Effect.runPromise(
        starter.startWorkspaceRuntime({
          runtimeKind: "codex",
          repoPath: repo,
          workingDirectory: repo,
          descriptor: RUNTIME_DESCRIPTORS_BY_KIND.codex,
        }),
      );
      await waitFor(() => existsSync(childPidPath));
      childPid = Number(await readFile(childPidPath, "utf8"));
      expect(processIsAlive(childPid)).toBe(true);

      await Effect.runPromise(handle.stop());
      await waitFor(() => !processIsAlive(childPid as number));
    } finally {
      if (childPid !== null && processIsAlive(childPid)) {
        process.kill(childPid, "SIGKILL");
      }
      await removeTestDirectory(root);
    }
  });

  test("keeps process-tree cleanup failures visible while unregistering transport", async () => {
    const root = await mkdtemp(join(tmpdir(), "odt-codex-cleanup-failure-"));
    try {
      const repo = join(root, "repo");
      await mkdir(repo);
      const codexBinary = await createFakeCodex(root);
      const codexAppServer = createCodexAppServerTransportRegistry();
      const starter = createCodexWorkspaceRuntimeStarter({
        systemCommands: createSystemCommands(),
        codexAppServer,
        codexBinary,
        mcpCommand: ["mcp-bin", "--stdio"],
        resolveMcpBridgeConnection: () =>
          Effect.succeed({
            workspaceId: "repo",
            hostUrl: "http://127.0.0.1:14327",
            hostToken: "token-1",
          }),
        requestTimeoutMs: 4_000,
        runtimeId: () => "runtime-cleanup-failure",
        processTreeTerminator: async () => {
          throw new Error("process tree stayed alive");
        },
      });

      const handle = await Effect.runPromise(
        starter.startWorkspaceRuntime({
          runtimeKind: "codex",
          repoPath: repo,
          workingDirectory: repo,
          descriptor: RUNTIME_DESCRIPTORS_BY_KIND.codex,
        }),
      );

      await expect(Effect.runPromise(handle.stop())).rejects.toThrow(
        "process tree: process tree stayed alive",
      );
      await expect(
        Effect.runPromise(
          codexAppServer.request({
            runtimeId: "runtime-cleanup-failure",
            method: "thread/loaded/list",
          }),
        ),
      ).rejects.toThrow("Codex app-server transport not found");
    } finally {
      await removeTestDirectory(root);
    }
  });

  test("starts a Windows PATH-discovered cmd Codex app-server runtime", async () => {
    if (process.platform !== "win32") {
      return;
    }

    const root = await mkdtemp(join(tmpdir(), "odt-codex-path-starter-"));
    const originalCapturePath = process.env.CODEX_CAPTURE_PATH;
    try {
      const repo = join(root, "repo");
      await mkdir(repo);
      const capturePath = join(root, "capture.json");
      process.env.CODEX_CAPTURE_PATH = capturePath;
      const codexBinary = await createFakeCodex(root);
      const codexAppServer = createCodexAppServerTransportRegistry();
      const pathWithFakeRuntime = `${root};${process.env.PATH ?? ""}`;
      const starter = createCodexWorkspaceRuntimeStarter({
        systemCommands: createSystemCommandRunner({
          env: { ...process.env, PATH: pathWithFakeRuntime, PATHEXT: ".CMD" },
          platform: "win32",
        }),
        processEnv: { ...process.env, PATH: pathWithFakeRuntime, PATHEXT: ".CMD" },
        codexAppServer,
        mcpCommand: ["mcp-bin", "--stdio"],
        clientVersion: "0.3.1-test",
        resolveMcpBridgeConnection: () =>
          Effect.succeed({
            workspaceId: "repo",
            hostUrl: "http://127.0.0.1:14327",
            hostToken: "token-1",
          }),
        requestTimeoutMs: 4_000,
        runtimeId: () => "runtime-path",
      });

      expect(codexBinary.endsWith(".cmd")).toBe(true);
      const handle = await Effect.runPromise(
        starter.startWorkspaceRuntime({
          runtimeKind: "codex",
          repoPath: repo,
          workingDirectory: repo,
          descriptor: RUNTIME_DESCRIPTORS_BY_KIND.codex,
        }),
      );

      expect(handle.runtime.runtimeId).toBe("runtime-path");
      const capture = JSON.parse(await readFile(capturePath, "utf8"));
      expect(capture.args).toContain("app-server");
      await expect(Effect.runPromise(handle.stop())).resolves.toBeUndefined();
    } finally {
      if (originalCapturePath === undefined) {
        delete process.env.CODEX_CAPTURE_PATH;
      } else {
        process.env.CODEX_CAPTURE_PATH = originalCapturePath;
      }
      await removeTestDirectory(root);
    }
  });

  test("emits Codex app-server stream events and keeps notifications available for drain polling", async () => {
    const root = await mkdtemp(join(tmpdir(), "odt-codex-starter-events-"));
    try {
      const repo = join(root, "repo");
      await mkdir(repo);
      const codexBinary = await createFakeCodex(root, { emitStreamEvents: true });
      const codexAppServer = createCodexAppServerTransportRegistry();
      const promiseCodexAppServer = codexAppServer;
      const events: unknown[] = [];
      const starter = createCodexWorkspaceRuntimeStarter({
        systemCommands: createSystemCommands(),
        codexAppServer,
        codexBinary,
        mcpCommand: ["mcp-bin", "--stdio"],
        eventEmitter: (event) => events.push(event),
        resolveMcpBridgeConnection: () =>
          Effect.tryPromise({
            try: async () => {
              return {
                workspaceId: "repo",
                hostUrl: "http://127.0.0.1:14327",
                hostToken: "token-1",
              };
            },
            catch: (cause) =>
              new HostOperationError({
                operation: "test.effect",
                message: cause instanceof Error ? cause.message : String(cause),
                cause: cause,
              }),
          }),
        requestTimeoutMs: 4000,
        runtimeId: () => "runtime-events",
      });
      const handle = await Effect.runPromise(
        starter.startWorkspaceRuntime({
          runtimeKind: "codex",
          repoPath: repo,
          workingDirectory: repo,
          descriptor: RUNTIME_DESCRIPTORS_BY_KIND.codex,
        }),
      );
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
      await expect(
        Effect.runPromise(promiseCodexAppServer.drainNotifications("runtime-events")),
      ).resolves.toEqual([
        {
          jsonrpc: "2.0",
          method: "codex/app-server/ready",
          params: { threadId: "thread-1" },
        },
      ]);
      await expect(
        Effect.runPromise(promiseCodexAppServer.drainServerRequests("runtime-events")),
      ).resolves.toEqual([]);
      await Effect.runPromise(handle.stop());
    } finally {
      await removeTestDirectory(root);
    }
  });
});

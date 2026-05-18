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
import {
  buildOpenCodeConfigContent,
  createOpenCodeWorkspaceRuntimeStarter as createEffectOpenCodeWorkspaceRuntimeStarter,
} from "./opencode-workspace-runtime-starter";

const createOpenCodeWorkspaceRuntimeStarter = (
  ...args: Parameters<typeof createEffectOpenCodeWorkspaceRuntimeStarter>
) => createEffectOpenCodeWorkspaceRuntimeStarter(...args);
const createSystemCommands = (): SystemCommandPort => ({
  resolveCommandPath(command) {
    return Effect.succeed(command);
  },
  requiredCommandError() {
    return Effect.succeed(null);
  },
  versionCommand() {
    return Effect.succeed("opencode 1.0.0");
  },
  runCommandAllowFailure() {
    return Effect.succeed({ ok: true, stdout: "", stderr: "" });
  },
});

const processIsAlive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
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

const createFakeOpenCode = async (
  root: string,
  options: { childPidPath?: string } = {},
): Promise<string> => {
  const scriptPath = join(root, "opencode.mjs");
  await writeFile(
    scriptPath,
    `import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";

const args = process.argv.slice(2);
if (args[0] !== "serve") {
  console.error("expected serve command");
  process.exit(2);
}
const portFlagIndex = args.indexOf("--port");
if (Number(args[portFlagIndex + 1]) !== 43123) {
  console.error("unexpected port");
  process.exit(2);
}
const childPidPath = ${JSON.stringify(options.childPidPath ?? null)};
if (childPidPath) {
  const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000);"], {
    stdio: "ignore",
  });
  writeFileSync(childPidPath, String(child.pid));
}
const keepAlive = setInterval(() => {}, 1000);
const stop = () => {
  clearInterval(keepAlive);
  process.exit(0);
};
process.on("SIGTERM", stop);
process.on("SIGINT", stop);
`,
  );
  return writeFakeRuntimeCommand(root, "opencode", "opencode.mjs");
};
describe("createOpenCodeWorkspaceRuntimeStarter", () => {
  test("builds OpenCode config content for the host bridge MCP", () => {
    expect(
      JSON.parse(
        buildOpenCodeConfigContent(
          {
            workspaceId: "repo",
            hostUrl: "http://127.0.0.1:14327",
            hostToken: "token-1",
          },
          ["mcp-bin", "--stdio"],
        ),
      ),
    ).toEqual({
      logLevel: "INFO",
      mcp: {
        openducktor: {
          type: "local",
          enabled: true,
          command: ["mcp-bin", "--stdio"],
          environment: {
            ODT_WORKSPACE_ID: "repo",
            ODT_HOST_URL: "http://127.0.0.1:14327",
            ODT_HOST_TOKEN: "token-1",
            ODT_FORBID_WORKSPACE_ID_INPUT: "true",
          },
        },
      },
    });
  });
  test("fails fast when the MCP bridge connection is not configured", async () => {
    const starter = createOpenCodeWorkspaceRuntimeStarter({
      systemCommands: createSystemCommands(),
      mcpCommand: ["mcp-bin"],
    });
    await expect(
      Effect.runPromise(
        starter.startWorkspaceRuntime({
          runtimeKind: "opencode",
          repoPath: "/repo",
          workingDirectory: "/repo",
          descriptor: RUNTIME_DESCRIPTORS_BY_KIND.opencode,
        }),
      ),
    ).rejects.toThrow("OpenCode workspace startup requires an MCP host bridge connection.");
  });
  test("starts a reachable OpenCode workspace runtime and stops its process", async () => {
    const root = await mkdtemp(join(tmpdir(), "odt-opencode-starter-"));
    try {
      const repo = join(root, "repo");
      await mkdir(repo);
      const opencodeBinary = await createFakeOpenCode(root);
      const portProbeCalls: number[] = [];
      const starter = createOpenCodeWorkspaceRuntimeStarter({
        systemCommands: createSystemCommands(),
        opencodeBinary,
        mcpCommand: ["mcp-bin"],
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
        startupTimeoutMs: 2000,
        retryDelayMs: 1,
        portAllocator: () =>
          Effect.tryPromise({
            try: async () => {
              return 43123;
            },
            catch: (cause) =>
              new HostOperationError({
                operation: "test.effect",
                message: cause instanceof Error ? cause.message : String(cause),
                cause: cause,
              }),
          }),
        portProbe: (port) =>
          Effect.tryPromise({
            try: async () => {
              portProbeCalls.push(port);
              return portProbeCalls.length === 3;
            },
            catch: (cause) =>
              new HostOperationError({
                operation: "test.effect",
                message: cause instanceof Error ? cause.message : String(cause),
                cause: cause,
              }),
          }),
        now: () => new Date("2026-05-10T10:00:00.000Z"),
        runtimeId: () => "runtime-1",
      });
      const handle = await Effect.runPromise(
        starter.startWorkspaceRuntime({
          runtimeKind: "opencode",
          repoPath: repo,
          workingDirectory: repo,
          descriptor: RUNTIME_DESCRIPTORS_BY_KIND.opencode,
        }),
      );
      expect(handle.runtime).toMatchObject({
        kind: "opencode",
        runtimeId: "runtime-1",
        repoPath: repo,
        role: "workspace",
        workingDirectory: repo,
        runtimeRoute: {
          type: "local_http",
          endpoint: "http://127.0.0.1:43123",
        },
        startedAt: "2026-05-10T10:00:00.000Z",
      });
      expect(portProbeCalls).toEqual([43123, 43123, 43123]);
      await expect(Effect.runPromise(handle.stop())).resolves.toBeUndefined();
    } finally {
      await removeTestDirectory(root);
    }
  });

  test("stops the OpenCode runtime process tree including descendants", async () => {
    const root = await mkdtemp(join(tmpdir(), "odt-opencode-starter-tree-"));
    let childPid: number | null = null;
    try {
      const repo = join(root, "repo");
      const childPidPath = join(root, "child.pid");
      await mkdir(repo);
      const opencodeBinary = await createFakeOpenCode(root, { childPidPath });
      const starter = createOpenCodeWorkspaceRuntimeStarter({
        systemCommands: createSystemCommands(),
        opencodeBinary,
        mcpCommand: ["mcp-bin"],
        resolveMcpBridgeConnection: () =>
          Effect.succeed({
            workspaceId: "repo",
            hostUrl: "http://127.0.0.1:14327",
            hostToken: "token-1",
          }),
        startupTimeoutMs: 2_000,
        retryDelayMs: 20,
        portAllocator: () => Effect.succeed(43123),
        portProbe: () => Effect.succeed(true),
        runtimeId: () => "runtime-tree",
      });

      const handle = await Effect.runPromise(
        starter.startWorkspaceRuntime({
          runtimeKind: "opencode",
          repoPath: repo,
          workingDirectory: repo,
          descriptor: RUNTIME_DESCRIPTORS_BY_KIND.opencode,
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

  test("cleans up a spawned OpenCode process tree after startup timeout", async () => {
    const root = await mkdtemp(join(tmpdir(), "odt-opencode-timeout-cleanup-"));
    let childPid: number | null = null;
    try {
      const repo = join(root, "repo");
      const childPidPath = join(root, "child.pid");
      await mkdir(repo);
      const opencodeBinary = await createFakeOpenCode(root, { childPidPath });
      const starter = createOpenCodeWorkspaceRuntimeStarter({
        systemCommands: createSystemCommands(),
        opencodeBinary,
        mcpCommand: ["mcp-bin"],
        resolveMcpBridgeConnection: () =>
          Effect.succeed({
            workspaceId: "repo",
            hostUrl: "http://127.0.0.1:14327",
            hostToken: "token-1",
          }),
        startupTimeoutMs: 100,
        retryDelayMs: 5,
        portAllocator: () => Effect.succeed(43123),
        portProbe: () =>
          Effect.promise(() => waitFor(() => existsSync(childPidPath))).pipe(Effect.as(false)),
      });

      await expect(
        Effect.runPromise(
          starter.startWorkspaceRuntime({
            runtimeKind: "opencode",
            repoPath: repo,
            workingDirectory: repo,
            descriptor: RUNTIME_DESCRIPTORS_BY_KIND.opencode,
          }),
        ),
      ).rejects.toThrow("Timed out waiting for OpenCode runtime on 127.0.0.1:43123.");
      childPid = Number(await readFile(childPidPath, "utf8"));
      await waitFor(() => !processIsAlive(childPid as number));
    } finally {
      if (childPid !== null && processIsAlive(childPid)) {
        process.kill(childPid, "SIGKILL");
      }
      await removeTestDirectory(root);
    }
  });

  test("reports OpenCode process-tree cleanup failures", async () => {
    const root = await mkdtemp(join(tmpdir(), "odt-opencode-cleanup-failure-"));
    let runtimePid: number | null = null;
    try {
      const repo = join(root, "repo");
      await mkdir(repo);
      const opencodeBinary = await createFakeOpenCode(root);
      const starter = createOpenCodeWorkspaceRuntimeStarter({
        systemCommands: createSystemCommands(),
        opencodeBinary,
        mcpCommand: ["mcp-bin"],
        resolveMcpBridgeConnection: () =>
          Effect.succeed({
            workspaceId: "repo",
            hostUrl: "http://127.0.0.1:14327",
            hostToken: "token-1",
          }),
        startupTimeoutMs: 2_000,
        retryDelayMs: 20,
        portAllocator: () => Effect.succeed(43123),
        portProbe: () => Effect.succeed(true),
        runtimeId: () => "runtime-failure",
        processTreeTerminator: ({ pid }) => {
          runtimePid = pid;
          return Effect.fail(
            new HostOperationError({
              operation: "test.processTreeTerminator",
              message: "process tree stayed alive",
            }),
          );
        },
      });

      const handle = await Effect.runPromise(
        starter.startWorkspaceRuntime({
          runtimeKind: "opencode",
          repoPath: repo,
          workingDirectory: repo,
          descriptor: RUNTIME_DESCRIPTORS_BY_KIND.opencode,
        }),
      );

      await expect(Effect.runPromise(handle.stop())).rejects.toThrow("process tree stayed alive");
    } finally {
      if (runtimePid !== null && processIsAlive(runtimePid)) {
        process.kill(runtimePid, "SIGKILL");
      }
      await removeTestDirectory(root);
    }
  });

  test("includes startup timeout cleanup failures", async () => {
    const root = await mkdtemp(join(tmpdir(), "odt-opencode-timeout-cleanup-failure-"));
    try {
      const repo = join(root, "repo");
      await mkdir(repo);
      const opencodeBinary = await createFakeOpenCode(root);
      const starter = createOpenCodeWorkspaceRuntimeStarter({
        systemCommands: createSystemCommands(),
        opencodeBinary,
        mcpCommand: ["mcp-bin"],
        resolveMcpBridgeConnection: () =>
          Effect.succeed({
            workspaceId: "repo",
            hostUrl: "http://127.0.0.1:14327",
            hostToken: "token-1",
          }),
        startupTimeoutMs: 20,
        retryDelayMs: 5,
        portAllocator: () => Effect.succeed(43123),
        portProbe: () => Effect.succeed(false),
        processTreeTerminator: ({ pid }) => {
          process.kill(pid, "SIGTERM");
          return Effect.fail(
            new HostOperationError({
              operation: "test.processTreeTerminator",
              message: "process tree cleanup failed",
            }),
          );
        },
      });

      await expect(
        Effect.runPromise(
          starter.startWorkspaceRuntime({
            runtimeKind: "opencode",
            repoPath: repo,
            workingDirectory: repo,
            descriptor: RUNTIME_DESCRIPTORS_BY_KIND.opencode,
          }),
        ),
      ).rejects.toThrow(
        "Timed out waiting for OpenCode runtime on 127.0.0.1:43123. Cleanup failed: process tree cleanup failed",
      );
    } finally {
      await removeTestDirectory(root);
    }
  });

  test("starts a Windows PATH-discovered cmd OpenCode runtime", async () => {
    if (process.platform !== "win32") {
      return;
    }

    const root = await mkdtemp(join(tmpdir(), "odt-opencode-path-starter-"));
    try {
      const repo = join(root, "repo");
      await mkdir(repo);
      const opencodeBinary = await createFakeOpenCode(root);
      const pathWithFakeRuntime = `${root};${process.env.PATH ?? ""}`;
      const starter = createOpenCodeWorkspaceRuntimeStarter({
        systemCommands: createSystemCommandRunner({
          env: { ...process.env, PATH: pathWithFakeRuntime, PATHEXT: ".CMD" },
          platform: "win32",
        }),
        processEnv: { ...process.env, PATH: pathWithFakeRuntime, PATHEXT: ".CMD" },
        mcpCommand: ["mcp-bin"],
        resolveMcpBridgeConnection: () =>
          Effect.succeed({
            workspaceId: "repo",
            hostUrl: "http://127.0.0.1:14327",
            hostToken: "token-1",
          }),
        startupTimeoutMs: 2_000,
        retryDelayMs: 20,
        portAllocator: () => Effect.succeed(43123),
        portProbe: () => Effect.succeed(true),
        runtimeId: () => "runtime-path",
      });

      expect(opencodeBinary.endsWith(".cmd")).toBe(true);
      const handle = await Effect.runPromise(
        starter.startWorkspaceRuntime({
          runtimeKind: "opencode",
          repoPath: repo,
          workingDirectory: repo,
          descriptor: RUNTIME_DESCRIPTORS_BY_KIND.opencode,
        }),
      );

      expect(handle.runtime.runtimeId).toBe("runtime-path");
      await expect(Effect.runPromise(handle.stop())).resolves.toBeUndefined();
    } finally {
      await removeTestDirectory(root);
    }
  });
});
